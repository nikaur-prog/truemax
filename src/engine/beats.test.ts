import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBeats, nearestDownbeat, onsetEnvelope, toMono } from "./beats.js";
import { beatsPerClipFor, planBeatCuts, suggestWindow } from "./beatPlan.js";

// ---------------------------------------------------------------------------
// A beat detector that cannot be checked is a beat detector nobody should cut
// to. These build click tracks at KNOWN tempos and demand the analysis recover
// them — not approximately, but to the precision the edit actually needs.
//
// The bar to clear: over a 20-second window, a cut must land within a frame of
// video (33ms) of its beat. That means the recovered period must be accurate to
// better than 33ms / 40 beats ≈ 0.8ms, which is far tighter than the 11.6ms
// analysis frame — and is exactly why the regression step exists.
// ---------------------------------------------------------------------------

const SR = 44100;

/**
 * A click track: a short percussive burst on every beat, with the downbeat
 * louder, over a quiet noise floor. Deterministic, so a failure is reproducible.
 */
function clickTrack(bpm: number, seconds: number, opts: { phase?: number; beatsPerBar?: number } = {}): Float32Array {
  const n = Math.round(SR * seconds);
  const out = new Float32Array(n);
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  // A room floor. Without it the envelope is zero between clicks, which is
  // cleaner than any real recording and would let a broken detector pass.
  for (let i = 0; i < n; i++) out[i] = rand() * 0.002;

  const period = 60 / bpm;
  const bar = opts.beatsPerBar ?? 4;
  const phase = opts.phase ?? 0;
  for (let k = 0; ; k++) {
    const t = phase + k * period;
    if (t >= seconds) break;
    const at = Math.round(t * SR);
    const loud = k % bar === 0 ? 1 : 0.55;
    // 25ms of decaying broadband noise: a drum hit's spectral signature, which
    // is what spectral flux is looking for.
    const len = Math.round(SR * 0.025);
    for (let i = 0; i < len && at + i < n; i++) {
      out[at + i] += rand() * loud * Math.exp((-i / len) * 6);
    }
  }
  return out;
}

test("the tempo of a click track is recovered exactly enough to cut on", () => {
  for (const bpm of [96, 120, 128, 140, 174]) {
    const grid = analyzeBeats(clickTrack(bpm, 40), SR);
    assert.ok(
      Math.abs(grid.bpm - bpm) < 0.5,
      `${bpm} BPM read as ${grid.bpm.toFixed(2)}`,
    );
    // The real requirement, stated as the thing it protects: forty beats out,
    // the grid must still be inside one video frame of the truth.
    const drift = Math.abs(grid.period - 60 / bpm) * 40;
    assert.ok(drift < 0.033, `drift over 40 beats was ${(drift * 1000).toFixed(1)}ms at ${bpm} BPM`);
    assert.ok(grid.confidence > 0.5, `confidence ${grid.confidence.toFixed(2)} at ${bpm} BPM`);
  }
});

test("the grid lands ON the clicks, not merely at the right spacing", () => {
  // A correct period with the wrong phase cuts on the off-beat, which sounds
  // worse than not trying. The beats must sit on the hits themselves.
  const phase = 0.31;
  const grid = analyzeBeats(clickTrack(128, 40, { phase }), SR);
  const period = 60 / 128;
  const nearest = grid.beats
    .map((t) => Math.abs(((t - phase) % period + period) % period))
    .map((d) => Math.min(d, period - d));
  const worst = Math.max(...nearest);
  assert.ok(worst < 0.02, `worst beat sat ${(worst * 1000).toFixed(1)}ms off the click`);
});

