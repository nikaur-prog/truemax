// Derive per-sex reference distributions from the measured celebrity pool,
// then emit updated dist blocks for metrics.ts and the celebs.ts DB.
//
//   mean  = median of all quality-gated scans of that sex   (population center proxy)
//   sd    = 1.25 x robust SD (1.4826 x MAD)                 (general pop is more varied
//                                                            than a celebrity sample)
//   ideal = median of the hand-labeled top tier             (band metrics only)
//
// Because ideal comes from consensus-attractive faces and sd from the wider
// pool, top-tier faces sit tight around the ideal and score high, while the
// pool median scores ~5.0. No inflation is introduced: scoring still converts
// closeness-to-ideal into a population percentile.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = process.env.TM_DATA ?? fileURLToPath(new URL("../.calib/", import.meta.url));
const scans = JSON.parse(readFileSync(`${DATA}scans.json`, "utf8"));
// People notable for their work, not their looks — the population reference.
const popScans = JSON.parse(readFileSync(`${DATA}pop-scans.json`, "utf8"));

// Strict gate defines the calibration sample (measurement fidelity matters
// most when deriving distributions). The looser gate defines DB inclusion,
// with each entry tagged so matching can prefer high-fidelity references.
// Pose normalization removes yaw/pitch from the measurements, so the
// calibration gate only needs to exclude photos where landmark accuracy
// itself degrades (self-occlusion) or expression distorts the mouth/jaw.
const GATE = { yaw: 25, pitch: 22, smile: 1.01 };
const GATE_LOOSE = { yaw: 26, pitch: 23, smile: 0.99 };

// Press photography contains far more smiling women than smiling men. Using a
// global neutral-expression gate left only 18 female reference faces versus 40
// male and biased even eye/face-width norms toward the tiny non-smiling subset.
// Apply the smile gate only where expression actually changes the construction.
const EXPRESSION_SENSITIVE = new Set([
  "eyeAspectRatio", "cheekboneHeight", "gonialProxy", "jawFrontalAngle",
  "chinHeightRatio", "philtrumChinRatio", "lowerFacePct", "lipRatio",
  "mouthIPD", "lipHeightLowerThird", "mouthCornerTilt", "middleLowerBalance",
  "mirrorDeviation", "eyeMouthParallel", "midlineDeviation",
]);
const expressionPasses = (scan, id) =>
  !EXPRESSION_SENSITIVE.has(id) || scan.quality.smile <= 0.7;

const passes = (q, g) =>
  Math.abs(q.yaw) <= g.yaw && Math.abs(q.pitch) <= g.pitch && q.smile <= g.smile;

const TOP_TIER = new Set([
  // male — consensus "high tier" for defining aesthetic ideals
  "Jordan Barrett", "David Gandy", "Francisco Lachowski", "Sean O'Pry",
  "Henry Cavill", "Brad Pitt", "Chris Hemsworth", "Zac Efron",
  "Christian Bale", "Chris Evans", "Ryan Gosling", "Michael B. Jordan",
  // female
  "Sydney Sweeney", "Megan Fox", "Margot Robbie", "Angelina Jolie",
  "Adriana Lima", "Bella Hadid", "Ana de Armas", "Gal Gadot",
  "Emily Ratajkowski", "Monica Bellucci", "Scarlett Johansson", "Kendall Jenner",
]);

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const robustSD = (a) => {
  const m = median(a);
  return 1.4826 * median(a.map((v) => Math.abs(v - m)));
};

