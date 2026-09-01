import type { RegionId, Report, ScoredMetric, Sex } from "./types.js";
import { verdictFor } from "./analysisMode.js";
import type { VerdictTone } from "./analysisMode.js";
import { REGION_NAMES } from "./scoring.js";
import { directionFor } from "./metrics.js";
import { statedPct } from "./precision.js";
import { reliabilityOf } from "./reliability.js";
import { SPREAD, spreadLine } from "./rarity.js";
import { PHRASES, SHORT_PHRASES, figureOf, hasPhrase } from "./reelPhrases.js";
import { eyeShapeFrom } from "./traits.js";
import { ordinal } from "./ordinal.js";

// ---------------------------------------------------------------------------
// The celebrity breakdown, as an ordered list of beats.
//
// One scan produces forty-one measurements in whatever order the engine
// happens to hold them. A watchable ninety seconds is ten of them, chosen for
// being notable, ordered so the eye travels down the face once rather than
// bouncing, and alternating between something flattering and something not so
// the video has a rhythm instead of turning into either a roast or an advert.
//
// This module does the choosing and the ordering and nothing else. It draws no
// pixels, encodes no video and reads no files: a beat names a metric and
// carries the words that go under it, and the renderer decides how to draw the
// measurement the metric already knows how to describe. Keeping it pure is
// what makes the running order testable, which matters because the running
// order IS the format.
//
// On the score beat, which is the one that needs care. VALIDITY.md §2 measures
// this engine at d = -0.20 separating celebrities from the general reference
// population — it does not demonstrably rank faces, and one photograph still
// carries material capture noise. So the headline number is offered as a POSITION
// on a measured distribution, next to the distribution itself, rather than as
// a verdict on a person. That is also the strongest beat in the format: a
// number nobody understands is a shrug, and the same number against a curve is
// the thing that makes somebody want their own.
// ---------------------------------------------------------------------------

// Top of the face to the bottom, which is the order a person reads a face in
// and the order every good version of this video uses. Proportions and
// symmetry are whole-face rather than local, so they come last.
const REGION_ORDER: RegionId[] = [
  "eyes",
  "midface",
  "nose",
  "lips",
  "jaw",
  "chin",
  "proportions",
  "symmetry",
];

export type BeatKind =
  | "hook"
  | "metric"
  | "score"
  | "context"
  | "cta"
  // The ending, in three moves. The face shrinks to the top and the full card
  // arrives under it; the card gives way to the curve on the word "percent";
  // the curve gives way to a search bar with the address being typed into it.
  //
  // Three separate kinds rather than one "ending", because each is a different
  // argument and the renderer has to know which one it is drawing: the card is
  // about the subject, the curve is about everybody else, and the search bar is
  // about the viewer.
  | "card"
  | "curve"
  | "search";

/** Everything the scorecard frame needs, so the renderer never reads a Report. */
export interface CardData {
  verdict: string;
  overall: number;
  potential: number;
  percentile: number;
  /** Region name and score, top to bottom of the face. */
  rows: Array<{ label: string; score: number }>;
}

export interface Beat {
  kind: BeatKind;
  /** The line as it appears on screen. */
  line: string;
  /**
   * The line as it should be READ ALOUD, when that differs from the screen.
   *
   * Metric names are written for a results table, not a microphone. "Facial
   * width-to-height (fWHR)" is right on screen and becomes "f-w-h-r" out of a
   * speech synthesiser; "Nose : mouth width" puts a colon where a reader needs
   * a word. The screen keeps the precise label and the voice gets the sentence
   * a person would actually say.
   */
  spoken?: string;
  /** For a metric beat: what the renderer should draw. */
  metricId?: string;
  /**
   * Every metric named in this beat, when the sentence names more than one.
   *
   * A beat used to be one measurement, so metricId was enough. Now that
   * strengths are grouped — "a compact midface, high-set cheekbones and good
   * width-to-height" is one sentence — the renderer needs the whole set to hold
   * a shot while several are named, instead of cutting once per metric and
   * running out of sentence. metricId stays as the first of them so nothing
   * that only reads one has to change.
   */
  metricIds?: string[];
  region?: RegionId;
  /** Whether this reads as a strength. Drives the overlay colour. */
  positive?: boolean;
  /** The measured value, already formatted, for the badge on screen. */
  badge?: string;
  /**
   * Where on the distribution this face sits, 0..100, for the curve beat.
   *
   * Carried on the beat rather than looked up from the report by the renderer,
   * because everything else in this module is already a self-contained
   * instruction and a renderer that has to reach back into a Report to draw one
   * frame is the seam every drift bug in this pipeline has come through.
   */
  percentile?: number;
  /** For the card beat: the whole scorecard, pre-assembled. */
  card?: CardData;
}

