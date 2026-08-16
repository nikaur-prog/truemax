// Analyse the consented side-landmark corrections people have submitted, and
// say whether the auto-placement has a SYSTEMATIC bias worth correcting.
//
// What it reads: the side_landmark_feedback table — automatic vs corrected
// point positions, face direction, seed method. Points only. It never touches
// the private photo bucket; the photographs are for a human re-labelling
// session, not for this script.
//
// What it prints, per landmark:
//   n        how many submissions moved this point at all
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
// when a landmark has earned an offset: n >= 25 and |median| > half the IQR.
// When landmarks qualify, the emitted JSON block is ready to paste into a
// calibration table.
//
// Run it with the service credentials in the environment (from Vercel env,
// never committed):
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
//     node scripts/analyze-side-feedback.mjs

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

const response = await fetch(
  `${url.replace(/\/$/, "")}/rest/v1/side_landmark_feedback` +
    `?select=face_dir,seed_method,automatic_points,corrected_points,moved_point_ids,created_at&order=created_at.asc`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!response.ok) {
  console.error(`Read failed: HTTP ${response.status} — ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}
const rows = await response.json();
console.log(`${rows.length} submissions on record.\n`);
if (!rows.length) process.exit(0);

const bySeed = {};
for (const row of rows) bySeed[row.seed_method] = (bySeed[row.seed_method] ?? 0) + 1;
console.log(
  "By seed method:",
  Object.entries(bySeed).map(([k, v]) => `${k} ${v}`).join(", "),
  "\n",
);

// offsets[pointId] = array of {dx, dy} in canonical unit-face space
const offsets = Object.fromEntries(POINT_IDS.map((id) => [id, []]));
let unusable = 0;

for (const row of rows) {
  const auto = row.automatic_points;
  const fixed = row.corrected_points;
  if (!auto || !fixed) {
    unusable++;
    continue;
  }
  // Unit of distance: the corrected face height. Point coordinates are stored
  // normalised by IMAGE dimensions, which vary with framing; the face height
  // does not.
  const faceH = Math.abs((fixed.menton?.y ?? 0) - (fixed.trichion?.y ?? 0));
  if (!Number.isFinite(faceH) || faceH < 0.05) {
    unusable++;
    continue;
  }
  for (const id of POINT_IDS) {
    const a = auto[id];
    const c = fixed[id];
    if (!a || !c) continue;
    const rawDx = (c.x - a.x) / faceH;
    const dy = (c.y - a.y) / faceH;
    // Mirror into faceDir=+1 space so "forward" means the same thing in
    // every submission regardless of which way the person was facing.
    const dx = row.face_dir === -1 ? -rawDx : rawDx;
    // Zero-movement points still count as evidence the seeder was RIGHT —
    // they go in as zeros and pull the median toward no correction.
    offsets[id].push({ dx, dy });
  }
}
if (unusable) console.log(`${unusable} rows skipped (malformed points or degenerate face box).\n`);

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
  const biased =
    all.length >= MIN_N &&
    (Math.abs(mdx) > Math.max(0.004, ix / 2) || Math.abs(mdy) > Math.max(0.004, iy / 2));
  if (biased) qualified[id] = { dx: +mdx.toFixed(4), dy: +mdy.toFixed(4) };
  console.log(
    id.padEnd(17),
    String(all.length).padStart(5),
    `${Math.round(movedShare * 100)}%`.padStart(7),
    mdx.toFixed(4).padStart(9),
    mdy.toFixed(4).padStart(9),
    ix.toFixed(4).padStart(9),
    iy.toFixed(4).padStart(9),
    biased ? "  BIASED — offset earned" : "  noise / fine",
  );
}

console.log(`
Reading the verdicts: an offset is only earned at n >= ${MIN_N} with a median
larger than half the spread — a consistent lean, not scatter. Units are
fractions of face height in faceDir=+1 space (positive dx = toward the face).
`);

if (Object.keys(qualified).length) {
  console.log("Calibration block (paste into the seeder's offset table, mirrored by faceDir):");
  console.log(JSON.stringify(qualified, null, 2));
} else {
  console.log("No landmark has earned a calibration offset yet. Keep collecting.");
}
