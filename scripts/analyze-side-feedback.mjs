// Analyse the consented side-landmark corrections people have submitted, and
// say whether the auto-placement has a SYSTEMATIC bias worth correcting.
//
// What it reads: the side_landmark_feedback table — automatic vs corrected
// point positions, face direction, seed method. Points only. It never touches
// the private photo bucket; the photographs are for a human re-labelling
// session, not for this script.
//
// What it prints, per landmark:
//   n        usable diagnostic submissions for this point
//   med dx   the median correction along x, in canonical orientation
//   med dy   the median correction along y
//   spread   the interquartile range — small spread + consistent sign is a
//            real bias; large spread is per-photo noise no offset can fix
//
// Canonical orientation: every offset is mirrored into faceDir=+1 space
// (faces image-right), so a "moved the gonion forward" correction from a
// left-facing photo agrees in sign with one from a right-facing photo.
// Offsets are in unit-face space — normalised by the corrected face height
// (trichion to menton) — so a 4K upload and a 720p one weigh the same.
//
// The output is a report, not an automatic patch, on purpose. A calibration
// offset only helps if the bias is consistent; applying medians estimated
// from a handful of rows would move placement AWAY from faces the seeder
// currently gets right. The rule printed at the bottom of the report says
// when a landmark merits a candidate: at least 25 independently reviewed,
// moved points with |median| > half the IQR. An emitted JSON block still needs
// a subject-separated held-out comparison and approval before use.
//
// Run it with the service credentials in the environment (from Vercel env,
// never committed):
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
//     node scripts/analyze-side-feedback.mjs

import { fetchSideFeedbackRows, sideFeedbackCalibrationOffsets, sideFeedbackOffsets } from "./side-feedback-analysis.mjs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (the truemax project, not reckon).");
  process.exit(1);
}

const POINT_IDS = [
  "trichion", "glabella", "nasion", "pronasale", "subnasale",
  "labialeSuperius", "labialeInferius", "pogonion", "menton",
  "gonion", "condylion", "cervicale", "tragion",
];

const MIN_N = 25;

const snapshotTime = new Date().toISOString();
let rows;
try {
  rows = await fetchSideFeedbackRows(url, key, { now: snapshotTime });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Feedback could not be read completely");
  process.exit(1);
}
console.log(`${rows.length} unexpired submissions at ${snapshotTime}.\n`);
if (!rows.length) process.exit(0);
console.log("Rejected or unknown-review rows are excluded. Unreviewed rows remain diagnostic, not verified labels; this report applies no offsets.\n");
console.log("Only independently reviewed, explicitly moved points can qualify a calibration candidate. A user Yes is not expert review.\n");

const bySeed = {};
for (const row of rows) {
  const key = `${row.seed_method}:${row.seed_version || "unversioned"}`;
  bySeed[key] = (bySeed[key] ?? 0) + 1;
}
console.log(
  "By seed method and version:",
  Object.entries(bySeed).map(([k, v]) => `${k} ${v}`).join(", "),
  "\n",
);

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function iqr(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return q(0.75) - q(0.25);
}

console.log(`
Reading the verdicts: a candidate needs at least ${MIN_N} reviewed moved points
with a median larger than half the spread. Units are
fractions of face height in faceDir=+1 space (positive dx = toward the face).
`);

// Never mix generations of a placement pass. A prompt or provider change can
// move a point in the opposite direction; combining both would average a real
// bias away and emit a correction that describes neither version.
const groupedRows = {};
for (const row of rows) {
  const key = `${row.seed_method}:${row.seed_version || "unversioned"}`;
  (groupedRows[key] ??= []).push(row);
}

for (const [seedKey, seedRows] of Object.entries(groupedRows)) {
  console.log(`\n${seedKey} (${seedRows.length} rows)`);
  const offsets = Object.fromEntries(POINT_IDS.map((id) => [id, []]));
  const calibrationOffsets = Object.fromEntries(POINT_IDS.map((id) => [id, []]));
  let unusable = 0;
  for (const row of seedRows) {
    const normalized = sideFeedbackOffsets(row, POINT_IDS);
    if (!normalized) {
      unusable++;
      continue;
    }
    for (const id of POINT_IDS) {
      if (normalized[id]) offsets[id].push(normalized[id]);
    }
    const reviewed = sideFeedbackCalibrationOffsets(row, POINT_IDS, Date.parse(snapshotTime));
    for (const id of POINT_IDS) {
      if (reviewed?.[id]) calibrationOffsets[id].push(reviewed[id]);
    }
  }
  if (unusable) console.log(`${unusable} rows skipped (rejected, unknown review status, invalid dimensions or malformed points).`);

  const qualified = {};
  console.log(
    "landmark".padEnd(17),
    "n".padStart(5),
    "moved%".padStart(7),
    "med dx".padStart(9),
    "med dy".padStart(9),
    "IQR dx".padStart(9),
    "IQR dy".padStart(9),
    "  verdict",
  );
  for (const id of POINT_IDS) {
    const all = offsets[id];
    if (!all.length) continue;
    const movedShare = all.filter((o) => Math.hypot(o.dx, o.dy) > 0.002).length / all.length;
    const dxs = all.map((o) => o.dx);
    const dys = all.map((o) => o.dy);
    const mdx = median(dxs);
    const mdy = median(dys);
    const ix = iqr(dxs);
    const iy = iqr(dys);
    const reviewed = calibrationOffsets[id];
    const reviewedDx = reviewed.map((o) => o.dx);
    const reviewedDy = reviewed.map((o) => o.dy);
    const biased = reviewed.length >= MIN_N
      && (Math.abs(median(reviewedDx)) > Math.max(0.004, iqr(reviewedDx) / 2)
        || Math.abs(median(reviewedDy)) > Math.max(0.004, iqr(reviewedDy) / 2));
    if (biased) qualified[id] = { dx: +median(reviewedDx).toFixed(4), dy: +median(reviewedDy).toFixed(4) };
    console.log(
      id.padEnd(17),
      String(all.length).padStart(5),
      `${Math.round(movedShare * 100)}%`.padStart(7),
      mdx.toFixed(4).padStart(9),
      mdy.toFixed(4).padStart(9),
      ix.toFixed(4).padStart(9),
      iy.toFixed(4).padStart(9),
      biased ? `  candidate (${reviewed.length} reviewed moved points)` : `  diagnostic only (${reviewed.length} reviewed moved points)`,
    );
  }

  if (Object.keys(qualified).length) {
    console.log(`Calibration candidate for ${seedKey} (mirrored by faceDir; requires a held-out review before use):`);
    console.log(JSON.stringify(qualified, null, 2));
  } else {
    console.log(`No ${seedKey} landmark qualifies a reviewed calibration candidate yet.`);
  }
}
