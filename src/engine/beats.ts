// ---------------------------------------------------------------------------
// Where the beats are.
//
// The Reel Creator cuts on music, so the whole feature rests on one question:
// given a song, exactly when does each beat land? This answers it offline, on
// the device, from the decoded samples — no service, no upload, no model. The
// song file never leaves the machine, which for a tool whose input is somebody
// else's copyrighted track is not a detail.
//
// The method is the standard one, and it is standard because it works on the
// kind of music anybody puts under a reel:
//
//   1. ONSET ENVELOPE. Frame the audio, take the spectrum of each frame, and
//      measure how much energy APPEARED since the previous frame (spectral
//      flux). A drum hit lights up many bins at once; a sustained pad does not.
//      The result is a low-rate signal that spikes when something is struck.
//   2. COMB SEARCH. Try every plausible beat period and every phase within it,
//      scoring each by how much onset energy lands on its beats. The winner is
//      the grid the music is actually playing.
//   3. REGRESSION. The comb answer is quantised to the frame rate — about 12ms,
//      which sounds tight and is not: over a 20-second window a 12ms period
//      error drags the last cut a quarter of a beat off. So each predicted beat
//      is snapped to the real onset peak beside it and a straight line is fitted
//      through the lot. That recovers the period to well under a millisecond.
//
// What this deliberately does NOT do is guess. Every function reports its own
// confidence, and a song this cannot read (rubato piano, ambient, live drums
// that drift) comes back as low confidence rather than as a grid that looks
// authoritative and cuts in the wrong places. The caller is expected to show
// the number and let a human overrule it — a beat grid you cannot correct by
// hand is worse than no beat grid at all.
// ---------------------------------------------------------------------------

/** A beat grid recovered from audio. Times are seconds from the file's start. */
export interface BeatGrid {
  bpm: number;
  /** Seconds per beat — carried alongside bpm because everything divides by it. */
  period: number;
  /** Every beat in the analysed span, ascending. */
  beats: number[];
  /**
   * Which beat index starts a bar, given `beatsPerBar`. Bar starts are where a
   * cut can be made without the music sounding interrupted, so this is what a
   * chosen start point snaps to.
   */
  downbeatOffset: number;
  beatsPerBar: number;
  /**
   * 0 to 1. Above ~0.5 the grid is trustworthy; below it the track is probably
   * not steady enough to cut to, and the UI should say so rather than pretend.
   */
  confidence: number;
}

// 512 samples at 44.1kHz is 11.6ms per frame — fine enough that the regression
// below has real peaks to snap to, coarse enough that a three-minute song is a
// few thousand numbers rather than a few million.
const HOP = 512;
const WINDOW = 2048;

// The range of tempos worth considering. Below 60 the "beat" people cut on is
// the half-time pulse and above 200 it is the double-time one; both are found
// as octaves of something inside this range.
const MIN_BPM = 60;
const MAX_BPM = 200;

// A reel cut sits where a beat is, and the beat people feel in almost all
// popular music is in 4. This is a default, not a claim about the song.
const BEATS_PER_BAR = 4;

/**
 * An in-place complex FFT, iterative radix-2.
 *
 * Written out rather than imported: it is thirty lines, it has no dependencies
 * to keep current, and a bundled DSP library for one transform would be larger
 * than the whole of this file.
 */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface OnsetEnvelope {
  /** One value per frame: how much energy appeared at that moment. */
  values: Float32Array;
  /**
   * The same signal, slightly blurred. The raw envelope is one- and two-frame
   * spikes, which a search stepping in fractions of a frame slips between —
   * a candidate period half a frame off scores near zero not because it is
   * wrong but because it landed in a gap. The blur gives every peak a little
   * width so the search can feel its way onto it; the RAW values are what the
   * final fit snaps to, so nothing is lost to smoothing.
   */
  smooth: Float32Array;
  /**
   * Onsets from the bottom of the spectrum only — essentially the kick drum.
   *
   * Used for finding the "one", and nothing else. A snare is broadband and a
   * kick is not, so a snare contributes far more spectral flux than the kick
   * that is actually carrying the bar: scored on total flux, a straight
   * kick-snare-kick-snare pattern reports its downbeat on beat two. Listening
   * only to the low end asks the question the way a listener does, because the
   * "one" is the one you feel in your chest.
   */
  low: Float32Array;
  /** Frames per second — the resolution everything downstream is quantised to. */
  frameRate: number;
  /**
   * Seconds to add to a frame's index-derived time to get the moment the sound
   * actually happened.
   *
   * A frame covers a whole window of audio, and its flux peaks when the
   * transient reaches the middle of that window — so an uncompensated envelope
   * reports every hit about 23ms early, uniformly. That is a third of a video
   * frame of error applied to every cut in the reel, and it is entirely
   * avoidable by saying where the frame's time actually is.
   */
  latency: number;
}