export interface ReelScriptOptions {
  /**
   * The full name, said ONCE, in the hook.
   *
   * How the format is actually read: "How attractive is Timothée Chalamet?" to
   * open, and then "Timothée" for the next ninety seconds. Repeating a full
   * name eight times is the station-announcement problem — it stops sounding
   * like somebody talking about a person and starts sounding like a record
   * being read out.
   */
  name: string;
  /**
   * What to call them for the rest of the video. Defaults to the first word of
   * `name`, which is right for almost every name and wrong for enough of them
   * — a mononym, a stage name, a surname somebody is universally known by —
   * that it has to be overridable rather than merely derived.
   */
  shortName?: string;
  /** How many measurement beats to keep. Ten is about ninety seconds. */
  metricBeats?: number;
  /** Non-facial context — height, status, whatever makes the ending fair. */
  context?: string[];
  /**
   * A sentence written by the operator, read out verbatim before the CTA.
   *
   * `context` is a list of terse facts and gets assembled into a sentence by
   * the template above. This is the other half: the thing only the person
   * cutting the video knows, in their own words. A breakdown that scores Justin
   * Bieber a 6 and stops there hands his audience an argument; the same
   * breakdown ending "he is a singer with a stadium career, and that changes
   * how he is seen far more than a jaw measurement does" has already made the
   * argument and conceded the fair part of it.
   *
   * Read verbatim rather than templated because the whole value is that it says
   * something the engine could not have known to say.
   */
  note?: string;
  /**
   * The opening line, when the default question is not the one being asked.
   *
   * The format's whole retention argument is the first two seconds, and
   * "How attractive is X?" is one framing of maybe five that work. Rage bait
   * ("How UNATTRACTIVE is X?") and the fallen-off angle ("How much is X
   * scoring compared to what he used to?") are different videos with the same
   * measurements underneath, and which one gets posted is a judgement about a
   * subject and an audience that the engine cannot make.
   *
   * `{name}` is substituted wherever it appears; a line with no placeholder is
   * used verbatim, since some openings do not want the name in them at all.
   * The full name goes in here, not the short one — this is the one beat that
   * says it, and everything after it is already on the short form.
   */
  opening?: string;
  cta?: string;
  /**
   * Which ladder the verdict word comes from.
   *
   * Passed in rather than read here, because this module is pure and the
   * preference lives in the browser — but passed in AT ALL because the page and
   * the video it exports have to call one face the same thing. A video that
   * says "Mogger" over a page that says "Great-looking" is two products.
   */
  tone?: VerdictTone;
  /**
   * Which cut this script is for.
   *
   * "full" (default) is the deep read: every clause closes on its figure and
   * the ending runs card, ceiling, curve, curve. "short" is the fast cut: the
   * voice says the verdict and the SCREEN says the number (the badge already
   * carries it), grades come from each metric's own zEff, more measurements
   * fit because each costs fewer words, and the ending is compressed to
   * verdict-and-score, ceiling, one curve, the search bar. The pace difference
   * is not a render setting: the timeline fits itself to the narration, so a
   * terser script IS the faster video.
   */
  cut?: "short" | "full";
}

// Words per minute the voice actually reads at.
//
// Measured off finished rundowns rather than assumed: ElevenLabs' default pace
// on this copy lands near 165, which is slower than conversational speech and
// about right for a voiceover that has to survive being watched at 1.5×.
//
// It exists so the person typing a disclaimer can be told, while they type, how
// much footage they are about to need. Guessing that number after the render
// means finding out you are eight seconds short of picture once the expensive
// part is already done.
//
// 186 is that measured 165 times the VOICE_SPEED of 1.125 the synthesiser is
// asked for in api/tts.ts. The two have to be changed together. Nothing BREAKS
// if they drift — rundownExport fits the visual timeline onto the real audio
// duration once it exists, so the render stays in sync either way — but this is
// the number quoted BEFORE the render, and a stale one sends somebody off to
// shoot the wrong amount of footage.
const WPM = 186;

/** Roughly how long a line takes to say, in seconds. */
export function spokenSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  // Plus a beat of air at the end. A line that ends the instant the last
  // syllable does cuts to the next card too tightly to read as speech.
  return (words / WPM) * 60 + 0.45;
}

// How notable a measurement has to be to be worth a beat. Below this it is
// within the noise of one photograph and saying anything about it is filler
// that makes the whole video less credible.
const NOTABLE_Z = 0.45;

// The reliability a metric needs before it may carry a sentence in a published
// video. See the filter in the beat builder for why this sits above the
// product-wide RELIABLE_MIN of 0.15.
//
// At 0.35 this drops jaw frontal angle (0.10), gonial angularity (0.25) and
// every metric measured at zero, while keeping jaw : cheekbone width (0.47) and
// the strong performers — lip ratio (0.74), intercanthal (0.73), philtrum-chin
// (0.69). The jaw is not silenced, only the two ways of measuring it that do
// not survive a change of photograph.
const REEL_RELIABLE_MIN = 0.35;

