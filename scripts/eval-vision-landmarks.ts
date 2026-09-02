// Does the vision pass place the side points better than the seeder?
//
// The go or no-go for AI-first side placement is a number, not an opinion:
// per landmark, how far the model lands from the hand-labelled truth, next to
// how far the on-device seeder lands on the same photographs. Both distances
// are in head widths (the labelled nose-to-ear-notch depth), the unit the
// seeder's own template is written in, so a 0.05 here means the same thing
// on a small photo and a large one.
//
// Ground truth is .side-dataset/labels.json (display pixels, 640 wide),
// produced by tools/side-seed-harness.mjs from the seeder's output plus hand
// corrections. Two honesty notes about that:
//
//   - A label the hand never moved equals the seed, so the seeder's error on
//     those points is zero by construction. The table therefore reports the
//     seeder two ways: over every labelled point, and over the points the
//     labeller actually moved, which is where it was wrong. The model is
//     reported over both as well.
//   - The three out-of-spec faces and the partial labels from tools/side-fit.mjs
//     are excluded here the same way.
//
// Runs the SAME code the endpoint runs (api/_sideLandmarks.ts), so the number
// describes production, not a benchmark copy of it.
//
//   ANTHROPIC_API_KEY=... npx tsx scripts/eval-vision-landmarks.ts [--limit 10] [--ids s000,s001]
//       [--model claude-sonnet-5] [--concurrency 2] [--no-cache]
//
// Predictions are cached in .side-dataset/vision-<model>.json so a re-run of
// the table costs nothing; delete the file or pass --no-cache to spend again.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { anthropicKey } from "../api/_anthropicKey.js";
import {
  BACK_LANDMARK_IDS,
  LANDMARK_MODEL_DEFAULT,
  LANDMARK_VERSION,
  SIDE_LANDMARK_IDS,
  placeSideLandmarks,
} from "../api/_sideLandmarks.js";
import type { LandmarkPoint, SideLandmarkId, SideLandmarkResult } from "../api/_sideLandmarks.js";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const DATA = `${APP_DIR}/.side-dataset`;
const DISPLAY_W = 640;
// The longest side the provider keeps before downsizing anyway. Sending more
// only costs upload time.
const MAX_SIDE = 1568;

// Mirrors tools/side-fit.mjs. Kept in step by hand; the harness prints which
// ids it skipped so a drift is visible.
const EXCLUDE = new Set(["s022", "s037", "s051"]);
const PARTIAL: Record<string, SideLandmarkId[]> = {
  s006: ["pronasale", "subnasale", "labialeSuperius", "labialeInferius", "pogonion", "menton", "cervicale"],
  s035: ["gonion", "condylion", "tragion"],
  s043: ["gonion", "condylion", "tragion"],
  s053: ["gonion"],
};

