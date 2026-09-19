import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { drainMaxStream, maxStreamErrorMessage } from "./maxStream.js";
import type { MaxStreamView } from "./maxStream.js";
import { parseMaxRemaining } from "../engine/maxAllowance.js";
import { maxReplyText } from "../engine/maxReplyText.js";
import { maxUndeliveredReply, MAX_REPLY_UNAVAILABLE, MAX_REPLY_EMPTY, MAX_REPLY_INTERRUPTED } from "../engine/maxReplyStatus.js";
import { maxTextMouthLevel } from "./maxSpeechText.js";

// Exercise the actual private ask function with isolated network/DOM seams.
// No browser, Auth request or paid chat request is made by these tests.
const source = readFileSync(new URL("./maxChat.ts", import.meta.url), "utf8");
const askSource = source.slice(source.indexOf("async function ask("), source.indexOf("// The line under the composer."));
const askJS = ts.transpileModule(askSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const failSource = source.slice(source.indexOf("function fail("), source.indexOf("// The answer lives in a child span"));
const failJS = ts.transpileModule(failSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

function scenario() {
  let nextTimer = 0;
  let nextFrame = 0;
  let now = 0;
  let writes = 0;
  let speechClears = 0;
  const speechUpdates: string[] = [];
  const timers = new Map<number, () => void>();
  const frames = new Map<number, FrameRequestCallback>();
  const classes = (names: string[] = []) => {
    const values = new Set(names);
    return {
      add: (...added: string[]) => { writes++; added.forEach((name) => values.add(name)); },
      remove: (...removed: string[]) => { writes++; removed.forEach((name) => values.delete(name)); },
      contains: (name: string) => values.has(name),
    };
  };
  const face = { isConnected: true, classList: classes(["mx-mood-happy"]) };
  const scope = { querySelector: () => face };
  const log = { isConnected: true, scrollHeight: 100, scrollTop: 0, clientHeight: 100 };
  const form = { isConnected: true, classList: classes(), closest: () => scope };
  const bubbles: { isConnected: boolean; classList: ReturnType<typeof classes>; innerHTML: string; querySelector: () => null }[] = [];
  const errors: string[] = [];
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { bodyController = controller; } });
  const deps = {
    currentAccessToken: async () => "test-token-not-a-credential",
    fetch: async () => new Response(stream, { headers: { "X-Max-Remaining": "5" } }),
    say: () => {
      const bubble = {
        isConnected: true, classList: classes(), innerHTML: "", querySelector: () => null, closest: () => scope,
        set textContent(value: string) { writes++; errors.push(value); },
      };
      bubbles.push(bubble);
      return bubble;
    },
    write: () => { writes++; },
    reactMax: () => { writes++; },
    showAllowance: () => {},
    allowanceLine: () => null,
    announceMaxConversationChanged: () => {},
    buildCoachingSnapshot: () => ({ routines: [] }),
    loadProfile: () => ({}),
    readProtocols: () => [],
    activeScanOwner: () => "user:test-owner",
    chatSpeech: {
      clear: () => { writes++; speechClears++; },
      update: (text: string) => { writes++; speechUpdates.push(text); },
    },
    parseMaxRemaining, maxTextMouthLevel, maxReplyText, maxUndeliveredReply,
    window: {
      setTimeout: (fn: () => void) => { const id = ++nextTimer; timers.set(id, fn); return id; },
      clearTimeout: (id: number) => timers.delete(id),
    },
    drainMaxStream: (body: ReadableStream<Uint8Array>, view: MaxStreamView) => drainMaxStream(body, view, {
      now: () => now,
      request: (fn) => { const id = ++nextFrame; frames.set(id, fn); return id; },
      cancel: (id) => { frames.delete(id); },
    }),
    maxStreamErrorMessage,
  };
  const runtime = new Function("deps", `
    const {currentAccessToken,fetch,say,write,reactMax,showAllowance,allowanceLine,
      announceMaxConversationChanged,window,drainMaxStream,maxStreamErrorMessage,
      buildCoachingSnapshot,loadProfile,readProtocols,activeScanOwner,chatSpeech,
      parseMaxRemaining,maxTextMouthLevel,maxReplyText,maxUndeliveredReply}=deps;
    const GIVE_UP_MS=90000;
    let chatGeneration=1, inFlight=null, transcript=[], chatAvatar=null;
    ${askJS}
    ${failJS}
    return {
      ask:(log,form)=>ask(log,form,"Hello",null,1,{conversationId:null,source:"dashboard",onConversation:()=>{}}),
      state:()=>({inFlight,transcript}),
      replace:()=>{
        const old=inFlight;
        chatGeneration++;
        transcript=[{role:"user",content:"new chat"}];
        inFlight=new AbortController();
        old?.abort();
        return inFlight;
      }
    };
  `)(deps) as {
    ask(log: unknown, form: unknown): Promise<string | null>;
    state(): { inFlight: AbortController | null; transcript: { content: string }[] };
    replace(): AbortController;
  };
  return {
    runtime, log, form, face, errors, bubbles, stream, bodyController, timers, frames,
    writes: () => writes,
    speechClears: () => speechClears,
    speechUpdates,
    expire: () => [...timers.values()].forEach((fn) => fn()),
    frame: () => {
      now += 100;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn(now));
    },
  };
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test("actual chat request exits busy/thinking and clears its deadline on a reader failure", async () => {
  const s = scenario();
  const result = s.runtime.ask(s.log, s.form);
  await flush();
  assert.equal(s.form.classList.contains("busy"), true);
  const beforeFailure = s.speechClears();
  s.bodyController.error(new Error("network lost"));
  assert.equal(await result, null);
  assert.equal(s.form.classList.contains("busy"), false);
  assert.equal(s.face.classList.contains("mx-mood-thinking"), false);
  assert.equal(s.face.classList.contains("speaking"), false);
  assert.match(s.errors[0]!, /lost the connection/);
  assert.equal(s.runtime.state().inFlight, null);
  assert.deepEqual(s.runtime.state().transcript, []);
  assert.equal(s.timers.size, 0);
  assert.equal(s.frames.size, 0);
  assert.ok(s.speechClears() > beforeFailure, "the actual error renderer clears the mascot's speech bubble");
});