// The sentence for one measurement.
//
// Three frames rather than one, cycled by position, because the first version
// of this produced "X has notably weak A. X has notably weak B. X has notably
// weak C." ten times over. Ten identical frames is not a breakdown, it is a
// list, and a list is what a viewer scrolls past.
//
// The direction words matter more than the variety. "Weak gonial angularity"
// tells a viewer nothing they can picture; "jaw angle is flatter than ideal"
// tells them where to look and which way it is off. The raw z sign carries
// that — which side of the mean the face actually sits — while zEff carries
// whether that is good, and the two are not the same for a band metric where
// both extremes are penalised.
// Get a mixed tone by CHOOSING a balanced set, not by reordering one.
//
// An earlier version sorted the chosen metrics down the face and then zipped
// strengths and weaknesses back together. Those two operations are in direct
// conflict and the zip ran second, so it silently undid the sort: the running
// order came out midface, eyes, midface, nose, lips, nose, jaw, proportions,
// jaw, chin. The comment above it claimed the eye travelled down the face. It
// did not, and on a format where the camera crops to the region being measured
// the bouncing is the most visible thing in the video.
//
// You cannot have both a strict anatomical order and a strict good/bad
// alternation. Anatomy wins, because it is what a viewer perceives. Tone
// balance is achieved instead at SELECTION time — take the most notable
// strengths and the most notable weaknesses in roughly equal number — and then
// a single sort down the face is the last thing that touches the order.
// The measurements the reference format always covers, and the ones a viewer
// who knows the genre expects to hear: thirds, face shape, midface, the
// marquee eye and lip reads. In the short cut these get a selection boost so
// they make the running order whenever they were measured, even at a
// middling grade — "balanced facial thirds" is a sentence the format owes its
// audience, and a face can be notable for being BALANCED, which a pure
// |zEff| ranking treats as unremarkable. fWHR is deliberately not here: its
// measured reliability is 0.00 (two photographs of one person disagree about
// it completely), and nothing with that number may carry a sentence in a
// published video, however famous the acronym.
const MARQUEE = new Set([
  "middleLowerBalance",
  "facialIndex",
  "midfaceRatio",
  "topThirdEst",
  "cheekboneHeight",
  "canthalTilt",
  "intercanthalEyeWidth",
  "lipRatio",
]);
const MARQUEE_BOOST = 0.5;
// A marquee STRENGTH has no floor at all in the short cut: near the mean is a
// legitimate read for these — "balanced facial thirds" is precisely what is
// true of a face whose thirds sit in the population's normal band, and the
// grade words scale down honestly ("a decent", "an alright") as zEff does. A
// marquee FLAW still has to clear NOTABLE_Z like everything else: calling a
// barely-off midface "top-heavy" would be overclaiming, and the flaw section
// is where the credibility lives.
const marqueeFloor = (m: ScoredMetric) => (m.zEff >= 0 ? 0 : NOTABLE_Z);

function selectBalanced(candidates: ScoredMetric[], limit: number, marquee = false): ScoredMetric[] {
  const interest = (m: ScoredMetric) =>
    Math.abs(m.zEff) + (marquee && MARQUEE.has(m.def.id) ? MARQUEE_BOOST : 0);
  const byInterest = [...candidates].sort((a, b) => interest(b) - interest(a));
  const good = byInterest.filter((m) => m.zEff >= 0);
  const bad = byInterest.filter((m) => m.zEff < 0);

  // Half each, and whichever side is short is made up by the other so a very
  // even or very lopsided face still fills the running order.
  const wantGood = Math.ceil(limit / 2);
  const picked = [...good.slice(0, wantGood), ...bad.slice(0, limit - wantGood)];
  if (picked.length < limit) {
    const taken = new Set(picked);
    picked.push(...byInterest.filter((m) => !taken.has(m)).slice(0, limit - picked.length));
  }
  return picked;
}

// The metric names the engine holds are written to sit in a results table next
// to a number, where "(frontal)" disambiguates the front measurement from the
// side one and "fWHR" is the term the literature uses. None of them reach the
// microphone any more — the clauses in reelPhrases.ts are written for a voice
// from the start, which is why the sanitiser that used to live here is gone
// rather than merely unused.

