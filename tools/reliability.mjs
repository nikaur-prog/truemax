// Per-metric reliability: how much a metric varies between photos of the SAME
// person, relative to how much it varies across the population. A metric whose
// within-person noise approaches its between-person spread carries no signal
// and should not influence the score.
import { readFileSync } from "node:fs";

const HERE = new URL("./", import.meta.url).pathname;
const alts = JSON.parse(readFileSync(HERE + "alt2-scans.json", "utf8"));
const pop = JSON.parse(readFileSync(HERE + "pop-scans.json", "utf8"));

const GATE = (q) => Math.abs(q.yaw) <= 25 && Math.abs(q.pitch) <= 22 && q.smile <= 0.7;
const sd = (a) => {
  if (a.length < 2) return null;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};

const ids = Object.keys(alts[0].metrics);

// Between-person spread, per sex, from the population reference
const popSD = {};
for (const sex of ["male", "female"]) {
  const rows = pop.filter((p) => p.entry.sex === sex && GATE(p.quality));
  for (const id of ids) {
    const v = rows.map((r) => r.entry.metrics[id]).filter(Number.isFinite);
    (popSD[id] ??= {})[sex] = sd(v);
  }
}

// Within-person spread, pooled across people
const byPerson = {};
for (const a of alts) {
  if (Math.abs(a.yaw) > 15 || Math.abs(a.pitch) > 16 || a.faceWidthFrac < 0.22) continue;
  (byPerson[a.person] ??= []).push(a);
}

const rows = [];
for (const id of ids) {
  const withins = [];
  for (const [, photos] of Object.entries(byPerson)) {
    if (photos.length < 3) continue;
    const sex = photos[0].sex;
    const vals = photos.map((p) => p.metrics[id]).filter(Number.isFinite);
    const s = sd(vals);
    const ps = popSD[id]?.[sex];
    if (s !== null && ps) withins.push(s / ps);
  }
  if (!withins.length) continue;
  const ratio = withins.reduce((a, b) => a + b, 0) / withins.length;
  // Reliability in the intraclass sense: share of observed variance that is
  // real between-person signal rather than photo-to-photo noise.
  const reliability = Math.max(0, 1 - ratio * ratio);
  rows.push({ id, ratio, reliability });
}

rows.sort((a, b) => a.reliability - b.reliability);
console.log("metric".padEnd(24), "noise/signal", "reliability");
for (const r of rows) {
  console.log(r.id.padEnd(24), r.ratio.toFixed(2).padStart(12), r.reliability.toFixed(2).padStart(11));
}
const mean = rows.reduce((a, r) => a + r.reliability, 0) / rows.length;
console.log(`\nmean reliability ${mean.toFixed(2)}   metrics below 0.3: ${rows.filter((r) => r.reliability < 0.3).length}/${rows.length}`);

console.log("\nRELIABILITY = {");
for (const r of rows.slice().sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(`  ${r.id}: ${r.reliability.toFixed(2)},`);
}
console.log("};");
