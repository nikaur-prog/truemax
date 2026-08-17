import test from "node:test";
import assert from "node:assert/strict";
import { beatAt, buildTimeline, fitTimeline, typedFraction } from "./rundownTimeline.js";
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

test("fitting to real audio scales everything and keeps the order", () => {
  // The voice comes back as one file of unknown length, so the estimate gets
  // stretched onto it. Relative pacing must survive that.
  const timeline = buildTimeline(BEATS);
  const stretched = fitTimeline(timeline, timeline.duration * 1.25);

  assert.equal(Number(stretched.duration.toFixed(6)), Number((timeline.duration * 1.25).toFixed(6)));
  for (let i = 0; i < timeline.beats.length; i++) {
    assert.equal(
      Number(stretched.beats[i].start.toFixed(6)),
      Number((timeline.beats[i].start * 1.25).toFixed(6)),
    );
  }
  // Still contiguous after scaling, and the draw cues moved with their beats.
  for (const b of stretched.beats) {
    if (b.drawAt === undefined) continue;
    assert.ok(b.drawAt >= b.start && b.drawAt < b.start + b.duration);
  }
  for (const cue of stretched.sfx) {
    assert.ok(beatAt(stretched, cue.at), `cue at ${cue.at} fell outside every beat after scaling`);
  }
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