// The clause for one measurement, with its figure inside it.
//
// Everything interesting about this now lives in reelPhrases.ts — see the
// header there for why a sentence assembled from the metric's own name can
// never be worth listening to. What is left here is picking the strength or the
// weakness reading, and working out which SIDE of the ideal the face is on so
// the weakness reading is the right one of the two.
function clauseFor(m: ScoredMetric, sex: Sex): string {
  const phrase = PHRASES[m.def.id];
  const v = figureOf(m);
  if (m.zEff > 0) return phrase.good(v);
  // Which side of the IDEAL, not which side of the mean. The two are not the
  // same: on a higher-is-better metric the ideal sits above the population
  // mean, so a face can be above average and still short of it, and reading
  // that out as "too high" is backwards. The ideal range is the exact answer
  // and every scored metric carries it; z is only the fallback for a metric
  // whose range did not survive.
  const [lo, hi] = m.idealRange ?? [];
  const high =
    Number.isFinite(hi) && Number.isFinite(lo)
      ? m.value > (hi as number)
      : directionFor(m.def, sex) === "lower"
        ? m.z > 0
        : m.z > 0;
  return phrase.bad(v, high);
}

// The graded article-plus-adjective for a short clause, from the metric's own
// distance above the mean. The words are the ones the reference format
// actually says — "an ideal FWHR", "a great midface ratio", "a good ramus" —
// and each band holds more than one so consecutive clauses do not chant the
// same adjective. The pick cycles by position rather than randomly, for the
// same reason the openers do: a fixed cycle cannot produce three "good"s in a
// row, and a random pick eventually will.
//
// The bottom two bands exist for the backfill case: on a face with few
// notable strengths, selection reaches below NOTABLE_Z to fill the running
// order, and "a decent" or "an average" is the honest word for what it finds
// there. Nothing below the mean ever reaches this function — a negative zEff
// takes the bad clause instead.
const GRADE_BANDS: Array<{ min: number; words: string[] }> = [
  { min: 1.3, words: ["an excellent", "an ideal"] },
  { min: 0.9, words: ["a great", "a very strong"] },
  { min: 0.45, words: ["a good", "a strong", "a well built"] },
  { min: 0.15, words: ["a decent", "a solid"] },
  { min: -Infinity, words: ["an average", "an alright"] },
];

function gradeFor(zEff: number, cycle: number): string {
  const band = GRADE_BANDS.find((b) => zEff >= b.min)!;
  return band.words[cycle % band.words.length];
}

// The short clause: verdict in the voice, figure on the screen.
//
// canthalTilt is the one metric whose strength has a NAME the audience uses —
// the eye shape — so its good clause comes from the trait classifier when the
// eyes classify, and only falls back to the graded generic when they do not.
function shortClauseFor(m: ScoredMetric, sex: Sex, report: Report, cycle: number): string {
  const phrase = SHORT_PHRASES[m.def.id];
  if (m.zEff > 0) {
    if (m.def.id === "canthalTilt") {
      const shape = eyeShapeFrom(report.metrics);
      if (shape) return shape.label;
    }
    return phrase.good(gradeFor(m.zEff, cycle));
  }
  const [lo, hi] = m.idealRange ?? [];
  const high =
    Number.isFinite(hi) && Number.isFinite(lo)
      ? m.value > (hi as number)
      : directionFor(m.def, sex) === "lower"
        ? m.z > 0
        : m.z > 0;
  return phrase.bad(high);
}

/** "a, b and c" — an Oxford-less list, because it is being spoken. */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

type GroupKind = "positive" | "negative" | "side" | "side-negative";

// The openers carry the STRUCTURE of the read: strengths, then a turn, then the
// flaws, with the profile as its own act. The turn is the thing the old
// one-metric-per-beat shape had no room for — alternating good and bad by
// magnitude means a viewer is never waiting for anything, because there is
// nothing left to arrive.
//
// Every opener ends where a clause can follow it, and the clauses in
// reelPhrases.ts all begin mid-sentence and lower case for exactly that reason.
// The list is cycled by position rather than picked at random: the fault the
// last version shipped was three consecutive sentences opening "There is also",
// and a fixed cycle cannot produce that where a random pick eventually will.
// Trimmed to the has-forms. "On top of that" and "There's also" were connective
// filler — heard back to back in a real export they read as a narrator stalling,
// and every one of them delays the signal word the clause now leads with.
const OPENERS: Record<GroupKind, (subject: string, pronoun: string) => string[]> = {
  positive: (subject, p) => [
    `${subject} has`,
    `${capitalize(p)} has`,
    `${capitalize(p)} also has`,
    `And ${p} has`,
  ],
  negative: (_s, p) => [
    `The flaws. ${capitalize(p)} has`,
    `${capitalize(p)} also has`,
    `And ${p} has`,
  ],
  side: (_s, p) => [`From the side, ${p} has`, `${capitalize(p)} also has`, `And ${p} has`],
  // The first opener used to hardcode "He has", which printed a masculine
  // pronoun over any woman whose profile carried a flaw.
  "side-negative": (_s, p) => [
    `The profile isn't perfect. ${capitalize(p)} has`,
    `${capitalize(p)} also has`,
    `And ${p} has`,
  ],
};