test("hats on every eighth do not drag the tempo off the beat", () => {
  // The ordinary case in the music people cut reels to, and the one that fools
  // a single-pass detector: twice as many onsets, evenly spaced, so the comb
  // locks onto the EIGHTH note. Folding that back gives the right tempo, but
  // the regression behind it was fitted through hats and drums together — two
  // populations at different strengths and slightly different timings. It read
  // 128 BPM as 127.85, which looks correct and drifts a frame and a half over
  // a twenty-second window. The fix is to fit again once the period is known.
  const SECONDS = 30;
  const n = SR * SECONDS;
  const audio = new Float32Array(n);
  let seed = 0x27d4eb2f;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  const hit = (t: number, tone: number, noise: number, gain: number, dec: number) => {
    const at = Math.round(t * SR);
    const len = Math.round(SR * dec);
    for (let i = 0; i < len && at + i < n; i++) {
      audio[at + i] +=
        (Math.sin((2 * Math.PI * tone * i) / SR) * (1 - noise) + rand() * noise) * gain * Math.exp((-i / len) * 5);
    }
  };
  const P = 60 / 128;
  for (let k = 0; k * P < SECONDS; k++) {
    const t = k * P;
    const bar = k % 4;
    if (bar === 0 || bar === 2) hit(t, 55, 0.15, 0.9, 0.12);
    if (bar === 1 || bar === 3) hit(t, 190, 0.75, 0.7, 0.09);
    hit(t, 9000, 0.95, 0.15, 0.03);
    hit(t + P / 2, 9000, 0.95, 0.12, 0.025); // the off-beat hat
  }
  const grid = analyzeBeats(audio, SR);
  assert.ok(Math.abs(grid.bpm - 128) < 0.1, `read as ${grid.bpm.toFixed(2)} BPM`);
  // Stated as the thing it protects: half a minute of beats without a video
  // frame of accumulated drift.
  const drift = Math.abs(grid.period - P) * 64;
  assert.ok(drift < 0.033, `drift over 64 beats was ${(drift * 1000).toFixed(1)}ms`);
});

test("a tempo outside the range people count in is folded, not reported raw", () => {
  // 240 BPM is heard and counted as 120. A grid claiming 240 would cut twice as
  // often as the music asks for.
  const grid = analyzeBeats(clickTrack(240, 40), SR);
  assert.ok(grid.bpm >= 90 && grid.bpm <= 180, `folded to ${grid.bpm.toFixed(1)}`);
});

test("silence is reported as unreadable rather than as a confident guess", () => {
  const grid = analyzeBeats(new Float32Array(SR * 5), SR);
  assert.ok(grid.confidence < 0.5, `silence claimed confidence ${grid.confidence}`);
});

test("the onset envelope spikes on hits and rests between them", () => {
  const env = onsetEnvelope(clickTrack(120, 8), SR);
  // Indices are found through the envelope's own latency, because that is the
  // contract every caller has to honour: a frame's flux peaks when the
  // transient reaches the middle of its window, so the frame that MEASURED a
  // hit sits about 23ms before the hit itself. Reading env.values[t * rate]
  // and expecting a peak is the mistake this test exists to document — it
  // lands two frames past the spike and reads zero.
  const at = (seconds: number) => Math.round((seconds - env.latency) * env.frameRate);
  let onBeat = 0;
  let offBeat = 0;
  for (let k = 2; k < 12; k++) {
    onBeat += env.values[at(k * 0.5)] ?? 0;
    offBeat += env.values[at((k + 0.5) * 0.5)] ?? 0;
  }
  assert.ok(onBeat > offBeat * 3, `on-beat ${onBeat.toFixed(1)} vs off-beat ${offBeat.toFixed(1)}`);
});

