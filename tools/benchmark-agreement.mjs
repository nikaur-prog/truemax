// Compare explicitly confirmed, same-unit geometric measurements, not scores.
// Product scores are context only and never fitting targets. A consistent
// difference suggests a construction to review, not which reader is correct.
//
// node tools/benchmark-agreement.mjs [private-pairs.json]
// Without an argument, reads the historical docs/benchmark-pairs.json. Old rows
// without explicit definition confirmation are held until reviewed; do not
// silently approve them to preserve a previously printed result.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

function canonicalUnit(value) {
  if (typeof value !== "string") return null;
  const unit = value.trim();
  if (["deg", "degree", "degrees", "°"].includes(unit)) return "°";
  if (["", "x", "×", "ratio"].includes(unit)) return "ratio";
  // These differences are percentage POINTS, never percentages of a possibly
  // zero measurement. Fraction and percent groups are not silently combined.
  if (unit === "%") return "pp";
  if (unit.startsWith("% ")) return `pp ${unit.slice(2)}`;
  return unit;
}

/** Pure audit calculation. Importing this module never reads a dataset. */
export function summarizeBenchmark(data) {
  const faces = Array.isArray(data?.faces) ? data.faces : [];
  const groups = new Map();
  const held = [];
  const faceSummaries = [];
  for (const [index, face] of faces.entries()) {
    const name = text(face?.name) ?? `Unnamed capture ${index + 1}`;
    const person = text(face?.person) ?? text(face?.name);
    let accepted = 0;
    for (const row of Array.isArray(face?.rows) ? face.rows : []) {
      const metric = text(row?.metric);
      const unit = canonicalUnit(row?.unit);
      let reason;
      if (row?.definitionConfirmed !== true) reason = "definition not explicitly confirmed";
      else if (!metric || !person) reason = "metric or person identifier missing";
      else if (unit === null) reason = "measurement unit missing";
      else if (!Number.isFinite(row.ours) || !Number.isFinite(row.theirs)) reason = "measurement unavailable";
      else if (!Number.isFinite(row.ours - row.theirs)) reason = "measurement difference is not finite";
      if (reason) {
        held.push({ metric: metric ?? "unknown", face: name, reason });
        continue;
      }
      const key = JSON.stringify([metric, unit]);
      if (!groups.has(key)) groups.set(key, { metric, unit, observations: [] });
      groups.get(key).observations.push({ person, delta: row.ours - row.theirs });
      accepted++;
    }
    // Explicit context only: none of these scores enters measurement statistics.
    faceSummaries.push({ name, accepted, ourOverall: face?.ourOverall, theirOverall: face?.theirOverall, theirGeometryOnly: face?.theirGeometryOnly });
  }

  const rows = [...groups.values()].map(({ metric, unit, observations }) => {
    const byPerson = new Map();
    for (const observation of observations) {
      if (!byPerson.has(observation.person)) byPerson.set(observation.person, []);
      byPerson.get(observation.person).push(observation.delta);
    }
    const personDeltas = [...byPerson.values()].map((deltas) => ({
      signed: mean(deltas), absolute: mean(deltas.map(Math.abs)),
    }));
    const signs = new Set(personDeltas.map((value) => Math.sign(value.signed)));
    return {
      metric, unit, n: observations.length, people: byPerson.size,
      // Each person has equal weight even when one has many repeat captures.
      meanDelta: mean(personDeltas.map((value) => value.signed)),
      meanAbsDelta: mean(personDeltas.map((value) => value.absolute)),
      maxAbsDelta: Math.max(...observations.map((value) => Math.abs(value.delta))),
      consistent: byPerson.size >= 3 && signs.size === 1 && !signs.has(0),
    };
  }).sort((a, b) => a.metric.localeCompare(b.metric) || a.unit.localeCompare(b.unit));
  return { faceCount: faces.length, rows, held, faces: faceSummaries };
}

export function formatBenchmark(summary) {
  const pad = (value, width) => String(value).padEnd(width);
  const number = (value) => value === 0 ? "0" : Number(value.toPrecision(6)).toString();
  const lines = [
    `${summary.faceCount} capture(s), ${summary.rows.length} explicitly confirmed metric/unit group(s).`,
    "Differences are TrueMax minus benchmark, in native units (pp = percentage points).",
    "Mean signed and absolute differences give each person equal weight. No percentage-relative error or score fitting.",
    "",
    pad("metric", 24) + pad("unit", 14) + pad("rows", 6) + pad("people", 8) + pad("signed mean", 14) + pad("mean absolute", 15) + pad("max absolute", 14) + "same direction",
  ];
  for (const row of summary.rows) {
    lines.push(pad(row.metric, 24) + pad(row.unit, 14) + pad(row.n, 6) + pad(row.people, 8)
      + pad(number(row.meanDelta), 14) + pad(number(row.meanAbsDelta), 15) + pad(number(row.maxAbsDelta), 14)
      + (row.people < 3 ? "too few people" : row.consistent ? "yes, exploratory" : "no"));
  }
  lines.push("", "Per capture (scores are context, not calibration targets):");
  for (const face of summary.faces) {
    lines.push(`  ${face.name}: ${face.accepted} confirmed pair(s)`
      + (Number.isFinite(face.ourOverall) ? `, ours ${face.ourOverall}` : "")
      + (Number.isFinite(face.theirGeometryOnly)
        ? `, benchmark ${face.theirGeometryOnly} (geometry only)`
        : Number.isFinite(face.theirOverall) ? `, benchmark ${face.theirOverall}` : ""));
  }
  if (summary.held.length) {
    lines.push("", `Held out: ${summary.held.length} pair(s).`);
    for (const row of summary.held) lines.push(`  ${row.metric} / ${row.face}: ${row.reason}`);
  }
  if (!summary.rows.length) lines.push("", "No explicitly confirmed measurement pairs to compare. Review definitions and units before interpreting agreement.");
  lines.push("", "A shared direction is an exploratory review cue, not an accuracy verdict. No universal error tolerance has been set.",
    "Check landmark constructions and independent annotations before changing measurements or reference ideals.");
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] ?? new URL("../docs/benchmark-pairs.json", import.meta.url);
  const summary = summarizeBenchmark(JSON.parse(readFileSync(input, "utf8")));
  console.log(formatBenchmark(summary));
  if (!summary.faceCount) process.exitCode = 1;
}
