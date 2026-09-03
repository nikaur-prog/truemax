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
//       [--model claude-sonnet-5] [--concurrency 2] [--no-cache] [--no-zoom] [--seed] [--repeat 3]
//
// Predictions are cached in .side-dataset/vision-<model>-<version>[-seed|-nozoom].json
// so a re-run of the table costs nothing; delete the file or pass --no-cache
// to spend again. --no-zoom runs the whole-frame call only. --seed sends the
// device seeder's points as the hint, which is what the app does: the
// whole-frame call is skipped, the front eight are the mesh's, and the crops
// are cut around the seed. Run with and without to see what the seed buys.
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
  anchorVertical,
  placeSideLandmarks,
  prepareLandmarkImage,
} from "../api/_sideLandmarks.js";
import type { LandmarkPoint, SideLandmarkId, SideLandmarkResult, StageName } from "../api/_sideLandmarks.js";
import { fuseSideSeeds } from "../src/engine/sideSeedFusion.js";
import type { ConfidenceBand } from "../src/engine/sideSeedFusion.js";
import type { SidePoints } from "../src/engine/sideMetrics.js";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const DATA = `${APP_DIR}/.side-dataset`;
const DISPLAY_W = 640;

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
  calls?: number;
  zoomed?: SideLandmarkId[];
  ms?: number;
  stages?: Partial<Record<StageName, Partial<Record<SideLandmarkId, LandmarkPoint>>>>;
  gonion?: string | null;
  gonionDisagreement?: number | null;
  mentonRetried?: boolean;
  seeded?: boolean;
  /** Further runs of the same pass, for the repeatability block. */
  runs?: Array<{ result: SideLandmarkResult; stages?: Cached["stages"] }>;
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
const zoom = !flag("no-zoom");
const useSeed = flag("seed");
// --repeat N runs the pass N times on the chosen faces (use --ids or --limit)
// and prints run-to-run scatter per stage: the model's own noise, which says
// whether an error is a stable misreading (fix the definition) or a wobble
// (vote). Extra runs are kept in the cache entry beside the first.
const repeat = Math.max(1, Number(arg("repeat") || 1));
const cachePath = `${DATA}/vision-${model.replace(/[^a-z0-9.-]/gi, "_")}-${LANDMARK_VERSION}${zoom ? "" : "-nozoom"}${useSeed ? "-seed" : ""}.json`;

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
const pending = ids.filter((id) => !(cache[id] && cache[id].model === model && cache[id].version === LANDMARK_VERSION && (cache[id].runs?.length ?? 0) + 1 >= repeat));
if (pending.length && !apiKey) {
  console.error(`${pending.length} profile(s) need a model call and ANTHROPIC_API_KEY is not set.`);
  process.exit(1);
}
const client = apiKey ? new Anthropic({ apiKey }) : null;

async function displayFrame(id: string): Promise<{ w: number; h: number }> {
  const file = files.find((f) => f.startsWith(`${id}.`))!;
  const meta = await sharp(readFileSync(`${DATA}/raw/${file}`)).rotate().metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;
  return { w: DISPLAY_W, h: (h * DISPLAY_W) / w };
}

