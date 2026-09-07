import assert from "node:assert/strict";
import test from "node:test";
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { detectHeadCovering, segmentCategories } from "./headCovering.js";

test("abandoned covering work never segments, while a live positive mask stays positive and closes", async (t) => {
  let ready!: (model: ImageSegmenter) => void;
  const boot = new Promise<ImageSegmenter>((resolve) => { ready = resolve; });
  const data = new Uint8Array(100 * 100);
  for (let y = 30; y < 80; y++) for (let x = 30; x < 70; x++) data[y * 100 + x] = 3;
  for (let y = 12; y < 33; y++) for (let x = 22; x < 78; x++) data[y * 100 + x] = 4;
  let reads = 0, closed = 0, broken = false;
  const model = {
    segment() {
      reads++;
      return { categoryMask: {
        width: 100, height: 100,
        getAsUint8Array() { if (broken) throw new Error("unreadable mask"); return data; },
        close() { closed++; },
      } };
    },
    close() {},
  } as unknown as ImageSegmenter;
  t.mock.method(FilesetResolver, "forVisionTasks", async () => ({ wasmLoaderPath: "", wasmBinaryPath: "" }));
  t.mock.method(ImageSegmenter, "createFromOptions", () => boot);
  t.mock.method(console, "warn", () => {});
  const source = {} as HTMLCanvasElement;
  let current = true;
  const run = detectHeadCovering(source, { isCurrent: () => current });
  current = false;
  ready(model);
  assert.equal((await run).available, false);
  assert.equal(reads, 0);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal(await segmentCategories(source, { signal: cancelled.signal }), null);
  assert.equal(reads, 0);
  const check = await detectHeadCovering(source);
  assert.equal(check.available, true);
  assert.equal(check.hatLikely, true);
  assert.equal(reads, 1);
  assert.equal(closed, 1);
  broken = true;
  assert.equal((await detectHeadCovering(source)).available, false);
  assert.equal(closed, 2, "mask is closed even if reading it throws");
});
