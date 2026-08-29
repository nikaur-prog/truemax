import test from "node:test";
import assert from "node:assert/strict";
import {
  alignTimeline,
  beatAt,
  beatNear,
  buildTimeline,
  fitTimeline,
  spokenWeight,
  typedFraction,
} from "./rundownTimeline.js";
import { narrationFrom, narrationOffsets } from "./reelScript.js";
import type { Beat } from "./reelScript.js";

const BEATS: Beat[] = [
  { kind: "hook", line: "How attractive is LeBron James?" },
  {
    kind: "metric",
    line: "The facial width-to-height (fWHR) is excellent.",
    spoken: "The facial width to height is excellent.",
    metricId: "fwhr",
    region: "midface",
    positive: true,
    badge: "2.06",
  },
  { kind: "metric", line: "The jaw is good.", metricId: "gonialProxy", region: "jaw", positive: true },
  { kind: "score", line: "LeBron James measures 7.2 out of 10.", badge: "90th percentile" },
  { kind: "cta", line: "Want yours measured the same way? truemax.app" },
];

test("beats are contiguous — no overlap and no dead air", () => {
  // A gap between beats is silence the renderer has nothing to draw for, and an
  // overlap is two captions on screen at once.
  const timeline = buildTimeline(BEATS);
  for (let i = 1; i < timeline.beats.length; i++) {
    const previous = timeline.beats[i - 1];
    assert.equal(
      Number((previous.start + previous.duration).toFixed(6)),
      Number(timeline.beats[i].start.toFixed(6)),
      `beat ${i} does not start where beat ${i - 1} ends`,
    );
  }
  const last = timeline.beats[timeline.beats.length - 1];
  assert.equal(Number((last.start + last.duration).toFixed(6)), Number(timeline.duration.toFixed(6)));
});

test("a short line still gets long enough to look at", () => {
  // "The jaw is good." is four words — about 1.5s at the estimated rate, which
  // is not long enough to read a measurement drawn on a face.
  const timeline = buildTimeline(BEATS);
  const short = timeline.beats[2];
  assert.ok(short.duration >= 1.6, `short beat only ${short.duration}s`);
});

test("only beats that draw something get a click", () => {
  const timeline = buildTimeline(BEATS);
  const clicks = timeline.sfx.filter((c) => c.kind === "click");
  assert.equal(clicks.length, 2, "one click per metric beat, no more");
  for (const click of clicks) {
    const owner = beatAt(timeline, click.at)!;
    assert.ok(owner.beat.metricId, "a click landed on a beat that draws nothing");
  }
});

test("every sound effect lands inside the beat that owns it", () => {
  // A keystroke firing after its caption has gone is the kind of drift nobody
  // notices in code review and everybody notices in the video.
  const timeline = buildTimeline(BEATS);
  for (const cue of timeline.sfx) {
    assert.ok(cue.at >= 0 && cue.at < timeline.duration, `cue at ${cue.at} is outside the video`);
    assert.ok(beatAt(timeline, cue.at), `cue at ${cue.at} belongs to no beat`);
  }
});

test("sound effects are in chronological order", () => {
  // The mixer schedules them in sequence; out-of-order cues would still sound
  // right but make the mixing code's job ambiguous.
  const timeline = buildTimeline(BEATS);
  for (let i = 1; i < timeline.sfx.length; i++) {
    assert.ok(timeline.sfx[i].at >= timeline.sfx[i - 1].at);
  }
});

test("captions finish typing before their beat ends", () => {
  // A caption still being typed when the beat cuts has not been read.
  const timeline = buildTimeline(BEATS);
  for (const b of timeline.beats) {
    const atEnd = typedFraction(b, b.start + b.duration - 0.01);
    assert.equal(atEnd, 1, `caption still typing at the end of "${b.beat.line}"`);
  }
});