async function predict(id: string): Promise<void> {
  const file = files.find((f) => f.startsWith(`${id}.`))!;
  const prepared = await prepareLandmarkImage(readFileSync(`${DATA}/raw/${file}`));
  // The seed as the app would send it: fractions of the same photograph.
  // seeds.json is in display pixels, 640 wide, of the upright image.
  let hint: Record<SideLandmarkId, LandmarkPoint> | null = null;
  if (useSeed && seeds[id]) {
    const { w, h } = await displayFrame(id);
    hint = {} as Record<SideLandmarkId, LandmarkPoint>;
    for (const pid of SIDE_LANDMARK_IDS) hint[pid] = { x: seeds[id].points[pid].x / w, y: seeds[id].points[pid].y / h };
  }
  const run = () => placeSideLandmarks(client!, prepared, {
    model,
    zoom,
    hint,
    onZoomError: (stage, error) => console.error(`${id}: ${stage} failed, ${error instanceof Error ? error.message : String(error)}`),
  });
  const have = cache[id] && cache[id].model === model && cache[id].version === LANDMARK_VERSION ? cache[id] : null;
  const pass = have ? null : await run();
  if (pass) {
    cache[id] = {
      model: pass.model, version: pass.version, result: pass.result, usage: pass.usage, calls: pass.calls, zoomed: pass.zoomed, ms: pass.ms,
      stages: pass.stages, gonion: pass.gonion, gonionDisagreement: pass.gonionDisagreement, mentonRetried: pass.mentonRetried, seeded: pass.seeded,
    };
  }
  while ((cache[id].runs?.length ?? 0) + 1 < repeat) {
    const again = await run();
    cache[id].runs = [...(cache[id].runs ?? []), { result: again.result, stages: again.stages }];
    if (useCache) writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  }
  if (!pass) return;
  if (useCache) writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  console.error(`${id}: ${pass.calls} call(s), ${(pass.ms / 1000).toFixed(1)}s, jaw corner ${pass.gonion ?? "first pass"}${pass.mentonRetried ? ", chin re-asked" : ""} (${pass.usage.inputTokens} in, ${pass.usage.outputTokens} out)`);
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

const dist = (a: LandmarkPoint, b: LandmarkPoint) => Math.hypot(a.x - b.x, a.y - b.y);

// The least-squares similarity (uniform scale, rotation, translation) that maps
// one point set onto another.
//
// This is what turns "the model is bad" into "the model is bad AT WHAT". A
// distance table alone cannot tell a model that misreads the face from a model
// that reads it correctly and frames it wrongly, and those need opposite
// responses. Anchoring the model's own points onto the eight front points the
// seeder already gets right removes framing entirely and leaves only shape.
//
// Two anchorings are reported. The similarity fit is the diagnostic. The
// vertical-only fit (anchorVertical, in the module the endpoint uses) is the
// correction production would apply: on vision-1 it took the ear cluster
// from 0.378 to 0.191 head widths where the similarity fit made it worse,
// because eight points close to a vertical line pin the horizontal scale
// badly and the model's x was never the problem.
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
  /** The model's points after a vertical-only fit onto the seeder's front points: the production correction. */
  anchoredY: number[];
  /** The model's points after a similarity fit onto the seeder's front points: the diagnostic. */
  anchored: number[];
  /** Signed offset, so a systematic bias is distinguishable from scatter. */
  dx: number[];
  dy: number[];
  /** The seed the app would actually use: device and model fused by policy. */
  fused: number[];
  /** The fused seed on the points the labeller moved, beside seedMoved and modelMoved. */
  fusedMoved: number[];
}
const perPoint: Record<SideLandmarkId, Bucket> = Object.fromEntries(
  SIDE_LANDMARK_IDS.map((id) => [id, { model: [], seed: [], modelMoved: [], seedMoved: [], anchoredY: [], anchored: [], dx: [], dy: [], fused: [], fusedMoved: [] }]),
) as Record<SideLandmarkId, Bucket>;
const FRONT_LANDMARK_IDS = SIDE_LANDMARK_IDS.filter((id) => !BACK_LANDMARK_IDS.includes(id));
// The y scale each face implies, model against truth. A value that is not 1
// and barely varies is a framing bug somewhere, not the model guessing.
const impliedYScale: number[] = [];

let scored = 0;
let tokensIn = 0;
let tokensOut = 0;
let calls = 0;
let zoomedPoints = 0;
const latencies: number[] = [];
// Where each back point stood after each stage, so a stage that buys nothing is visible.
const byStage: Record<StageName, Record<SideLandmarkId, number[]>> = {
  first: Object.fromEntries(SIDE_LANDMARK_IDS.map((id) => [id, []])) as Record<SideLandmarkId, number[]>,
  coarse: Object.fromEntries(SIDE_LANDMARK_IDS.map((id) => [id, []])) as Record<SideLandmarkId, number[]>,
  fine: Object.fromEntries(SIDE_LANDMARK_IDS.map((id) => [id, []])) as Record<SideLandmarkId, number[]>,
};
const gonionMethods: Record<string, number> = {};
// Per back point: the two readers' errors and their disagreement, for the
// oracle table (the better of the two per point is the ceiling any selector
// can reach) and for whether disagreement predicts the fused error.
const pairs: Record<SideLandmarkId, Array<{ d: number; seed: number; model: number; blend: number; fused: number; conf: number }>> =
  Object.fromEntries(SIDE_LANDMARK_IDS.map((id) => [id, []])) as never;
// Relations the labels fix and the model kept breaking, in head widths.
const relations = { gonionBelowNotch: [] as number[], gonionAboveMenton: [] as number[], mentonBelowPogonion: [] as number[], condylionAheadOfNotch: [] as number[] };
const gonionDisagreements: number[] = [];
let mentonRetries = 0;
let seededCount = 0;
// Per face, per back point: the model's signed offset along the nose-to-ear
// axis and across it, in head widths, for the leave-one-out bias table.
const biasSamples: Record<SideLandmarkId, Array<{ along: number; across: number; err: number; m: LandmarkPoint; t: LandmarkPoint; axis: LandmarkPoint; unit: number }>> =
  Object.fromEntries(SIDE_LANDMARK_IDS.map((id) => [id, []])) as never;