test("the downbeat is found in the bass, not in whatever is loudest", () => {
  // A kick-snare pattern is the case that breaks the obvious approach: the
  // snare is broadband and throws far more spectral flux than the kick, so
  // scoring bars on total onset energy puts the "one" on beat two. Here beat 0
  // is a low thud and beat 2 a bright crack of equal loudness; the bar must be
  // found on the thud.
  const SECONDS = 24;
  const n = SR * SECONDS;
  const audio = new Float32Array(n);
  let seed = 0x5bd1e995;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  const period = 60 / 120;
  const hit = (t: number, tone: number, noise: number) => {
    const at = Math.round(t * SR);
    const len = Math.round(SR * 0.09);
    for (let i = 0; i < len && at + i < n; i++) {
      const e = Math.exp((-i / len) * 5);
      audio[at + i] += (Math.sin((2 * Math.PI * tone * i) / SR) * (1 - noise) + rand() * noise) * 0.8 * e;
    }
  };
  for (let k = 0; k * period < SECONDS; k++) {
    if (k % 4 === 0) hit(k * period, 55, 0.1); // the one: low
    if (k % 4 === 2) hit(k * period, 220, 0.9); // the three: bright
  }
  const grid = analyzeBeats(audio, SR);
  // The assertion is about WHERE the bars land in the music, not about the
  // index they carry: the grid's first beat is simply the earliest one at or
  // after zero, so which array index is the downbeat is an arbitrary rotation.
  // Kicks are on even seconds here and snares on odd ones, so every bar start
  // must be near an even second.
  const barStarts: number[] = [];
  for (let i = grid.downbeatOffset; i < grid.beats.length; i += grid.beatsPerBar) barStarts.push(grid.beats[i]);
  assert.ok(barStarts.length >= 8, `only ${barStarts.length} bars found`);
  for (const t of barStarts.slice(1, 9)) {
    const nearest = Math.round(t);
    assert.equal(nearest % 2, 0, `a bar started at ${t.toFixed(3)}s — that is the snare, not the kick`);
    assert.ok(Math.abs(t - nearest) < 0.05, `a bar start sat ${(Math.abs(t - nearest) * 1000).toFixed(0)}ms off the hit`);
  }
});

test("mono folding averages rather than sums", () => {
  // Summing clips a two-channel file into distortion, and distortion is itself
  // a broadband transient — it would read as an onset on every frame.
  const mono = toMono([new Float32Array([1, 1]), new Float32Array([0, -1])]);
  assert.deepEqual([...mono], [0.5, 0]);
});

// --- the planner ----------------------------------------------------------

const gridAt = (bpm: number, seconds = 60) => ({
  bpm,
  period: 60 / bpm,
  beats: Array.from({ length: Math.floor(seconds / (60 / bpm)) }, (_, i) => i * (60 / bpm)),
  downbeatOffset: 0,
  beatsPerBar: 4,
  confidence: 1,
});

test("the window length a given number of clips needs", () => {
  // The number the UI puts in front of the user before they go hunting for a
  // section: twelve clips at two beats, at 128 BPM, is 11.25 seconds.
  const w = suggestWindow(128, 12, 2);
  assert.equal(w.beats, 24);
  assert.equal(w.bars, 6);
  assert.ok(Math.abs(w.seconds - 11.25) < 1e-9);
});

test("a window the user already chose gives whole beats per clip", () => {
  // 20 seconds at 128 BPM is 42 whole beats; across 12 clips that is 3 each.
  assert.equal(beatsPerClipFor(gridAt(128), 20, 12), 3);
  // Never below one — a clip shorter than a beat is a flash frame.
  assert.equal(beatsPerClipFor(gridAt(128), 1, 12), 1);
});

test("every cut lands on a beat and the clips tile the window exactly", () => {
  const grid = gridAt(128);
  const plan = planBeatCuts({ grid, clipCount: 7, beatsPerClip: 2, songStart: 0 });
  assert.equal(plan.cuts.length, 7);
  for (const c of plan.cuts) {
    const beatsIn = c.start / grid.period;
    assert.ok(Math.abs(beatsIn - Math.round(beatsIn)) < 1e-9, "a cut fell between beats");
  }
  // No gaps, no overlaps, and the last cut ends exactly at the window's end.
  for (let i = 1; i < plan.cuts.length; i++) {
    assert.ok(Math.abs(plan.cuts[i].start - plan.cuts[i - 1].end) < 1e-9);
  }
  assert.ok(Math.abs(plan.cuts[plan.cuts.length - 1].end - plan.duration) < 1e-9);
});

