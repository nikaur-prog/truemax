// Fit the side-seed template constants from the labeled dataset.
//
// Labels = the harness seeds with hand corrections applied (display px, 640
// wide). The corrections below were made by visual inspection of every
// annotated render in .side-dataset/seeded/; a face listed in EXCLUDE is
// clipped or otherwise out of capture spec and takes no part in the fit, and
// PARTIAL lists points too uncertain to label (hair over the ear, frame
// edge).
//
// What is fitted:
//   - TEMPLATE rows for the five placed points (menton, gonion, condylion,
//     cervicale, tragion), as medians of the LABELED positions in the head's
//     own frame. The frame is built from labeled trichion/pogonion/pronasale
//     — the same construction placeBackPoints uses — and the head width unit
//     is the labeled nose-to-tragion depth, which makes tragion's fitted fu
//     exactly -1 by construction and every other point relative to real ears
//     rather than to a guessed width.
//   - EAR_DEPTH_SCALE: how much the seeder's implied head width differs from
//     the labeled one, as a median ratio. Multiplies SEG_EAR_DEPTH.
//
//   node tools/side-fit.mjs            → prints fitted constants + error table
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const seeds = JSON.parse(readFileSync(`${APP_DIR}/.side-dataset/seeds.json`, "utf8"));

// s022: nose clipped at the frame. s037: braids hang over the whole profile
// line. s051: over-rotated, more back-of-head than profile. All three are out
// of capture spec — the app would coach a retake — so they teach nothing.
const EXCLUDE = new Set(["s022", "s037", "s051"]);
const PARTIAL = {
  s006: ["pronasale", "subnasale", "labialeSuperius", "labialeInferius", "pogonion", "menton", "cervicale"],
  s035: ["gonion", "condylion", "tragion"],
  // Afro fully covers the ear; the cluster cannot be honestly labeled.
  s043: ["gonion", "condylion", "tragion"],
  // The beard hides the jaw angle.
  s053: ["gonion"],
};

// Hand corrections in display pixels. Point ids in SIDE_POINTS order.
const IDS = [
  "trichion", "glabella", "nasion", "pronasale", "subnasale",
  "labialeSuperius", "labialeInferius", "pogonion", "menton",
  "cervicale", "gonion", "condylion", "tragion",
];
const C = (n) => IDS[n - 1];
const CORRECTIONS = {
  s000: { 1: [122, 232], 2: [95, 288], 7: [75, 510], 8: [92, 548], 9: [135, 582], 10: [232, 596], 11: [332, 556], 12: [368, 390], 13: [396, 390] },
  s001: { 2: [556, 272], 7: [605, 545], 8: [592, 590], 9: [555, 610], 10: [395, 622], 11: [285, 570], 12: [278, 398], 13: [262, 388] },
  s002: { 9: [85, 780], 11: [430, 760], 12: [465, 415], 13: [505, 415] },
  s003: { 9: [500, 555], 10: [398, 552], 11: [342, 500], 12: [305, 352], 13: [292, 350] },
  s004: { 7: [70, 583], 8: [78, 610] },
  s006: { 11: [400, 565] },
  s007: { 8: [92, 628], 9: [132, 652], 10: [248, 652], 11: [348, 590] },
  s008: { 11: [288, 722], 12: [215, 592], 13: [232, 586] },
  s009: { 11: [293, 588], 12: [340, 440], 13: [352, 442] },
  s010: { 1: [455, 185] },
  s012: { 12: [428, 442], 13: [432, 438] },
  s013: { 11: [268, 648], 12: [310, 472], 13: [318, 475] },
  s014: { 1: [118, 142], 2: [85, 245], 3: [78, 272], 8: [20, 555], 11: [310, 640], 12: [412, 438], 13: [428, 428] },
  s015: { 9: [555, 552], 11: [432, 552], 12: [372, 442], 13: [365, 448] },
  s016: { 12: [356, 455], 13: [368, 442] },
  s017: { 11: [328, 678], 12: [215, 468], 13: [200, 455] },
  s018: { 12: [352, 432], 13: [362, 438] },
  s019: { 9: [95, 668], 12: [510, 472], 13: [498, 478] },
  s020: { 9: [75, 645], 11: [302, 618], 12: [448, 435], 13: [455, 425] },
  s021: { 11: [372, 542], 12: [268, 362], 13: [258, 352] },
  s023: { 13: [392, 490] },
  s024: { 2: [112, 295], 3: [102, 328], 9: [70, 770], 12: [508, 522], 13: [498, 532] },
  s025: { 12: [352, 455], 13: [345, 465] },
  s026: { 13: [396, 383] },
  s027: { 8: [145, 592], 9: [170, 612], 12: [538, 448], 13: [548, 438] },
  s029: { 13: [368, 492] },
  s030: { 1: [100, 185], 2: [118, 248], 3: [108, 268], 12: [310, 350], 13: [322, 340] },
  s031: { 12: [338, 455], 13: [348, 448] },
  s032: { 1: [100, 158], 2: [122, 298], 3: [118, 325], 12: [438, 440], 13: [412, 412] },
  s033: { 12: [330, 392], 13: [342, 382] },
  s034: { 11: [292, 528], 12: [265, 352], 13: [250, 345] },
  // Round 2 (s036-s059, hand-labeled 2026-08-29). Mostly the ear cluster,
  // which is what the fit needs; front points only where the seed missed.
  s036: { 11: [330, 595], 12: [378, 448], 13: [392, 442] },
  s038: { 1: [172, 315], 12: [393, 522], 13: [400, 510] },
  s039: { 7: [548, 612], 12: [305, 500], 13: [315, 492] },
  s040: { 12: [332, 438], 13: [340, 430] },
  s041: { 12: [295, 448], 13: [302, 438] },
  s042: { 3: [115, 420], 12: [315, 478], 13: [322, 468] },
  s043: { 5: [558, 572], 6: [566, 594], 7: [560, 612], 8: [552, 625] },
  s044: { 12: [420, 462], 13: [428, 452] },
  s045: { 12: [300, 425], 13: [307, 415] },
  s046: { 1: [220, 220] },
  s047: { 12: [338, 502], 13: [345, 492] },
  s048: { 12: [345, 518], 13: [352, 508] },
  s049: { 12: [348, 445], 13: [355, 435] },
  s050: { 8: [158, 545], 9: [175, 572], 10: [250, 590], 11: [312, 552], 13: [368, 440] },
  s052: { 12: [348, 335], 13: [352, 322] },
  s053: { 1: [420, 368], 9: [522, 758], 12: [240, 580], 13: [248, 568] },
  s054: { 12: [296, 498], 13: [303, 488] },
  s055: { 11: [295, 655], 12: [280, 482], 13: [288, 472] },
  s056: { 12: [262, 442], 13: [268, 432] },
  s057: { 1: [232, 222], 9: [138, 598] },
  s058: { 1: [455, 295], 12: [250, 470], 13: [258, 458] },
};

