// ---------------------------------------------------------------------------
// Repeatability, from the diagnostics dumps a person can actually collect.
//
// tools/reliability.mjs answers the same question from harvested celebrity
// photographs: it needs a JSON corpus produced by the scan-alts pipeline, and
// nothing you can gather by handing a phone to fifteen friends will ever be in
// that shape. This reads what the app itself can emit — the text on the
// clipboard behind "Copy diagnostics" — so a scanning session turns into an
// answer instead of a folder of notes.
//
// THE QUESTION. Scan one person twice and the two scores differ. Repeatability
// is how much of that difference is the instrument rather than the face, and it
// is the number the entire product promise rests on: "we will tell you whether
// it moved" is only true above the noise floor. A metric whose scan-to-scan
// spread approaches its between-person spread carries no signal at all.
//
// USAGE
//   node tools/repeat-scans.mjs scans/            # a directory of .txt dumps
//   node tools/repeat-scans.mjs a.txt b.txt ...   # or explicit files
//
// Each file may hold one dump or several concatenated. Faces are grouped by
// the `face:` line, so name the person the same way in every scan of them —
// that label is the only thing tying two dumps together.
//
// POSE GATING. A capture taken at 20 degrees of yaw differs from a level one
// for reasons that have nothing to do with the face, so those scans are
// reported and excluded rather than averaged in as instability. Dumps written
// before the capture line existed have no pose to check and are counted
// separately, because "not measured" is not "fine".
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Matches tools/reliability.mjs, so the two are directly comparable.
const GATE = { yaw: 15, pitch: 16, smile: 0.5 };

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node tools/repeat-scans.mjs <dir | file.txt ...>");
  process.exit(1);
}

const files = args.flatMap((a) => {
  const s = statSync(a);
  if (!s.isDirectory()) return [a];
  return readdirSync(a)
    .filter((f) => /\.(txt|md|log)$/i.test(f))
    .map((f) => join(a, f));
});

// --- parsing ----------------------------------------------------------------

