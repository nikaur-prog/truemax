// Re-derive the six bizygo-dependent distributions after the landmark change.
//
// Changing bizygo from landmarks 116/345 to 234/454 changes the VALUE of every
// metric that divides by it, so the mean, sd and ideal fitted to the old
// definition all describe a quantity that no longer exists. Left alone, every
// user would be scored against a target 10% away from where the measurement now
// lands.
//
// tools/calibrate.mjs is the proper way to regenerate these, but it needs two
// archives: the population pool for mean/sd and the hand-labelled top tier for
// the ideal. Only the population archive is present in this checkout, so this
// does the half it can do exactly and carries the ideal across by its POSITION
// rather than its value:
//
//     newIdeal = newMean + (oldIdeal - oldMean) / oldSd * newSd
//
// The ideal was never a number in its own right — it was "this far above the
// population centre, in population sd". That relationship is what the top tier
// established, and it survives a change of units. Copying the raw figure across
// would not; scaling it by a single factor would be close but wrong, because
// the ratio of old to new bizygo varies about 5% face to face.
//
// mean and sd use the same estimators as calibrate.mjs — median and 1.4826 x
// MAD — so the numbers this emits are drawn from the same population, gated the
// same way, as the ones it replaces.
//
// Re-run tools/calibrate.mjs instead of this the moment the top-tier archive is
// back on disk. This is the honest fallback, not the better method.
//
//   node tools/rescale-bizygo-dists.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = process.env.TM_DATA ?? fileURLToPath(new URL("../.calib/", import.meta.url));
const popScans = JSON.parse(readFileSync(`${DATA}pop-scans.json`, "utf8"));

// Everything the landmark change touches. Two ways in, and it is worth naming
// both because the first pass at this list got them confused:
//
//   divides by bizygo   eyeSeparationRatio, fwhr, jawCheekRatio,
//                       fifthsEyeRatio, facialIndex, cheekFullness
//   uses the landmarks' Y  cheekboneHeight, which is
//                       (zygion.y - eyeMid.y) / (menton.y - eyeMid.y) and has
//                       no bizygo in it at all. 234/454 sit slightly lower on
//                       the face than 116/345 (0.199 against 0.179 in
//                       eye-to-chin units), so its numerator moves too.
//
// cheekFullness is measured but is not in calibrate.mjs's table — its dist is
// hand-set (male mean 0, female 0.4, sd 1.6) rather than fitted, so re-deriving
// it from the population here would be a different change from the one this
// tool exists to make. Listed so it is not forgotten, handled separately.
const AFFECTED = [
  "eyeSeparationRatio", "fwhr", "jawCheekRatio",
  "fifthsEyeRatio", "facialIndex", "cheekboneHeight",
];

// Copied from calibrate.mjs so the sample is gated identically.
const GATE = { yaw: 25, pitch: 22, smile: 1.01 };
const EXPRESSION_SENSITIVE = new Set(["cheekboneHeight"]);
const passes = (q) => Math.abs(q.yaw) <= GATE.yaw && Math.abs(q.pitch) <= GATE.pitch && q.smile <= GATE.smile;
const expressionPasses = (s, id) => !EXPRESSION_SENSITIVE.has(id) || s.quality.smile <= 0.7;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const robustSD = (a) => 1.4826 * median(a.map((v) => Math.abs(v - median(a))));

// The shipped values, i.e. what these were fitted to under the OLD landmarks.
const OLD = {
  eyeSeparationRatio: { male: { mean: 0.4685, sd: 0.01379, ideal: 0.47105 }, female: { mean: 0.4821, sd: 0.00964, ideal: 0.49174 } },
};

const src = readFileSync(new URL("../src/engine/metrics.ts", import.meta.url), "utf8");
for (const id of AFFECTED) {
  if (OLD[id]) continue;
  const block = src.match(new RegExp(`id: "${id}"[\\s\\S]{0,600}?dist: \\{([\\s\\S]*?)\\n    \\},`));
  if (!block) { console.error(`could not read the shipped dist for ${id}`); process.exit(1); }
  const grab = (sex) => {
    const m = block[1].match(new RegExp(`${sex}: \\{ mean: ([-\\d.]+), sd: ([-\\d.]+)(?:, ideal: ([-\\d.]+))? \\}`));
    if (!m) return null;
    return { mean: +m[1], sd: +m[2], ...(m[3] === undefined ? {} : { ideal: +m[3] }) };
  };
  const male = grab("male");
  const female = grab("female");
  if (!male || !female) { console.error(`could not parse the shipped dist for ${id}`); process.exit(1); }
  OLD[id] = { male, female };
}

const DECIMALS = { eyeSeparationRatio: 3, fwhr: 2, cheekboneHeight: 2, jawCheekRatio: 3, fifthsEyeRatio: 3, facialIndex: 2 };
const round = (v, d) => Number(v.toFixed(d + 2));

console.log("Re-derived from the rescanned population. Paste into src/engine/metrics.ts.\n");
for (const id of AFFECTED) {
  const parts = [];
  let note = "";
  for (const sex of ["male", "female"]) {
    const vals = popScans
      .filter((s) => s.entry.sex === sex && passes(s.quality) && expressionPasses(s, id))
      .map((s) => s.entry.metrics[id])
      .filter(Number.isFinite);
    if (vals.length < 6) { console.log(`${id}: only ${vals.length} ${sex} scans — skipped`); parts.length = 0; break; }
    const mean = median(vals);
    const sd = Math.max(1e-6, robustSD(vals));
    const old = OLD[id][sex];
    const d = DECIMALS[id];
    let piece = `${sex}: { mean: ${round(mean, d)}, sd: ${round(sd, d)}`;
    if (old.ideal !== undefined) {
      const z = (old.ideal - old.mean) / old.sd;
      piece += `, ideal: ${round(mean + z * sd, d)}`;
      note = ` // ideal carried across at z=${z.toFixed(3)}`;
    }
    parts.push(`${piece} }`);
    if (sex === "male") {
      console.log(`  ${id} male:   ${old.mean} -> ${round(mean, d)}  (${((mean / old.mean - 1) * 100).toFixed(1)}%), n=${vals.length}`);
    } else {
      console.log(`  ${id} female: ${old.mean} -> ${round(mean, d)}  (${((mean / old.mean - 1) * 100).toFixed(1)}%), n=${vals.length}`);
    }
  }
  if (parts.length === 2) console.log(`    dist: { ${parts.join(", ")} },${note}\n`);
}
