// Fit the display scale (SHRINK) to the rated corpus — the one command to
// re-run whenever the corpus grows or the reference table is regenerated.
//
//   npx tsx tools/fit-scale.ts
//
// Three candidate calibrations are printed. They answer different questions:
//
//   regression        "given a noisy measurement, what is my safest guess of
//                     the human rating?" Attenuated toward zero by exactly
//                     the measurement noise it should correct for — with
//                     r≈0.74 against humans it collapses the whole displayed
//                     scale into 4-and-a-bit to 6-and-a-bit. This is the fit
//                     that produced SHRINK=0.4, and it is the wrong question.
//
//   attenuation-corr. regression divided by the observed correlation — a
//                     crude de-noising, shown for context.
//
//   variance match    "make the displayed spread equal the human-rating
//                     spread." The right calibration for a RANKING product:
//                     ordering comes from the measurement, scale comes from
//                     the population. Individual errors are larger than under
//                     regression — that is the honest cost of showing a scale
//                     that can actually reach its own ends.
//
// The recommendation printed at the bottom is the variance match.
import { readFileSync } from "node:fs";
import { scoreFrontMeasurements, SHRINK, SCORE_SCALE } from "../src/engine/scoring.js";

const corpus = JSON.parse(
  readFileSync(new URL("../src/engine/calibration/corpus.json", import.meta.url), "utf8"),
) as { faces: { id: string; sex: "male" | "female"; rating: number; measurements: Record<string, number> }[] };

const rows = corpus.faces.map((f) => {
  const r = scoreFrontMeasurements(f.measurements, f.sex, null);
  return { id: f.id, sex: f.sex, human: f.rating, uz: r.overallZ / SHRINK, score: r.overall };
});

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const humans = rows.map((r) => r.human);
const uzs = rows.map((r) => r.uz);

let num = 0, den = 0, cn = 0, cdH = 0, cdZ = 0;
const mH = mean(humans), mZ = mean(uzs);
for (const r of rows) {
  num += r.uz * (r.human - 5); // slope through the fixed point (0, 5)
  den += r.uz * r.uz;
  cn += (r.human - mH) * (r.uz - mZ);
  cdH += (r.human - mH) ** 2;
  cdZ += (r.uz - mZ) ** 2;
}
const pearson = cn / Math.sqrt(cdH * cdZ);
const regression = num / den;
const varianceMatch = sd(humans) / sd(uzs);

rows.sort((a, b) => a.human - b.human);
console.log("id    sex     human  unshrunkZ  displayed");
for (const r of rows) {
  console.log(
    `${r.id.padEnd(5)} ${r.sex.padEnd(7)} ${String(r.human).padEnd(6)} ` +
      `${r.uz.toFixed(3).padStart(8)}  ${r.score}`,
  );
}
console.log(`\nn=${rows.length}  human mean ${mH.toFixed(2)} sd ${sd(humans).toFixed(2)}` +
  `  unshrunk-z mean ${mZ.toFixed(2)} sd ${sd(uzs).toFixed(2)}  Pearson r ${pearson.toFixed(3)}`);
console.log(`shipped: SCORE_SCALE ${SCORE_SCALE} × SHRINK ${SHRINK} = ${(SCORE_SCALE * SHRINK).toFixed(2)} score/z\n`);

const asShrink = (slope: number) => (slope / SCORE_SCALE).toFixed(3);
console.log(`regression (through 5@z=0):  ${regression.toFixed(3)} score/z → SHRINK ${asShrink(regression)}`);
console.log(`attenuation-corrected:       ${(regression / pearson).toFixed(3)} score/z → SHRINK ${asShrink(regression / pearson)}`);
console.log(`variance match:              ${varianceMatch.toFixed(3)} score/z → SHRINK ${asShrink(varianceMatch)}`);
console.log(`\nrecommended SHRINK (variance match): ${asShrink(varianceMatch)}`);
console.log("caveat: the corpus stores measurements only, so these overalls blend without");
console.log("shapeZ (W_SHAPE of the app's blend). Good for scale fitting, not for quoting.");