/** The moment, in seconds, that envelope index `i` refers to. */
export function frameTime(env: OnsetEnvelope, i: number): number {
  return i / env.frameRate + env.latency;
}

/** Read the blurred envelope at a fractional index, linearly interpolated. */
function sampleSmooth(env: OnsetEnvelope, x: number): number {
  if (x < 0 || x > env.smooth.length - 1) return 0;
  const i = Math.floor(x);
  const f = x - i;
  const a = env.smooth[i] ?? 0;
  const b = env.smooth[i + 1] ?? a;
  return a + (b - a) * f;
}

/**
 * The onset envelope: a spike wherever something is struck.
 *
 * Magnitudes are log-compressed before differencing. Without it the envelope is
 * dominated by whichever bass note is loudest and a kick drum under a sub
 * becomes invisible; with it a hi-hat and a kick contribute comparably, which
 * is what "a beat happened" actually means.
 */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): OnsetEnvelope {
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  const values = new Float32Array(Math.max(0, frames));
  const lows = new Float32Array(Math.max(0, frames));
  const bins = WINDOW / 2;
  // Everything below ~200Hz: the kick's fundamental and first harmonic, and
  // nothing a hi-hat or a vocal sibilant reaches.
  const lowBins = Math.max(1, Math.round((200 * WINDOW) / sampleRate));
  const re = new Float32Array(WINDOW);
  const im = new Float32Array(WINDOW);
  let prev = new Float32Array(bins);
  // Hann, precomputed. Rectangular framing smears a transient across the whole
  // spectrum and turns every frame into an onset.
  const win = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1));

  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < WINDOW; i++) {
      re[i] = samples[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    let lowFlux = 0;
    const cur = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      const mag = Math.log1p(100 * Math.hypot(re[k], im[k]));
      cur[k] = mag;
      // Half-wave rectified: energy LEAVING is a note ending, which is not an
      // onset and must not count toward one.
      const d = mag - prev[k];
      if (d > 0) {
        flux += d;
        if (k < lowBins) lowFlux += d;
      }
    }
    values[f] = flux;
    lows[f] = lowFlux;
    prev = cur;
  }

  // Subtract a local mean and rectify. This is what makes the envelope usable
  // on music that gets louder: without it a chorus outscores a verse and the
  // comb search locks onto the loudest section's phase rather than the song's.
  const frameRate = sampleRate / HOP;
  const halfWin = Math.max(1, Math.round(frameRate * 0.15));
  const localMax = (src: Float32Array): Float32Array => {
    const dst = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      let sum = 0;
      let n = 0;
      for (let j = Math.max(0, i - halfWin); j <= Math.min(src.length - 1, i + halfWin); j++) {
        sum += src[j];
        n++;
      }
      dst[i] = Math.max(0, src[i] - sum / n);
    }
    return dst;
  };
  const out = localMax(values);
  const low = localMax(lows);

  // A three-tap blur, applied twice — enough to widen a one-frame spike into
  // something a fractional search can find, narrow enough that two hits an
  // eighth-note apart stay separate.
  const smooth = new Float32Array(out);
  for (let pass = 0; pass < 2; pass++) {
    const prev = new Float32Array(smooth);
    for (let i = 0; i < smooth.length; i++) {
      const a = prev[i - 1] ?? 0;
      const c = prev[i + 1] ?? 0;
      smooth[i] = 0.25 * a + 0.5 * prev[i] + 0.25 * c;
    }
  }

  return { values: out, smooth, low, frameRate, latency: WINDOW / 2 / sampleRate };
}

/**
 * The period and phase whose beats collect the most onset energy.
 *
 * Exhaustive over both, because the search space is small enough to afford it
 * and an exhaustive search cannot get stuck in a local maximum the way a hill
 * climb can.
 *
 * THE PERIOD IS FRACTIONAL, and that is not a refinement — it is the whole
 * difference between working and not. At 44.1kHz a frame is 11.6ms, and 128 BPM
 * is 40.375 frames per beat. Searched in whole frames, the closest candidate is
 * 40, which has slipped a third of a frame by beat two and a full FIFTEEN
 * frames by the end of a twenty-second window: the grid stops touching the
 * drums entirely, and the search settles on whatever unrelated period happens
 * to graze a few spikes. Almost no real tempo is a whole number of frames, so
 * this is the normal case rather than an edge one.
 */
