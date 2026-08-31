import type { FaceFlaw } from "./faceFlawCatalog.js";

// ---------------------------------------------------------------------------
// The prompts behind the AI Model Reel pair.
//
// THE AFTER IS GENERATED FIRST, and that inversion is the whole point of this
// file. It replaces the original order, which made the before and then cleared
// its blemishes to get the after.
//
// The old order sounded right and produced a ceiling nobody wanted. Whatever
// face the before generation happened to return WAS the face; the after could
// only ever be that same face with tidier skin. An operator asking for an eight
// got the model's default person with the puffiness taken out, which reads as a
// five who slept well. The comment that used to sit in the route argued models
// resist making a face worse, so start from the worse one. That is true of a
// text prompt and false of an EDIT: "add shadows under the eyes" to an existing
// photograph is a small, local, entirely ordinary retouch, and gpt-image-1 does
// it readily.
//
// So the root call now generates the best-looking version, unconstrained, and
// every other frame is an edit descending from it. The pair's ceiling is set by
// a prompt written to reach a ceiling rather than by whatever came back first.
//
// Identity still carries in the pixels rather than in words, exactly as before.
// The chain is:
//
//     after portrait   (text to image, the root: this defines the person)
//       -> before portrait  (edit: add the flaws)
//       -> after body       (edit: same person, full length)
//            -> before body (edit: add the flaws)
//
// Everything below is a pure string builder so the tests can read the prompts
// rather than read the file that contains them.
// ---------------------------------------------------------------------------

export type PairSex = "male" | "female";

export interface PairSpec {
  sex: PairSex;
  /** What the operator typed: who this person is. */
  description: string;
  flaws: readonly FaceFlaw[];
  /** Where the after should land on the ten-point scale. */
  afterScore: number;
  /** Where the before should land. Only the gap to the after is used. */
  beforeScore: number;
}

/** Clamp a score field to the scale, tolerating anything a number input allows. */
export function usableScore(value: unknown, fallback: number): number {
  // The empty cases are checked BEFORE the coercion, because Number("") and
  // Number(null) are both 0: finite, in range after clamping, and therefore
  // indistinguishable from somebody deliberately asking for the bottom of the
  // scale. A cleared input would have quietly produced the plainest face the
  // prompt can describe.
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && !value.trim()) return fallback;
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  // Plain decimal only. Number() happily reads "0x8" as 8, "0b10" as 2, "0o10"
  // as 8 and "1e1" as 10, so a crafted request could select a band the form
  // cannot produce. The form emits a decimal or nothing; anything else is not
  // a number this field ever meant.
  if (typeof value === "string" && !/^[+-]?\d*\.?\d+$/.test(value.trim())) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10, Math.max(1, n));
}

/**
 * How good-looking the after is asked to be.
 *
 * Bands rather than a number in the prompt, because "make this person a 7.4"
 * means nothing to an image model: it has never seen our percentile tables and
 * there is no shared scale to appeal to. Bands of escalating language are what
 * actually moves the output, and the UI says so plainly rather than implying a
 * contract the generator never signed.
 *
 * ABOUT THE STANDARD THIS ENCODES, honestly, because the comment that used to
 * sit here was self-contradictory. It claimed a house prompt encoding a look
 * "would be applying one standard of attractiveness to everybody" while doing
 * precisely that: one fixed template per sex, applied to every character an
 * operator asks for. There is no way to write a prompt that asks for a
 * good-looking face without encoding some idea of what that means, so the
 * pretence was the problem rather than the template.
 *
 * What the rule in CLAUDE.md actually forbids is a standard that VARIES: no
 * ethnicity is inferred anywhere, and no different bar is applied to anybody.
 * This is one bar for everyone, which is the compliant shape.
 *
 * Two things follow, and both are enforced below. The language stays structural
 * and grooming only, naming no skin tone, hair type or feature that stands in
 * for ethnicity, so the template composes with any description rather than
 * fighting it. And the operator's own description is stated to WIN: it is what
 * makes this a starting point they can steer instead of a house face wearing
 * their words.
 */