// Direction/decimals mirror metrics.ts; "lower" metrics take no ideal.
const LOWER = new Set(["mirrorDeviation", "canthalAsymmetry", "eyeMouthParallel", "midlineDeviation"]);
const DECIMALS = {
  canthalTilt: 1, eyeAspectRatio: 2, eyeSeparationRatio: 3, intercanthalEyeWidth: 2,
  browPosition: 3, browTilt: 1, fwhr: 2, midfaceRatio: 2, cheekboneHeight: 2,
  jawCheekRatio: 3, gonialProxy: 1, jawFrontalAngle: 1, chinHeightRatio: 2,
  philtrumChinRatio: 2, chinWidthRatio: 2, lowerFacePct: 1, noseMouthRatio: 2,
  noseIntercanthal: 2, nasalIndex: 2, lipRatio: 2, mouthIPD: 2,
  lipHeightLowerThird: 1, mouthCornerTilt: 1, topThirdEst: 1,
  middleLowerBalance: 2, fifthsEyeRatio: 3, facialIndex: 2,
  mirrorDeviation: 1, canthalAsymmetry: 1, eyeMouthParallel: 1, midlineDeviation: 1,
};
const round = (v, d) => Number(v.toFixed(d + 2));

const out = {};
const counts = {};
for (const sex of ["male", "female"]) {
  // mean/SD come from the population proxy; ideals from the celebrity top tier
  const pool = popScans.filter((s) => s.entry.sex === sex && passes(s.quality, GATE));
  const top = scans.filter(
    (s) => s.entry.sex === sex && TOP_TIER.has(s.entry.name) && passes(s.quality, GATE_LOOSE),
  );
  counts[sex] = { pool: pool.length, top: top.length, topNames: top.map((t) => t.entry.name) };

  for (const id of Object.keys(DECIMALS)) {
    const vals = pool
      .filter((s) => expressionPasses(s, id))
      .map((s) => s.entry.metrics[id])
      .filter(Number.isFinite);
    if (vals.length < 6) continue;
    const mean = median(vals);
    // Robust SD from a real population sample — no artificial inflation.
    const sd = Math.max(1e-6, robustSD(vals));

    let ideal;
    if (!LOWER.has(id)) {
      const topVals = top
        .filter((s) => expressionPasses(s, id))
        .map((s) => s.entry.metrics[id])
        .filter(Number.isFinite);
      ideal = topVals.length >= 4 ? median(topVals) : mean;
      // Small samples can throw an ideal far out; keep it within 1σ of center.
      ideal = Math.max(mean - sd, Math.min(mean + sd, ideal));
    }
    const d = DECIMALS[id];
    out[id] = out[id] ?? {};
    out[id][sex] = {
      mean: round(mean, d),
      sd: round(sd, d),
      ...(ideal !== undefined ? { ideal: round(ideal, d) } : {}),
    };
  }
}

console.log("gated pool sizes:", JSON.stringify(counts, null, 1));

const lines = [];
for (const [id, byS] of Object.entries(out)) {
  if (!byS.male || !byS.female) continue;
  const fmt = (o) =>
    `{ mean: ${o.mean}, sd: ${o.sd}${o.ideal !== undefined ? `, ideal: ${o.ideal}` : ""} }`;
  lines.push(`  ${id}: { male: ${fmt(byS.male)}, female: ${fmt(byS.female)} },`);
}
writeFileSync(
  `${DATA}derived-dists.txt`,
  `export const DERIVED_DISTS: Record<string, MetricDef["dist"]> = {\n${lines.join("\n")}\n};\n`,
);
console.log(`\nwrote derived-dists.txt (${lines.length} metrics)`);

// Celebrity DB: quality-gated entries only, so stored measurements are sound.
const dbEntries = scans
  .filter((s) => passes(s.quality, GATE_LOOSE))
  .map((s) => ({ ...s.entry, capture: passes(s.quality, GATE) ? "high" : "moderate" }));
writeFileSync(
  `${DATA}celeb-db.json`,
  JSON.stringify(dbEntries, null, 2),
);
console.log(
  `celeb DB: ${dbEntries.length} entries ` +
    `(${dbEntries.filter((e) => e.sex === "male").length}M / ${dbEntries.filter((e) => e.sex === "female").length}F)`,
);
console.log("excluded:", scans.filter((s) => !passes(s.quality, GATE_LOOSE)).map((s) => s.entry.name).join(", "));
