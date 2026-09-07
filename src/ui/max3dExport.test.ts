import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MAX_3D_EXAMPLES, max3DRecordingMime, recordMax3DExample } from "./max3dExport.js";
import { MAX_3D_STATES, MAX_3D_VIEWS, type Max3DHandle } from "./max3d.js";

test("the bounded examples cover every real animation and all four views", () => {
  assert.equal(MAX_3D_EXAMPLES.length, 5);
  assert.deepEqual([...new Set(MAX_3D_EXAMPLES.flatMap((example) => example.steps.map((step) => step.state)))].sort(), [...MAX_3D_STATES].sort());
  assert.deepEqual([...new Set(MAX_3D_EXAMPLES.flatMap((example) => example.steps.map((step) => step.view)))].sort(), [...MAX_3D_VIEWS].sort());
  for (const example of MAX_3D_EXAMPLES) {
    assert.ok(example.durationMs >= 12_000 && example.durationMs <= 15_000);
    assert.equal(example.steps[0].at, 0);
    assert.ok(example.steps.every((step, index) => step.at < example.durationMs && (index === 0 || step.at > example.steps[index - 1].at)));
  }
  assert.equal(max3DRecordingMime((mime) => mime === "video/mp4"), "video/mp4");
  assert.equal(max3DRecordingMime((mime) => mime === "video/webm;codecs=vp8"), "video/webm;codecs=vp8");
  assert.equal(max3DRecordingMime(() => false), null);
});

function fixture({ empty = false, stalledStop = false, tainted = false } = {}) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  let time = 100;
  let timerId = 0;
  const timers = new Map<number, { at: number; every: number; action: () => void }>();
  let trackStops = 0;
  let recordings = 0;
  let sourceCopies = 0;
  let drawingCalls = 0;
  const doc = Object.assign(new EventTarget(), { hidden: false, createElement: () => new Canvas() });
  class Canvas extends EventTarget {
    width = 630; height = 630; dataset = { max3d: "true" }; isConnected = true; style = { visibility: "visible" };
    getContext() { return {
      clearRect() {}, fillRect() {}, fillText() {},
      drawImage(value: Canvas) { drawingCalls++; if (value === source) { if (tainted) throw new DOMException("Not origin clean", "SecurityError"); sourceCopies++; } },
    }; }
    captureStream() { return { getTracks: () => [{ stop: () => { trackStops++; } }] }; }
  }
  class Recorder {
    static isTypeSupported(type: string) { return type === "video/webm;codecs=vp8"; }
    state = "inactive"; mimeType = "video/webm;codecs=vp8";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { recordings++; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      if (stalledStop) return;
      if (!empty) this.ondataavailable?.({ data: new Blob(["real recorder boundary double"]) });
      this.onstop?.();
    }
  }
  const stage = Object.assign(new EventTarget(), { isConnected: true });
  const source = new Canvas();
  const states: string[] = [], views: string[] = [];
  const handle: Max3DHandle = { setAnimation: (state) => states.push(state), setView: (view) => views.push(view), setPlayfulEnabled() {}, setSpeechLevel() {}, destroy() {} };
  install("document", doc);
  install("MediaRecorder", Recorder);
  install("performance", { now: () => time });
  install("setTimeout", (action: () => void, delay: number) => { const id = ++timerId; timers.set(id, { at: time + delay, every: 0, action }); return id; });
  install("setInterval", (action: () => void, delay: number) => { const id = ++timerId; timers.set(id, { at: time + delay, every: delay, action }); return id; });
  install("clearTimeout", (id: number) => timers.delete(id));
  install("clearInterval", (id: number) => timers.delete(id));
  const signal = new AbortController();
  return {
    doc, source, signal, states, views, timers,
    run: (index = 0) => recordMax3DExample(stage as unknown as HTMLElement, handle, MAX_3D_EXAMPLES[index], { signal: signal.signal }),
    frame: () => { const event = new Event("max3dframe"); Object.defineProperty(event, "target", { value: source }); stage.dispatchEvent(event); },
    count: () => ({ trackStops, recordings, sourceCopies, drawingCalls }),
    advance(ms: number) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        time = timer.at;
        if (timer.every) timer.at += timer.every;
        else timers.delete(id);
        timer.action();
      }
      time = end;
    },
    restore() { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } },
  };
}

test("recording waits for real rendered pixels and quiet clips reuse a copied frame safely", async () => {
  const f = fixture();
  try {
    const promise = f.run(2);
    assert.equal(f.count().recordings, 0);
    for (let frame = 0; frame < 12; frame++) f.frame();
    assert.equal(f.count().sourceCopies, 12);
    f.advance(12_000);
    const result = await promise;
    assert.equal(result.filename, "max-views-and-quiet.webm");
    assert.ok(result.blob.size > 0);
    assert.deepEqual(f.states, ["idle", "quiet", "idle", "quiet"]);
    assert.deepEqual(f.views, ["front", "three-quarter", "side", "back"]);
    assert.equal(f.count().sourceCopies, 12, "timer paints use the snapshot, never a potentially cleared WebGL buffer");
    assert.ok(f.count().drawingCalls > 300, "quiet views still produce the full timed video");
    assert.equal(f.count().trackStops, 1);
    assert.equal(f.timers.size, 0);
  } finally { f.restore(); }
});

test("cancelling a recording releases tracks and drops later frames", async () => {
  const f = fixture();
  try {
    const promise = f.run(); f.frame();
    f.signal.abort();
    await assert.rejects(promise, { name: "AbortError" });
    const count = f.count().sourceCopies;
    f.frame(); f.advance(20_000);
    assert.equal(f.count().sourceCopies, count);
    assert.equal(f.count().trackStops, 1);
    assert.equal(f.timers.size, 0);
  } finally { f.restore(); }
});

test("first-frame wait, hidden tabs, tainted sources and empty or stalled encoders fail closed", async () => {
  for (const scenario of ["no-frame", "hidden", "tainted", "empty", "stalled"] as const) {
    const f = fixture({ tainted: scenario === "tainted", empty: scenario === "empty", stalledStop: scenario === "stalled" });
    try {
      const promise = f.run();
      if (scenario === "no-frame") f.advance(15_000);
      else if (scenario === "hidden") { f.frame(); f.doc.hidden = true; f.doc.dispatchEvent(new Event("visibilitychange")); }
      else {
        for (let frame = 0; frame < 12; frame++) f.frame();
        f.advance(17_000);
      }
      await assert.rejects(promise);
      assert.equal(f.timers.size, 0, scenario);
      if (scenario !== "no-frame" && scenario !== "tainted") assert.equal(f.count().trackStops, 1, scenario);
    } finally { f.restore(); }
  }
});

test("only the development preview imports the export helper and the frame hook is development-only", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("./max3dRuntime.ts"), /if \(import\.meta\.env\?\.DEV\) canvas\.dispatchEvent/);
  assert.match(read("./max3dPreview.ts"), /from "\.\/max3dExport\.js"/);
  assert.doesNotMatch(read("./max3d.ts"), /max3dExport/);
  assert.doesNotMatch(read("./max3dExport.ts"), /\bfetch\(|getUserMedia\(|XMLHttpRequest|WebSocket/);
});
