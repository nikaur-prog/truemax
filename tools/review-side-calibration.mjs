// Read an admin "Export all capture diagnostics" JSON privately on this device.
// This reports correction movement, not accuracy, and does not fit any scores.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("Usage: node tools/review-side-calibration.mjs <diagnostics.json|->");
const input = readFileSync(path === "-" ? 0 : path, "utf8");
if (input.length > 30_000_000) throw new Error("Split diagnostic exports larger than 30 MB before review.");
const data = JSON.parse(input);
if (!data || !Array.isArray(data.faces)) throw new Error("Expected an all-capture diagnostics export with faces[].");
const points = new Map();
const metrics = new Map();
let sideCaptures = 0;
let comparableCaptures = 0;
let unscoredAutomatic = 0;
let templateFallbacks = 0;
const add = (map, id, value) => {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !Number.isFinite(value)) return;
  const values = map.get(id) ?? [];
  values.push(Math.abs(value)); map.set(id, values);
};
for (const face of data.faces) {
  const side = face?.diagnostics?.side;
  if (!side) continue;
  sideCaptures++;
  if (side.diagnostics?.templateFallback === true) templateFallbacks++;
  const comparison = side.placementComparison;
  if (comparison?.comparisonKind !== "automatic-versus-operator" || !Array.isArray(comparison.pointChanges) || !Array.isArray(comparison.metricChanges)) continue;
  comparableCaptures++;
  if (!comparison.automaticReport) unscoredAutomatic++;
  for (const point of comparison.pointChanges) add(points, point?.id, point?.imageDiagonalFraction);
  // Invalid automatic geometry is useful evidence, not a numeric comparison.
  if (comparison.automaticReport) {
    for (const metric of comparison.metricChanges) add(metrics, metric?.id, metric?.delta);
  }
}
const summarise = (map) => [...map].map(([id, values]) => {
  values.sort((a, b) => a - b);
  const q = (fraction) => {
    const index = (values.length - 1) * fraction;
    const lo = Math.floor(index); const hi = Math.ceil(index);
    return values[lo] + (values[hi] - values[lo]) * (index - lo);
  };
  return { id, count: values.length, medianAbsoluteChange: q(.5), p90AbsoluteChange: q(.9), maximumAbsoluteChange: values.at(-1) };
}).sort((a, b) => b.medianAbsoluteChange - a.medianAbsoluteChange);
console.log(JSON.stringify({
  interpretation: "Operator correction movement only. Not independent placement accuracy, population validation or automatic retraining.",
  totalRecords: data.faces.length, sideCaptures, comparableCaptures,
  legacyOrMissingComparisons: sideCaptures - comparableCaptures,
  unscoredAutomatic, templateFallbacks,
  pointMovementUnit: "fraction of review image diagonal; comparable only with controlled framing",
  pointMovement: summarise(points),
  metricChangeUnit: "each metric's original measurement unit; do not compare magnitudes across unlike units",
  metricChanges: summarise(metrics),
}, null, 2));