test("fitting to real audio allocates by spoken share, not by one scale factor", () => {
  // This test used to assert uniform scaling — every start multiplied by
  // actual/estimated. That is what produced the drift: the estimate adds a flat
  // GAP and a MIN_BEAT floor to every beat, both fixed costs that are a far
  // bigger share of a short beat than a long one, and scaling preserves that
  // surplus as a proportion. The error does not cancel across beats, it
  // accumulates, so the picture falls further behind the voice the longer the
  // video runs.
  //
  // The synthesiser reads at a roughly constant rate through one request, so a
  // beat's share of the WORDS is its share of the duration. That is the claim
  // being made here, and it is the whole fix.
  const timeline = buildTimeline(BEATS);
  const REAL = 40;
  const fitted = fitTimeline(timeline, REAL);

  // Weighted by how long each line takes to SAY, not by how many spaces are in
  // it. A word is not a unit of time — see spokenWeight.
  const words = (b: (typeof BEATS)[number]) => spokenWeight(b.spoken ?? b.line);
  const total = BEATS.reduce((a, b) => a + words(b), 0);

  fitted.beats.forEach((b, i) => {
    const want = (words(BEATS[i]) / total) * REAL;
    assert.ok(
      Math.abs(b.duration - want) < 1e-6,
      `beat ${i} got ${b.duration.toFixed(3)}s, spoken share says ${want.toFixed(3)}s`,
    );
  });

  // Contiguous, and summing to the audio EXACTLY. Any residue here is drift by
  // another name — a gap the picture spends waiting for a voice that has moved
  // on, or an overlap it never catches up from.
  let cursor = 0;
  for (const b of fitted.beats) {
    assert.ok(Math.abs(b.start - cursor) < 1e-9, `beat starts at ${b.start}, previous ended ${cursor}`);
    cursor += b.duration;
  }
  assert.ok(Math.abs(cursor - REAL) < 1e-6, `beats sum to ${cursor}, audio is ${REAL}`);
  assert.equal(Number(fitted.duration.toFixed(6)), REAL);

  // The draw cues moved with their beats rather than being rescaled from an
  // absolute time that no longer means anything.
  for (const b of fitted.beats) {
    if (b.drawAt === undefined) continue;
    assert.ok(b.drawAt >= b.start && b.drawAt < b.start + b.duration);
  }
  for (const cue of fitted.sfx) {
    assert.ok(beatAt(fitted, cue.at), `cue at ${cue.at} fell outside every beat after fitting`);
  }
});

test("a short beat does not steal time from the beats after it", () => {
  // The concrete symptom. The hook is four words and the estimate gives it
  // MIN_BEAT + GAP = 1.95s; the voice says it in well under half that. Under
  // the old uniform scaling that surplus survived, and every beat after the
  // hook started late by it — cumulatively, so the last beat was the worst.
  const timeline = buildTimeline(BEATS);
  const fitted = fitTimeline(timeline, 40);
  const hook = fitted.beats[0];
  const hookWords = spokenWeight(BEATS[0].spoken ?? BEATS[0].line);
  const allWords = BEATS.reduce((a, b) => a + spokenWeight(b.spoken ?? b.line), 0);
  // Its slice of the video is its slice of the script, and nothing else.
  assert.ok(
    Math.abs(hook.duration / 40 - hookWords / allWords) < 1e-9,
    `hook takes ${((hook.duration / 40) * 100).toFixed(1)}% of the video for ${((hookWords / allWords) * 100).toFixed(1)}% of the words`,
  );
});

test("fitting refuses nonsense rather than producing it", () => {
  // A failed synthesis reporting zero length must not collapse the video to
  // nothing — better to keep the estimate and be slightly out of sync.
  const timeline = buildTimeline(BEATS);
  assert.equal(fitTimeline(timeline, 0).duration, timeline.duration);
  assert.equal(fitTimeline(timeline, -3).duration, timeline.duration);
  assert.equal(fitTimeline(timeline, Number.NaN).duration, timeline.duration);
});

