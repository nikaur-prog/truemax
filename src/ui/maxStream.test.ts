import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { drainMaxStream, maxStreamErrorMessage } from "./maxStream.js";
import type { MaxStreamClock, MaxStreamView } from "./maxStream.js";

class Frames implements MaxStreamClock {
  time = 0;
  next = 0;
  pending = new Map<number, FrameRequestCallback>();
  now = () => this.time;
  request = (callback: FrameRequestCallback) => {
    const id = ++this.next;
    this.pending.set(id, callback);
    return id;
  };
  cancel = (id: number) => { this.pending.delete(id); };
  step(ms = 100) {
    this.time += ms;
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    callbacks.forEach((callback) => callback(this.time));
  }
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function setup(cancel?: UnderlyingSource<Uint8Array>["cancel"]) {
  const clock = new Frames();
  const abort = new AbortController();
  let current = true;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel });
  const writes: string[] = [];
  const waits: boolean[] = [];
  let begins = 0;
  const view: MaxStreamView = {
    signal: abort.signal,
    isCurrent: () => current,
    begin: () => { begins++; },
    write: (text) => { writes.push(text); },
    waiting: (on) => { waits.push(on); },
  };
  return {
    clock, abort, stream, controller, view, writes, waits,
    begins: () => begins,
    detach: () => { current = false; },
    enqueue: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
  };
}

test("successful chunks preserve pacing, scrub split markup and finish without extra frames", async () => {
  const s = setup();
  const result = drainMaxStream(s.stream, s.view, s.clock);
  s.enqueue("**Hello");
  await flush();
  s.clock.step(40);
  assert.equal(s.writes[s.writes.length - 1], "He");
  s.enqueue("**, world.");
  s.controller.close();
  await flush();
  s.clock.step(1000);
  assert.equal(await result, "Hello, world.");
  assert.equal(s.writes[s.writes.length - 1], "Hello, world.");
  assert.equal(s.begins(), 1);
  assert.equal(s.clock.pending.size, 0);
  assert.equal(s.stream.locked, false);
});

test("a reader failure before the first token rejects immediately without waiting for a frame", async () => {
  const s = setup();
  const problem = new Error("offline");
  const result = drainMaxStream(s.stream, s.view, s.clock);
  const rejected = assert.rejects(result, (error) => error === problem);
  s.controller.error(problem);
  await rejected;
  await flush();
  assert.equal(s.clock.pending.size, 0);
  assert.equal(s.stream.locked, false);
  assert.deepEqual(s.writes, []);
  assert.equal(s.begins(), 0);
});

test("a mid-stream failure stops the drain without changing the already shown text", async () => {
  const s = setup();
  const result = drainMaxStream(s.stream, s.view, s.clock);
  const rejected = assert.rejects(result, /lost connection/);
  s.enqueue("A partial reply");
  await flush();
  s.clock.step(100);
  const before = [...s.writes];
  s.controller.error(new Error("lost connection"));
  await rejected;
  s.clock.step(5000);
  assert.deepEqual(s.writes, before);
  assert.equal(s.clock.pending.size, 0);
  assert.equal(s.stream.locked, false);
});

test("timeout cancels a pending read and rejects even while frames are suspended", async () => {
  let cancelled: unknown;
  const s = setup((reason) => { cancelled = reason; });
  const timeout = new DOMException("timeout", "TimeoutError");
  const result = drainMaxStream(s.stream, s.view, s.clock);
  const rejected = assert.rejects(result, (error) => error === timeout);
  s.abort.abort(timeout);
  await rejected;
  await flush();
  assert.equal(cancelled, timeout);
  assert.equal(s.clock.pending.size, 0);
  assert.equal(s.stream.locked, false);
  assert.match(maxStreamErrorMessage(timeout, s.abort.signal)!, /too long/);
});

test("a cancelled source whose cancel promise hangs cannot strand presentation cleanup", async () => {
  const s = setup(() => new Promise<void>(() => {}));
  const result = drainMaxStream(s.stream, s.view, s.clock);
  const rejected = assert.rejects(result, { name: "AbortError" });
  s.abort.abort();
  await rejected;
  await flush();
  assert.equal(s.clock.pending.size, 0);
  assert.equal(s.stream.locked, false);
  assert.equal(maxStreamErrorMessage(s.abort.signal.reason, s.abort.signal), null);
});

