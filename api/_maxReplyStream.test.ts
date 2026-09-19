import assert from "node:assert/strict";
import test from "node:test";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { createMaxReplyStream, MAX_REPLY_EMPTY, MAX_REPLY_UNAVAILABLE, MAX_REPLY_INTERRUPTED, MAX_REPLY_LIMIT, MAX_REPLY_NOT_SAVED } from "./_maxReplyStream.js";
import type { MaxReplyOutcome } from "./_maxReplyStream.js";

const delta = (text: string): RawMessageStreamEvent => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const stop: RawMessageStreamEvent = { type: "message_stop" };
const limit = { type: "message_delta", delta: { stop_reason: "max_tokens" } } as RawMessageStreamEvent;

function fixture(events: RawMessageStreamEvent[], options: { providerError?: Error; saveError?: Error; save?: () => Promise<void> } = {}) {
  const outcomes: MaxReplyOutcome[] = [];
  const errors: string[] = [];
  let cancels = 0;
  const source = {
    abort() { cancels++; },
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
      if (options.providerError) throw options.providerError;
    },
  };
  const stream = createMaxReplyStream(source, {
    async settle(outcome) {
      outcomes.push(outcome);
      await options.save?.();
      if (options.saveError) throw options.saveError;
    },
    cancel() { cancels++; },
    error(stage) { errors.push(stage); },
  });
  return { stream, outcomes, errors, cancels: () => cancels };
}

test("complete replies stream normally and settle the same visible text once", async () => {
  const f = fixture([delta("Keep it "), delta("simple."), stop]);
  assert.equal(await new Response(f.stream).text(), "Keep it simple.");
  assert.deepEqual(f.outcomes, [{ text: "Keep it simple.", delivered: true, cancelled: false }]);
  assert.deepEqual(f.errors, []);
});

test("empty, whitespace and markup-only replies get a retry notice and no delivered-turn claim", async () => {
  for (const text of ["", " \n\t", "**`__", "\u200b\ufeff"]) {
    const f = fixture([delta(text), stop]);
    assert.ok((await new Response(f.stream).text()).includes(MAX_REPLY_EMPTY));
    assert.equal(f.outcomes[0].delivered, false);
    assert.ok(f.outcomes[0].text.includes(MAX_REPLY_EMPTY));
  }
});

test("provider failure before any answer releases the turn through its outcome", async () => {
  const f = fixture([], { providerError: new Error("provider offline") });
  assert.equal(await new Response(f.stream).text(), MAX_REPLY_UNAVAILABLE);
  assert.equal(f.outcomes[0].delivered, false);
  assert.deepEqual(f.errors, ["provider"]);
});

test("provider credit errors give a neutral unavailable notice without leaking billing details", async () => {
  const providerError = Object.assign(new Error("Your credit balance is too low to access the API. Please go to Plans & Billing to upgrade or purchase credits."), {
    status: 400, error: { type: "invalid_request_error" },
  });
  const f = fixture([], { providerError });
  const text = await new Response(f.stream).text();
  assert.equal(text, MAX_REPLY_UNAVAILABLE);
  assert.doesNotMatch(text, /credit|billing|upgrade|invalid_request|400/i);
  assert.equal(f.outcomes[0].delivered, false);
  assert.deepEqual(f.errors, ["provider"]);
});

test("dropped streams keep the partial reply and persist its interruption notice", async () => {
  for (const providerError of [undefined, new Error("connection reset")]) {
    const f = fixture([delta("The next step is")], { providerError });
    const visible = await new Response(f.stream).text();
    assert.equal(visible, `The next step is\n\n${MAX_REPLY_INTERRUPTED}`);
    assert.equal(f.outcomes[0].text, visible);
    assert.equal(f.outcomes[0].delivered, true);
  }
});

test("output-limit completion is explicit instead of silently ending half an answer", async () => {
  const f = fixture([delta("Keep these two priorities"), limit, stop]);
  const visible = await new Response(f.stream).text();
  assert.ok(visible.endsWith(MAX_REPLY_LIMIT));
  assert.equal(f.outcomes[0].text, visible);
});

test("a persistence exception closes the body with an honest notice rather than hanging", async () => {
  const f = fixture([delta("One useful action."), stop], { saveError: new Error("save failed") });
  assert.equal(await new Response(f.stream).text(), `One useful action.\n\n${MAX_REPLY_NOT_SAVED}`);
  assert.deepEqual(f.errors, ["persistence"]);
});

test("cancellation during persistence does not enqueue or close the cancelled controller", async () => {
  let saveStarted!: () => void;
  let finishSave!: () => void;
  const started = new Promise<void>((resolve) => { saveStarted = resolve; });
  const pending = new Promise<void>((resolve) => { finishSave = resolve; });
  const f = fixture([delta("Reply"), stop], { save: async () => { saveStarted(); await pending; }, saveError: new Error("save failed") });
  const reader = f.stream.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "Reply");
  await started;
  await reader.cancel();
  finishSave();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(f.cancels(), 2, "source abort and claim cancellation both run");
  assert.deepEqual(f.errors, ["persistence"]);
  assert.equal((await reader.read()).done, true);
});

test("cancellation while the provider waits settles silently and cannot write into a later chat", async () => {
  let rejectRead!: (error: unknown) => void;
  const waiting = new Promise<never>((_resolve, reject) => { rejectRead = reject; });
  const outcomes: MaxReplyOutcome[] = [];
  const errors: unknown[] = [];
  let cancelled = 0;
  const stream = createMaxReplyStream({
    async *[Symbol.asyncIterator]() { yield delta("Start"); await waiting; },
    abort() { rejectRead(new Error("cancelled")); },
  }, {
    async settle(outcome) { outcomes.push(outcome); },
    cancel() { cancelled++; },
    error(_stage, error) { errors.push(error); },
  });
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(cancelled, 1);
  assert.equal(outcomes[0]?.cancelled, true);
  assert.deepEqual(errors, []);
});
