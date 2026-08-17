import type { RegionId, Report, ScoredMetric, Sex } from "./types.js";
import { verdictFor } from "./analysisMode.js";
import { REGION_NAMES } from "./scoring.js";
import { directionFor } from "./metrics.js";
import { statedPct } from "./precision.js";
import { reliabilityOf } from "./reliability.js";
import { SPREAD, rarityShort, spreadLine } from "./rarity.js";

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
// population — it does not demonstrably rank faces, and one photograph moves a
// score by about ±1.2 anyway. So the headline number is offered as a POSITION
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

export type BeatKind = "hook" | "metric" | "score" | "context" | "cta";

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
  region?: RegionId;
  /** Whether this reads as a strength. Drives the overlay colour. */
  positive?: boolean;
  /** The measured value, already formatted, for the badge on screen. */
  badge?: string;
}

export interface ReelScriptOptions {
  name: string;
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
  cta?: string;
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
// 185 is that measured 165 times the VOICE_SPEED of 1.12 the synthesiser is
// asked for in api/tts.ts. The two have to be changed together. Nothing BREAKS
// if they drift — rundownExport fits the visual timeline onto the real audio
// duration once it exists, so the render stays in sync either way — but this is
// the number quoted BEFORE the render, and a stale one sends somebody off to
// shoot the wrong amount of footage.
const WPM = 185;

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
// Every frame takes a PREDICATE ("is excellent", "sits higher than ideal")
// rather than an adjective, because the good and bad cases need different
// parts of speech otherwise. An earlier version mixed the two and produced
// "Notice the a nose : mouth width further from ideal" — an article and a verb
// out of place, in the one sentence on screen.
//
// Six rather than three, because three frames over ten beats means every frame
// is heard three times and the pattern is audible by the fourth. Six is heard
// twice, which reads as a person with habits rather than a template.
//
// The full name is used sparingly on purpose: hearing "Marlon Lundgren-Garcia"
// five times in ninety seconds is the station-announcement problem again.
const FRAMES = [
  (subject: string, name: string, predicate: string) => `${subject}'s ${name} ${predicate}.`,
  (_subject: string, name: string, predicate: string) => `The ${name} ${predicate}.`,
  (_subject: string, name: string, predicate: string) => `Notice the ${name} — it ${predicate}.`,
  (_subject: string, name: string, predicate: string) => `Look at the ${name}: it ${predicate}.`,
  (_subject: string, name: string, predicate: string) => `Then the ${name}, which ${predicate}.`,
  (_subject: string, name: string, predicate: string) => `On the ${name} — it ${predicate}.`,
];

// A measured value a voice can say.
//
// Trailing zeros and four decimal places are for a table. Read aloud, "zero
// point three eight zero" is noise where "zero point three eight" is a number,
// and an angle wants none of it at all.
function fmtValue(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1).replace(/\.0$/, "");
  return v.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}

// A metric name a voice can say.
//
// The engine's names are written to sit in a results table next to a number,
// where "(frontal)" disambiguates the front measurement from the side one and
// "fWHR" is the term the literature uses. Read aloud, the parenthetical is
// noise and the acronym comes out as four letters. The screen keeps the exact
// label; this is only what goes to the synthesiser.
function spokenName(name: string): string {
  return name
    .toLowerCase()
    // "(frontal)", "(est.)", "(fwhr)" — all disambiguators for a reader.
    .replace(/\s*\([^)]*\)/g, "")
    // "nose : mouth width" -> "nose to mouth width"
    .replace(/\s*:\s*/g, " to ")
    // "width-to-height" survives as-is, but a trailing hyphen would not.
    .replace(/\s+/g, " ")
    .trim();
}