test("closing or replacing the chat cancels a buffered answer before another UI write", async () => {
  let cancelled = false;
  const s = setup(() => { cancelled = true; });
  const result = drainMaxStream(s.stream, s.view, s.clock);
  const rejected = assert.rejects(result, { name: "AbortError" });
  s.enqueue("This response belongs to the old chat.");
  await flush();
  s.clock.step(100);
  const before = [...s.writes];
  s.detach();
  s.clock.step(100);
  await rejected;
  await flush();
  assert.equal(cancelled, true);
  assert.deepEqual(s.writes, before);
  assert.equal(s.clock.pending.size, 0);
  assert.equal(s.stream.locked, false);
});

test("an already-aborted request releases its reader without starting presentation", async () => {
  const s = setup();
  s.abort.abort();
  await assert.rejects(drainMaxStream(s.stream, s.view, s.clock), { name: "AbortError" });
  await flush();
  assert.equal(s.clock.pending.size, 0);
  assert.equal(s.stream.locked, false);
  assert.equal(s.begins(), 0);
});

test("closing the view inside a presentation callback cannot schedule or write again", async () => {
  const s = setup();
  s.view.begin = () => s.abort.abort();
  const result = drainMaxStream(s.stream, s.view, s.clock);
  const rejected = assert.rejects(result, { name: "AbortError" });
  s.enqueue("Hello");
  await flush();
  s.clock.step(100);
  await rejected;
  assert.deepEqual(s.writes, []);
  assert.equal(s.clock.pending.size, 0);
});

test("a quiet stream keeps its partial answer and toggles waiting until final completion", async () => {
  const s = setup();
  const result = drainMaxStream(s.stream, s.view, s.clock);
  s.clock.step(5000);
  assert.equal(s.begins(), 0);
  s.enqueue("Hello");
  await flush();
  s.clock.step(100);
  s.clock.step(1500);
  assert.deepEqual(s.waits, [true]);
  assert.equal(s.writes[s.writes.length - 1], "Hello");
  const writesBefore = s.writes.length;
  s.clock.step(100);
  assert.equal(s.writes.length, writesBefore, "waiting does not rewrite unchanged text");
  s.enqueue(" again");
  s.controller.close();
  await flush();
  s.clock.step(1000);
  assert.equal(await result, "Hello again");
  assert.deepEqual(s.waits, [true, false]);
  assert.equal(s.clock.pending.size, 0);
});

test("empty completed streams resolve and rendering errors reject with reader cleanup", async () => {
  const empty = setup();
  const result = drainMaxStream(empty.stream, empty.view, empty.clock);
  empty.controller.close();
  await flush();
  empty.clock.step();
  assert.equal(await result, "");
  assert.equal(empty.begins(), 0);
  assert.equal(empty.clock.pending.size, 0);

  const broken = setup();
  broken.view.write = () => { throw new Error("removed renderer"); };
  const failure = drainMaxStream(broken.stream, broken.view, broken.clock);
  const rejected = assert.rejects(failure, /removed renderer/);
  broken.enqueue("Hello");
  await flush();
  broken.clock.step();
  await rejected;
  await flush();
  assert.equal(broken.stream.locked, false);
  assert.equal(broken.clock.pending.size, 0);
});

test("only failures, not deliberate cancellation, produce a user error message", () => {
  const abort = new AbortController();
  assert.match(maxStreamErrorMessage(new Error("offline"), abort.signal)!, /lost the connection/);
  assert.match(maxStreamErrorMessage(new DOMException("timeout", "TimeoutError"), abort.signal)!, /too long/);
  abort.abort();
  assert.equal(maxStreamErrorMessage(new Error("stream stopped"), abort.signal), null);
});

test("the chat owns its stream, face, cleanup and generation rather than the newer dialog", () => {
  const source = readFileSync(new URL("./maxChat.ts", import.meta.url), "utf8");
  assert.match(source, /const isCurrent = \(\): boolean => generation === chatGeneration && log\.isConnected && form\.isConnected/);
  assert.match(source, /drainMaxStream\(response\.body, \{\s+signal: controller\.signal,\s+isCurrent: \(\) => isCurrent\(\) && bubble\.isConnected/);
  assert.match(source, /finally \{\s+window\.clearTimeout\(giveUp\);[\s\S]*if \(generation === chatGeneration\) \{[\s\S]*if \(form\.isConnected\) form\.classList\.remove\("busy"\)/);
  assert.match(source, /if \(inFlight === controller\) inFlight = null/);
  assert.doesNotMatch(source, /document\.querySelector[^\n]*maxchat-face/);
  assert.match(source, /const atBottom = log\.scrollHeight[\s\S]*write\(bubble, text\);\s+if \(atBottom\) log\.scrollTop = log\.scrollHeight/);
});