// Does the model know when it is wrong? Error by the confidence it reported.
const byConfidence: Record<string, number[]> = { "0.8 to 1": [], "0.5 to 0.8": [], "under 0.5": [] };
// Does the fused band mean what it says? Error of the fused point by band.
const byBand: Record<ConfidenceBand, number[]> = { high: [], mid: [], low: [] };
const overallBands: Record<ConfidenceBand, number> = { high: 0, mid: 0, low: 0 };
// Per face, per back point, per reader: the error, for the face-bootstrap
// verdict (a face's five back points share one head-width error, so the
// resampling unit is the face, never the point).
type Reader = "seeder" | "model" | "fused";
const perFace: Array<{ id: string; moved: Set<SideLandmarkId>; err: Record<Reader, Partial<Record<SideLandmarkId, number>>>; highWrong: number; highCount: number }> = [];
// Run-to-run scatter, per landmark and stage, from --repeat.
const scatter: Record<string, number[]> = {};
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
  calls += cached.calls ?? 1;
  zoomedPoints += cached.zoomed?.length ?? 0;
  if (typeof cached.ms === "number") latencies.push(cached.ms);
  if (cached.gonion) gonionMethods[cached.gonion] = (gonionMethods[cached.gonion] ?? 0) + 1;
  if (typeof cached.gonionDisagreement === "number") gonionDisagreements.push(cached.gonionDisagreement);
  if (cached.mentonRetried) mentonRetries += 1;
  if (cached.seeded) seededCount += 1;
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
  const modelPx = Object.fromEntries(SIDE_LANDMARK_IDS.map((pid) => [pid, px(pid)])) as Frame;
  const fitY = seed && anchors.length >= 2 ? anchorVertical(modelPx, seed, anchors) : null;
  // The seed the app would use: the device seed and the model fused by the
  // production policy, in the same display frame as the labels.
  const fused = seed ? fuseSideSeeds(seed as SidePoints, modelPx as SidePoints, cached.result.confidence) : null;
  if (fused) overallBands[fused.overall] += 1;
  const face: (typeof perFace)[number] = { id, moved: new Set(), err: { seeder: {}, model: {}, fused: {} }, highWrong: 0, highCount: 0 };
  perFace.push(face);
  // Repeatability: distance between runs of the same pass, per stage.
  if (cached.runs?.length) {
    const all = [cached, ...cached.runs];
    for (const pid of BACK_LANDMARK_IDS) {
      if (partial.has(pid)) continue;
      const key = (stage: string) => `${pid}:${stage}`;
      const pts = all.map((r) => ({ x: r.result.points[pid].x * w, y: r.result.points[pid].y * h }));
      const ds: number[] = [];
      for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) ds.push(dist(pts[a], pts[b]) / unit);
      (scatter[key("final")] ??= []).push(median(ds));
      for (const stage of ["first", "coarse", "fine"] as const) {
        const sp = all.map((r) => r.stages?.[stage]?.[pid]).filter(Boolean) as LandmarkPoint[];
        if (sp.length < 2) continue;
        const spx = sp.map((p) => ({ x: p.x * w, y: p.y * h }));
        const sd: number[] = [];
        for (let a = 0; a < spx.length; a++) for (let b = a + 1; b < spx.length; b++) sd.push(dist(spx[a], spx[b]) / unit);
        (scatter[key(stage)] ??= []).push(median(sd));
      }
    }
  }
  // Facing, so a left-facing and a right-facing profile do not cancel each other
  // out in the signed table below.
  const facing = truth.pronasale.x > truth.tragion.x ? 1 : -1;
  // The nose-to-ear axis of this face, for the bias table.
  const axis = { x: (truth.pronasale.x - truth.tragion.x) / unit, y: (truth.pronasale.y - truth.tragion.y) / unit };
  // The model's own relations, to set beside the labels' (gonion 0.46 below
  // the notch and 0.07 above the chin bottom; menton 0.067 below the chin
  // front; condylion 0.02 ahead of the notch).
  if (!partial.has("gonion") && !partial.has("tragion") && !partial.has("menton")) {
    relations.gonionBelowNotch.push((px("gonion").y - px("tragion").y) / unit);
    relations.gonionAboveMenton.push((px("menton").y - px("gonion").y) / unit);
  }
  if (!partial.has("menton")) relations.mentonBelowPogonion.push((px("menton").y - px("pogonion").y) / unit);
  if (!partial.has("condylion") && !partial.has("tragion")) relations.condylionAheadOfNotch.push((facing * (px("condylion").x - px("tragion").x)) / unit);
  for (const stage of ["first", "coarse", "fine"] as const) {
    const st = cached.stages?.[stage];
    if (!st) continue;
    for (const pid of SIDE_LANDMARK_IDS) {
      const sp = st[pid];
      if (!sp || partial.has(pid)) continue;
      byStage[stage][pid].push(dist({ x: sp.x * w, y: sp.y * h }, truth[pid]) / unit);
    }
  }
  for (const pid of SIDE_LANDMARK_IDS) {
    if (partial.has(pid)) continue;
    const t = truth[pid];
    const m = px(pid);
    const mErr = dist(m, t) / unit;
    if (BACK_LANDMARK_IDS.includes(pid)) {
      const ox = (m.x - t.x) / unit;
      const oy = (m.y - t.y) / unit;
      biasSamples[pid].push({ along: ox * axis.x + oy * axis.y, across: -ox * axis.y + oy * axis.x, err: mErr, m, t, axis, unit });
    }
    perPoint[pid].model.push(mErr);
    perPoint[pid].dx.push((facing * (m.x - t.x)) / unit);
    perPoint[pid].dy.push((m.y - t.y) / unit);
    if (fit) perPoint[pid].anchored.push(dist(fit(m), t) / unit);
    if (fitY) perPoint[pid].anchoredY.push(dist(fitY[pid], t) / unit);
    const conf = cached.result.confidence[pid];
    byConfidence[conf >= 0.8 ? "0.8 to 1" : conf >= 0.5 ? "0.5 to 0.8" : "under 0.5"].push(mErr);
    if (fused) {
      const fErr = dist(fused.points[pid], t) / unit;
      perPoint[pid].fused.push(fErr);
      byBand[fused.band[pid]].push(fErr);
      if (BACK_LANDMARK_IDS.includes(pid)) {
        face.err.fused[pid] = fErr;
        face.err.model[pid] = mErr;
        if (fused.band[pid] === "high") {
          face.highCount += 1;
          if (fErr > 0.1) face.highWrong += 1;
        }
      }
      if (seed?.[pid] && BACK_LANDMARK_IDS.includes(pid)) {
        const sErr = dist(seed[pid], t) / unit;
        const blend = dist({ x: (seed[pid].x + m.x) / 2, y: (seed[pid].y + m.y) / 2 }, t) / unit;
        pairs[pid].push({ d: fused.agreement[pid] ?? 0, seed: sErr, model: mErr, blend, fused: fErr, conf });
      }
    }
    if (seed?.[pid]) {
      const sErr = dist(seed[pid], t) / unit;
      perPoint[pid].seed.push(sErr);
      const moved = sErr > 0.5 / unit;
      if (BACK_LANDMARK_IDS.includes(pid)) face.err.seeder[pid] = sErr;
      if (moved) {
        perPoint[pid].seedMoved.push(sErr);
        perPoint[pid].modelMoved.push(mErr);
        if (BACK_LANDMARK_IDS.includes(pid)) face.moved.add(pid);
        if (fused) perPoint[pid].fusedMoved.push(dist(fused.points[pid], t) / unit);
      }
    }
  }
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "  n/a");
const line = (label: string, b: Bucket) =>
  `${label.padEnd(16)} ${String(b.model.length).padStart(3)}  ${fmt(median(b.model))}  ${fmt(p90(b.model))}   ${fmt(median(b.seed))}  ${fmt(p90(b.seed))}   ${String(b.seedMoved.length).padStart(3)}  ${fmt(median(b.modelMoved))}  ${fmt(median(b.seedMoved))}  ${fmt(median(b.fusedMoved))}   ${fmt(median(b.fused))}  ${fmt(p90(b.fused))}`;