// One measurement to a sentence.
//
// Two was tried, on the reasoning that grouping is what stops a rundown reading
// as a list. It is not — LENGTH is. Back when a clause was "excellent canthal
// tilt", ten of them in a row was a list and grouping them into threes was the
// only available fix. Now that a clause carries a figure, a place to look and a
// consequence, it is twenty words on its own, and two of them joined by "and"
// is a sentence a listener loses halfway through:
//
//   "...a canthal tilt of 6.4 degrees, so the outer corner of the eye sits well
//   above the inner — that's the hunter-eye look and brows running at 4.1
//   degrees — straight and low rather than arched, which is the masculine set."
//
// One clause, one shot, one thing to look at. The variety that grouping was
// covering for now comes from the clauses themselves being different sentences
// rather than the same sentence with the nouns swapped.
const CLAUSES_PER_SENTENCE = 1;

function groupedBeats(
  ms: ScoredMetric[],
  sex: Sex,
  subject: string,
  kind: GroupKind,
  // The clause writer for the cut being built. Passed in rather than branched
  // on here so this function stays about STRUCTURE — openers, cycling, badges
  // — and the two cuts cannot drift apart in anything except their words.
  clause: (m: ScoredMetric, cycle: number) => string,
): Beat[] {
  if (!ms.length) return [];
  const pronoun = sex === "female" ? "she" : "he";
  const openers = OPENERS[kind](subject, pronoun);

  const beats: Beat[] = [];
  for (let i = 0, n = 0; i < ms.length; i += CLAUSES_PER_SENTENCE, n++) {
    const chunk = ms.slice(i, i + CLAUSES_PER_SENTENCE);
    // The first opener is the one that names the section — "Now the flaws", the
    // subject's own name — so it is never reused; the rest cycle behind it.
    // Cycling rather than clamping, because clamping to the last entry is what
    // produced three consecutive sentences opening "There is also".
    const opener = n === 0 ? openers[0] : openers[1 + ((n - 1) % (openers.length - 1))];
    const positive = kind === "positive" || kind === "side";
    beats.push({
      kind: "metric",
      line: `${opener} ${listOf(chunk.map((m) => clause(m, n)))}.`,
      metricId: chunk[0].def.id,
      region: chunk[0].def.region as Beat["region"],
      positive,
      badge: `${chunk[0].value.toFixed(chunk[0].def.decimals)}${chunk[0].def.unit}`,
      // Every metric in the sentence, so the renderer can hold the shot while
      // more than one measurement is named rather than cutting per metric and
      // running out of sentence.
      metricIds: chunk.map((m) => m.def.id),
    });
  }
  return beats;
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The default opening question. Exported so the field can show it as a hint. */
export const DEFAULT_OPENING = "How attractive is {name}?";

/**
 * The hook, with the name substituted in.
 *
 * Falls back to the default on an empty or whitespace-only override rather than
 * shipping a blank first beat — a rundown that opens on silence has thrown away
 * the two seconds the whole format depends on.
 */
export function openingLine(opening: string | undefined, name: string): string {
  const raw = opening?.trim();
  if (!raw) return DEFAULT_OPENING.replace(/\{name\}/g, name);
  return raw.replace(/\{name\}/g, name);
}

// The scorecard, assembled here rather than read out of the Report by the
// renderer.
//
// Every other beat in this module is a self-contained instruction — a sentence
// and the id of the thing to draw — and a renderer reaching back into a Report
// for one frame is the seam every drift bug in this pipeline has come through.
// The regions are already in face order in the Report, so the card reads top to
// bottom the same way the video just did.
function cardData(report: Report, tone?: VerdictTone): CardData {
  return {
    verdict: verdictFor(report, tone).word,
    overall: report.overall,
    potential: report.potential,
    percentile: report.overallPercentile,
    rows: [...report.regions]
      .sort((a, b) => REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region))
      .map((r) => ({ label: REGION_NAMES[r.region] ?? r.region, score: r.score })),
  };
}

