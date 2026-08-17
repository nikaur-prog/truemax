import test from "node:test";
import assert from "node:assert/strict";
import { beatAt, beatNear, buildTimeline, fitTimeline, typedFraction } from "./rundownTimeline.js";
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

test("fitting to real audio allocates by word share, not by one scale factor", () => {
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

  const words = (b: (typeof BEATS)[number]) =>
    (b.spoken ?? b.line).split(/\s+/).filter(Boolean).length;
  const total = BEATS.reduce((a, b) => a + words(b), 0);

  fitted.beats.forEach((b, i) => {
    const want = (words(BEATS[i]) / total) * REAL;
    assert.ok(
      Math.abs(b.duration - want) < 1e-6,
      `beat ${i} got ${b.duration.toFixed(3)}s, word share says ${want.toFixed(3)}s`,
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
  const hookWords = (BEATS[0].spoken ?? BEATS[0].line).split(/\s+/).filter(Boolean).length;
  const allWords = BEATS.reduce(
    (a, b) => a + (b.spoken ?? b.line).split(/\s+/).filter(Boolean).length,
    0,
  );
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
