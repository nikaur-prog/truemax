import type { ReelFace, ReelRegion } from "./demoReelData.js";
import { placeCallouts } from "./demoReelLayout.js";

/** Load only requested portraits. A decoded still is the handover boundary. */
export function createReelImages(
  urls: string[],
  onChange: () => void,
  createImage: () => HTMLImageElement = () => new Image(),
) {
  const entries = new Map<number, { image: HTMLImageElement; ready: boolean; failed: boolean; width: number; height: number }>();
  let stopped = false;
  const ensure = (index: number): void => {
    if (stopped || entries.has(index) || !urls[index]) return;
    const image = createImage();
    const entry = { image, ready: false, failed: false, width: 0, height: 0 };
    entries.set(index, entry);
    image.decoding = "async";
    image.fetchPriority = "low";
    const finish = (failed: boolean): void => {
      if (stopped || entry.ready || entry.failed) return;
      entry.failed = failed;
      entry.ready = !failed;
      entry.width = image.naturalWidth;
      entry.height = image.naturalHeight;
      image.onload = null;
      image.onerror = null;
      onChange();
    };
    image.onload = () => {
      void (async () => {
        try { await image.decode?.(); } catch { /* Older image decoders may reject an otherwise usable still. */ }
        finish(!image.complete || image.naturalWidth === 0);
      })();
    };
    image.onerror = () => finish(true);
    image.src = urls[index];
  };
  return {
    ensure,
    ready(index: number) { const entry = entries.get(index); return entry?.ready ? entry : null; },
    failed(index: number) { return entries.get(index)?.failed === true; },
    next(index: number) {
      for (let offset = 1; offset < urls.length; offset++) {
        const next = (index + offset) % urls.length;
        if (!entries.get(next)?.failed) return next;
      }
      return index;
    },
    stop() {
      stopped = true;
      for (const { image } of entries.values()) { image.onload = null; image.onerror = null; }
      entries.clear();
    },
  };
}

/** Sort once per face and only place labels when their geometry changes. */
export function createReelCallouts() {
  const faces = new WeakMap<ReelFace, { outs: ReelRegion[]; key: string; placed: ReturnType<typeof placeCallouts> }>();
  return (face: ReelFace, width: number, height: number, reserve: number) => {
    let cached = faces.get(face);
    if (!cached) {
      const sorted = [...face.regions].sort((a, b) => b.score - a.score);
      const outs = sorted.length < 3 ? sorted : [sorted[0], sorted[sorted.length >> 1], sorted[sorted.length - 1]];
      cached = { outs, key: "", placed: [] };
      faces.set(face, cached);
    }
    const key = `${width}:${height}:${reserve}`;
    if (cached.key !== key) {
      cached.key = key;
      cached.placed = placeCallouts(cached.outs, width, height, reserve);
    }
    return cached;
  };
}

/** Attribute/property writes on stable frames need not trigger style work. */
export function createReelValueWriter() {
  const values = new Map<string, unknown>();
  return (key: string, value: unknown, write: () => void): void => {
    if (values.has(key) && values.get(key) === value) return;
    values.set(key, value);
    write();
  };
}