function beautyBand(score: number, sex: PairSex): string {
  const shared =
    sex === "female"
      ? [
          "high sharply defined cheekbones",
          "a slim clean jawline with a defined chin",
          "large bright wide-set eyes with a slight upward tilt",
          "full lips",
          "a straight refined nose",
          "a long neck",
          "smooth taut poreless-looking skin",
        ]
      : [
          "a strong square jaw with a sharp gonial angle",
          "a defined broad chin",
          "prominent cheekbones with hollow definition beneath them",
          "deep-set eyes with a low straight brow",
          "a straight nose",
          "a thick neck and broad shoulders",
          "clear taut skin over lean facial planes",
        ];
  const features = shared.join(", ");

  // The top band is written the way a casting brief is written, because that is
  // the job: this face is going to open a video against everything else on the
  // feed. Restraint here reads as an average person in the result.
  if (score >= 9) {
    return [
      `An exceptionally good-looking ${sex === "female" ? "woman" : "man"}, the top of the scale:`,
      `${features}.`,
      "Flawless facial symmetry and ideal proportions. The kind of face used in a cosmetics campaign.",
      "Striking, memorable, and immediately good-looking at a glance.",
    ].join(" ");
  }
  if (score >= 8) {
    return [
      `A strikingly good-looking ${sex === "female" ? "woman" : "man"}:`,
      `${features}.`,
      "Excellent facial symmetry and proportions. Genuinely head-turning, the sort of face a modelling agency signs.",
    ].join(" ");
  }
  if (score >= 7) {
    return [
      `A notably good-looking ${sex === "female" ? "woman" : "man"}:`,
      `${features}.`,
      "Good facial symmetry and clean proportions. Clearly above average without being unusual.",
    ].join(" ");
  }
  return [
    `An ordinary, pleasant-looking ${sex === "female" ? "woman" : "man"}.`,
    "Average facial proportions, nothing exaggerated in either direction.",
  ].join(" ");
}

/**
 * The single line that stops a body word from landing on the face.
 *
 * "Great physique, curvy body" produced a heavier FACE, because a
 * head-and-shoulders prompt has nowhere else to put the word. The operator was
 * describing a figure and got a fuller jaw and cheeks. Saying explicitly which
 * half of the description applies to the frame in view is the fix, and it costs
 * one sentence in each prompt.
 */
const BODY_WORDS_STAY_ON_THE_BODY =
  "Any wording about build, physique or figure describes the BODY only. " +
  "The face itself stays lean and sculpted with a clearly defined jawline, " +
  "defined cheekbones and no softness or fullness under the chin.";

/** Held identical across every frame so the photograph never becomes the variable. */
const CAMERA = [
  "Plain mid-grey studio background, even soft light, no harsh shadows across the face.",
  "Shot on an 85mm lens at f/4. Natural skin texture with visible pores. Photorealistic, not illustrated or rendered.",
].join(" ");

/**
 * THE ROOT CALL. Text to image, and the only frame that invents a person.
 *
 * Everything the pair will ever be is decided here, which is why the beauty
 * language lives in this prompt and nowhere else. The before does not get a
 * competing description of the face; it gets this face with flaws added.
 */
export function afterPortraitPrompt(spec: PairSpec): string {
  return [
    `A photorealistic head-and-shoulders studio portrait of one ${spec.sex === "female" ? "woman" : "man"}.`,
    beautyBand(spec.afterScore, spec.sex),
    spec.description,
    // The operator's description outranks the template above it. Without this
    // the house features quietly overrule whatever they actually asked for,
    // and the tool stops being theirs.
    "Where the description above conflicts with any of these features, follow the description.",
    BODY_WORDS_STAY_ON_THE_BODY,
    "Clear healthy well-hydrated skin, groomed hair, groomed brows, visibly well rested.",
    "Front on, looking straight at the camera, neutral expression, mouth closed.",
    CAMERA,
  ].join(" ");
}