// "eval" mode: compare the CURRENT seeds against the frozen labels.json
// instead of rebuilding labels — the after-measurement for a seeder change.
const EVAL = process.argv[2] === "eval";
const savedLabels = EVAL
  ? JSON.parse(readFileSync(`${APP_DIR}/.side-dataset/labels.json`, "utf8"))
  : null;

const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2;
};

// Head frame from labeled points, mirroring sideVerify.headFrame.
const POGONION_V = 0.94; // must match TEMPLATE.pogonion[1]
function frameOf(p) {
  const dx = p.pogonion.x - p.trichion.x;
  const dy = p.pogonion.y - p.trichion.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1)) return null;
  const vx = dx / len, vy = dy / len;
  let ux = vy, uy = -vx;
  const uNose = (p.pronasale.x - p.trichion.x) * ux + (p.pronasale.y - p.trichion.y) * uy;
  if (uNose < 0) { ux = -ux; uy = -uy; }
  return { ox: p.trichion.x, oy: p.trichion.y, ux, uy, vx, vy, uNose: Math.abs(uNose), vlen: len / POGONION_V };
}
const U = (f, pt) => (pt.x - f.ox) * f.ux + (pt.y - f.oy) * f.uy;
const V = (f, pt) => (pt.x - f.ox) * f.vx + (pt.y - f.oy) * f.vy;

const BACK = ["menton", "gonion", "condylion", "cervicale", "tragion"];
const labels = {};
const fits = {};
for (const id of BACK) fits[id] = { fu: [], fv: [] };
const errors = {};
for (const id of IDS) errors[id] = [];
const widthRatios = [];

for (const [face, seed] of Object.entries(seeds)) {
  if (EXCLUDE.has(face)) continue;
  const pts = {};
  if (EVAL) {
    if (!savedLabels[face]) continue;
    for (const id of IDS) pts[id] = { ...savedLabels[face].points[id] };
  } else {
    for (const id of IDS) pts[id] = { ...seed.points[id] };
    for (const [n, [x, y]] of Object.entries(CORRECTIONS[face] ?? {})) pts[C(Number(n))] = { x, y };
  }
  labels[face] = { points: pts };

  const skip = new Set(PARTIAL[face] ?? []);
  const f = frameOf(pts);
  if (!f) continue;
  const headW = Math.abs(U(f, pts.tragion) - f.uNose);
  if (headW > 5 && !skip.has("tragion")) {
    for (const id of BACK) {
      if (skip.has(id)) continue;
      fits[id].fu.push((U(f, pts[id]) - f.uNose) / headW * (U(f, pts[id]) - f.uNose < 0 ? 1 : 1));
      fits[id].fv.push(V(f, pts[id]) / f.vlen);
    }
    // Seeder's implied width, recovered from where it PUT tragion.
    const fs = frameOf(seed.points);
    if (fs) {
      const headWSeed = Math.abs(U(fs, seed.points.tragion) - fs.uNose);
      if (headWSeed > 5) widthRatios.push(headW / headWSeed);
    }
  }
  // Per-point seed-vs-label error, in % of labeled head height.
  const hh = f.vlen;
  for (const id of IDS) {
    if (skip.has(id)) continue;
    const d = Math.hypot(seed.points[id].x - pts[id].x, seed.points[id].y - pts[id].y);
    errors[id].push((d / hh) * 100);
  }
}

if (!EVAL) writeFileSync(`${APP_DIR}/.side-dataset/labels.json`, JSON.stringify(labels, null, 1));

console.log("faces fitted:", Object.keys(labels).length);
console.log("\nTEMPLATE (fu in nose-to-tragion widths, fv in head heights):");
for (const id of BACK) {
  console.log(`  ${id}: [${median(fits[id].fu).toFixed(3)}, ${median(fits[id].fv).toFixed(3)}]  (n=${fits[id].fu.length})`);
}
console.log("\nEAR_DEPTH_SCALE (label headW / seed headW): median", median(widthRatios).toFixed(3), "n=", widthRatios.length);
console.log("\nSeed error before refit, % of head height (median / p90):");
for (const id of IDS) {
  const e = errors[id];
  if (!e.length) continue;
  const p90 = [...e].sort((a, b) => a - b)[Math.floor(e.length * 0.9)];
  console.log(`  ${id}: ${median(e).toFixed(1)}% / ${p90.toFixed(1)}%  (n=${e.length})`);
}
