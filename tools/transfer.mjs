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

const RHO_METRICS = 0.3;
const RHO_PILLARS = 0.55;
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
const aggregateZ = (zs, rho) =>
  (zs.reduce((a, z) => a + z, 0) / zs.length) / Math.sqrt(rho + (1 - rho) / zs.length);

const overall = table("overall");
const pillar = Object.fromEntries(PILLARS.map((p) => [p, table(`pillar:${p}`)]));

console.log(`\nTransfer function — ${sex}\n`);
console.log("  every metric at the same z, so metric score = 5 + 1.3z\n");
console.log("   metric z   metric score   raw aggregate   overall pct   overall score");
console.log("   " + "-".repeat(72));
for (const mz of [-0.75, -0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5, 0.75, 1.0]) {
  const pz = PILLARS.map((p) =>
    normalizeAgg(aggregateZ(Array(METRICS_PER_PILLAR).fill(mz), RHO_METRICS), pillar[p]));
  const raw = aggregateZ(pz, RHO_PILLARS);
  const oz = normalizeAgg(raw, overall);
  const pct = phi(oz) * 100;
  console.log(
    `   ${mz.toFixed(2).padStart(8)}   ${(5 + SCORE_SCALE * mz).toFixed(2).padStart(12)}` +
    `   ${raw.toFixed(3).padStart(13)}   ${(pct.toFixed(1) + "%").padStart(11)}` +
    `   ${(5 + SCORE_SCALE * oz).toFixed(2).padStart(13)}`);
}
console.log("\n   reference population aggregate: " +
  `min ${overall[0].toFixed(3)}  median ${overall[(overall.length / 2) | 0].toFixed(3)}` +
  `  max ${overall[overall.length - 1].toFixed(3)}\n`);
console.log("  A face at the population mean must land at the 50th percentile.");
console.log("  A face whose metrics all sit half a sigma up must NOT exceed the");
console.log("  entire reference population's maximum aggregate.\n");