const biasLine = (label: string, b: Bucket) =>
  `${label.padEnd(16)} ${String(b.dx.length).padStart(3)}  ${fmt(median(b.dx))}  ${fmt(median(b.dy))}   ${fmt(median(b.anchoredY))}  ${fmt(p90(b.anchoredY))}   ${fmt(median(b.anchored))}`;

console.log(`\nVision pass ${model} (${LANDMARK_VERSION}) against ${scored} labelled profiles; error in head widths (nose tip to ear notch).`);
if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);
console.log("");
console.log("landmark           n   model med  p90    seeder med  p90    moved  model@moved seeder@moved fused@moved   fused med  p90");
console.log("(a label the hand never moved IS the seed, so the seeder's error there is zero by construction; the @moved columns are the honest comparison)");
for (const pid of SIDE_LANDMARK_IDS) console.log(line(pid, perPoint[pid]));

const merge = (idsToMerge: readonly SideLandmarkId[]): Bucket => ({
  model: idsToMerge.flatMap((id) => perPoint[id].model),
  seed: idsToMerge.flatMap((id) => perPoint[id].seed),
  modelMoved: idsToMerge.flatMap((id) => perPoint[id].modelMoved),
  seedMoved: idsToMerge.flatMap((id) => perPoint[id].seedMoved),
  anchoredY: idsToMerge.flatMap((id) => perPoint[id].anchoredY),
  anchored: idsToMerge.flatMap((id) => perPoint[id].anchored),
  dx: idsToMerge.flatMap((id) => perPoint[id].dx),
  dy: idsToMerge.flatMap((id) => perPoint[id].dy),
  fused: idsToMerge.flatMap((id) => perPoint[id].fused),
  fusedMoved: idsToMerge.flatMap((id) => perPoint[id].fusedMoved),
});
const front = SIDE_LANDMARK_IDS.filter((id) => !BACK_LANDMARK_IDS.includes(id));
console.log("");
console.log(line("FRONT (8)", merge(front)));
console.log(line("BACK (5)", merge(BACK_LANDMARK_IDS)));
console.log(line("ALL (13)", merge(SIDE_LANDMARK_IDS)));

