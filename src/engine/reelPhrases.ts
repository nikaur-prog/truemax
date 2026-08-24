import type { ScoredMetric } from "./types.js";

// ---------------------------------------------------------------------------
// What a measurement SOUNDS like, said out loud, by a person.
//
// Every previous version of the rundown script built its sentences out of the
// metric's own name — the string that sits at the head of a column in the
// results table. That can never produce a line worth listening to, because the
// two jobs are opposites. "Midface : lower face balance" is exactly right above
// a number a reader can scan back to; read aloud over somebody's face it is
// four nouns and no picture.
//
// So this is a hand-written clause per measurement, and there is no fallback
// worth having: a metric with no entry here does not get a sentence.
//
// THE SHAPE IS VERDICT-FIRST, FIGURE-LAST, AND NOTHING AFTER THE FIGURE.
//
// The previous shape was measurement → number → explanation → signal:
//
//   "a canthal tilt of 6.9 degrees, so the outer corner of the eye sits well
//    above the inner and that's the hunter-eye look"
//
// Twenty words, and the only two anybody repeats — "hunter eyes" — arrive
// last, after a clause of anatomy tutoring nobody asked for. Watched against
// the rundowns that actually travel, the difference is exactly this ordering:
// they say the verdict, close on the number, and cut.
//
//   "hunter eyes, canthal tilt 6.9 degrees"
//
// Three rules, in the order the words now come out:
//
//   1. The SIGNAL leads. Hunter, masculine, youthful, recessed — the word a
//      viewer would use is the first word they hear, while the feature is on
//      screen in front of them.
//   2. The FIGURE closes the clause, and closes it dead. No "which is", no
//      "so the". The number is the receipt, and a receipt is the end of a
//      transaction, not the middle of one. This is still the whole difference
//      between this format and a horoscope: the trait arrives with its
//      measurement attached.
//   3. Nothing explains itself. The line under the face names the metric, the
//      overlay draws where it was measured, and the voice saying it a third
//      way was the reason every beat ran twice as long as its evidence.
//
// The `bad` clause takes `high`, which SIDE of the ideal the face actually
// sits on — because for a band metric the two failures are opposite-looking
// things and calling both of them "off" is the tell that nothing was measured.
// Eyes too far apart and eyes too close together are not the same note.
// ---------------------------------------------------------------------------

export interface Phrase {
  /** Reads as a strength. */
  good: (v: string) => string;
  /** Reads as a weakness. `high` is true when the face sits ABOVE the ideal. */
  bad: (v: string, high: boolean) => string;
}

// The measured number, formatted the way the metric asks and no further. The
// clause supplies the unit word, because "6.4°" has to become "6.4 degrees" for
// a microphone and "0.85×" has to become "0.85 times" or vanish into the
// sentence entirely.
export function figureOf(m: ScoredMetric): string {
  return m.value.toFixed(m.def.decimals);
}

