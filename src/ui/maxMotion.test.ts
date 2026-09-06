import test from "node:test";
import assert from "node:assert/strict";
import { createMaxGazeScheduler, createMaxMotionController } from "./maxMotion.js";
import { mountMaxIdle, type MaxIdleRuntime } from "./maxIdle.js";

test("motion waits for visibility and dynamically stops for hidden, reduced-motion or data-saving states", () => {
  let allowed = true;
  let changed = () => {};
  let visible = (_value: boolean) => {};
  let observed = 0;
  let disconnected = 0;
  const target = { connected: true };
  const controller = createMaxMotionController<typeof target>({
    allowed: () => allowed, connected: (item) => item.connected,
    observe: (_target, callback) => { observed++; visible = callback; return () => { disconnected++; }; },
    onChange: (callback) => { changed = callback; return () => {}; },
  });
  const states: boolean[] = [];
  const remove = controller.observe(target, (active) => states.push(active));
  const second = controller.observe(target, () => {});
  assert.equal(observed, 1, "gaze, idle and CSS share one observer");
  assert.deepEqual(states, [false]);
  visible(true);
  allowed = false; changed();
  allowed = true; changed();
  target.connected = false; changed();
  assert.deepEqual(states, [false, true, false, true, false]);
  remove();
  assert.equal(disconnected, 0);
  second(); second();
  assert.equal(disconnected, 1);
});

test("pointer bursts use one frame and all layout reads precede style writes", () => {
  let frame: (() => void) | undefined;
  let requests = 0;
  const calls: string[] = [];
  const scheduler = createMaxGazeScheduler({ requestFrame: (callback) => { requests++; frame = callback; return requests; }, cancelFrame: () => {} });
  for (const id of ["a", "b"]) scheduler.add({
    active: () => true,
    read: () => { calls.push(`read ${id}`); return { left: 0, top: 0, width: 100, height: 100 }; },
    write: (x) => { calls.push(`write ${id}`); assert.equal(x, "3.00px"); },
  });
  scheduler.move(50, 38);
  scheduler.move(5000, 38);
  assert.equal(requests, 1);
  frame!();
  assert.deepEqual(calls, ["read a", "read b", "write a", "write b"]);
  assert.equal(requests, 1, "there is no permanent gaze animation loop");
});

test("hidden, coarse pointer and removed gaze targets do not perform geometry work", () => {
  let active = false;
  let requests = 0;
  let cancellations = 0;
  let frame: (() => void) | undefined;
  const scheduler = createMaxGazeScheduler({ requestFrame: (callback) => { requests++; frame = callback; return requests; }, cancelFrame: () => { cancellations++; } });
  const remove = scheduler.add({ active: () => active, read: () => { throw new Error("unseen geometry read"); }, write: () => {} });
  scheduler.move(0, 0);
  assert.equal(requests, 0);
  active = true;
  scheduler.move(1, 1);
  active = false;
  scheduler.refresh();
  assert.equal(cancellations, 1);
  frame!();
  remove();
  scheduler.move(2, 2);
  assert.equal(requests, 1);
});

test("idle controller owns no timers while asleep and cannot restart after disposal", () => {
  let next = 0;
  let visibility = (_active: boolean) => {};
  let unsubscribed = 0;
  const pending = new Map<number, { callback: () => void; delay: number }>();
  const classes = new Set<string>();
  const svg = { isConnected: true, classList: { add: (...values: string[]) => values.forEach((value) => classes.add(value)), remove: (...values: string[]) => values.forEach((value) => classes.delete(value)) } };
  const stage = Object.assign(new EventTarget(), { querySelector: () => svg }) as unknown as HTMLElement;
  const runtime: MaxIdleRuntime = {
    schedule: (callback, delay) => { pending.set(++next, { callback, delay }); return next; },
    cancel: (id) => { pending.delete(id); },
    observe: (_svg, callback) => { visibility = callback; callback(false); return () => { unsubscribed++; }; },
  };
  const handle = mountMaxIdle(stage, runtime)!;
  handle.play("think");
  assert.equal(pending.size, 0);
  visibility(true);
  assert.equal([...pending.values()][0].delay, 10000);
  const first = [...pending.values()][0].callback;
  pending.clear(); first();
  assert.ok(classes.has("mx-windup"));
  const stale = [...pending.values()][0].callback;
  visibility(false);
  assert.equal(pending.size, 0);
  assert.equal(classes.size, 0);
  stale();
  assert.equal(classes.size, 0);
  visibility(true);
  handle.destroy(); handle.destroy();
  visibility(true); handle.play("dance");
  assert.equal(pending.size, 0);
  assert.equal(unsubscribed, 1);
});