export function buildReelScript(report: Report, options: ReelScriptOptions): Beat[] {
  const short = options.cut === "short";
  // The short cut fits more measurements because each costs fewer words:
  // fourteen terse clauses run about the same seconds as ten full ones.
  const limit = options.metricBeats ?? (short ? 14 : 10);
  const clause: (m: ScoredMetric, cycle: number) => string = short
    ? (m, cycle) => shortClauseFor(m, report.sex, report, cycle)
    : (m) => clauseFor(m, report.sex);
  const name = options.name;
  // Everything after the hook uses the short form. Falls back to the full name
  // when the first word IS the whole thing, so a mononym never ends up with an
  // empty label on the curve.
  const shortName = (options.shortName?.trim() || name.trim().split(/\s+/)[0] || name).trim();
  // Resolved once. Called twice in one template it was one edit away from the
  // spoken word and the word on the card disagreeing.
  const verdict = verdictFor(report, options.tone);

  // Notable, measured, and not an impossible reading. An implausible metric is
  // a landmark in the wrong place (see scoring.ts) — it carries no weight in
  // the score and it must not carry a sentence in a video either.
  // Reliability is a harder gate here than anywhere else in the product, and
  // the reason is that a video is published.
  //
  // reliability.ts measures what share of each metric's variance is real
  // between-person signal rather than photo-to-photo noise. Jaw frontal angle
  // is 0.10 — ninety per cent noise — and it was eligible to headline a beat,
  // so a rundown could and did assert "Jaw frontal angle, 3.7 out of 10, below
  // average" over somebody's face. That is a coin flip set in serif type, and
  // it is the single sentence most likely to make a viewer conclude the whole
  // instrument is invented.
  //
  // The argument was already made two lines above for implausible values: it
  // carries no weight in the score, so it must not carry a sentence in a video.
  // Noise deserves the same treatment and was simply never given it.
  //
  // The bar is deliberately ABOVE the product-wide RELIABLE_MIN of 0.15. That
  // threshold decides whether an on-screen row gets a score or an "indicative"
  // chip — a row is glanceable, revisable, and sits beside its own caveat. A
  // video has none of that: it is downloaded, posted, and argued with in a
  // comment section months later with no chip anywhere near it. Something
  // barely past meaningless does not belong in one.
  //
  // And the last gate is language. A metric with no hand-written clause in
  // reelPhrases.ts does not get a sentence, because the alternative — building
  // one out of the metric's own column heading — is what produced "upper face
  // proportion below the ideal band", and a line nobody can picture is worse
  // than a line that was never said.
  const candidates = report.metrics.filter(
    (m) =>
      !m.implausible &&
      Math.abs(m.zEff) >= (short && MARQUEE.has(m.def.id) ? marqueeFloor(m) : NOTABLE_Z) &&
      reliabilityOf(m.def.id) >= REEL_RELIABLE_MIN &&
      hasPhrase(m.def.id),
  );

  // Selection is by interest AND tone balance; the running order is by anatomy.
  // This sort is the last thing that touches the order — see selectBalanced.
  const byRegion = selectBalanced(candidates, limit, short).sort(
    (a, b) => REGION_ORDER.indexOf(a.def.region) - REGION_ORDER.indexOf(b.def.region),
  );

  // Strengths together, then the turn, then the flaws — and several features
  // per sentence rather than one.
  //
  // The old shape was one metric, one sentence, ten times, alternating good and
  // bad by magnitude. That is a list, and a list never builds: there is no
  // point in it where a viewer is waiting for the next thing. The reference is
  // how the format is actually read aloud by the people who do it well — "a
  // compact midface, high-set cheekbones, good width-to-height and mouth-to-nose
  // proportions" is four measurements in one breath, and then a clean pivot
  // into what is wrong.
  //
  // Grouping is by REGION, because that is the unit a viewer can picture. Three
  // features of a midface is a sentence about a midface; three features drawn
  // from three regions is the list again with commas instead of full stops.
  const positives = byRegion.filter((m) => m.zEff > 0);
  const negatives = byRegion.filter((m) => m.zEff <= 0);

  const metricBeats: Beat[] = [
    // Front strengths, grouped. Side is held back for its own section — it is
    // a different photograph and naming it gives the rundown a second act.
    ...groupedBeats(positives.filter((m) => m.def.view !== "side"), report.sex, shortName, "positive", clause),
    ...groupedBeats(negatives.filter((m) => m.def.view !== "side"), report.sex, shortName, "negative", clause),
    ...groupedBeats(positives.filter((m) => m.def.view === "side"), report.sex, shortName, "side", clause),
    ...groupedBeats(negatives.filter((m) => m.def.view === "side"), report.sex, shortName, "side-negative", clause),
  ];

  const pct = statedPct(report.overallPercentile);
  const beats: Beat[] = [
    { kind: "hook", line: openingLine(options.opening, name) },
    ...metricBeats,
    // The number and the curve, never the number alone — a score with no
    // distribution beside it gets read against a school mark, which is the
    // misreading this product exists to correct.
    //
    // Three beats rather than one. As a single block this ran eleven seconds
    // of unbroken narration at the exact moment a viewer is most likely to be
    // watching, and the renderer had nothing to cut on. Split, the number lands
    // alone, then the curve arrives as its own reveal.
    // The ask goes BEFORE the number, not after.
    //
    // The number is the only thing a viewer is waiting for, so it is the only
    // moment the ask is free. Put it afterwards and it arrives at the exact
    // instant they have what they came for and their thumb is already moving.
    //
    // It is a spoken line only. The SHOWN ask is the search bar at the end,
    // which needs the curve to have landed first to mean anything, so the two
    // are deliberately not the same beat.
    {
      kind: "cta",
      line: options.cta ?? "Before the rating, go get yours at truemax.app.",
    },
    // THE CARD. The face shrinks to the top of the frame and the whole
    // breakdown arrives under it.
    //
    // Verdict and number in one line. A number is an argument, a name is a
    // conclusion, and split across two beats the conclusion lands after the
    // viewer has already decided what they think of the number.
    //
    // "The verdict:" rather than a sentence around the word, because the ladder
    // holds nouns AND clauses — "Mogger", "True Adam", "You're cooked" — and no
    // one sentence frame fits all three. It was shipping "Marlon has mogger".
    //
    // The rung is said TWICE: once in the ladder's own word and once in plain
    // English. "Mogger" is the word that gets quoted in a comment section and it
    // is also a word that means nothing to somebody who arrived from the For You
    // page without ever having heard it. "A very attractive male" costs four
    // words and carries the same verdict to everybody else watching.
    // The short cut merges the verdict and the number into one card beat and
    // keeps the ceiling to one terse line: same ending the format always runs
    // — card, curve, search — with half the narration under it. The full cut
    // keeps the three-beat build; see each beat's own comment.
    ...(short
      ? ([
          {
            kind: "card",
            line: `The verdict: ${verdict.word}. ${shortName} measures ${report.overall.toFixed(1)} out of 10.`,
            card: cardData(report, options.tone),
          },
          {
            kind: "card",
            line: `Ceiling: ${report.potential.toFixed(1)}, with everything soft fixed.`,
            card: cardData(report, options.tone),
          },
        ] satisfies Beat[])
      : ([
    {
      kind: "card",
      line: `The verdict: ${verdict.word}. ${capitalize(verdict.descriptor)}.`,
      card: cardData(report, options.tone),
    },
    // The number is its OWN beat rather than a third sentence on the verdict's.
    //
    // Three sentences ran to five caption lines, which pages as two-plus-two
    // and then a single orphan line reading "out of 10." — and it made the
    // longest beat in the video the one the lag was reported on. Two shorter
    // beats page cleanly, track the voice more closely because there is less
    // room inside each for the estimate to be wrong, and land the word and the
    // number as two separate hits instead of one run-on.
    //
    // Still a card beat, so the card does not move: the entrance is keyed to
    // the FIRST card beat and all of these are the same state.
    {
      kind: "card",
      line: `${shortName} measures ${report.overall.toFixed(1)} out of 10.`,
      card: cardData(report, options.tone),
    },
    // Still on the card. The ceiling as a NUMBER, not a ladder rung: named rungs
    // work for where somebody IS, but as a CEILING a name is discouraging,
    // because the top rung is defined as almost nobody and a viewer knows they
    // are not about to become the one. A number one point above the one they
    // just heard is a target; the same ceiling as a name is a door with
    // somebody else's name on it.
    {
      kind: "card",
      line: `Ceiling: ${report.potential.toFixed(1)}. That's the same bone structure with everything soft fixed.`,
      card: cardData(report, options.tone),
    },
        ] satisfies Beat[])),
    // THE CURVE, on the word "percent". Crowd shaded, one marker outside it.
    //
    // The distribution was previously SAID here, and saying it is not the same
    // as showing it. "Two thirds of men measure between 4.1 and 6.3" asks a
    // viewer to hold two numbers and compare them to a third they heard ten
    // seconds ago. The same fact as a shaded band with a line standing outside
    // it is understood before it is read. This is the frame the whole format
    // has been building an argument for, and it was narration over a face.
    // NO "1 in N" IS SAID, on purpose, and this is a scoring-integrity line
    // rather than a style one.
    //
    // "That's 1 in 20" was the percentile restated as a rarity, and it is the
    // single claim in the video that collides hardest with how the audience
    // already uses the scale. In the community this format speaks to, a 7 is
    // a one-in-a-huge-number face; our 7.1 meant "top 5% of a 258-photo
    // reference set". Both readings heard together sound like a lie, and the
    // fix is NOT to print the folklore number — a corpus of nineteen rated
    // faces cannot distinguish one-in-a-thousand from one-in-a-million, and
    // claiming it would be inventing a measurement, which is the one thing
    // this product must never do.
    //
    // So the spoken claim is only what the data supports: the shape of the
    // crowd and where this face stands in it. The percentile badge stays on
    // screen, scoped to the reference set by the curve it is printed on. The
    // deeper repair is the rated-corpus recalibration: once the score is
    // fitted to ratings where a 7 is reserved for near-nobody, the number
    // itself compresses and the collision disappears at the source.
    {
      kind: "curve",
      line: spreadLine(report.sex),
      percentile: report.overallPercentile,
      badge: `${ordinal(pct)} percentile`,
    },
    // The second curve line is the full cut's luxury: the short cut has made
    // its point by now and the search bar is waiting.
    ...(short
      ? []
      : [
          {
            kind: "curve" as const,
            line: `${SPREAD.median.toFixed(1)} is dead average. That band is most of them.`,
            percentile: report.overallPercentile,
          },
        ]),
  ];

  if (options.context?.length) {
    beats.push({
      kind: "context",
      // The fairness beat, and it is not only fairness. A breakdown that stops
      // at the face invites the subject's audience to argue with it; naming
      // what the face is not measuring ends the argument before it starts.
      line: `This measures a face and nothing else. ${shortName}: ${options.context.join(", ")}.`,
    });
  }

  if (options.note?.trim()) {
    beats.push({ kind: "context", line: options.note.trim() });
  }

  // The address, typed into a search bar on screen.
  //
  // A URL spoken aloud is a URL nobody types. A URL being typed into a search
  // bar is an instruction the viewer's hands already know how to follow, and it
  // is the one piece of the video with a job outside the video. It lands the
  // beat after the curve, which is the moment the viewer has just been shown
  // where a stranger stands and has not yet been shown where they stand.
  beats.push({ kind: "search", line: "Want yours analysed? truemax.app." });

  // Ends on a question rather than a statement. The rundowns that collect
  // comments all close by asking for the next subject, and it costs one line.
  beats.push({ kind: "cta", line: "Who should we measure next?" });

  return beats;
}