// The two diagnostics that say WHY, not just how much.
console.log("");
console.log("Signed offset and the anchored fits. dx>0 = model too far forward, dy>0 = model too low.");
console.log("A large offset that barely varies is a framing bug. Scatter around zero is imprecision.");
console.log("y-anchored: vertical scale and offset fitted to the seeder's front points (what production applies).");
console.log("sim-anchored: similarity fit to the same points (diagnostic only).");
console.log("");
console.log("landmark           n  median dx  median dy   y-anch med  p90   sim-anch");
for (const pid of SIDE_LANDMARK_IDS) console.log(biasLine(pid, perPoint[pid]));
console.log("");
console.log(biasLine("FRONT (8)", merge(front)));
console.log(biasLine("BACK (5)", merge(BACK_LANDMARK_IDS)));
console.log(biasLine("ALL (13)", merge(SIDE_LANDMARK_IDS)));
console.log("");
console.log(
  `y scale each face implies (1.000 = correctly framed): median ${fmt(median(impliedYScale))}, spread ${
    fmt(Math.sqrt(impliedYScale.reduce((t, v) => t + (v - median(impliedYScale)) ** 2, 0) / Math.max(1, impliedYScale.length)))
  } over ${impliedYScale.length} faces.`,
);

// Each stage on its own. A stage that does not lower the median of the
// points it touches is a call the app should not make.
const stagesSeen = (["first", "coarse", "fine"] as const).filter((st) => BACK_LANDMARK_IDS.some((id) => byStage[st][id].length));
if (stagesSeen.length) {
  console.log("");
  console.log(`Back points after each stage (median error), ${seededCount} of ${scored} profiles seeded from the device points:`);
  console.log(`landmark          ${stagesSeen.map((st) => st.padStart(7)).join("")}`);
  for (const pid of BACK_LANDMARK_IDS) {
    console.log(`${pid.padEnd(16)}  ${stagesSeen.map((st) => fmt(median(byStage[st][pid])).padStart(7)).join("")}`);
  }
  console.log(`${"BACK (5)".padEnd(16)}  ${stagesSeen.map((st) => fmt(median(BACK_LANDMARK_IDS.flatMap((id) => byStage[st][id]))).padStart(7)).join("")}`);
}
if (Object.keys(gonionMethods).length) {
  console.log("");
  console.log(
    `Jaw corner: ${Object.entries(gonionMethods).map(([k, v]) => `${v} ${k}`).join(", ")}; construction versus guess median ${fmt(median(gonionDisagreements))} head widths. Chin re-asked on ${mentonRetries} profile(s).`,
  );
}

// Where the model puts each point relative to the others, beside the labels.
console.log("");
console.log("The model's own relations (median, head widths) beside the labels':");
console.log(`  jaw corner below the ear notch     ${fmt(median(relations.gonionBelowNotch))}   labels 0.46`);
console.log(`  jaw corner above the chin bottom   ${fmt(median(relations.gonionAboveMenton))}   labels 0.07`);
console.log(`  chin bottom below the chin front   ${fmt(median(relations.mentonBelowPogonion))}   labels 0.067`);
console.log(`  hinge ahead of the ear notch       ${fmt(median(relations.condylionAheadOfNotch))}   labels 0.02`);