test("leftover beats lengthen the first and last clip, never a middle one", () => {
  // 5 clips over 17 beats: 3 each with 2 spare. The spares open and close.
  const plan = planBeatCuts({ grid: gridAt(120), clipCount: 5, beatsPerClip: 3.4, songStart: 0 });
  const beats = plan.cuts.map((c) => c.beats);
  assert.equal(beats.reduce((a, b) => a + b, 0), plan.duration / (60 / 120));
  assert.ok(beats[0] >= beats[1], "the opening shot should not be the shortest");
  assert.ok(beats[beats.length - 1] >= beats[beats.length - 2], "the closing shot should not be the shortest");
});

test("the reveal starts exactly on the drop, not near it", () => {
  const grid = gridAt(128);
  const drop = 8 * grid.period; // eight beats in
  const plan = planBeatCuts({
    grid,
    clipCount: 8,
    beatsPerClip: 2,
    songStart: 0,
    dropAt: drop,
    clipsBeforeDrop: 4,
  });
  const reveal = plan.cuts.find((c) => c.onDrop);
  assert.ok(reveal, "no clip was marked as the reveal");
  assert.ok(Math.abs(reveal!.start - drop) < 1e-9, "the reveal did not land on the drop");
  // And the halves still tile: four clips before, four after, nothing dropped.
  assert.equal(plan.cuts.length, 8);
  assert.equal(plan.cuts.filter((c) => c.start < drop).length, 4);
});

test("a drop outside the window is ignored rather than bending the edit", () => {
  const grid = gridAt(128);
  const plan = planBeatCuts({ grid, clipCount: 6, beatsPerClip: 2, songStart: 0, dropAt: 999 });
  assert.equal(plan.cuts.length, 6);
  assert.equal(plan.cuts.some((c) => c.onDrop), false);
});

test("no clip is ever silently lost to a drop placed early or late", () => {
  // The bug this pins: a drop two beats into the window with five clips asked
  // for before it gave three of them zero beats, and zero-beat clips are not
  // rendered — five cuts appeared for eight attached clips, with a silent
  // hole. The requested split is now honoured only as far as the beats can
  // carry it, so every clip keeps at least one beat.
  const grid = gridAt(120);
  const early = planBeatCuts({ grid, clipCount: 8, beatsPerClip: 2, songStart: 0, dropAt: 1.0, clipsBeforeDrop: 5 });
  assert.equal(early.cuts.length, 8, `early drop lost ${8 - early.cuts.length} clips`);
  assert.ok(early.cuts.every((c) => c.beats >= 1));
  assert.ok(early.cuts.some((c) => c.onDrop));
  const late = planBeatCuts({ grid, clipCount: 8, beatsPerClip: 2, songStart: 0, dropAt: 7.5, clipsBeforeDrop: 2 });
  assert.equal(late.cuts.length, 8, `late drop lost ${8 - late.cuts.length} clips`);
  // And the cuts still tile: no gap, no overlap, ending at the stated duration.
  for (let i = 1; i < early.cuts.length; i++) {
    assert.ok(Math.abs(early.cuts[i].start - early.cuts[i - 1].end) < 1e-9);
  }
  assert.equal(early.cuts[0].start, 0);
  assert.ok(Math.abs(early.cuts[early.cuts.length - 1].end - early.duration) < 1e-9);
});

test("a single clip ignores the drop instead of starting mid-window", () => {
  // One clip has nothing to cut TO the drop from. Honouring it began the only
  // clip at the drop, leaving dead air from the window's start to the reveal.
  const plan = planBeatCuts({ grid: gridAt(120), clipCount: 1, beatsPerClip: 4, songStart: 0, dropAt: 1.0 });
  assert.equal(plan.cuts.length, 1);
  assert.equal(plan.cuts[0].start, 0);
  assert.equal(plan.cuts[0].onDrop, undefined);
});

test("a fractional pace cannot run the last cut past the stated duration", () => {
  // 6 x 3.4 beats claims 20.4 beats of duration while integer shares sum to
  // 21 — the final cut overran the music window. The total is rounded first.
  const plan = planBeatCuts({ grid: gridAt(120), clipCount: 6, beatsPerClip: 3.4, songStart: 0 });
  const sum = plan.cuts.reduce((a, c) => a + c.beats, 0);
  assert.equal(sum * (60 / 120), plan.duration);
  assert.ok(Math.abs(plan.cuts[plan.cuts.length - 1].end - plan.duration) < 1e-9);
});

