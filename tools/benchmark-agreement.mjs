// Do we measure the same thing a competing product measures?
//
// Reads docs/benchmark-pairs.json — the same quantity on the same face, ours
// against the number their UI displayed — and reports, per metric, whether our
// disagreement is SYSTEMATIC (every face off in the same direction, which is a
// bias we can find and fix) or scattered (which is noise, and no offset helps).
//
// What this is for, and what it is not for:
//
//   It is a measurement audit. If our canthal tilt reads low on every face, our
//   ideal for canthal tilt may be sitting in exactly the right place and the
//   MEASUREMENT is what needs correcting. Without this you cannot tell those two
//   apart, and re-deriving an ideal that was already correct makes things worse.
//
//   It is NOT a calibration set. Nothing here may be fitted to their scores.
//   Regressing our numbers onto theirs is reverse-engineering their scoring
//   formula — the same thing as reading their code, done with arithmetic — and
//   it is out of bounds. Their scores are printed for context and are never a
//   target. See the header in the JSON.
//
// Four PEOPLE gives roughly four observations per metric. That is enough to FLAG
// a consistent offset and not enough to CORRECT one; the flag's job is to order
// the ideal-placement audit, which is then done against our own reference set.
//
//   node tools/benchmark-agreement.mjs

import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("../docs/benchmark-pairs.json", import.meta.url)));
const faces = data.faces ?? [];
if (!faces.length) {
  console.error("No faces in docs/benchmark-pairs.json.");
  process.exit(1);
}

// Group every paired row by metric.
const byMetric = new Map();
const unconfirmed = [];
for (const face of faces) {
  for (const row of face.rows ?? []) {
    if (!Number.isFinite(row.ours) || !Number.isFinite(row.theirs)) continue;
    // A pairing whose two sides may not be the same quantity cannot contribute
    // to a bias estimate. Averaging a definition mismatch in with genuine
    // disagreements invents an offset and buries the real ones underneath it.
    if (row.definitionConfirmed === false) {
      unconfirmed.push({ metric: row.metric, face: face.name, ours: row.ours, theirs: row.theirs });
      continue;
    }
    if (!byMetric.has(row.metric)) byMetric.set(row.metric, []);
    byMetric.get(row.metric).push({ ...row, face: face.name, person: face.person ?? face.name });
  }
}

const pct = (ours, theirs) => (theirs === 0 ? NaN : ((ours - theirs) / Math.abs(theirs)) * 100);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

console.log(`${faces.length} face(s), ${byMetric.size} metric(s) measured by both.\n`);

const flagged = [];
const rows = [];
for (const [metric, obs] of [...byMetric].sort()) {
  const deltas = obs.map((o) => o.ours - o.theirs);
  const rel = obs.map((o) => pct(o.ours, o.theirs)).filter(Number.isFinite);
  const signs = new Set(deltas.map((d) => (d > 0 ? 1 : d < 0 ? -1 : 0)));
  // PEOPLE, not captures. Two photographs of one person share that person's
  // bone structure, so if a construction disagrees on their face it disagrees
  // on both captures — which looks like two confirmations and is one. Counting
  // captures let three rows of Bieber-and-Cavill-twice read as "all 3 faces",
  // and the flag it produced was really n=2.
  const people = new Set(obs.map((o) => o.person));
  // Every face off the same way, and by enough to matter. A single face can
  // never satisfy "consistent" in any meaningful sense, so it is not claimed.
  const consistent = people.size >= 3 && signs.size === 1 && !signs.has(0);
  const meanRel = rel.length ? mean(rel) : NaN;
  rows.push({ metric, n: obs.length, people: people.size, meanDelta: mean(deltas), meanRel, consistent });
  if (consistent && Math.abs(meanRel) >= 3) flagged.push({ metric, meanRel, people: people.size });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("metric", 22) + pad("rows", 6) + pad("people", 8) + pad("mean Δ", 12) + pad("mean Δ%", 11) + "same direction",
);
console.log("-".repeat(72));
for (const r of rows) {
  console.log(
    pad(r.metric, 22) +
      pad(r.n, 6) +
      pad(r.people, 8) +
      pad(r.meanDelta.toFixed(3), 12) +
      pad(Number.isFinite(r.meanRel) ? r.meanRel.toFixed(1) + "%" : "—", 11) +
      (r.people < 3 ? "too few people" : r.consistent ? "YES" : "no"),
  );
}

console.log("\nPer face:");
for (const face of faces) {
  const scored = face.rows?.filter((r) => Number.isFinite(r.ours) && Number.isFinite(r.theirs)) ?? [];
  console.log(`  ${face.name}: ${scored.length} paired`
    + (face.ourOverall != null ? `, ours ${face.ourOverall}` : "")
    // Their geometry-only row where the UI exposes one, because their headline
    // pillar includes vision-model judgements we take no measurement for, and
    // comparing against it overstates the gap.
    + (face.theirGeometryOnly != null
        ? `, theirs ${face.theirGeometryOnly} (geometry only; pillar shows ${face.theirOverall})`
        : face.theirOverall != null ? `, theirs ${face.theirOverall}` : ""));
}

if (unconfirmed.length) {
  console.log("\nHeld out — the two sides may not be measuring the same thing:");
  for (const u of unconfirmed) {
    console.log(`  ${pad(u.metric, 22)} ${u.face}: ours ${u.ours} vs theirs ${u.theirs}`);
  }
  console.log("  Resolve each by construction, not by averaging it into a bias estimate.");
}

if (!flagged.length) {
  const thin = rows.filter((r) => r.people < 3).length;
  console.log(
    `\nNothing flagged.${thin ? ` ${thin} metric(s) have fewer than three PEOPLE — add more before reading anything into them.` : ""}`,
  );
} else {
  console.log("\nSystematic offsets — re-check these measurements BEFORE moving their ideals:");
  for (const f of flagged.sort((a, b) => Math.abs(b.meanRel) - Math.abs(a.meanRel))) {
    console.log(`  ${pad(f.metric, 22)} ours reads ${f.meanRel > 0 ? "high" : "low"} by ${Math.abs(f.meanRel).toFixed(1)}% on all ${f.people} people`);
  }
  console.log("\nA consistent offset means the IDEAL may be fine and the measurement is not.");
  console.log("Re-derive against our own reference set — never by adopting their numbers.");
}