export const PHRASES: Record<string, Phrase> = {
  // --- eyes ---------------------------------------------------------------
  canthalTilt: {
    good: (v) => `hunter eyes, with a canthal tilt of ${v} degrees`,
    bad: (v, high) =>
      high
        ? `over-tilted, startled-set eyes at ${v} degrees`
        : `flat, downturned eyes, canthal tilt only ${v} degrees`,
  },
  browTilt: {
    good: (v) => `masculine straight-set brows at ${v} degrees`,
    bad: (v, high) =>
      high
        ? `soft, arched brows at ${v} degrees`
        : `heavy drooping brows at ${v} degrees`,
  },
  browPosition: {
    good: (v) => `dimorphic low-set brows, ${v} of an eye-span over the eye`,
    bad: (v, high) =>
      high
        ? `high, floating brows, ${v} of an eye-span clear of the eye`
        : `brows crowding the eye, at ${v} of an eye-span`,
  },
  intercanthalEyeWidth: {
    good: (v) => `classically spaced eyes, one eye apart at ${v}`,
    bad: (v, high) =>
      high
        ? `wide-set eyes, ${v} eye-widths apart`
        : `close-set eyes, ${v} eye-widths apart`,
  },
  fifthsEyeRatio: {
    good: (v) => `textbook fifths, each eye ${v} of the face's width`,
    bad: (v, high) =>
      high
        ? `oversized eyes, ${v} of the face's width`
        : `small eyes, ${v} of the face's width`,
  },

  // --- midface ------------------------------------------------------------
  midfaceRatio: {
    good: (v) => `a youthful compact midface at ${v}`,
    bad: (v, high) =>
      high
        ? `a long, ageing midface at ${v}`
        : `a cramped midface at ${v}`,
  },
  cheekboneHeight: {
    good: (v) => `high-set cheekbones at ${v}`,
    bad: (v, high) =>
      high
        ? `cheekbones riding hollow-high at ${v}`
        : `low, flat cheekbones at ${v}`,
  },
  cheekFullness: {
    good: (v) => `lean, cut cheeks at ${v} per cent`,
    bad: (v, high) =>
      high
        ? `soft, padded cheeks at ${v} per cent`
        : `gaunt, hollowed cheeks at ${v} per cent`,
  },

  // --- jaw ----------------------------------------------------------------
  jawCheekRatio: {
    good: (v) => `a wide frontal jaw, ${v} of the cheekbone width`,
    bad: (v, high) =>
      high
        ? `a squared-off jaw, ${v} of the cheekbone width`
        : `a tapering jaw, ${v} of the cheekbone width`,
  },

  // --- chin ---------------------------------------------------------------
  philtrumChinRatio: {
    good: (v) => `a masculine chin-to-philtrum ratio, ${v} times the length`,
    bad: (v, high) =>
      high
        ? `an overlong chin, ${v} times the philtrum`
        : `a weak chin, only ${v} times the philtrum`,
  },
  chinWidthRatio: {
    good: (v) => `a broad dimorphic chin, ${v} of the jaw's width`,
    bad: (v, high) =>
      high
        ? `a blunt, flattened chin, ${v} of the jaw's width`
        : `a narrow, pointed chin, ${v} of the jaw's width`,
  },
  lowerFacePct: {
    good: (v) => `a masculine lower third, ${v} per cent of the face`,
    bad: (v, high) =>
      high
        ? `an overlong lower third, ${v} per cent of the face`
        : `a boyish short lower third, ${v} per cent of the face`,
  },

  // --- lips ---------------------------------------------------------------
  lipRatio: {
    good: (v) => `balanced full lips, the lower ${v} times the upper`,
    bad: (v, high) =>
      high
        ? `a bottom-heavy mouth, the lower lip ${v} times the upper`
        : `a thin mouth, the lower lip only ${v} times the upper`,
  },
  mouthCornerTilt: {
    good: (v) => `upturned mouth corners at ${v} degrees`,
    bad: (v, high) =>
      high
        ? `expression-forced mouth corners at ${v} degrees`
        : `a resting scowl, mouth corners at ${v} degrees`,
  },

  // --- proportions --------------------------------------------------------
  facialIndex: {
    good: (v) => `a photogenic long face shape at ${v}`,
    bad: (v, high) =>
      high
        ? `an overlong, narrow face at ${v}`
        : `a wide, short face shape at ${v}`,
  },
  middleLowerBalance: {
    good: (v) => `an even midface-to-lower-face balance, ${v} to one`,
    bad: (v, high) =>
      high
        ? `a top-heavy midface, ${v} times the lower face`
        : `a bottom-heavy face, ${v} to one`,
  },
  topThirdEst: {
    good: (v) => `a proportionate upper third at ${v} per cent`,
    bad: (v, high) =>
      high
        ? `a tall forehead, ${v} per cent of the face`
        : `a short forehead, ${v} per cent of the face`,
  },
  foreheadRatio: {
    good: (v) => `a balanced forehead at ${v} eye-spans`,
    bad: (v, high) =>
      high
        ? `a dominant forehead at ${v} eye-spans`
        : `a low forehead at ${v} eye-spans`,
  },

  // --- symmetry -----------------------------------------------------------
  midlineDeviation: {
    good: (v) => `a near-perfect midline, off by ${v} per cent of an eye-span`,
    bad: (v) => `a visibly shifted midline, off by ${v} per cent of an eye-span`,
  },

  // --- side ---------------------------------------------------------------
  gonialAngle: {
    good: (v) => `a sharp jawline, gonial angle ${v} degrees`,
    bad: (v, high) =>
      high
        ? `a rounded, soft jaw corner at ${v} degrees`
        : `an over-cut jaw corner at ${v} degrees`,
  },
  ramusMandible: {
    good: (v) => `a deep vertical jaw, ramus ${v} of the mandible`,
    bad: (v, high) =>
      high
        ? `a tall, short-bodied jaw at ${v}`
        : `a shallow jaw, ramus only ${v} of the mandible`,
  },
  submentalCervical: {
    good: (v) => `a clean chin-to-neck line at ${v} degrees`,
    bad: (v, high) =>
      high
        ? `a soft under-chin at ${v} degrees`
        : `a compressed neckline at ${v} degrees`,
  },
  mandibularPlane: {
    good: (v) => `a flat, strong jaw plane at ${v} degrees`,
    bad: (v, high) =>
      high
        ? `a steep, recessed-reading jaw plane at ${v} degrees`
        : `an over-flat jaw plane at ${v} degrees`,
  },
  chinProjection: {
    good: (v) => `a forward-set chin, ${v} per cent projection`,
    bad: (v, high) =>
      high
        ? `an over-projected chin at ${v} per cent`
        : `a recessed chin, ${v} per cent projection`,
  },
  chinRecession: {
    good: (v) => `a chin that holds its own line, H angle ${v} degrees`,
    bad: (v, high) =>
      high
        ? `a chin that falls behind the lips, H angle ${v} degrees`
        : `a chin running ahead of the lips, H angle ${v} degrees`,
  },
  facialConvexity: {
    good: (v) => `a straight profile, convexity ${v} degrees`,
    bad: (v, high) =>
      high
        ? `a bowed, convex profile at ${v} degrees`
        : `a concave profile at ${v} degrees`,
  },
  totalFacialConvexity: {
    good: (v) => `a straight nose-in profile at ${v} degrees`,
    bad: (v, high) =>
      high
        ? `a nose-heavy convex profile at ${v} degrees`
        : `a flattened full profile at ${v} degrees`,
  },
  nasofrontalAngle: {
    good: (v) => `a defined brow-to-bridge step at ${v} degrees`,
    bad: (v, high) =>
      high
        ? `a flat brow-to-bridge line at ${v} degrees`
        : `a deep-notched nasofrontal angle at ${v} degrees`,
  },
  nasolabialAngle: {
    good: (v) => `a well-set nose base, nasolabial angle ${v} degrees`,
    bad: (v, high) =>
      high
        ? `an upturned nose base at ${v} degrees`
        : `a drooping nose base at ${v} degrees`,
  },
  nasalProjection: {
    good: (v) => `a proportionate nose, ${v} per cent projection`,
    bad: (v, high) =>
      high
        ? `a leading nose, ${v} per cent projection`
        : `a flat nose, ${v} per cent projection`,
  },
  upperLipELine: {
    good: (v) => `a textbook upper lip, ${v} per cent behind the E-line`,
    bad: (v, high) =>
      high
        ? `a protruding upper lip, ${v} per cent past the E-line`
        : `a recessed upper lip, ${v} per cent behind the E-line`,
  },
  lowerLipELine: {
    good: (v) => `a tracking lower lip, ${v} per cent off the E-line`,
    bad: (v, high) =>
      high
        ? `a protruding lower lip, ${v} per cent past the E-line`
        : `a recessed lower lip, ${v} per cent behind the E-line`,
  },
  lowerThirdDepth: {
    good: (v) => `a deep, forward lower third at ${v}`,
    bad: (v, high) =>
      high
        ? `a jutting lower third at ${v}`
        : `a shallow lower third at ${v}`,
  },
  foreheadSlope: {
    good: (v) => `an upright forehead at ${v} degrees`,
    bad: (v, high) =>
      high
        ? `a swept-back forehead at ${v} degrees`
        : `a domed, vertical forehead at ${v} degrees`,
  },
  midfaceRatioSide: {
    good: (v) => `a compact side midface at ${v}`,
    bad: (v, high) =>
      high
        ? `a long side midface at ${v}`
        : `a shallow side midface at ${v}`,
  },
};

/** Whether this measurement has a sentence a person would actually say. */
export function hasPhrase(id: string): boolean {
  return id in PHRASES;
}