/**
 * How hard the flaws land, from the gap the operator asked for.
 *
 * The gap is the only thing the before score is used for. Its absolute value
 * would be a second claim about the scale, and one number pretending to a
 * precision it does not have is already enough.
 */
function flawWeight(spec: PairSpec): string {
  const gap = spec.afterScore - spec.beforeScore;
  if (gap >= 3) return "Apply these heavily and unmistakably";
  if (gap >= 1.5) return "Apply these clearly";
  return "Apply these subtly";
}

/**
 * THE BEFORE, as an edit that ADDS to the after.
 *
 * Only the `add` half of each flaw appears here, and only ever as something to
 * put on top of a face that already exists. Nothing in this prompt describes
 * the face, for the same reason the old after prompt could not: a second
 * description is how one person becomes two.
 *
 * The structural refusals are stated last and stated flatly. They are what keeps
 * this an honest before and after rather than the standard lie of the format,
 * where the "before" is quietly a different, wider, heavier skull.
 */
export function beforeFromAfterPrompt(spec: PairSpec): string {
  const added = spec.flaws.length
    ? `${flawWeight(spec)}: ${spec.flaws.map((f) => f.add).join("; ")}.`
    : "Make the skin dull and uneven in tone, the hair unstyled, and the person look tired and unrested.";
  return [
    "Keep this exact person: same face, same bone structure, same eyes, same age, same hair colour, same body.",
    "This is the unflattering photograph of them, taken before any of it was dealt with.",
    added,
    // SAME SHOT. A before in flat light beside an after in good light is the
    // standard lie of glow-up content: nothing about the person changed.
    "Same pose, same framing, same background, same lighting, same camera, same distance from the lens.",
    "Do not restructure the face. Do not change the bone structure, the jaw width, the nose or the eye shape.",
    "Do not make them a different person, and do not make them older or younger.",
  ].join(" ");
}

/**
 * The same person, full length.
 *
 * An edit of the after portrait rather than a fresh generation, for the reason
 * everything else here is an edit: a second text-to-image call from the same
 * description returns a sibling, not the same person, and a reel that cuts from
 * a face to a body that is not theirs is worse than having no body shot.
 *
 * "In proportion, fit and toned" is doing specific work. An operator writing
 * "curvy" is describing an hourglass and the generator hears weight; naming
 * proportion explicitly is what separates the two without overruling what they
 * asked for.
 */
export function afterBodyPrompt(spec: PairSpec): string {
  return [
    "Keep this exact person: same face, same bone structure, same hair, same skin, same age.",
    "Reframe to a full-length standing shot showing them head to toe, the whole body in frame with room above the head and below the feet.",
    spec.description,
    "In proportion, fit and toned, with good posture. Athletic rather than heavy.",
    `Plain fitted neutral clothing that shows the figure: ${
      spec.sex === "female" ? "a fitted top and leggings" : "a fitted t-shirt and shorts"
    }.`,
    "Standing straight, arms relaxed at their sides, facing the camera.",
    CAMERA,
  ].join(" ");
}

/** The before of the body pair: the same flaws, on the same full-length frame. */
export function beforeBodyPrompt(spec: PairSpec): string {
  const added = spec.flaws.length
    ? `${flawWeight(spec)}: ${spec.flaws.map((f) => f.add).join("; ")}.`
    : "Make the skin dull and uneven in tone, the hair unstyled, the posture slack, and the person look tired and unrested.";
  return [
    "Keep this exact person: same face, same bone structure, same height, same hair colour, same clothing, same age.",
    "This is the unflattering photograph of them, taken before any of it was dealt with.",
    added,
    "Same pose, same full-length framing, same background, same lighting, same camera, same distance from the lens.",
    "Do not restructure the face or the skeleton. Do not change their height or their proportions.",
    "Do not make them a different person.",
  ].join(" ");
}