test("the timing is driven by what is SAID, not what is shown", () => {
  // The screen keeps "(fWHR)" and the voice does not, so a beat whose spoken
  // form is shorter must be timed by the spoken form — otherwise every beat
  // with a parenthetical sits in silence waiting for words nobody speaks.
  const shown: Beat[] = [{ kind: "metric", line: "a b c d e f g h i j k l", metricId: "x" }];
  const said: Beat[] = [{ kind: "metric", line: "a b c d e f g h i j k l", spoken: "a b", metricId: "x" }];
  assert.ok(buildTimeline(shown).duration > buildTimeline(said).duration);
});

test("beatAt is exclusive at the end so no time belongs to two beats", () => {
  const timeline = buildTimeline(BEATS);
  const first = timeline.beats[0];
  assert.equal(beatAt(timeline, first.start)!.beat.line, first.beat.line);
  assert.equal(beatAt(timeline, first.start + first.duration)!.beat.line, timeline.beats[1].beat.line);
  assert.equal(beatAt(timeline, timeline.duration), null);
});

// ---------------------------------------------------------------------------
// Fitting to the SPEECH rather than to the file.
// ---------------------------------------------------------------------------

test("the beats start where the talking starts, not where the file does", () => {
  // A synthesised mp3 opens with a little silence. Beats that begin at zero
  // begin before the voice does, and every one after them inherits the offset.
  const timeline = buildTimeline(BEATS);
  const fitted = fitTimeline(timeline, 40, 0.3);

  assert.ok(Math.abs(fitted.beats[0].start - 0.3) < 1e-9, `first beat starts at ${fitted.beats[0].start}`);

  // Contiguous from the offset, and ending at offset + speech. The duration is
  // where the beats END — the renderer asks with an absolute t, so a duration
  // that ignored the offset would put the last frames past the timeline.
  let cursor = 0.3;
  for (const b of fitted.beats) {
    assert.ok(Math.abs(b.start - cursor) < 1e-9, `beat starts at ${b.start}, previous ended ${cursor}`);
    cursor += b.duration;
  }
  assert.ok(Math.abs(cursor - 40.3) < 1e-6, `beats end at ${cursor}, expected 40.3`);
  assert.ok(Math.abs(fitted.duration - 40.3) < 1e-6, `duration is ${fitted.duration}`);

  // Every cue still lands inside a beat.
  for (const cue of fitted.sfx) {
    assert.ok(beatAt(fitted, cue.at), `cue at ${cue.at} fell outside every beat`);
  }
});

test("trailing silence in the file does not stretch the video", () => {
  // THE DRIFT, stated as an inequality. Fitting to a 41s file that holds 40s of
  // speech hands every beat 2.5% more time than the voice takes, and the error
  // accumulates: by the last beat the picture is most of a second behind.
  const timeline = buildTimeline(BEATS);
  const toFile = fitTimeline(timeline, 41);
  const toSpeech = fitTimeline(timeline, 40);
  const last = timeline.beats.length - 1;
  const lag = toFile.beats[last].start - toSpeech.beats[last].start;
  assert.ok(lag > 0.7, `fitting to the file only cost ${lag.toFixed(2)}s by the last beat`);
});

test("beatNear clamps instead of falling off either end", () => {
  // The renderer asks per frame and cannot be handed null. Before the offset
  // existed, "no beat here" only happened past the END, and the fallback was
  // the last beat — which with an offset would have opened the video on its own
  // sign-off card.
  const fitted = fitTimeline(buildTimeline(BEATS), 40, 0.5);
  assert.equal(beatNear(fitted, 0)!.beat.line, fitted.beats[0].beat.line);
  assert.equal(beatNear(fitted, 0.2)!.beat.line, fitted.beats[0].beat.line);
  assert.equal(beatNear(fitted, 1e6)!.beat.line, fitted.beats[fitted.beats.length - 1].beat.line);
  // And inside the timeline it agrees with beatAt exactly.
  for (let t = 0.5; t < 40; t += 0.37) {
    assert.equal(beatNear(fitted, t), beatAt(fitted, t), `disagreed at ${t.toFixed(2)}`);
  }
});