// A single narration block, for text-to-speech. Kept separate from the beats
// so the captions on screen and the voice track cannot drift.
export function narrationFrom(beats: Beat[]): string {
  return beats.map((b) => b.spoken ?? b.line).join(" ");
}

/**
 * Where each beat's text begins inside narrationFrom's paragraph.
 *
 * The synthesiser returns the start time of every CHARACTER it spoke, indexed
 * against the text it was handed. To turn that into "when does beat 7 start" we
 * need to know which character beat 7 begins at — so the offsets are derived
 * here, next to the join that produces them, rather than re-derived by the
 * renderer from a string it would have to re-split the same way.
 *
 * Returns one offset per beat plus a final entry for the end of the paragraph,
 * so a caller can read beat i's span as [offsets[i], offsets[i + 1]).
 */
export function narrationOffsets(beats: Beat[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const b of beats) {
    offsets.push(cursor);
    // +1 for the space the join inserts. The last beat has no trailing space,
    // which is why the final entry is written from the real length below.
    cursor += (b.spoken ?? b.line).length + 1;
  }
  offsets.push(narrationFrom(beats).length);
  return offsets;
}

// Whether a report is fit to publish.
//
// The pipeline must refuse a photograph the app itself would warn a paying
// customer about. Publishing a jaw number measured off a tilted magazine cover
// is the fastest way to lose the credibility the format exists to build, and
// nobody will ever check it but us.
export function reelBlockers(report: Report, offAxisDeg: number, jawWarnDeg: number): string[] {
  const blockers: string[] = [];
  if (offAxisDeg > jawWarnDeg) {
    blockers.push(
      `Capture is ${offAxisDeg.toFixed(0)}° off level; jaw and chin cannot be stated from it.`,
    );
  }
  // A measurement that DECLINED is not a measurement that lied.
  //
  // foreheadRatio refuses on a cap, a fringe, or hair the same value as the
  // skin — that refusal is the hairline detector working, and it says so about
  // the photograph rather than about the mesh. Counting it here blocked a
  // rundown on any face wearing a hat, and reported the reason as a tilt.
  //
  // A landmark metric cannot decline: if one is unmeasurable the mesh itself is
  // broken and nothing built on it can be trusted, which is why analyzeFront
  // throws outright rather than reaching this function. So what is left to
  // catch here is the plausibility guard — a value that WAS produced and is
  // anatomically impossible.
  const impossible = report.metrics.filter((m) => m.implausible && Number.isFinite(m.value));
  if (impossible.length) {
    blockers.push(`${impossible.length} measurement(s) came back anatomically impossible.`);
  }
  const usable = report.metrics.filter((m) => !m.implausible && Math.abs(m.zEff) >= NOTABLE_Z);
  if (usable.length < 6) {
    blockers.push(`Only ${usable.length} notable measurements; not enough for a breakdown.`);
  }
  return blockers;
}

export const REEL_REGION_NAMES = REGION_NAMES;
