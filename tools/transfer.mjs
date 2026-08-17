// The score's transfer function, end to end.
//
// Answers one question the unit tests cannot: if every metric on a face sits
// at the same distance from the population mean, where does the OVERALL score
// come out? That is the relationship between the evidence and the headline
// number, and it is the thing that broke — four real scans showed overalls
// ranging from 1.0 below to 2.5 above the mean of their own metrics.
//
// Reads the shipped AGG_NORM table and mirrors the aggregation in scoring.ts
// (aggregateZ -> normalizeAgg per pillar, then again for the overall) rather
// than importing them, so that a change to either shows up here as a DIFF
// instead of silently agreeing with itself.
//
//   node tools/transfer.mjs [male|female]
import { readFileSync } from "node:fs";

const SCORE_SCALE = 1.3;
const PILLARS = ["Harmony", "Angularity", "Dimorphism", "Features"];
const METRICS_PER_PILLAR = 8;

const sex = process.argv[2] === "female" ? "female" : "male";
const src = readFileSync(new URL("../src/engine/aggNorm.ts", import.meta.url), "utf8");
const block = sex === "male"
  ? src.slice(src.indexOf("male:"), src.indexOf("female:"))
  : src.slice(src.indexOf("female:"));
const table = (key) => {
  const m = new RegExp(`"${key}":\\s*\\[([^\\]]+)\\]`).exec(block);
  if (!m) throw new Error(`no quantile table for ${key} (${sex})`);
  return m[1].split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
};

const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
function probit(p) {
  let lo = -8, hi = 8;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (phi(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

function tailZ(z, q) {
  const last = q.length - 1;
  const hiP = 1 - 0.5 / (last + 1), loP = 0.5 / (last + 1);
  const qi = Math.max(1, Math.round(last * 0.25));
  if (z >= q[last]) {
    const span = q[last] - q[last - qi] || 1e-9;
    return probit(hiP) + (z - q[last]) * Math.max(0.2, (probit(hiP) - probit(1 - qi / last)) / span);
  }
  const span = q[qi] - q[0] || 1e-9;
  return probit(loP) - (q[0] - z) * Math.max(0.2, (probit(qi / last) - probit(loP)) / span);
}
function normalizeAgg(z, q) {
  const last = q.length - 1;
  if (z >= q[last] || z <= q[0]) return tailZ(z, q);
  let i = 0;
  while (i < last && z > q[i + 1]) i++;
  const span = q[i + 1] - q[i] || 1e-9;
  return probit(Math.min(Math.max((i + (z - q[i]) / span) / last, 0.001), 0.999));
}
// Plain weighted mean, mirroring scoring.ts. Deliberately a copy, so a
// change on either side shows up here as a diff rather than agreeing silently.
const aggregateZ = (zs) => zs.reduce((a, z) => a + z, 0) / zs.length;

const overall = table("overall");
const pillar = Object.fromEntries(PILLARS.map((p) => [p, table(`pillar:${p}`)]));

// Anchored on the POPULATION, not on the metric ideal.
//
// The first version of this walked out from metric z = 0 and called that "an
// average face". It is not: z = 0 is a face sitting exactly on every aesthetic
// ideal, and the reference population's median sits well below that. Measuring
// steepness from the wrong origin made the curve look worse than it is and hid
// the property that actually matters — how far a face moves per unit of REAL
// between-person variation.
const med = overall[(overall.length / 2) | 0];
const sd = (overall[overall.length - 1] - overall[0]) / 6; // ~6 sd across a sample this size

console.log(`\nTransfer function — ${sex}\n`);
console.log("  offsets are in population SD from the reference median\n");
console.log("   pop SD   metric score   raw aggregate   overall pct   overall score");
console.log("   " + "-".repeat(70));
for (const nsd of [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5]) {
  const mz = med + nsd * sd;
  const pz = PILLARS.map((p) =>
    normalizeAgg(aggregateZ(Array(METRICS_PER_PILLAR).fill(mz)), pillar[p]));
  const raw = aggregateZ(pz);
  const oz = normalizeAgg(raw, overall);
  console.log(
    `   ${nsd.toFixed(1).padStart(6)}   ${(5 + SCORE_SCALE * mz).toFixed(2).padStart(12)}` +
    `   ${raw.toFixed(3).padStart(13)}   ${((phi(oz) * 100).toFixed(1) + "%").padStart(11)}` +
    `   ${(5 + SCORE_SCALE * oz).toFixed(2).padStart(13)}`);
}
// The number that matters for stability: two photographs of one man moved the
// mean metric z by 0.37 on the shipped build. How much score is that worth?
{
  const at = (mz) => {
    const pz = PILLARS.map((p) =>
      normalizeAgg(aggregateZ(Array(METRICS_PER_PILLAR).fill(mz)), pillar[p]));
    return 5 + SCORE_SCALE * normalizeAgg(aggregateZ(pz), overall);
  };
  console.log(`\n   a 0.37 shift in mean metric z (one man, two photos) is worth ` +
    `${(at(med + 0.37) - at(med)).toFixed(2)} points of score at the median.`);
}
console.log("\n   reference population aggregate: " +
  `min ${overall[0].toFixed(3)}  median ${overall[(overall.length / 2) | 0].toFixed(3)}` +
  `  max ${overall[overall.length - 1].toFixed(3)}\n`);
console.log("  A face at the population mean must land at the 50th percentile.");
console.log("  A face whose metrics all sit half a sigma up must NOT exceed the");
console.log("  entire reference population's maximum aggregate.\n");
