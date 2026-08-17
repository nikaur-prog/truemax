import test from "node:test";
import assert from "node:assert/strict";
import { speechSpan } from "./rundownAudio.js";

// ---------------------------------------------------------------------------
// Finding the speech inside the file.
//
// This is the whole sync fix. fitTimeline shares the beats out across whatever
// duration it is handed, and it was being handed the length of the mp3 — which
// is longer than the narration inside it, because a synthesiser leaves silence
// at both ends. Every beat then gets a slice of a span that is too long, the
// error compounds, and by the end of the video the caption is most of a second
// behind the voice.
//
// A real AudioBuffer needs a browser. The function reads three properties, so
// three properties are what it is given — a fabricated buffer is a better test
// subject here than a real recording would be, because the silence can be put
// exactly where the assertion is about.
// ---------------------------------------------------------------------------

function buffer(samples: Float32Array, sampleRate = 44100): AudioBuffer {
  return {
    sampleRate,
    duration: samples.length / sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer;
}

/** Tone between `from` and `to` seconds, silence either side. */
function speech(total: number, from: number, to: number, sampleRate = 44100): AudioBuffer {
  const data = new Float32Array(Math.round(total * sampleRate));
  for (let i = Math.round(from * sampleRate); i < Math.round(to * sampleRate); i++) {
    // 220Hz at a realistic speech level. A tone rather than noise so the test
    // fails for a reason rather than a seed.
    data[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.6;
  }
  return buffer(data, sampleRate);
}

test("trailing silence is not counted as speech", () => {
  // The reported symptom, at the size it was reported: a file about a second
  // longer than the narration in it.
  const span = speechSpan(speech(41, 0.05, 40.1));
  assert.ok(span.end < 40.4, `span ends at ${span.end.toFixed(2)}, tail not trimmed`);
  assert.ok(span.end > 40.0, `span ends at ${span.end.toFixed(2)}, clipped the last word`);
});

test("leading silence is not counted as speech", () => {
  const span = speechSpan(speech(41, 0.4, 40.5));
  assert.ok(span.start > 0.3, `span starts at ${span.start.toFixed(2)}, head not trimmed`);
  assert.ok(span.start <= 0.4, `span starts at ${span.start.toFixed(2)}, clipped the first word`);
});

test("the span never clips the speech it found", () => {
  // Erring early is invisible; erring late is the entire complaint. The padding
  // exists to guarantee the direction of the error.
  for (const [from, to] of [
    [0, 30],
    [0.02, 29.5],
    [1.2, 28],
  ] as const) {
    const span = speechSpan(speech(30, from, to));
    assert.ok(span.start <= from + 1e-9, `start ${span.start} is after the speech at ${from}`);
    assert.ok(span.end >= to - 1e-9, `end ${span.end} is before the speech ends at ${to}`);
  }
});

test("a silent file resolves to the whole file rather than to nothing", () => {
  // A failed or empty synthesis must not collapse the timeline into zero
  // seconds. Keeping the file length leaves the video slightly out of sync,
  // which is the same place it was before any of this.
  const silent = speechSpan(buffer(new Float32Array(44100 * 5)));
  assert.equal(silent.start, 0);
  assert.ok(Math.abs(silent.end - 5) < 1e-6);

  const empty = speechSpan(buffer(new Float32Array(0)));
  assert.equal(empty.start, 0);
});

test("a file that is mostly silence is refused, not trusted", () => {
  // The guard against the detector being wrong in the dangerous direction. If
  // a quarter of a narration file looks like speech, the likelier explanation
  // is a bad threshold than a synthesiser that returned forty seconds of
  // nothing — and acting on it would compress the whole video into the first
  // quarter of its own audio, which is far worse than the drift being fixed.
  const span = speechSpan(speech(40, 0, 8));
  assert.equal(span.start, 0);
  assert.ok(Math.abs(span.end - 40) < 1e-6, `took the detector's word for it: ${span.end}`);
});

test("a quiet render is measured against its own level", () => {
  // The threshold is relative to the track's peak, so a narration mastered
  // eighteen decibels down is trimmed the same way a loud one is rather than
  // reading as silence end to end.
  const loud = speech(20, 0.5, 19);
  const quiet = buffer(Float32Array.from(loud.getChannelData(0), (v) => v * 0.12));
  const a = speechSpan(loud);
  const b = speechSpan(quiet);
  assert.ok(Math.abs(a.start - b.start) < 0.05, `${a.start} vs ${b.start}`);
  assert.ok(Math.abs(a.end - b.end) < 0.05, `${a.end} vs ${b.end}`);
});