type Frame = Record<SideLandmarkId, LandmarkPoint>;
interface Labelled {
  points: Frame;
}
interface Cached {
  model: string;
  version: string;
  result: SideLandmarkResult;
  usage: { inputTokens: number; outputTokens: number };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const model = arg("model") || process.env.SIDE_LANDMARK_MODEL || LANDMARK_MODEL_DEFAULT;
const limit = Number(arg("limit") || 0) || Infinity;
const onlyIds = arg("ids")?.split(",").map((s) => s.trim()).filter(Boolean);
const concurrency = Math.max(1, Number(arg("concurrency") || 2));
const useCache = !flag("no-cache");
const cachePath = `${DATA}/vision-${model.replace(/[^a-z0-9.-]/gi, "_")}.json`;

const labels = JSON.parse(readFileSync(`${DATA}/labels.json`, "utf8")) as Record<string, Labelled>;
const seeds = JSON.parse(readFileSync(`${DATA}/seeds.json`, "utf8")) as Record<string, Labelled>;
const cache: Record<string, Cached> = useCache && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

const files = readdirSync(`${DATA}/raw`).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const ids = files
  .map((f) => f.replace(/\.[^.]+$/, ""))
  .filter((id) => labels[id] && !EXCLUDE.has(id))
  .filter((id) => !onlyIds || onlyIds.includes(id))
  .slice(0, Number.isFinite(limit) ? limit : undefined);

if (!ids.length) {
  console.error("No labelled profiles to evaluate.");
  process.exit(1);
}

let apiKey: string | null = null;
try {
  apiKey = anthropicKey();
} catch {
  apiKey = null;
}
const pending = ids.filter((id) => !(cache[id] && cache[id].model === model && cache[id].version === LANDMARK_VERSION));
if (pending.length && !apiKey) {
  console.error(`${pending.length} profile(s) need a model call and ANTHROPIC_API_KEY is not set.`);
  process.exit(1);
}
const client = apiKey ? new Anthropic({ apiKey }) : null;

async function predict(id: string): Promise<void> {
  const file = files.find((f) => f.startsWith(`${id}.`))!;
  const raw = readFileSync(`${DATA}/raw/${file}`);
  const jpeg = await sharp(raw)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  const pass = await placeSideLandmarks(client!, { data: jpeg.toString("base64"), mediaType: "image/jpeg" }, { model });
  cache[id] = { model: pass.model, version: pass.version, result: pass.result, usage: pass.usage };
  if (useCache) writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  console.error(`${id}: placed (${pass.usage.inputTokens} in, ${pass.usage.outputTokens} out)`);
}

// A small worker pool; the provider is the bottleneck, not the disk.
const queue = [...pending];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await predict(id);
      } catch (error) {
        console.error(`${id}: failed, ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }),
);

// ---------------------------------------------------------------------------
// Scoring, all in the label frame (display pixels, DISPLAY_W wide).
// ---------------------------------------------------------------------------
async function displayFrame(id: string): Promise<{ w: number; h: number }> {
  const file = files.find((f) => f.startsWith(`${id}.`))!;
  const meta = await sharp(readFileSync(`${DATA}/raw/${file}`)).rotate().metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;
  return { w: DISPLAY_W, h: (h * DISPLAY_W) / w };
}

const dist = (a: LandmarkPoint, b: LandmarkPoint) => Math.hypot(a.x - b.x, a.y - b.y);

// The least-squares similarity (uniform scale, rotation, translation) that maps
// one point set onto another.
//
// This is what turns "the model is bad" into "the model is bad AT WHAT". A
// distance table alone cannot tell a model that misreads the face from a model
// that reads it correctly and frames it wrongly, and those need opposite
// responses. Anchoring the model's own points onto the eight front points the
// seeder already gets right removes framing entirely and leaves only shape,
// and it is a transform production could genuinely apply, because in the app
// the seeder's front points are sitting right there.
function similarity(
  src: readonly LandmarkPoint[],
  dst: readonly LandmarkPoint[],
): ((p: LandmarkPoint) => LandmarkPoint) | null {
  const n = src.length;
  if (!n || n !== dst.length) return null;
  const msx = src.reduce((t, p) => t + p.x, 0) / n;
  const msy = src.reduce((t, p) => t + p.y, 0) / n;
  const mdx = dst.reduce((t, p) => t + p.x, 0) / n;
  const mdy = dst.reduce((t, p) => t + p.y, 0) / n;
  let sa = 0;
  let sb = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[i].x - msx;
    const ay = src[i].y - msy;
    const bx = dst[i].x - mdx;
    const by = dst[i].y - mdy;
    sa += ax * bx + ay * by;
    sb += ax * by - ay * bx;
    sxx += ax * ax + ay * ay;
  }
  if (!sxx) return null;
  const a = sa / sxx;
  const b = sb / sxx;
  return (p) => {
    const x = p.x - msx;
    const y = p.y - msy;
    return { x: a * x - b * y + mdx, y: b * x + a * y + mdy };
  };
}
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p90 = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((p, q) => p - q);
  return s[Math.min(s.length - 1, Math.floor(0.9 * (s.length - 1)))];
};

interface Bucket {
  model: number[];
  seed: number[];
  modelMoved: number[];
  seedMoved: number[];
  /** The model's points after anchoring their shape onto the seeder's front points. */
  anchored: number[];
  /** Signed offset, so a systematic bias is distinguishable from scatter. */
  dx: number[];
  dy: number[];
}
const perPoint: Record<SideLandmarkId, Bucket> = Object.fromEntries(
  SIDE_LANDMARK_IDS.map((id) => [id, { model: [], seed: [], modelMoved: [], seedMoved: [], anchored: [], dx: [], dy: [] }]),
) as Record<SideLandmarkId, Bucket>;
const FRONT_LANDMARK_IDS = SIDE_LANDMARK_IDS.filter((id) => !BACK_LANDMARK_IDS.includes(id));
// The y scale each face implies, model against truth. A value that is not 1
// and barely varies is a framing bug somewhere, not the model guessing.
const impliedYScale: number[] = [];

let scored = 0;
let tokensIn = 0;
let tokensOut = 0;
const skipped: string[] = [];
for (const id of ids) {
  const cached = cache[id];
  if (!cached || cached.model !== model) {
    skipped.push(id);
    continue;
  }
  const truth = labels[id].points;
  const seed = seeds[id]?.points;
  const { w, h } = await displayFrame(id);
  const unit = dist(truth.pronasale, truth.tragion);
  if (!(unit > 1)) {
    skipped.push(id);
    continue;
  }
  const partial = new Set(PARTIAL[id] ?? []);
  tokensIn += cached.usage.inputTokens;
  tokensOut += cached.usage.outputTokens;
  scored += 1;
  const px = (pid: SideLandmarkId) => ({ x: cached.result.points[pid].x * w, y: cached.result.points[pid].y * h });
  // The y scale this face implies. Reported because a value that is not 1 and
  // barely moves across faces is a framing bug, and a framing bug is fixable
  // where imprecision is not.
  const usable = SIDE_LANDMARK_IDS.filter((pid) => !partial.has(pid));
  const den = usable.reduce((t, pid) => t + px(pid).y ** 2, 0);
  if (den) impliedYScale.push(usable.reduce((t, pid) => t + px(pid).y * truth[pid].y, 0) / den);
  // The model's own shape, anchored onto the seeder's front points. This is the
  // best correction production could actually apply, so it is the fair ceiling
  // on what the model is worth here.
  const anchors = FRONT_LANDMARK_IDS.filter((pid) => !partial.has(pid) && seed?.[pid]);
  const fit = seed && anchors.length >= 3
    ? similarity(anchors.map(px), anchors.map((pid) => seed[pid]))
    : null;
  // Facing, so a left-facing and a right-facing profile do not cancel each other
  // out in the signed table below.
  const facing = truth.pronasale.x > truth.tragion.x ? 1 : -1;
  for (const pid of SIDE_LANDMARK_IDS) {
    if (partial.has(pid)) continue;
    const t = truth[pid];
    const m = px(pid);
    const mErr = dist(m, t) / unit;
    perPoint[pid].model.push(mErr);
    perPoint[pid].dx.push((facing * (m.x - t.x)) / unit);
    perPoint[pid].dy.push((m.y - t.y) / unit);
    if (fit) perPoint[pid].anchored.push(dist(fit(m), t) / unit);
    if (seed?.[pid]) {
      const sErr = dist(seed[pid], t) / unit;
      perPoint[pid].seed.push(sErr);
      const moved = sErr > 0.5 / unit;
      if (moved) {
        perPoint[pid].seedMoved.push(sErr);
        perPoint[pid].modelMoved.push(mErr);
      }
    }
  }
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "  n/a");
const line = (label: string, b: Bucket) =>
  `${label.padEnd(16)} ${String(b.model.length).padStart(3)}  ${fmt(median(b.model))}  ${fmt(p90(b.model))}   ${fmt(median(b.seed))}  ${fmt(p90(b.seed))}   ${String(b.seedMoved.length).padStart(3)}  ${fmt(median(b.modelMoved))}  ${fmt(median(b.seedMoved))}`;
const biasLine = (label: string, b: Bucket) =>
  `${label.padEnd(16)} ${String(b.dx.length).padStart(3)}  ${fmt(median(b.dx))}  ${fmt(median(b.dy))}   ${fmt(median(b.anchored))}`;

console.log(`\nVision pass ${model} (${LANDMARK_VERSION}) against ${scored} labelled profiles; error in head widths (nose tip to ear notch).`);
if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);
console.log("");
console.log("landmark           n   model med  p90    seeder med  p90    moved  model@moved seeder@moved");
for (const pid of SIDE_LANDMARK_IDS) console.log(line(pid, perPoint[pid]));

const merge = (idsToMerge: readonly SideLandmarkId[]): Bucket => ({
  model: idsToMerge.flatMap((id) => perPoint[id].model),
  seed: idsToMerge.flatMap((id) => perPoint[id].seed),
  modelMoved: idsToMerge.flatMap((id) => perPoint[id].modelMoved),
  seedMoved: idsToMerge.flatMap((id) => perPoint[id].seedMoved),
});
const front = SIDE_LANDMARK_IDS.filter((id) => !BACK_LANDMARK_IDS.includes(id));
console.log("");
console.log(line("FRONT (8)", merge(front)));
console.log(line("BACK (5)", merge(BACK_LANDMARK_IDS)));
console.log(line("ALL (13)", merge(SIDE_LANDMARK_IDS)));

// The two diagnostics that say WHY, not just how much.
console.log("");
console.log("Signed offset and the anchored fit. dx>0 = model too far forward, dy>0 = model too low.");
console.log("A large offset that barely varies is a framing bug. Scatter around zero is imprecision.");
console.log("");
console.log("landmark           n  median dx  median dy   anchored");
for (const pid of SIDE_LANDMARK_IDS) console.log(biasLine(pid, perPoint[pid]));
console.log("");
console.log(biasLine("FRONT (8)", merge(front)));
console.log(biasLine("BACK (5)", merge(BACK_LANDMARK_IDS)));
console.log("");
console.log(
  `y scale each face implies (1.000 = correctly framed): median ${fmt(median(impliedYScale))}, spread ${
    fmt(Math.sqrt(impliedYScale.reduce((t, v) => t + (v - median(impliedYScale)) ** 2, 0) / Math.max(1, impliedYScale.length)))
  } over ${impliedYScale.length} faces.`,
);

const back = merge(BACK_LANDMARK_IDS);
const ratio = median(back.modelMoved) / median(back.seedMoved);
console.log("");
console.log(`Tokens: ${tokensIn} in, ${tokensOut} out across ${scored} profiles.`);
if (Number.isFinite(ratio)) {
  console.log(
    `Back points where the seeder was wrong: model median ${fmt(median(back.modelMoved))} vs seeder ${fmt(median(back.seedMoved))} (ratio ${ratio.toFixed(2)}). ` +
      (ratio <= 0.5 ? "GO: the model halves the seeder's error where it fails." : "NO-GO on AI-first: use the model on refusal only, or try a larger model."),
  );
}