// The disagreement table: per back point, by how far the two readers sat
// apart, the error of each, of their average, of the policy's choice, and
// of the better of the two (the oracle, the ceiling any selector can reach).
const spearman = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 3) return NaN;
  const rank = (v: number[]) => {
    const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(n);
    order.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = (n - 1) / 2;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - mx);
    dx2 += (rx[i] - mx) ** 2;
    dy2 += (ry[i] - mx) ** 2;
  }
  return num / Math.sqrt(dx2 * dy2);
};
const BINS: Array<[string, number, number]> = [["<= 0.06", 0, 0.06], ["0.06-0.15", 0.06, 0.15], ["0.15-0.30", 0.15, 0.3], ["> 0.30", 0.3, Infinity]];
console.log("");
console.log("Disagreement between the readers, per back point (median errors; oracle = the better of the two per point):");
console.log("landmark   bin          n   seeder   model   blend   fused  oracle");
for (const pid of BACK_LANDMARK_IDS) {
  const all = pairs[pid];
  if (!all.length) continue;
  for (const [label, lo, hi] of BINS) {
    const rows = all.filter((r) => r.d > lo && r.d <= hi || (lo === 0 && r.d <= hi));
    if (!rows.length) continue;
    const oracle = rows.map((r) => Math.min(r.seed, r.model));
    console.log(`${pid.padEnd(10)} ${label.padEnd(10)} ${String(rows.length).padStart(3)}   ${fmt(median(rows.map((r) => r.seed)))}   ${fmt(median(rows.map((r) => r.model)))}   ${fmt(median(rows.map((r) => r.blend)))}   ${fmt(median(rows.map((r) => r.fused)))}   ${fmt(median(oracle))}`);
  }
  console.log(
    `${"".padEnd(10)} rho(disagreement, fused error) ${fmt(spearman(all.map((r) => r.d), all.map((r) => r.fused)))}   rho(model confidence, model error) ${fmt(spearman(all.map((r) => r.conf), all.map((r) => r.model)))}`,
  );
}

// The bias table, leave-one-out: each face's correction is the median offset
// of every OTHER face, along and across the nose-to-ear axis, so a face
// never corrects itself. If the corrected error drops, the offset is a
// property of the model and the versioned table in the module can carry it;
// if it does not, the offset varies face to face and is not a bias at all.
console.log("");
console.log("Per-landmark bias, leave-one-out (head widths along the nose-to-ear axis, then across it; corrected = raw offset removed):");
console.log("landmark           n   along  across   raw med   corrected med  p90");
const looRows: string[] = [];
for (const pid of BACK_LANDMARK_IDS) {
  const samples = biasSamples[pid];
  if (samples.length < 4) continue;
  const corrected: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const others = samples.filter((_, j) => j !== i);
    const along = median(others.map((o) => o.along));
    const across = median(others.map((o) => o.across));
    const sm = samples[i];
    // Remove the offset in the face's own axis frame.
    const dx = along * sm.axis.x - across * sm.axis.y;
    const dy = along * sm.axis.y + across * sm.axis.x;
    const fixed = { x: sm.m.x - dx * sm.unit, y: sm.m.y - dy * sm.unit };
    corrected.push(dist(fixed, sm.t) / sm.unit);
  }
  const along = median(samples.map((o) => o.along));
  const across = median(samples.map((o) => o.across));
  console.log(`${pid.padEnd(16)} ${String(samples.length).padStart(3)}  ${fmt(along)}  ${fmt(across)}   ${fmt(median(samples.map((o) => o.err)))}     ${fmt(median(corrected))}  ${fmt(p90(corrected))}`);
  looRows.push(`  ${pid}: { along: ${along.toFixed(3)}, across: ${across.toFixed(3)} },`);
}
if (looRows.length) {
  console.log("Paste-ready table (only if the corrected column is clearly lower):");
  console.log(looRows.join("\n"));
}