// ---------------------------------------------------------------------------
// Weighting by how long a line takes to SAY.
// ---------------------------------------------------------------------------

test("a decimal is weighted as the words it is read as", () => {
  // "7.2" is one whitespace-word and "seven point two" out loud. Weighted by
  // word count it was worth the same as "at", which is where a third of the
  // remaining caption lag was coming from.
  assert.equal(spokenWeight("7.2"), 4);
  assert.equal(spokenWeight("10"), 1);
  assert.equal(spokenWeight("6.4"), 3);
  assert.equal(spokenWeight("1.62"), 4);
  // An ordinal is the cardinal plus a syllable.
  assert.equal(spokenWeight("92nd"), 4);
});

test("an address is weighted with its dots spoken", () => {
  // "truemax dot app". The CTA beat is mostly short function words and then
  // this, so under word count it was the lightest beat in the video and the
  // voice took the longest over it.
  assert.equal(spokenWeight("truemax.app"), 4);
  assert.ok(spokenWeight("at truemax.app.") > spokenWeight("at the door."));
});

test("a percentage is heard as two words", () => {
  assert.equal(spokenWeight("40%"), 4); // "forty per cent"
});

test("syllable weight beats word count on the lines that were lagging", () => {
  // The diagnosis, as an inequality rather than a story. Both reported beats
  // are heavier per word than a measurement beat, so word count was handing
  // the measurement beats time that belonged to these two — and the lag showed
  // up on the run-up into them.
  const perWord = (line: string) => spokenWeight(line) / line.split(/\s+/).filter(Boolean).length;

  const metric =
    "Steph has a canthal tilt of 6.4 degrees, so the outer corner of the eye sits well above the inner and that's the hunter-eye look.";
  const cta = "Before the rating, go get yours at truemax.app.";
  const card = "The verdict: Mogger. A very attractive male. Steph measures 7.2 out of 10.";

  assert.ok(perWord(cta) > perWord(metric), `cta ${perWord(cta)} vs metric ${perWord(metric)}`);
  assert.ok(perWord(card) > perWord(metric), `card ${perWord(card)} vs metric ${perWord(metric)}`);
});

test("the weight is never zero, so no beat can be allocated no time", () => {
  // A beat with a duration of zero is a caption that never appears and a
  // measurement that never draws.
  for (const line of ["", "   ", "...", "—", "?"]) {
    assert.ok(spokenWeight(line) >= 1, `"${line}" weighed ${spokenWeight(line)}`);
  }
});

test("a silent e is not a syllable but a short word keeps its vowel", () => {
  assert.equal(spokenWeight("male"), 1);
  assert.equal(spokenWeight("the"), 1);
  assert.equal(spokenWeight("attractive"), 3);
});

// ---------------------------------------------------------------------------
// Exact alignment: the end of estimating.
// ---------------------------------------------------------------------------

/** A fake synthesiser that reads at a constant rate, so the maths is checkable. */
function alignmentFor(text: string, secondsPerChar = 0.05) {
  const characters = [...text];
  const starts = characters.map((_, i) => i * secondsPerChar);
  const ends = characters.map((_, i) => (i + 1) * secondsPerChar);
  return { characters, starts, ends };
}

test("beats are placed on the synthesiser's own timings", () => {
  const timeline = buildTimeline(BEATS);
  const text = narrationFrom(BEATS);
  const offsets = narrationOffsets(BEATS);
  const aligned = alignTimeline(timeline, alignmentFor(text), offsets);

  aligned.beats.forEach((b, i) => {
    // Beat i starts when its first character was spoken. Nothing estimated.
    assert.ok(Math.abs(b.start - offsets[i] * 0.05) < 1e-9, `beat ${i} starts at ${b.start}`);
    assert.ok(b.duration > 0, `beat ${i} has no duration`);
  });
});