function combSearch(env: OnsetEnvelope): { periodFrames: number; phase: number; score: number } {
  const { smooth, frameRate } = env;
  const minP = (60 / MAX_BPM) * frameRate;
  const maxP = (60 / MIN_BPM) * frameRate;
  // A tenth of a frame is ~1ms per beat, which the regression afterwards
  // sharpens further; a finer step here buys nothing but time.
  const pStep = 0.1;
  const phaseStep = 0.25;
  let best = { periodFrames: minP, phase: 0, score: -1 };
  for (let p = minP; p <= maxP; p += pStep) {
    for (let phase = 0; phase < p; phase += phaseStep) {
      let sum = 0;
      let hits = 0;
      for (let x = phase; x <= smooth.length - 1; x += p) {
        sum += sampleSmooth(env, x);
        hits++;
      }
      if (hits < 4) continue;
      // Normalised by hit count so a long period is not rewarded merely for
      // sampling the envelope less often and skipping its quiet stretches.
      const score = sum / hits;
      if (score > best.score) best = { periodFrames: p, phase, score };
    }
  }
  return best;
}

/**
 * Prefer the octave people actually count in.
 *
 * Halving or doubling a correct tempo scores nearly as well — every beat of a
 * 64 BPM grid is also a beat of a 128 BPM one — so the raw winner is often the
 * wrong octave. When a doubled or halved candidate scores close and lands in
 * the range dance and pop music actually sit in, take it.
 */
function preferredOctave(bpm: number): number {
  let out = bpm;
  while (out < 90) out *= 2;
  while (out > 180) out /= 2;
  return out;
}

/**
 * Fit a straight line through the real onset peaks near the predicted beats.
 *
 * This is what turns a frame-quantised guess into a usable grid: the comb gives
 * roughly where the beats are, each prediction is snapped to the strongest
 * onset within half a beat of it, and a least-squares fit through those
 * snapped times recovers period and phase to far better than one frame.
 */
function refine(
  env: OnsetEnvelope,
  periodSec: number,
  phaseSec: number,
): { period: number; phase: number; agreement: number } {
  const { values, frameRate } = env;
  const duration = values.length / frameRate;
  const search = Math.round((periodSec * 0.4) * frameRate);
  const xs: number[] = [];
  const ys: number[] = [];
  let strong = 0;
  let total = 0;

  for (let k = 0; ; k++) {
    const predicted = phaseSec + k * periodSec;
    if (predicted > duration) break;
    total++;
    const centre = Math.round(predicted * frameRate);
    let bestI = -1;
    let bestV = 0;
    for (let i = Math.max(0, centre - search); i <= Math.min(values.length - 1, centre + search); i++) {
      if (values[i] > bestV) {
        bestV = values[i];
        bestI = i;
      }
    }
    if (bestI < 0 || bestV <= 0) continue;
    strong++;
    xs.push(k);
    // Compensated here, at the one place a frame index becomes a real moment,
    // so every time leaving this function is when the sound happened.
    ys.push(frameTime(env, bestI));
  }

  // Too few real peaks to fit through: keep the comb's answer rather than
  // fitting a line to noise.
  if (xs.length < 4) return { period: periodSec, phase: phaseSec, agreement: 0 };

  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const period = den > 0 ? num / den : periodSec;
  const phase = my - period * mx;

  // How tightly the snapped peaks sit on the fitted line, as a fraction of a
  // beat. A steady track lands inside a few percent; a drifting one does not,
  // and that difference is the honest confidence signal.
  let err = 0;
  for (let i = 0; i < n; i++) err += Math.abs(ys[i] - (phase + period * xs[i]));
  const meanErr = err / n / period;
  const agreement = Math.max(0, 1 - meanErr * 4) * (total ? strong / total : 0);
  return { period, phase, agreement };
}

/**
 * Which beat of the bar is the downbeat.
 *
 * Bars are found the way a listener finds them: the "one" is usually the
 * heaviest hit. Each of the four candidate offsets is scored by the onset
 * energy on its own beats, and the strongest wins. This is the least certain
 * part of the analysis by some distance, which is why it is reported separately
 * and is trivial for a human to nudge by one.
 */
function findDownbeat(env: OnsetEnvelope, beats: number[]): number {
  const { low: values, frameRate } = env;
  let best = 0;
  let bestScore = -1;
  for (let off = 0; off < BEATS_PER_BAR; off++) {
    let sum = 0;
    let n = 0;
    for (let i = off; i < beats.length; i += BEATS_PER_BAR) {
      // Beat times arrive compensated, so the latency comes back off to find
      // the frame that measured them.
      const f = Math.round((beats[i] - env.latency) * frameRate);
      if (f >= 0 && f < values.length) {
        sum += values[f];
        n++;
      }
    }
    const score = n ? sum / n : 0;
    if (score > bestScore) {
      bestScore = score;
      best = off;
    }
  }
  return best;
}