// Whether the model's confidence and the fused band carry information. A
// band whose median error does not rise from high to low is decoration.
console.log("");
console.log("Model error by the confidence it reported (all points):");
for (const [bin, errs] of Object.entries(byConfidence)) {
  console.log(`  ${bin.padEnd(12)} n ${String(errs.length).padStart(4)}  median ${fmt(median(errs))}  p90 ${fmt(p90(errs))}`);
}
console.log("Fused-seed error by the band the app would show (all points):");
for (const b of ["high", "mid", "low"] as const) {
  console.log(`  ${b.padEnd(12)} n ${String(byBand[b].length).padStart(4)}  median ${fmt(median(byBand[b]))}  p90 ${fmt(p90(byBand[b]))}`);
}
console.log(`Overall band per profile: ${overallBands.high} high, ${overallBands.mid} mid, ${overallBands.low} low.`);

// The verdict, per landmark, on the points a hand placed, with the face as
// the unit of resampling. One pooled ratio hid two things: 86 of the 122
// moved back points are the ear pair, so the jaw corner and chin bottom
// could not move it either way; and a median cannot see the tail, which is
// what a person meets (a seeder ear a third of a head out on a third of
// faces). So: median with a bootstrap interval over faces, the paired win
// rate against the seeder, the gross-miss rate over ALL labelled points
// (error over 0.15 head widths, a miss anybody would notice), and the
// fraction of profiles whose five back points are all within 0.10.
const READERS: Reader[] = ["seeder", "model", "fused"];
const rng = (() => {
  let x = 20260903;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
})();
const bootstrapMedian = (values: (f: (typeof perFace)[number]) => number | undefined, faces: typeof perFace): [number, number] => {
  const meds: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const sample: number[] = [];
    for (let k = 0; k < faces.length; k++) {
      const v = values(faces[Math.floor(rng() * faces.length)]);
      if (v !== undefined) sample.push(v);
    }
    if (sample.length) meds.push(median(sample));
  }
  meds.sort((a, b) => a - b);
  return [meds[Math.floor(0.025 * (meds.length - 1))] ?? NaN, meds[Math.floor(0.975 * (meds.length - 1))] ?? NaN];
};
console.log("");
console.log("Verdict per back point, hand-placed labels only (moved), face-bootstrap 95% interval; gross miss = error over 0.15 on all labelled points:");
console.log("landmark    reader   n   median   [95% CI]        beats seeder   gross-miss%");
const holds: string[] = [];
for (const pid of BACK_LANDMARK_IDS) {
  const movedFaces = perFace.filter((f) => f.moved.has(pid));
  for (const reader of READERS) {
    const vals = movedFaces.map((f) => f.err[reader][pid]).filter((v): v is number => v !== undefined);
    const all = perFace.map((f) => f.err[reader][pid]).filter((v): v is number => v !== undefined);
    if (!vals.length) continue;
    const [lo, hi] = bootstrapMedian((f) => f.err[reader][pid], movedFaces);
    const wins = movedFaces.filter((f) => (f.err[reader][pid] ?? Infinity) < (f.err.seeder[pid] ?? Infinity)).length;
    const gross = all.filter((v) => v > 0.15).length / all.length;
    console.log(
      `${pid.padEnd(11)} ${reader.padEnd(7)} ${String(vals.length).padStart(3)}   ${fmt(median(vals))}   [${fmt(lo)}, ${fmt(hi)}]   ${reader === "seeder" ? "     " : `${String(Math.round((100 * wins) / Math.max(1, movedFaces.length))).padStart(3)}% `}        ${(100 * gross).toFixed(0).padStart(3)}%`,
    );
  }
  // SHIP conditions for the fused reader on this landmark.
  const fusedMoved = movedFaces.map((f) => f.err.fused[pid]).filter((v): v is number => v !== undefined);
  const seedMoved = movedFaces.map((f) => f.err.seeder[pid]).filter((v): v is number => v !== undefined);
  const fusedAll = perFace.map((f) => f.err.fused[pid]).filter((v): v is number => v !== undefined);
  const seedAll = perFace.map((f) => f.err.seeder[pid]).filter((v): v is number => v !== undefined);
  if (fusedMoved.length && seedMoved.length) {
    const [, seedHi] = bootstrapMedian((f) => f.err.seeder[pid], movedFaces);
    const fusedGross = fusedAll.filter((v) => v > 0.15).length / Math.max(1, fusedAll.length);
    const seedGross = seedAll.filter((v) => v > 0.15).length / Math.max(1, seedAll.length);
    if (median(fusedMoved) > seedHi) holds.push(`${pid}: fused median ${fmt(median(fusedMoved))} is worse than the seeder's interval`);
    if (fusedGross > Math.max(0.05, seedGross / 2)) holds.push(`${pid}: fused gross-miss ${(100 * fusedGross).toFixed(0)}% against the seeder's ${(100 * seedGross).toFixed(0)}%`);
  }
}
const cleanAt = (reader: Reader, within: number) =>
  perFace.filter((f) => BACK_LANDMARK_IDS.every((pid) => f.err[reader][pid] === undefined || f.err[reader][pid]! <= within)).length / Math.max(1, perFace.length);