function qualify(
  m: ScoredMetric,
  index: number,
  sex: Sex,
): { line: (subject: string) => string; spoken: (subject: string) => string; positive: boolean } {
  const good = m.zEff;
  const name = m.def.name.toLowerCase();
  const positive = good >= 0;
  const strength = Math.abs(good);

  // A standout gets its NUMBER said, not just its adjective.
  //
  // "Notice the chin-to-philtrum ratio, it is excellent" is a claim. "Chin to
  // philtrum of 3.94, against an ideal of 3.39 — excellent" is the same claim
  // with its evidence attached, and it is the difference between a face app
  // and somebody who measured something. It is reserved for standouts because
  // eleven numbers in ninety seconds is a spreadsheet being read aloud; one or
  // two, on the features that actually carry the face, is a case being made.
  // The midpoint of the display band is the ideal the bar is drawn around, so
  // it is the one the viewer is looking at while this is said.
  const ideal = (m.idealRange[0] + m.idealRange[1]) / 2;
  const figures = Number.isFinite(m.value) && Number.isFinite(ideal)
    ? `${fmtValue(m.value)}, against an ideal of ${fmtValue(ideal)}`
    : null;

  // Alternates within a band rather than repeating one word, keyed off the
  // metric's position in the running order so the same face always narrates
  // identically — a rundown that reworded itself between two renders of one
  // scan would look like the measurement had changed.
  const pick = <T,>(options: T[]): T => options[index % options.length];

  let predicate: string;
  if (good >= 1.2) predicate = figures ? `of ${figures} — excellent` : "is excellent";
  else if (good >= 0.5) predicate = pick(["is good", "is a strength here", "holds up well"]);
  else if (strength < 0.5) predicate = pick(["is about average", "sits mid-pack", "lands near the middle"]);
  else {
    // Below the mean and worth naming: say WHICH WAY, not just "weak". "Weak
    // gonial angularity" tells a viewer nothing they can picture; "sits flatter
    // than ideal" tells them where to look and which direction it is off.
    //
    // The raw z carries the side of the mean; zEff carries whether that is
    // good. For a band metric both extremes are penalised, so the two disagree
    // and only z knows which extreme this face is on.
    const way =
      directionFor(m.def, sex) === "band"
        ? m.z > 0
          ? "sits above the ideal band"
          : "sits below the ideal band"
        : m.z > 0
          ? "reads higher than ideal"
          : "reads lower than ideal";
    predicate = good > -1.2 ? way.replace(/^(sits|reads) /, "$1 slightly ") : way;
  }

  const frame = FRAMES[index % FRAMES.length];
  const said = spokenName(m.def.name);
  return {
    line: (subject: string) => frame(subject, name, predicate),
    spoken: (subject: string) => frame(subject, said, predicate),
    positive,
  };
}

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
function selectBalanced(candidates: ScoredMetric[], limit: number): ScoredMetric[] {
  const byInterest = [...candidates].sort((a, b) => Math.abs(b.zEff) - Math.abs(a.zEff));
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

export function buildReelScript(report: Report, options: ReelScriptOptions): Beat[] {
  const limit = options.metricBeats ?? 10;
  const name = options.name;

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
  const candidates = report.metrics.filter(
    (m) =>
      !m.implausible &&
      Math.abs(m.zEff) >= NOTABLE_Z &&
      reliabilityOf(m.def.id) >= REEL_RELIABLE_MIN,
  );

  // Selection is by interest AND tone balance; the running order is by anatomy.
  // This sort is the last thing that touches the order — see selectBalanced.
  const byRegion = selectBalanced(candidates, limit).sort(
    (a, b) => REGION_ORDER.indexOf(a.def.region) - REGION_ORDER.indexOf(b.def.region),
  );

  const metricBeats: Beat[] = byRegion.map((m, i) => {
    const q = qualify(m, i, report.sex);
    return {
      kind: "metric" as const,
      line: q.line(name),
      spoken: q.spoken(name),
      metricId: m.def.id,
      region: m.def.region,
      positive: q.positive,
      badge: `${m.value.toFixed(m.def.decimals)}${m.def.unit}`,
    };
  });

  const pct = statedPct(report.overallPercentile);
  const beats: Beat[] = [
    { kind: "hook", line: `How attractive is ${name}?` },
    ...metricBeats,
    // The number and the curve, never the number alone — a score with no
    // distribution beside it gets read against a school mark, which is the
    // misreading this product exists to correct.
    //
    // Three beats rather than one. As a single block this ran eleven seconds
    // of unbroken narration at the exact moment a viewer is most likely to be
    // watching, and the renderer had nothing to cut on. Split, the number lands
    // alone, then the curve arrives as its own reveal.
    {
      kind: "score",
      line: `${name} measures ${report.overall.toFixed(1)} out of 10.`,
      badge: `${pct}th percentile`,
    },
    {
      kind: "score",
      line: `That's ${rarityShort(report.overallPercentile).toLowerCase()} of the reference set.`,
      badge: `${pct}th percentile`,
    },
    {
      kind: "score",
      line: `${spreadLine(report.sex)} ${SPREAD.median.toFixed(1)} is the exact middle.`,
    },
    // The verdict, and it is the beat the format was missing.
    //
    // A number is an argument; a name is a conclusion, and a conclusion is what
    // gets quoted in a comment section. Every competitor in this niche ends on
    // one. Ending on a percentile instead is ending on the working.
    //
    // It is the SAME ladder the app shows — analysisMode owns the bands, and a
    // second copy here is exactly the drift that module exists to prevent, so
    // this asks rather than restates. Which also means a video and the app can
    // never disagree about what a face is called.
    {
      kind: "score",
      line: `Verdict: ${verdictFor(report).word.toLowerCase()}.`,
      badge: verdictFor(report).word,
    },
  ];

  if (options.context?.length) {
    beats.push({
      kind: "context",
      // The fairness beat, and it is not only fairness. A breakdown that stops
      // at the face invites the subject's audience to argue with it; naming
      // what the face is not measuring ends the argument before it starts.
      line: `This measures a face and nothing else. ${name}: ${options.context.join(", ")}.`,
    });
  }

  if (options.note?.trim()) {
    beats.push({ kind: "context", line: options.note.trim() });
  }

  beats.push({
    kind: "cta",
    line: options.cta ?? "Want yours measured the same way? truemax.app",
  });

  return beats;
}

// A single narration block, for text-to-speech. Kept separate from the beats
// so the captions on screen and the voice track cannot drift.
export function narrationFrom(beats: Beat[]): string {
  return beats.map((b) => b.spoken ?? b.line).join(" ");
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