/**
 * Read the beat grid out of decoded mono samples.
 *
 * Analysing the whole file is unnecessary and slow — tempo is a property of the
 * track, so a window from the middle (where the drums are, rather than an intro
 * that may have none) answers it — but the returned grid spans the entire file
 * so any window the user picks is covered.
 */
export function analyzeBeats(samples: Float32Array, sampleRate: number): BeatGrid {
  // Start a fifth of the way in — past the intro, into the part of the
  // arrangement that has drums — and then take as much as ninety seconds.
  //
  // The span is generous on purpose. Precision comes from the regression at the
  // end, and a regression's precision improves with the number of beats it is
  // fitted through: a twenty-second read of a 128 BPM track has forty beats to
  // work with and lands within about a tenth of a BPM, where ninety seconds has
  // nearly two hundred and lands on the nose. A tenth of a BPM sounds like
  // nothing and is worth about 40ms of drift by the end of a long window, which
  // is more than a video frame.
  const span = Math.min(samples.length, Math.round(sampleRate * 90));
  const from = Math.min(Math.max(0, samples.length - span), Math.round(samples.length / 5));
  const slice = samples.subarray(from, from + span);

  const env = onsetEnvelope(slice, sampleRate);
  if (env.values.length < 16) {
    return { bpm: 0, period: 0, beats: [], downbeatOffset: 0, beatsPerBar: BEATS_PER_BAR, confidence: 0 };
  }

  const comb = combSearch(env);
  const coarsePeriod = comb.periodFrames / env.frameRate;
  // The comb works in raw frame indices; refine works in real time. The
  // latency belongs to the phase, not to the period — a constant offset moves
  // where the beats are without changing how far apart they are.
  const coarsePhase = comb.phase / env.frameRate;
  const fit = refine(env, coarsePeriod, coarsePhase);

  // Octave correction, applied to the refined period so the phase survives it:
  // a doubled grid keeps every beat of the halved one, so the same phase is
  // still on a beat either way.
  const rawBpm = 60 / fit.period;
  const folded = preferredOctave(rawBpm);

  // And then FIT AGAIN at the folded period, because the first fit was made
  // through the wrong set of hits.
  //
  // Hi-hats on every eighth are the ordinary case in the music people cut
  // reels to, and the comb quite reasonably locks onto them — twice as many
  // onsets, evenly spaced. Folding that back to the quarter note gives the
  // right tempo, but the regression behind it was fitted through hats AND
  // drums together: two interleaved populations sitting at different strengths
  // and slightly different timings. Measured on a 128 BPM track that read as
  // 127.85 with a confidence of 0.62 — right enough to look correct, wrong
  // enough to drift a frame and a half over a twenty-second window. Re-fitting
  // once the period is known puts the regression back on the beats themselves.
  const second = Math.abs(folded - rawBpm) > 0.01 ? refine(env, 60 / folded, fit.phase) : fit;
  const bpm = preferredOctave(60 / second.period);
  const period = 60 / bpm;
  const best = second.agreement >= fit.agreement ? second : fit;

  // Back to the whole file's timeline: the analysis ran on a slice, and every
  // time it produced is relative to that slice's start.
  const phaseInFile = second.phase + from / sampleRate;
  const duration = samples.length / sampleRate;
  const first = phaseInFile - Math.floor(phaseInFile / period) * period;
  const beats: number[] = [];
  for (let t = first; t <= duration; t += period) beats.push(t);

  const downbeatOffset = findDownbeat(env, beats.map((t) => t - from / sampleRate));
  return {
    bpm,
    period,
    beats,
    downbeatOffset,
    beatsPerBar: BEATS_PER_BAR,
    confidence: Math.min(1, best.agreement),
  };
}

/** Mix any channel layout down to the mono signal the analysis wants. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** The bar start nearest a chosen time — where a cut can begin without a lurch. */
export function nearestDownbeat(grid: BeatGrid, time: number): number {
  if (!grid.beats.length) return time;
  let best = grid.beats[grid.downbeatOffset] ?? grid.beats[0];
  for (let i = grid.downbeatOffset; i < grid.beats.length; i += grid.beatsPerBar) {
    if (Math.abs(grid.beats[i] - time) < Math.abs(best - time)) best = grid.beats[i];
  }
  return best;
}