console.log("");
console.log(`Clean profiles (all five back points within 0.10): seeder ${(100 * cleanAt("seeder", 0.1)).toFixed(0)}%, model ${(100 * cleanAt("model", 0.1)).toFixed(0)}%, fused ${(100 * cleanAt("fused", 0.1)).toFixed(0)}%; within 0.06: seeder ${(100 * cleanAt("seeder", 0.06)).toFixed(0)}%, model ${(100 * cleanAt("model", 0.06)).toFixed(0)}%, fused ${(100 * cleanAt("fused", 0.06)).toFixed(0)}%.`);
const highCount = perFace.reduce((t, f) => t + f.highCount, 0);
const highWrong = perFace.reduce((t, f) => t + f.highWrong, 0);
console.log(`Points shown as high confidence that were more than 0.10 out: ${highWrong} of ${highCount} (${highCount ? ((100 * highWrong) / highCount).toFixed(0) : "n/a"}%).`);
if (cleanAt("fused", 0.1) < 0.7) holds.push(`clean-profile rate at 0.10 is ${(100 * cleanAt("fused", 0.1)).toFixed(0)}%, under 70%`);
if (highCount && highWrong / highCount > 0.1) holds.push(`high band wrong on ${((100 * highWrong) / highCount).toFixed(0)}% of points, over 10%`);
console.log(holds.length ? `HOLD the fused seed as AI-first: ${holds.join("; ")}.` : "SHIP: the fused seed is no worse than the seeder on every back point, misses less, and its high band means what it says.");
console.log("(A head width is about 335 px on the 640 px review canvas and about 200 px on a phone, so 0.10 is 20 phone pixels.)");

if (Object.keys(scatter).length) {
  console.log("");
  console.log(`Run-to-run scatter from --repeat (median distance between runs, head widths):`);
  console.log("landmark          first  coarse   fine   final");
  for (const pid of BACK_LANDMARK_IDS) {
    const cell = (stage: string) => fmt(median(scatter[`${pid}:${stage}`] ?? [])).padStart(7);
    console.log(`${pid.padEnd(16)}${cell("first")}${cell("coarse")}${cell("fine")}${cell("final")}`);
  }
}

const back = merge(BACK_LANDMARK_IDS);
const ratio = median(back.modelMoved) / median(back.seedMoved);
console.log("");
console.log(`Tokens: ${tokensIn} in, ${tokensOut} out across ${scored} profiles, ${calls} model calls, ${zoomedPoints} points from a zoom pass.`);
if (latencies.length) console.log(`Latency per photo: median ${(median(latencies) / 1000).toFixed(1)}s, p90 ${(p90(latencies) / 1000).toFixed(1)}s (client deadline is what the app sets).`);
if (Number.isFinite(ratio)) {
  console.log(
    `Legacy pooled rule (70% of these points are the ear pair): model median ${fmt(median(back.modelMoved))} vs seeder ${fmt(median(back.seedMoved))} where the seeder was wrong (ratio ${ratio.toFixed(2)}). ` +
      (ratio <= 0.5 ? "GO by the pooled rule." : "NO-GO by the pooled rule; the verdict block above is the one that decides."),
  );
}
// The same rule with the production correction applied. The seeder's front
// points exist in the app whenever the model runs, so this is the number
// AI-first would actually ship with.
const backMovedY: number[] = [];
for (const pid of BACK_LANDMARK_IDS) {
  // anchoredY and model are pushed in the same order per point, so the moved
  // subset can be picked out by matching the moved model errors' positions.
  const b = perPoint[pid];
  let k = 0;
  for (let i = 0; i < b.model.length; i++) {
    if (k < b.modelMoved.length && b.model[i] === b.modelMoved[k] && b.anchoredY[i] !== undefined) {
      backMovedY.push(b.anchoredY[i]);
      k += 1;
    }
  }
}
const ratioY = median(backMovedY) / median(back.seedMoved);
if (Number.isFinite(ratioY)) {
  console.log(
    `Same points, y-anchored to the seeder's front points: model median ${fmt(median(backMovedY))} vs seeder ${fmt(median(back.seedMoved))} (ratio ${ratioY.toFixed(2)}). ` +
      (ratioY <= 0.5 ? "GO with anchoring." : "NO-GO even with anchoring."),
  );
}
