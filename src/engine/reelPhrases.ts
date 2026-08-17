import type { ScoredMetric } from "./types.js";

// ---------------------------------------------------------------------------
// What a measurement SOUNDS like, said out loud, by a person.
//
// Every previous version of the rundown script built its sentences out of the
// metric's own name — the string that sits at the head of a column in the
// results table. That can never produce a line worth listening to, because the
// two jobs are opposites. "Midface : lower face balance" is exactly right above
// a number a reader can scan back to; read aloud over somebody's face it is
// four nouns and no picture. A viewer cannot see a balance. They can see a
// midface that is short.
//
// So this is a hand-written clause per measurement, and there is no fallback
// worth having: a metric with no entry here does not get a sentence. Generating
// one is what produced "There is also upper face proportion below the ideal
// band and midface to lower face balance below the ideal band", which is a
// sentence no human has ever said.
//
// Three rules the clauses follow, all three learned from watching the rundowns
// that actually travel:
//
//   1. The figure is IN the clause. A trait named without its number is an
//      opinion; the same trait with "6.4 degrees" in front of it is a reading.
//      That is the entire difference between this format and a horoscope.
//   2. Say where to look. "Hunter eyes — the outer corner sits above the inner"
//      tells a viewer what to check on the face on screen. "Excellent canthal
//      tilt" tells them to trust us.
//   3. Say what it signals, not just what it is. Masculinity, youth, softness,
//      dominance. The measurement is the evidence; the signal is the reason
//      anybody is still watching.
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
    good: (v) =>
      `a canthal tilt of ${v} degrees, so the outer corner of the eye sits well above the inner and that's the hunter-eye look`,
    bad: (v, high) =>
      high
        ? `a canthal tilt of ${v} degrees, steep enough that the eye reads startled rather than hooded`
        : `a canthal tilt of only ${v} degrees, so the eye sits level to downturned rather than hunter`,
  },
  browTilt: {
    good: (v) => `brows running at ${v} degrees, straight and low rather than arched, which is the masculine set`,
    bad: (v, high) =>
      high
        ? `brows arched at ${v} degrees, which softens the whole upper face`
        : `brows dropping ${v} degrees toward the outside, which reads heavy rather than sharp`,
  },
  browPosition: {
    good: (v) => `brows set low over the eye, ${v} of an eye-span above it, which is the dimorphic position`,
    bad: (v, high) =>
      high
        ? `brows sitting high, ${v} of an eye-span clear of the eye, which opens the upper face and reads softer`
        : `brows crowding the eye at ${v} of an eye-span, which closes the upper face`,
  },
  intercanthalEyeWidth: {
    good: (v) => `eye spacing of ${v}, the gap between the eyes is one eye wide, which is the classical ideal`,
    bad: (v, high) =>
      high
        ? `eyes set wide, ${v} eye-widths apart, which flattens the middle of the face`
        : `eyes set close, ${v} eye-widths apart, which narrows the whole upper third`,
  },
  fifthsEyeRatio: {
    good: (v) => `each eye taking up ${v} of the face's width, a clean fifth, which is what the rule of fifths asks for`,
    bad: (v, high) =>
      high
        ? `eyes taking ${v} of the face's width, wider than the fifths allow`
        : `eyes taking only ${v} of the face's width, small against the frame`,
  },

  // --- midface ------------------------------------------------------------
  midfaceRatio: {
    good: (v) => `a compact midface at ${v}, short from eye to lip, which is what keeps a face looking young`,
    bad: (v, high) =>
      high
        ? `a long midface at ${v}, and midface length is the single measurement that ages a face fastest`
        : `a midface at ${v}, short enough that the features crowd together`,
  },
  cheekboneHeight: {
    good: (v) => `cheekbones set high at ${v}, sitting up under the eye where they catch light`,
    bad: (v, high) =>
      high
        ? `cheekbones riding very high at ${v}, which hollows the midface`
        : `cheekbones set low at ${v}, so the midface has no shelf to it`,
  },
  cheekFullness: {
    good: (v) => `cheek fullness at ${v} per cent, lean, with the bone doing the work rather than the fat pad`,
    bad: (v, high) =>
      high
        ? `cheek fullness at ${v} per cent, soft enough to blur the bone underneath`
        : `cheeks hollow at ${v} per cent, which reads gaunt rather than lean`,
  },

  // --- jaw ----------------------------------------------------------------
  jawCheekRatio: {
    good: (v) => `a jaw measuring ${v} of the cheekbone width, wide, and that ratio is the frontal jaw`,
    bad: (v, high) =>
      high
        ? `a jaw at ${v} of the cheekbone width, as wide as the cheekbones, which squares the face off`
        : `a jaw at ${v} of the cheekbone width, so the face tapers away below the cheek`,
  },

  // --- chin ---------------------------------------------------------------
  philtrumChinRatio: {
    good: (v) => `a chin ${v} times the length of the philtrum, long chin, short upper lip, which is the masculine proportion`,
    bad: (v, high) =>
      high
        ? `a chin ${v} times the philtrum, long enough to stretch the bottom of the face`
        : `a chin only ${v} times the philtrum, so the lower face has no anchor`,
  },
  chinWidthRatio: {
    good: (v) => `a chin ${v} of the jaw's width, broad rather than pointed, which is the dimorphic shape`,
    bad: (v, high) =>
      high
        ? `a chin ${v} of the jaw's width, blunt enough to flatten the bottom of the face`
        : `a chin ${v} of the jaw's width, narrow and tapered where it wants to be square`,
  },
  lowerFacePct: {
    good: (v) => `the lower face taking ${v} per cent of the height, the third that carries most of the masculinity`,
    bad: (v, high) =>
      high
        ? `the lower face taking ${v} per cent of the height, long against the other two thirds`
        : `the lower face at only ${v} per cent, short, which is what makes a face read boyish`,
  },

  // --- lips ---------------------------------------------------------------
  lipRatio: {
    good: (v) => `a lower lip ${v} times the upper, the proportion that reads full without reading feminine`,
    bad: (v, high) =>
      high
        ? `a lower lip ${v} times the upper, unbalanced enough to drag the mouth down`
        : `a lower lip only ${v} times the upper, so the mouth reads thin`,
  },
  mouthCornerTilt: {
    good: (v) => `mouth corners at ${v} degrees, turned up at rest`,
    bad: (v, high) =>
      high
        ? `mouth corners at ${v} degrees, high enough to read as a held expression`
        : `mouth corners at ${v} degrees, turned down at rest, which reads as a resting scowl`,
  },

  // --- proportions --------------------------------------------------------
  facialIndex: {
    good: (v) => `a facial index of ${v}, long against its width, which is what photographs well`,
    bad: (v, high) =>
      high
        ? `a facial index of ${v}, narrow enough that the face reads long`
        : `a facial index of ${v}, so the face is wide for its height`,
  },
  middleLowerBalance: {
    good: (v) => `a midface and lower face at ${v} to one, which is the balance the eye reads as even`,
    bad: (v, high) =>
      high
        ? `a midface ${v} times the lower face, top-heavy through the middle`
        : `a midface only ${v} times the lower face, so the bottom of the face dominates`,
  },
  topThirdEst: {
    good: (v) => `an upper third at ${v} per cent, in proportion with the other two`,
    bad: (v, high) =>
      high
        ? `an upper third at ${v} per cent, a tall forehead against the rest of the face`
        : `an upper third at only ${v} per cent, so the forehead is short for the face`,
  },
  foreheadRatio: {
    good: (v) => `a forehead ${v} eye-spans tall, in proportion rather than dominant`,
    bad: (v, high) =>
      high
        ? `a forehead ${v} eye-spans tall, which is a lot of face above the brow`
        : `a forehead only ${v} eye-spans tall, low against the rest`,
  },

  // --- symmetry -----------------------------------------------------------
  midlineDeviation: {
    good: (v) => `a midline off by ${v} per cent of an eye-span, near dead straight`,
    bad: (v) => `a midline off by ${v} per cent of an eye-span, enough to see once it is pointed out`,
  },

  // --- side ---------------------------------------------------------------
  gonialAngle: {
    good: (v) => `a gonial angle of ${v} degrees, the corner of the jaw is sharp, and that is the measurement people mean when they say jawline`,
    bad: (v, high) =>
      high
        ? `a gonial angle of ${v} degrees, obtuse enough that the jaw curves rather than turns`
        : `a gonial angle of ${v} degrees, sharp to the point of looking cut rather than built`,
  },
  ramusMandible: {
    good: (v) => `a ramus to mandible ratio of ${v}, the vertical arm of the jaw is long, which is what gives a jaw depth from the side`,
    bad: (v, high) =>
      high
        ? `a ramus to mandible ratio of ${v}, a tall jaw arm against a short body`
        : `a ramus to mandible ratio of ${v}, so the jaw has little height behind it`,
  },
  submentalCervical: {
    good: (v) => `a submental cervical angle of ${v} degrees, a clean line from chin to neck, no softness under the jaw`,
    bad: (v, high) =>
      high
        ? `a submental cervical angle of ${v} degrees, which is where the under-chin loses its edge`
        : `a submental cervical angle of ${v} degrees, tight enough to shorten the neck`,
  },
  mandibularPlane: {
    good: (v) => `a mandibular plane of ${v} degrees, the jaw runs flat rather than dropping away`,
    bad: (v, high) =>
      high
        ? `a mandibular plane of ${v} degrees, a steep jaw line, which is the profile that reads recessed`
        : `a mandibular plane of ${v} degrees, flat to the point of squaring the face off`,
  },
  chinProjection: {
    good: (v) => `chin projection at ${v} per cent, the chin carries forward to where the profile wants it`,
    bad: (v, high) =>
      high
        ? `chin projection at ${v} per cent, forward enough to lead the profile`
        : `chin projection at ${v} per cent, so the chin sits back behind the lip`,
  },
  facialConvexity: {
    good: (v) => `a facial convexity of ${v} degrees, the profile runs close to straight from brow to chin`,
    bad: (v, high) =>
      high
        ? `a facial convexity of ${v} degrees, so the profile bows outward through the middle`
        : `a facial convexity of ${v} degrees, concave enough to push the chin forward of the brow`,
  },
  totalFacialConvexity: {
    good: (v) => `a total convexity of ${v} degrees, straight through the nose as well as the jaw`,
    bad: (v, high) =>
      high
        ? `a total convexity of ${v} degrees once the nose is counted in`
        : `a total convexity of ${v} degrees, which flattens the profile`,
  },
  nasofrontalAngle: {
    good: (v) => `a nasofrontal angle of ${v} degrees, a defined step from brow to bridge`,
    bad: (v, high) =>
      high
        ? `a nasofrontal angle of ${v} degrees, so brow and bridge run into each other`
        : `a nasofrontal angle of ${v} degrees, a deep notch between brow and nose`,
  },
  nasolabialAngle: {
    good: (v) => `a nasolabial angle of ${v} degrees, the nose base sitting where it should against the lip`,
    bad: (v, high) =>
      high
        ? `a nasolabial angle of ${v} degrees, an upturned nose base`
        : `a nasolabial angle of ${v} degrees, so the nose base droops toward the lip`,
  },
  nasalProjection: {
    good: (v) => `nasal projection at ${v} per cent, in proportion with the profile`,
    bad: (v, high) =>
      high
        ? `nasal projection at ${v} per cent, far enough forward to lead the profile`
        : `nasal projection at ${v} per cent, flat against the face`,
  },
  upperLipELine: {
    good: (v) => `an upper lip sitting ${v} per cent behind the E-line, which is where it belongs`,
    bad: (v, high) =>
      high
        ? `an upper lip ${v} per cent proud of the E-line, forward of nose and chin`
        : `an upper lip ${v} per cent behind the E-line, set back between them`,
  },
  lowerLipELine: {
    good: (v) => `a lower lip ${v} per cent off the E-line, tracking the upper`,
    bad: (v, high) =>
      high
        ? `a lower lip ${v} per cent proud of the E-line`
        : `a lower lip ${v} per cent behind the E-line`,
  },
  lowerThirdDepth: {
    good: (v) => `a lower-third depth of ${v}, the bottom of the face carries forward as well as down`,
    bad: (v, high) =>
      high
        ? `a lower-third depth of ${v}, deep enough to jut`
        : `a lower-third depth of ${v}, so the lower face is shallow from the side`,
  },
  foreheadSlope: {
    good: (v) => `a forehead slope of ${v} degrees, upright rather than sloped back`,
    bad: (v, high) =>
      high
        ? `a forehead slope of ${v} degrees, leaning back off the brow`
        : `a forehead slope of ${v} degrees, vertical to the point of doming`,
  },
  midfaceRatioSide: {
    good: (v) => `a midface depth of ${v}, compact from the side as well as the front`,
    bad: (v, high) =>
      high
        ? `a midface depth of ${v}, long through the middle of the profile`
        : `a midface depth of ${v}, shallow from the side`,
  },
};

/** Whether this measurement has a sentence a person would actually say. */
export function hasPhrase(id: string): boolean {
  return id in PHRASES;
}