const num = (s) => {
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

/** Split a file into individual dumps and parse each one. */
function parseDumps(text) {
  const chunks = text
    .split(/^(?=TRUEMAX SCAN DIAGNOSTICS\s*$)/m)
    .map((c) => c.trim())
    .filter((c) => c.startsWith("TRUEMAX SCAN DIAGNOSTICS"));
  return chunks.map(parseDump).filter(Boolean);
}

function parseDump(text) {
  const lines = text.split("\n");
  const face = /^face:\s*(.+)$/m.exec(text)?.[1]?.trim();
  if (!face) return null;
  const sex = /^scored against:\s*(men|women)\s*$/m.exec(text)?.[1] === "women" ? "female" : "male";
  const overall = num(/^overall:\s*([-\d.]+)/m.exec(text)?.[1] ?? "");
  const front = num(/^front:\s*([-\d.]+)/m.exec(text)?.[1] ?? "");
  const side = num(/·\s*side:\s*([-\d.]+)/m.exec(text)?.[1] ?? "");
  const at = /^taken:\s*(\S+)/m.exec(text)?.[1] ?? null;
  const scanId = /^scan:\s*(\S+)/m.exec(text)?.[1] ?? null;

  const cap = /^capture:\s*(.+)$/m.exec(text)?.[1] ?? null;
  const pose = cap
    ? {
        yaw: num(/yaw\s*([-\d.]+)/.exec(cap)?.[1] ?? ""),
        pitch: num(/pitch\s*([-\d.]+)/.exec(cap)?.[1] ?? ""),
        roll: num(/roll\s*([-\d.]+)/.exec(cap)?.[1] ?? ""),
        smile: num(/smile\s*([-\d.]+)/.exec(cap)?.[1] ?? ""),
      }
    : null;

  // The metric table. Columns are fixed-width but the NAME can contain spaces,
  // so anchor on the numeric prefix and take the rest of the line as the name.
  // score, off(σ), reliab, dir, value, ideal, name
  const metrics = {};
  let inMetrics = false;
  for (const line of lines) {
    if (/^METRICS\s*$/.test(line)) { inMetrics = true; continue; }
    if (/^EXCLUDED/.test(line)) { inMetrics = false; continue; }
    if (!inMetrics) continue;
    // Leading whitespace is \s+ and NOT a fixed two spaces: the score column
    // is right-padded to width 5, so a row actually begins with four spaces
    // and an exact-count anchor silently matched nothing at all — every dump
    // parsed as a scan with zero metrics.
    const m = /^\s+([-\d.—]+)\s+([+-][\d.—]+)σ\s+([\d.—]+)\s+(\S+)\s+([-\d.—]+)\s+([-\d.—]+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const value = num(m[5]);
    if (value === null) continue;
    metrics[m[7]] = { value, score: num(m[1]), off: num(m[2]) };
  }
  if (!Object.keys(metrics).length) return null;
  return { face, sex, overall, front, side, at, scanId, pose, metrics };
}

// --- load -------------------------------------------------------------------

const scans = [];
for (const f of files) {
  const found = parseDumps(readFileSync(f, "utf8"));
  if (!found.length) console.error(`! no dumps found in ${f}`);
  for (const s of found) scans.push({ ...s, file: f });
}
if (!scans.length) {
  console.error("No diagnostics dumps parsed. Paste the text behind 'Copy diagnostics'.");
  process.exit(1);
}

// A duplicated paste of ONE scan looks exactly like perfect repeatability,
// which would be the most flattering possible bug. Scan ids make it detectable.
const seen = new Set();
const dupes = [];
for (const s of scans) {
  if (!s.scanId) continue;
  if (seen.has(s.scanId)) dupes.push(s.scanId);
  seen.add(s.scanId);
}
const unique = scans.filter((s, i) => !s.scanId || scans.findIndex((o) => o.scanId === s.scanId) === i);

// --- gate -------------------------------------------------------------------

const noPose = unique.filter((s) => !s.pose);
const gated = unique.filter((s) => {
  if (!s.pose) return false;
  return (
    Math.abs(s.pose.yaw ?? 0) <= GATE.yaw &&
    Math.abs(s.pose.pitch ?? 0) <= GATE.pitch &&
    (s.pose.smile ?? 0) <= GATE.smile
  );
});
const rejected = unique.filter((s) => s.pose && !gated.includes(s));

// --- group ------------------------------------------------------------------

const byFace = {};
for (const s of gated) (byFace[s.face] ??= []).push(s);
const repeated = Object.entries(byFace).filter(([, list]) => list.length >= 2);

const sd = (a) => {
  if (a.length < 2) return null;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};

console.log(`\nREAD  ${scans.length} dump${scans.length === 1 ? "" : "s"} from ${files.length} file${files.length === 1 ? "" : "s"}`);
if (dupes.length) console.log(`      ${dupes.length} duplicate paste${dupes.length === 1 ? "" : "s"} dropped (same scan id)`);
console.log(`      ${gated.length} usable, ${rejected.length} rejected on pose/expression, ${noPose.length} with no capture line`);
for (const s of rejected) {
  const p = s.pose;
  console.log(`      rejected: ${s.face} — yaw ${p.yaw}° pitch ${p.pitch}° smile ${p.smile}  (${s.file})`);
}
if (noPose.length) {
  console.log(`      no capture line — from a build before pose was recorded, cannot be gated:`);
  for (const s of noPose) console.log(`        ${s.face} (${s.file})`);
}

const people = Object.keys(byFace).length;
const women = new Set(gated.filter((s) => s.sex === "female").map((s) => s.face)).size;
console.log(`\nFACES ${people} (${women} scored against women), ${repeated.length} scanned more than once`);
if (!repeated.length) {
  console.log(`\nNothing to measure yet: repeatability needs at least one face scanned twice.`);
  process.exit(0);
}

// --- the answer -------------------------------------------------------------
//
// Between-person spread comes from THIS set rather than the population table,
// so the ratio answers "against the people I scanned" honestly. With fifteen
// faces that spread is itself uncertain, which is why the count is printed
// beside it rather than the number being presented alone.

const ids = [...new Set(gated.flatMap((s) => Object.keys(s.metrics)))];
const rows = [];
for (const id of ids) {
  // One value per face (its mean), for the between-person spread.
  const perFace = Object.values(byFace)
    .map((list) => {
      const v = list.map((s) => s.metrics[id]?.value).filter((x) => typeof x === "number");
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    })
    .filter((x) => x !== null);
  const between = sd(perFace);

  // Within-person spread, pooled across the faces scanned more than once.
  const withins = [];
  for (const [, list] of repeated) {
    const v = list.map((s) => s.metrics[id]?.value).filter((x) => typeof x === "number");
    const s = sd(v);
    if (s !== null) withins.push(s);
  }
  if (!withins.length || !between) continue;
  const within = withins.reduce((a, b) => a + b, 0) / withins.length;
  const ratio = within / between;
  rows.push({ id, within, between, ratio, reliability: Math.max(0, 1 - ratio * ratio), n: withins.length });
}

rows.sort((a, b) => a.reliability - b.reliability);
console.log(`\nPER-METRIC REPEATABILITY  (${repeated.length} face${repeated.length === 1 ? "" : "s"} scanned twice or more)`);
console.log(`  ${"metric".padEnd(30)} ${"within".padStart(9)} ${"between".padStart(9)} ${"noise".padStart(7)} ${"reliab".padStart(7)}`);
for (const r of rows) {
  const flag = r.reliability < 0.3 ? "  ← noise" : r.reliability < 0.5 ? "  ← weak" : "";
  console.log(
    `  ${r.id.padEnd(30)} ${r.within.toFixed(3).padStart(9)} ${r.between.toFixed(3).padStart(9)} ` +
      `${r.ratio.toFixed(2).padStart(7)} ${r.reliability.toFixed(2).padStart(7)}${flag}`,
  );
}
const mean = rows.reduce((a, r) => a + r.reliability, 0) / rows.length;
console.log(`\n  mean reliability ${mean.toFixed(2)}   below 0.3: ${rows.filter((r) => r.reliability < 0.3).length}/${rows.length}`);

// --- the headline the product actually promises -----------------------------
//
// Per-metric reliability is the diagnostic; THIS is the claim. If the same
// face scanned twice moves the overall by more than a rescan is meant to
// detect, then "your score went up" is a statement about the camera.

const overallSpread = [];
const frontSpread = [];
const sideSpread = [];
for (const [face, list] of repeated) {
  const o = sd(list.map((s) => s.overall).filter(Number.isFinite));
  const f = sd(list.map((s) => s.front).filter(Number.isFinite));
  const sv = sd(list.map((s) => s.side).filter(Number.isFinite));
  if (o !== null) overallSpread.push({ face, sd: o, n: list.length });
  if (f !== null) frontSpread.push(f);
  if (sv !== null) sideSpread.push(sv);
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
console.log(`\nSCORE STABILITY  (same face, different photograph)`);
for (const s of overallSpread.sort((a, b) => b.sd - a.sd)) {
  console.log(`  ${s.face.padEnd(30)} ±${s.sd.toFixed(2)} over ${s.n} scans`);
}
const mo = avg(overallSpread.map((s) => s.sd));
const mf = avg(frontSpread);
const ms = avg(sideSpread);
console.log(`\n  overall ±${mo?.toFixed(2) ?? "—"}` +
  `${mf === null ? "" : `   front ±${mf.toFixed(2)}`}` +
  `${ms === null ? "" : `   side ±${ms.toFixed(2)}`}`);
if (ms !== null && mf !== null && ms > mf * 1.5) {
  console.log(`  The side moves ${(ms / mf).toFixed(1)}x more than the front between photographs of one person.`);
}
console.log(
  `\n  A rescan can only honestly report a change larger than this. Anything\n` +
    `  smaller is the instrument, and the delta copy should not claim it.\n`,
);