test("actual timeout shows timeout copy and releases chat controls without a frame", async () => {
  const s = scenario();
  const result = s.runtime.ask(s.log, s.form);
  await flush();
  s.expire();
  assert.equal(await result, null);
  assert.match(s.errors[0]!, /too long/);
  assert.equal(s.form.classList.contains("busy"), false);
  assert.equal(s.face.classList.contains("mx-mood-thinking"), false);
  assert.equal(s.runtime.state().inFlight, null);
  assert.equal(s.timers.size, 0);
  assert.equal(s.frames.size, 0);
});

test("closing then opening a newer chat leaves its request and transcript untouched", async () => {
  const s = scenario();
  const result = s.runtime.ask(s.log, s.form);
  await flush();
  s.log.isConnected = s.form.isConnected = s.face.isConnected = false;
  for (const bubble of s.bubbles) bubble.isConnected = false;
  const newer = s.runtime.replace();
  const before = s.writes();
  assert.equal(await result, null);
  assert.equal(s.runtime.state().inFlight, newer);
  assert.deepEqual(s.runtime.state().transcript, [{ role: "user", content: "new chat" }]);
  assert.equal(s.writes(), before, "old request cannot mutate closed or replacement UI");
  assert.deepEqual(s.errors, []);
  assert.equal(s.timers.size, 0);
  assert.equal(s.frames.size, 0);
});

test("detaching the reply/log stops the stream and releases the surviving composer", async () => {
  const s = scenario();
  const result = s.runtime.ask(s.log, s.form);
  await flush();
  s.log.isConnected = false;
  s.frame();
  assert.equal(await result, null);
  assert.equal(s.form.classList.contains("busy"), false);
  assert.equal(s.face.classList.contains("mx-mood-thinking"), false);
  assert.equal(s.runtime.state().inFlight, null);
  assert.deepEqual(s.errors, []);
  assert.equal(s.timers.size, 0);
  assert.equal(s.frames.size, 0);
});

async function receiveReply(s: ReturnType<typeof scenario>, text: string): Promise<void> {
  s.bodyController.enqueue(new TextEncoder().encode(text));
  s.bodyController.close();
  await flush();
  for (let i = 0; i < 45; i++) { s.frame(); await flush(); }
}

test("undelivered service notices clear speech and do not become successful local assistant turns", async () => {
  for (const notice of [MAX_REPLY_UNAVAILABLE, MAX_REPLY_EMPTY]) {
    const s = scenario();
    const result = s.runtime.ask(s.log, s.form);
    await flush();
    const beforeFailure = s.speechClears();
    await receiveReply(s, notice);
    assert.equal(await result, null);
    assert.deepEqual(s.errors, [notice]);
    assert.deepEqual(s.runtime.state().transcript, []);
    assert.ok(s.speechClears() > beforeFailure);
    assert.equal(s.form.classList.contains("busy"), false);
    assert.equal(s.timers.size, 0);
    assert.equal(s.frames.size, 0);
  }
});

test("a useful partial answer retains its interruption notice and normal speech completion", async () => {
  const s = scenario();
  const result = s.runtime.ask(s.log, s.form);
  await flush();
  const text = `Keep one useful step.\n\n${MAX_REPLY_INTERRUPTED}`;
  await receiveReply(s, text);
  assert.equal(await result, text);
  const turns = s.runtime.state().transcript;
  assert.equal(turns[turns.length - 1]?.content, text);
  assert.deepEqual(s.errors, []);
  assert.equal(s.speechUpdates[s.speechUpdates.length - 1], text);
});