test("no beat overlaps the next", () => {
  // The one thing exact timings could still get wrong: reading a beat's end off
  // the NEXT beat's first character would make every boundary an overlap.
  const aligned = alignTimeline(buildTimeline(BEATS), alignmentFor(narrationFrom(BEATS)), narrationOffsets(BEATS));
  for (let i = 1; i < aligned.beats.length; i++) {
    const previous = aligned.beats[i - 1];
    assert.ok(
      previous.start + previous.duration <= aligned.beats[i].start + 1e-9,
      `beat ${i - 1} runs into beat ${i}`,
    );
  }
});

test("the offsets line up with the paragraph that was actually sent", () => {
  // The whole alignment rests on this: the synthesiser indexes its timings
  // against the text it was handed, so an offset that does not point at the
  // right character times every caption to the wrong word. Asserted by reading
  // the beat's own text back out of the paragraph at its offset.
  const text = narrationFrom(BEATS);
  const offsets = narrationOffsets(BEATS);
  BEATS.forEach((beat, i) => {
    const spoken = beat.spoken ?? beat.line;
    assert.equal(text.slice(offsets[i], offsets[i] + spoken.length), spoken, `beat ${i}`);
  });
  assert.equal(offsets[BEATS.length], text.length, "the final offset is not the end of the text");
});

test("an unusable alignment falls back wholesale rather than in part", () => {
  // Splicing one estimated beat into a measured timeline would leave a single
  // line out of step with everything around it, which is the hardest possible
  // version of this bug to see.
  const timeline = buildTimeline(BEATS);
  const offsets = narrationOffsets(BEATS);
  const good = alignmentFor(narrationFrom(BEATS));

  assert.equal(alignTimeline(timeline, { characters: [], starts: [], ends: [] }, offsets), timeline);

  // A bad timestamp on a beat BOUNDARY takes the whole thing back to the
  // estimate. Only the boundaries are read — a beat's start and the end of its
  // last character — so those are the values that can poison a result, and a
  // NaN anywhere between them is genuinely harmless rather than merely
  // tolerated.
  const broken = { ...good, starts: [...good.starts] };
  broken.starts[offsets[3]] = Number.NaN;
  assert.equal(
    alignTimeline(timeline, broken, offsets),
    timeline,
    "a bad boundary timestamp was spliced in rather than refused",
  );

  // A beat whose end lands before its start — a synthesiser reporting times out
  // of order — is refused for the same reason.
  const inverted = { ...good, ends: [...good.ends] };
  inverted.ends[offsets[4] - 1] = -1;
  assert.equal(alignTimeline(timeline, inverted, offsets), timeline, "a negative span was accepted");
});

test("alignment beats the estimate on a voice that does not read evenly", () => {
  // The reason this exists. A synthesiser that slows down for the second half
  // of a read is something no character or syllable count predicts, and it is
  // the class of thing that put the caption behind twice.
  const text = narrationFrom(BEATS);
  const offsets = narrationOffsets(BEATS);
  const characters = [...text];
  const starts: number[] = [];
  const ends: number[] = [];
  let cursor = 0;
  characters.forEach((_, i) => {
    // Second half read at half speed.
    const rate = i < characters.length / 2 ? 0.04 : 0.08;
    starts.push(cursor);
    cursor += rate;
    ends.push(cursor);
  });

  const aligned = alignTimeline(buildTimeline(BEATS), { characters, starts, ends }, offsets);
  const fitted = fitTimeline(buildTimeline(BEATS), cursor);

  // The aligned timeline puts the last beat where the voice actually reaches
  // it; the estimate, which assumes an even read, does not.
  const last = aligned.beats.length - 1;
  assert.ok(Math.abs(aligned.beats[last].start - starts[offsets[last]]) < 1e-9);
  assert.ok(
    Math.abs(fitted.beats[last].start - starts[offsets[last]]) > 0.5,
    "the estimate happened to be right, so this test proves nothing",
  );
});
