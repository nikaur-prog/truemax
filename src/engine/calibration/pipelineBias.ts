import type { Sex } from "../types.js";

// ---------------------------------------------------------------------------
// What the landmark pipeline reads, versus what the textbook measured.
//
// Every distribution in metrics.ts was seeded from published facial
// anthropometry: calipers on real skulls and faces, in millimetres. This engine
// does not use calipers. It takes a 2D photograph, fits a 478-point mesh to it,
// and computes ratios between mesh vertices. Those two things are NOT the same
// measurement, and nobody ever checked how far apart they were.
//
// Nineteen scans say: far apart, and consistently so.
//
//   nose : mouth width   women read +3.7σ above the seeded mean, on every face
//   canthal tilt         men read −2.8σ; the model expects +4.7°, the mesh says −1.2°
//   eye separation       both sexes +2.7σ
//   upper face           both sexes about −2σ
//
// A ±3σ constant offset is not a population of unusual faces. It is a ruler
// starting at the wrong number. And because most metrics are scored as a BAND —
// distance from an ideal, in either direction — a constant offset does not
// cancel out or average away. It parks everybody far from the ideal at once, on
// the same metrics, every scan. That is the mechanism behind the complaint this
// whole calibration started from: nineteen faces spanning "well below average"
// to "professional model" came back inside a 1.5-point band, because the score
// was dominated by an error they all shared rather than by anything that
// distinguished them.
//
// So this file corrects the ruler, and only the ruler:
//
//   shift   added to mean AND ideal, leaving the gap between them untouched.
//           The literature's claim about which value is most attractive is
//           preserved; only where that value sits in mesh units changes.
//   spread  multiplies sd. A metric whose real spread is wider than modelled
//           inflates every z built on it, which is what pegs 13% of all
//           per-metric scores at the influence clamp.
//
// Deliberately NOT in this file: anything derived from how attractive a human
// judged the face. Directions and ideals are aesthetic claims and they belong
// in metrics.ts next to the reasoning for them. These numbers are measurement
// calibration, and they would be identical if the corpus had been rated by
// nobody.
//
// ---------------------------------------------------------------------------
// How these were computed, so they can be regenerated rather than re-guessed:
//
//   shift  = 0.75 × (corpus mean − seeded mean), applied only where the gap
//            exceeds 0.75σ. The 0.75 is shrinkage — with n≈10 per sex the
//            corpus mean carries a standard error near 0.3σ, and the corpus is
//            not a random draw from the population, so taking the full offset
//            would be treating "the average face we happened to collect" as
//            "the average face".
//   spread = (corpus sd / seeded sd)^0.7, clamped to [1.0, 2.0].
//
// The clamp only ever widens. Narrowing an sd makes a metric MORE punishing,
// and a small non-random corpus is exactly the wrong evidence for doing that:
// a sample of ten is tighter than the population it came from more often than
// not. Metrics that look inert here are left inert rather than sharpened by
// fiat. Widening is capped at 2× so one outlier face cannot switch a metric
// off entirely.
//
// Regenerate when the corpus grows — the whole point of keeping this as a
// separate table is that it is derived, and the seeded values it corrects stay
// visible and unedited in metrics.ts.
// ---------------------------------------------------------------------------

export interface BiasCell {
  /** Added to both mean and ideal, in the metric's own units. */
  shift?: number;
  /** Multiplies sd. Never below 1 — see above. */
  spread?: number;
}

export const PIPELINE_BIAS: Record<string, Partial<Record<Sex, BiasCell>>> = {
  canthalTilt: { male: { shift: -3.5942, spread: 1.6245 }, female: { spread: 1.6245 } },
  eyeAspectRatio: { male: { shift: -0.03458, spread: 1.1792 }, female: { spread: 1.3876 } },
  eyeSeparationRatio: { male: { shift: 0.03021, spread: 1.126 }, female: { shift: 0.02663, spread: 1.5276 } },
  intercanthalEyeWidth: { female: { spread: 1.3599 } },
  browPosition: { male: { shift: 0.04568 }, female: { shift: 0.05857, spread: 1.2739 } },
  browTilt: { male: { spread: 1.19 } },
  cheekboneHeight: { male: { shift: -0.01017, spread: 1.3338 } },
  jawCheekRatio: { male: { shift: -0.03416, spread: 1.1647 }, female: { shift: -0.05464, spread: 1.6245 } },
  gonialProxy: { male: { shift: 1.6304 }, female: { shift: 3.3487, spread: 1.2389 } },
  jawFrontalAngle: { male: { shift: -12.441, spread: 1.2121 } },
  chinHeightRatio: { male: { spread: 1.2888 }, female: { spread: 1.6245 } },
  philtrumChinRatio: { male: { shift: 0.33175, spread: 1.3923 }, female: { shift: 0.5565, spread: 1.4591 } },
  chinWidthRatio: { male: { shift: 0.03117, spread: 1.3879 } },
  lowerFacePct: { female: { shift: -2.2913 } },
  noseMouthRatio: { male: { shift: 0.05217 }, female: { shift: 0.13387, spread: 1.4124 } },
  nasalIndex: { female: { shift: -0.04912, spread: 1.062 } },
  lipRatio: { female: { shift: -0.19275 } },
  mouthIPD: { male: { spread: 1.0578 }, female: { shift: -0.06675, spread: 1.4342 } },
  lipHeightLowerThird: { male: { shift: 5.7458, spread: 1.2583 }, female: { spread: 1.2704 } },
  mouthCornerTilt: { male: { spread: 1.6132 }, female: { shift: -3.4237, spread: 1.0253 } },
  topThirdEst: { male: { shift: -2.4658, spread: 1.2277 }, female: { shift: -1.1588, spread: 1.3136 } },
  middleLowerBalance: { female: { shift: 0.09225 } },
  fifthsEyeRatio: { male: { shift: 0.01537, spread: 1.0187 }, female: { shift: 0.01271, spread: 1.367 } },
  facialIndex: { male: { shift: 0.06325 }, female: { shift: 0.048, spread: 1.1536 } },
  mirrorDeviation: { female: { shift: -2.835 } },
  midlineDeviation: { male: { spread: 1.3494 } },
};