test("the detector is not tied to 44.1kHz", () => {
  const sr = 48000;
  const n = sr * 30;
  const audio = new Float32Array(n);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  const period = 60 / 128;
  for (let k = 0; k * period < 30; k++) {
    const at = Math.round(k * period * sr);
    const len = Math.round(sr * 0.025);
    for (let i = 0; i < len && at + i < n; i++) {
      audio[at + i] += rand() * (k % 4 === 0 ? 1 : 0.55) * Math.exp((-i / len) * 6);
    }
  }
  const grid = analyzeBeats(audio, sr);
  assert.ok(Math.abs(grid.bpm - 128) < 0.5, `48kHz read as ${grid.bpm.toFixed(2)}`);
  assert.ok(grid.confidence > 0.5);
});

test("the window start snaps to a bar, so the music does not begin mid-phrase", () => {
  const grid = gridAt(120); // 0.5s beats, 2s bars
  const plan = planBeatCuts({ grid, clipCount: 4, beatsPerClip: 4, songStart: 5.3 });
  assert.ok(Math.abs(plan.songStart - 6) < 1e-9, `snapped to ${plan.songStart}`);
  assert.equal(nearestDownbeat(grid, 5.3), 6);
});

test("a pinned clip gets exactly the beats it asked for, the pace fills the rest", () => {
  const grid = gridAt(120);
  const plan = planBeatCuts({
    grid, clipCount: 4, beatsPerClip: 2, songStart: 0,
    beatOverrides: [null, 6, null, null],
  });
  const beats = plan.cuts.map((c) => c.beats);
  // Pace mode: the window GROWS for the pin — 2+6+2+2 = 12 beats.
  assert.deepEqual(beats, [2, 6, 2, 2]);
  assert.ok(Math.abs(plan.duration - 12 * grid.period) < 1e-9);
});

test("pins inside a fixed window are honoured and the window never shrinks a pin", () => {
  const grid = gridAt(120);
  // Fit 10 beats with one clip pinned to 6: the other three share the 4 left.
  const plan = planBeatCuts({
    grid, clipCount: 4, songStart: 0, totalBeats: 10,
    beatOverrides: [null, 6, null, null],
  });
  const beats = plan.cuts.map((c) => c.beats);
  assert.equal(beats[1], 6);
  assert.equal(beats.reduce((a, b) => a + b, 0), 10);
  // A window too small for the pins grows rather than trimming them silently.
  const grown = planBeatCuts({
    grid, clipCount: 3, songStart: 0, totalBeats: 4,
    beatOverrides: [4, 4, null],
  });
  assert.deepEqual(grown.cuts.map((c) => c.beats), [4, 4, 1]);
});

test("pins before the drop yield to the drop; pins after it extend the window", () => {
  const grid = gridAt(120);
  const drop = 4 * grid.period;
  const plan = planBeatCuts({
    grid, clipCount: 4, beatsPerClip: 2, songStart: 0,
    dropAt: drop, clipsBeforeDrop: 2,
    // The first clip asks for 8 beats but only 4 exist before the drop:
    // the reveal must not move, so the pin is capped. The last clip's 6
    // extends the window's end instead — same music, playing longer.
    beatOverrides: [8, null, null, 6],
  });
  const reveal = plan.cuts.find((c) => c.onDrop);
  assert.ok(Math.abs(reveal!.start - drop) < 1e-9, "the reveal moved off the drop");
  const beats = plan.cuts.map((c) => c.beats);
  assert.equal(beats[0] + beats[1], 4, "the before side must fill exactly the drop's beats");
  assert.equal(beats[3], 6, "the after-side pin was not honoured");
  // Still tiles exactly.
  for (let i = 1; i < plan.cuts.length; i++) {
    assert.ok(Math.abs(plan.cuts[i].start - plan.cuts[i - 1].end) < 1e-9);
  }
  assert.ok(Math.abs(plan.cuts[plan.cuts.length - 1].end - plan.duration) < 1e-9);
});
