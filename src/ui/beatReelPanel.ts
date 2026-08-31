import { analyzeBeats, nearestDownbeat, onsetEnvelope, toMono } from "../engine/beats.js";
import { activeCut, coverRect } from "../engine/reelFrame.js";
import type { BeatGrid } from "../engine/beats.js";
import { beatsIn, planBeatCuts, suggestWindow } from "../engine/beatPlan.js";
import type { BeatPlan } from "../engine/beatPlan.js";
import { renderBeatReel } from "./beatReelExport.js";
import type { ReelClip, ReelQuality } from "./beatReelExport.js";
import { quickVideoDuration, renderQuickVideoFrame } from "./quickVideoExport.js";
import type { QuickExportScores } from "./quickVideoExport.js";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Sex } from "../engine/types.js";
import { aggregateScoreToPercentile } from "../engine/scoring.js";

// ---------------------------------------------------------------------------
// Attach clips. Attach a song. Get a cut.
//
// The ordering of this panel is the whole argument. Clips come first because
// how many you have decides how long each one is; the song comes second because
// its tempo turns that count into seconds; and the window is chosen LAST,
// against a number this panel has already worked out for you. At no point is
// anybody asked to guess a duration, which is the question the old creator
// asked and the reason its cuts never sat on the music.
//
// The waveform is drawn from the onset envelope rather than from the samples.
// A sample waveform of a modern master is a solid block — everything is
// squashed to the ceiling, so it shows a rectangle and tells you nothing. The
// onset envelope shows where the HITS are, which is the only thing anybody is
// looking for when they scrub a song for a section to cut to, and it lets the
// detected grid be drawn on top of the evidence it came from. If the ticks do
// not line up with the spikes, the analysis is wrong and you can SEE that it
// is wrong, rather than finding out after a two-minute render.
//
// Nothing here uploads anything. The song is decoded into memory, analysed,
// sliced and muxed on the device.
// ---------------------------------------------------------------------------

interface PanelClip extends ReelClip {
  name: string;
  url: string;
  // A still image riding the strip as a segment. It has no timeline of its
  // own — it holds its frame for however many beats it is given — so it is
  // rendered through `draw` (reading `bias` at draw time), and the export
  // never knows it was not footage. Exactly one of video/image is set.
  image?: HTMLImageElement;
  // How many beats this clip holds, when the person has said so. Null means
  // the pace decides. This is how a clip is slowed DOWN — more beats is the
  // same footage holding longer on the music.
  beats: number | null;
}

interface Song {
  name: string;
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  grid: BeatGrid;
  /** The onset envelope, for drawing. Downsampled per pixel at paint time. */
  env: Float32Array;
  envRate: number;
}

// ---------------------------------------------------------------------------
// The analysis, on the beat.
//
// This panel began as a generic clip cutter, which missed its own point: the
// TikTok this product wants made is before-clips, THE ANALYSIS, after-clips —
// and the analysis is the one segment no other tool can provide. So when the
// caller has a scan in hand, the analysis reel joins the strip as a segment
// like any clip: it takes its beats from the same plan, it can be reordered
// with the same arrows, and it renders AT 2x — the full breakdown compressed
// into a couple of seconds, which is the pace the format demands. It is
// synthesised per frame (a pure function of time) rather than pre-rendered to
// a video, so there is no intermediate encode and no quality loss.
// ---------------------------------------------------------------------------
export interface BeatAnalysisSource {
  photo: HTMLCanvasElement;
  landmarks: NormalizedLandmark[];
  sex: Sex;
  scores: QuickExportScores;
  /**
   * The earlier scan of a before/after run. When present the analysis segment
   * can play as a GLOW-UP: the before card for the first half of its beats,
   * then the after card counting up out of the before score. The delta is the
   * shareable frame, and it only exists if both numbers are drawn in the same
   * place doing the same thing.
   */
  before?: { photo: HTMLCanvasElement; landmarks: NormalizedLandmark[]; scores: QuickExportScores };
}

let host: HTMLDivElement | null = null;
let clips: PanelClip[] = [];
let song: Song | null = null;
let analysisSource: BeatAnalysisSource | null = null;
let analysisOn = false;
// Where the analysis sits in the strip. Until the person moves it, it floats
// to the middle — before-clips, analysis, after-clips is the format — and
// once moved it stays where it was put.
let analysisAt = 0;
let analysisMoved = false;
// Glow-up mode: before card then after card inside the analysis segment.
// Defaults ON when a before scan exists — two photographs were taken to make
// this exact comparison — and the chips under the strip switch it.
let analysisPair = true;
// The analysis segment's own pace. Speed is how fast the breakdown plays;
// beats is how long the cut holds, and NULL means "exactly long enough to
// play the whole thing at that speed". The first live render held the
// analysis for two beats — under a second of a 5.5-second breakdown — which
// was not fast, it was decapitated. Auto-full is the only honest default.
let analysisSpeed = 2;
let analysisBeats: number | null = null;
// Whether the analysis tile's own editor is open (the clip editors use
// openClip; the analysis is not in clips[] so it carries its own flag).
let openAna = false;

function autoAnalysisBeats(): number | null {
  const g = grid();
  if (!g?.bpm) return null;
  const body = quickVideoDuration("breakdown");
  const content = (analysisPair && analysisSource?.before ? body * 2 : body) / analysisSpeed;
  return Math.max(1, Math.ceil(content / g.period - 1e-6));
}
let beatsPerClip = 2;
// When set, the section's length governs and the pace is whatever fills it.
// Null means the pace control governs and the length follows from it. Exactly
// one of the two is in charge at any moment, and the panel says which.
let fitSeconds: number | null = null;
let songStart = 0;
let dropAt: number | null = null;
let clipsBeforeDrop: number | null = null;
let quality: ReelQuality = "1080";
let busy = false;
// The growth loop, on by default and honestly labelled: the card is the one
// part of the reel that is ours, and it is a checkbox precisely so nobody
// discovers it in their export.
let outro = true;
// The polished 30-second CTA film is the default tail for TikTok reels. It is
// still optional: a creator cutting a custom CTA can turn it off before the
// render instead of trimming a finished file afterwards. The short card above
// remains a separate choice and is the only CTA embedded in a full Rundown.
let longCta = true;

export function closeBeatReelPanel(): void {
  // A render still writing must keep its sources: closing mid-render would
  // revoke the clip URLs the encoder is seeking through and turn the rest of
  // the export into two-second seek timeouts on dead blobs. The ✕ and the
  // backdrop are both disabled while busy, so this is belt and braces.
  if (busy) return;
  stopReelPreview();
  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  for (const c of clips) URL.revokeObjectURL(c.url);
  clips = [];
  song = null;
  dropAt = null;
  clipsBeforeDrop = null;
  // Every control resets with the panel. Leaving quality or the fitted
  // section length behind meant reopening showed the DEFAULTS while the state
  // still held the old choices — a 4K render out of a select that said 1080.
  beatsPerClip = 2;
  fitSeconds = null;
  quality = "1080";
  songStart = 0;
  outro = true;
  longCta = true;
  analysisSource = null;
  analysisOn = false;
  analysisAt = 0;
  analysisMoved = false;
  analysisPair = true;
  analysisSpeed = 2;
  analysisBeats = null;
  openAna = false;
  stopSong();
  pausedAt = null;
  songBuffer = null;
  host?.remove();
  host = null;
}

// The strip's true length: video clips plus the analysis segment when it is
// riding along. Every count the planner or a control sees goes through this —
// a plan built on clips.length alone would give the analysis nobody's beats.
function reelCount(): number {
  return clips.length + (analysisOn ? 1 : 0);
}

// Where the analysis sits in the combined strip, clamped to what exists.
function analysisPos(): number {
  if (!analysisMoved) return Math.ceil(clips.length / 2);
  return Math.max(0, Math.min(clips.length, analysisAt));
}

// The clip list the renderer receives: videos in strip order with the
// analysis segment spliced in at its position.
function reelClips(): ReelClip[] {
  const list: ReelClip[] = [...clips];
  if (analysisOn && analysisSource) list.splice(analysisPos(), 0, analysisClip(analysisSource));
  return list;
}

function analysisClip(a: BeatAnalysisSource): ReelClip {
  const off = document.createElement("canvas");
  const body = quickVideoDuration("breakdown");
  const pair = analysisPair && a.before;
  return {
    startAt: 0,
    draw: (ctx, w, h, into, dur) => {
      // 2x: the full breakdown in half its runtime. A cut longer than the
      // sped-up body holds the final frame — the same rule a too-short video
      // clip follows — because looping a score reveal reads as a glitch.
      //
      // GLOW-UP: with a before scan riding along, the segment stages itself —
      // the before card owns the first half of the window, the after card the
      // second, counting up out of the before score. The handover sits at the
      // midpoint, which is a beat whenever the segment holds an even count.
      const scale = w / 720;
      if (pair) {
        const half = dur / 2;
        if (into < half) {
          const t = Math.min(into * analysisSpeed, body - 0.05);
          renderQuickVideoFrame(off, a.before!.photo, a.before!.landmarks, a.sex, a.before!.scores, t, "breakdown", scale);
        } else {
          const t = Math.min((into - half) * analysisSpeed, body - 0.05);
          const climb = { ...a.scores, from: a.before!.scores.overall };
          renderQuickVideoFrame(off, a.photo, a.landmarks, a.sex, climb, t, "breakdown", scale);
        }
      } else {
        const t = Math.min(into * analysisSpeed, body - 0.05);
        // The frame is authored at 720x1280; the scale argument renders it at
        // the reel's own resolution, so 1080 and 4K both get native pixels
        // rather than an upscale.
        renderQuickVideoFrame(off, a.photo, a.landmarks, a.sex, a.scores, t, "breakdown", scale);
      }
      ctx.drawImage(off, 0, 0, w, h);
    },
  };
}

const fmt = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

// ---------------------------------------------------------------------------
// Hearing the song.
//
// The waveform shows where the hits are; it cannot tell you which hit is THE
// drop. That takes ears, and until now the only way to listen was to open the
// file in another app and count seconds — for a panel whose whole argument is
// that nobody should have to do arithmetic against a song.
//
// One player, Web Audio, from the decoded channels already in memory (nothing
// re-reads the file). Play starts at the chosen start marker; clicking the
// waveform while playing jumps playback there along with the marker, so
// scrubbing by ear and choosing the section are the same gesture. A playhead
// runs across the wave — drawn into the same canvas as everything else, so it
// can never drift from the ruler it is read against.
// ---------------------------------------------------------------------------
let audioCtx: AudioContext | null = null;
let playingSrc: AudioBufferSourceNode | null = null;
// Where playback began, in song seconds and context time, so the playhead is
// arithmetic rather than state that can lag.
let playFrom = 0;
let playCtxAt = 0;
let playRaf = 0;
let songBuffer: AudioBuffer | null = null;
// Where full-song playback paused, in song seconds. Space resumes from HERE,
// not from the start marker — pausing to look at something is not starting
// over. Null means nothing is paused; play falls back to the marker.
let pausedAt: number | null = null;
// Whether the current playback is the full song (true) or a bounded preview
// slice (false). Only a full play records a pause point: a cut preview ending
// must not teleport the resume position to wherever the preview stopped.
let fullPlay = false;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

function isPlaying(): boolean {
  return playingSrc !== null;
}

function playheadTime(): number | null {
  if (!playingSrc || !audioCtx) return null;
  return playFrom + (audioCtx.currentTime - playCtxAt);
}

function stopSong(): void {
  if (playRaf) cancelAnimationFrame(playRaf);
  playRaf = 0;
  if (playingSrc) {
    // Record the pause point BEFORE tearing the source down — afterwards the
    // playhead is gone. A play that ran off the end of the track resumes from
    // the marker instead: "resume from the silence after the song" is nothing.
    if (fullPlay) {
      const t = playheadTime();
      pausedAt = t !== null && song && t < song.duration - 0.1 ? t : null;
    }
    playingSrc.onended = null;
    try { playingSrc.stop(); } catch { /* already ended */ }
    playingSrc = null;
  }
  paintPlayButton();
  if (host && song) drawWave();
}

function playSong(from: number, dur?: number): void {
  if (!song) return;
  stopSong();
  fullPlay = dur === undefined;
  try {
    audioCtx = audioCtx ?? new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    if (!songBuffer) {
      songBuffer = new AudioBuffer({
        numberOfChannels: song.channels.length,
        length: song.channels[0]?.length || 1,
        sampleRate: song.sampleRate,
      });
      song.channels.forEach((ch, i) => songBuffer!.copyToChannel(new Float32Array(ch), i));
    }
    const src = audioCtx.createBufferSource();
    src.buffer = songBuffer;
    src.connect(audioCtx.destination);
    src.onended = () => {
      if (playingSrc === src) stopSong();
    };
    src.start(0, Math.max(0, Math.min(song.duration - 0.05, from)), dur);
    playingSrc = src;
    playFrom = from;
    playCtxAt = audioCtx.currentTime;
    const tick = () => {
      if (!playingSrc || !host) return;
      drawWave();
      playRaf = requestAnimationFrame(tick);
    };
    playRaf = requestAnimationFrame(tick);
  } catch {
    // No audio output is a quieter panel, never a broken one.
    playingSrc = null;
  }
  paintPlayButton();
}

function paintPlayButton(): void {
  const btn = host?.querySelector<HTMLButtonElement>("#brp-play");
  if (!btn) return;
  btn.textContent = isPlaying()
    ? "❚❚ Pause · space"
    : pausedAt !== null
      ? "► Resume · space"
      : "► Play from the marker";
}

function grid(): BeatGrid | null {
  return song?.grid ?? null;
}

// One frame (1/30s) left or right — a beat with shift held — moving whichever
// position is live: the playhead while playing, the paused marker otherwise.
// Shared by the arrow keys and the ◂ ▸ buttons under the waveform, so the two
// can never drift apart in behaviour.
function stepFrame(dir: number, wholeBeat = false): void {
  const g = grid();
  if (!song || !g?.bpm) return;
  const step = (wholeBeat ? g.period : 1 / 30) * dir;
  const base = isPlaying() ? (playheadTime() ?? songStart) : (pausedAt ?? songStart);
  const at = Math.max(0, Math.min(song.duration - 0.05, base + step));
  if (isPlaying()) playSong(at);
  else {
    pausedAt = at;
    paintPlayButton();
    drawWave();
  }
}

// The strip's beat requests in combined order — the analysis spliced in at
// its position with its auto-full default. One list, built one way, for the
// planner and every control that reasons about it.
function combinedOverrides(): Array<number | null> {
  const list: Array<number | null> = clips.map((c) => c.beats);
  if (analysisOn && analysisSource) {
    list.splice(analysisPos(), 0, analysisBeats ?? autoAnalysisBeats());
  }
  return list;
}

// How many beats the segments BEFORE the drop ask for, given how many of
// them there are. This is the drop's anchor arithmetic: the reel does not
// cram those segments into whatever gap happens to sit after the start
// marker — the start moves EARLIER to make room for them.
function beatsBeforeDrop(before: number): number {
  return combinedOverrides()
    .slice(0, before)
    .reduce<number>((a, p) => a + (p ?? beatsPerClip), 0);
}

/** The detected beat nearest to a time — the drop snaps to real beats. */
function nearestBeatTo(g: BeatGrid, t: number): number {
  let best = t;
  let dist = Infinity;
  for (const b of g.beats) {
    const d = Math.abs(b - t);
    if (d < dist) {
      dist = d;
      best = b;
    }
  }
  return best;
}

// Where the reveal starts when a drop is first marked: right AFTER the
// analysis. The format is before-clips, the glow-up, then the drop hits and
// the reveal plays — so everything up to and including the analysis sits on
// the before side. Without an analysis, half the strip.
function defaultClipsBeforeDrop(): void {
  clipsBeforeDrop = Math.max(
    1,
    Math.min(
      reelCount() - 1,
      analysisOn && analysisSource ? analysisPos() + 1 : Math.floor(reelCount() / 2),
    ),
  );
}

function currentPlan(): BeatPlan | null {
  const g = grid();
  if (!g || !reelCount() || !g.bpm) return null;
  // With a drop marked, the drop is the anchor and everything is laid out
  // around it: the segments before it own their beats, so the reel starts
  // exactly that many beats EARLIER than the drop, and the after side runs
  // from the drop for its own beats. Adding a clip or lengthening one before
  // the drop pulls the start back; after it, pushes the end out. The drop
  // itself never moves — it is the one time the person chose by ear.
  let effectiveStart = songStart;
  if (dropAt !== null) {
    const n = reelCount();
    const before = Math.max(1, Math.min(n - 1, clipsBeforeDrop ?? 1));
    effectiveStart = Math.max(0, dropAt - beatsBeforeDrop(before) * g.period);
  }
  return planBeatCuts({
    grid: g,
    clipCount: reelCount(),
    beatsPerClip,
    beatOverrides: combinedOverrides(),
    // A fitted section length and a drop anchor cannot both govern; the drop
    // wins, because it was placed by ear and the fit was a convenience.
    ...(dropAt === null && fitSeconds != null ? { totalBeats: beatsIn(g, fitSeconds) } : {}),
    songStart: effectiveStart,
    dropAt: dropAt ?? undefined,
    clipsBeforeDrop: clipsBeforeDrop ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// The live preview.
//
// "Does this edit work" was only answerable by a two-minute render. Now the
// plan plays in real time in a small frame: the song from the chosen start,
// the clips seeked and cut exactly where the export will cut them, the
// analysis synthesised per frame the same way the encoder does it. It is the
// render loop minus the encoder — same activeCut, same coverRect, same draw —
// so what it shows is what renders, at thumbnail size and zero cost.
// ---------------------------------------------------------------------------
let previewOn = false;
let previewRaf = 0;

function paintPreviewButton(): void {
  const btn = host?.querySelector<HTMLButtonElement>("#brp-preview");
  if (!btn) return;
  btn.textContent = previewOn ? "■ Stop the preview" : "► Preview the reel";
}

function stopReelPreview(): void {
  if (previewRaf) cancelAnimationFrame(previewRaf);
  previewRaf = 0;
  if (!previewOn) return;
  previewOn = false;
  for (const c of clips) c.video?.pause();
  stopSong();
  const wrapEl = host?.querySelector<HTMLElement>("#brp-prevwrap");
  if (wrapEl) wrapEl.hidden = true;
  paintPreviewButton();
}

function startReelPreview(): void {
  const plan = currentPlan();
  if (!plan || !song || busy) return;
  stopReelPreview();
  const wrapEl = host?.querySelector<HTMLElement>("#brp-prevwrap");
  const canvas = host?.querySelector<HTMLCanvasElement>("#brp-prev");
  const ctx = canvas?.getContext("2d");
  if (!wrapEl || !canvas || !ctx) return;
  wrapEl.hidden = false;
  previewOn = true;
  const list = reelClips();
  // A bounded play, so the pause point of the transport is left alone.
  playSong(plan.songStart, plan.duration);
  let t0 = performance.now();
  let lastClip = -1;
  const W = canvas.width;
  const H = canvas.height;
  const tick = () => {
    if (!previewOn || !host) return;
    const t = (performance.now() - t0) / 1000;
    if (t >= plan.duration) {
      // The preview LOOPS: judging an edit takes more than one pass, and
      // restarting it by hand after every pass is the friction the preview
      // exists to remove. It runs until stopped — the stop button, any edit,
      // space, or the render taking the clips for itself.
      t0 = performance.now();
      lastClip = -1;
      playSong(plan.songStart, plan.duration);
      previewRaf = requestAnimationFrame(tick);
      return;
    }
    const hit = activeCut(plan.cuts, t);
    const clip = hit ? list[hit.cut.clip] : undefined;
    if (hit && clip) {
      if (clip.draw) {
        if (lastClip !== hit.cut.clip) {
          for (const c of clips) c.video?.pause();
          lastClip = hit.cut.clip;
        }
        clip.draw(ctx, W, H, hit.into, hit.cut.end - hit.cut.start);
      } else if (clip.video) {
        const v = clip.video;
        if (lastClip !== hit.cut.clip) {
          // One video plays at a time. Seek to where the export would seek —
          // the clip's in-point plus how far into the cut we are, at the
          // clip's own speed — then let real time carry it.
          for (const c of clips) c.video?.pause();
          v.currentTime = clip.startAt + hit.into * (clip.speed ?? 1);
          v.playbackRate = clip.speed ?? 1;
          void v.play().catch(() => undefined);
          lastClip = hit.cut.clip;
        }
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        if (v.videoWidth && v.videoHeight) {
          const r = coverRect(v.videoWidth, v.videoHeight, W, H, clip.bias ?? 0);
          ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
        }
      }
    }
    previewRaf = requestAnimationFrame(tick);
  };
  previewRaf = requestAnimationFrame(tick);
  paintPreviewButton();
}

export function openBeatReelPanel(analysis?: BeatAnalysisSource): void {
  closeBeatReelPanel();
  // Creator edits are production copy, not a second measurement pass. Keep a
  // private copy so changing a reel score never mutates the saved scan behind
  // the panel.
  analysisSource = analysis
    ? {
        ...analysis,
        scores: { ...analysis.scores, regions: analysis.scores.regions.map((region) => ({ ...region })) },
        before: analysis.before
          ? {
              ...analysis.before,
              scores: {
                ...analysis.before.scores,
                regions: analysis.before.scores.regions.map((region) => ({ ...region })),
              },
            }
          : undefined,
      }
    : null;
  analysisOn = Boolean(analysis);
  const el = document.createElement("div");
  host = el;
  el.className = "brp";
  el.innerHTML = `
    <div class="brp-card" role="dialog" aria-modal="true" aria-labelledby="brp-h">
      <button class="brp-x" type="button" aria-label="Close">✕</button>
      <h2 id="brp-h">Make a TikTok</h2>
      <p class="brp-sub">${
        analysis
          ? "Your clips before, your analysis at 2×, your clips after, every cut lands on a beat of the song you attach."
          : "Attach your clips, then a song. The tempo decides how long each clip is: you never pick a duration."
      }</p>

      ${
        analysis
          ? `<section class="brp-score-panel" aria-label="Scores shown in this reel">
        ${
          analysis.before
            ? `<label><span>Before score</span>
          <input class="q-input" id="brp-before-score" type="number" min="0" max="10" step="0.1"
            inputmode="decimal" value="${analysis.before.scores.overall.toFixed(1)}"></label>`
            : ""
        }
        <label><span>${analysis.before ? "After score" : "Analysis score"}</span>
          <input class="q-input" id="brp-current-score" type="number" min="0" max="10" step="0.1"
            inputmode="decimal" value="${analysis.scores.overall.toFixed(1)}"></label>
        <p>These are the numbers shown in this reel. Editing them does not change the saved facial analysis.</p>
      </section>`
          : ""
      }

      <section class="brp-sec">
        <div class="brp-head"><span>1 · YOUR CLIPS</span><small id="brp-clipnote">Nothing attached yet.</small></div>
        <div class="brp-clips" id="brp-clips"></div>
        <input id="brp-clip-input" type="file" accept="video/*,image/*" multiple hidden />
      </section>

      <section class="brp-sec">
        <div class="brp-head"><span>2 · THE SONG</span><small id="brp-songnote">Attach the full track: you pick the section next.</small></div>
        <div class="brp-song" id="brp-song">
          <button class="brp-add" type="button" id="brp-song-add"><span>♪</span>Add a song</button>
        </div>
        <input id="brp-song-input" type="file" accept="audio/*" hidden />
      </section>

      <section class="brp-sec" id="brp-preview-sec" hidden>
        <div class="brp-head"><span>▶ THE PREVIEW</span><small id="brp-prevnote">Loops the beat cut exactly. The selected 30-second CTA film appends after it.</small></div>
        <div class="brp-prevwrap" id="brp-prevwrap" hidden>
          <canvas id="brp-prev" width="270" height="480"></canvas>
        </div>
        <button class="btn gho brp-prevbtn" id="brp-preview" type="button">► Preview the reel</button>
      </section>

      <section class="brp-sec" id="brp-window-sec" hidden>
        <div class="brp-head"><span>3 · THE SECTION</span><small id="brp-wantnote"></small></div>
        <div class="brp-wave-wrap">
          <canvas class="brp-wave" id="brp-wave" width="1200" height="150"></canvas>
          <button type="button" class="btn gho brp-play" id="brp-play">► Play from the marker</button>
          <div class="brp-wave-foot">
            <div class="brp-wave-hint" id="brp-wave-hint">Click the waveform to set where the reel starts, while playing, playback jumps with it. Listen for the drop, then shift-click to mark it.</div>
            <div class="brp-step">
              <button type="button" id="brp-step-back" title="One frame back, hold shift for a beat">◂</button>
              <button type="button" id="brp-step-fwd" title="One frame forward, hold shift for a beat">▸</button>
            </div>
          </div>
        </div>
        <div class="brp-controls">
          <label class="brp-ctl">Pace
            <select id="brp-pace" class="q-input">
              <option value="1">1 beat a clip, frantic</option>
              <option value="2" selected>2 beats a clip, standard</option>
              <option value="3">3 beats a clip</option>
              <option value="4">4 beats a clip, cinematic</option>
            </select>
          </label>
          <!-- The same formula run backwards, for the common case of having a
               specific section in mind: type its length and the pace is chosen
               to fill it with whole beats. Never leaves a fractional beat over: it takes the largest whole number that fits and says what the
               window actually came out as. -->
          <label class="brp-ctl">Or fit a section of
            <input class="q-input" id="brp-fit" type="number" min="2" max="180" step="1" placeholder="20" />
          </label>
          <label class="brp-ctl">Quality
            <select id="brp-quality" class="q-input">
              <option value="1080" selected>1080 × 1920: the platform native</option>
              <option value="4k">2160 × 3840, 4K, about 4× the render time</option>
            </select>
          </label>
        </div>
        <div class="brp-drop">
          <label class="brp-outro"><input type="checkbox" id="brp-outro" checked />
            End on the TrueMax card <em>one bar · "truemax.app"</em></label>
          <label class="brp-outro"><input type="checkbox" id="brp-long-cta" checked />
            Append the polished TrueMax CTA film <em>30s · voice and visuals</em></label>
          <small>Turn the long film off when you are adding a custom CTA in your editor. Rundowns already carry their short CTA and do not use this switch.</small>
        </div>
        <div class="brp-drop">
          <button type="button" class="btn gho" id="brp-drop-set">Mark the drop here</button>
          <button type="button" class="btn gho" id="brp-drop-clear" hidden>Clear the drop</button>
          <label class="brp-ctl brp-before" hidden id="brp-before-wrap">Clips before it
            <input class="q-input" id="brp-before" type="number" min="1" step="1" />
          </label>
          <small id="brp-dropnote">Optional. The clip that starts on the drop is your reveal.</small>
        </div>
      </section>

      <section class="brp-sec" id="brp-plan-sec" hidden>
        <div class="brp-head"><span>4 · THE CUT</span><small id="brp-plannote"></small></div>
        <div class="brp-cuts" id="brp-cuts"></div>
      </section>

      <div class="brp-actions">
        <button class="btn pri" id="brp-go" disabled>Render the reel</button>
        <span class="brp-progress" id="brp-progress"></span>
      </div>
    </div>`;

  document.body.appendChild(el);
  wire(el);

  // The transport, on the keyboard. Space pauses and resumes IN PLACE —
  // never back to the start marker — and the arrow keys step the position a
  // frame (1/30s) at a time, a beat with shift held. Frame-stepping is how a
  // drop is actually found: the waveform gets you near it, the last few
  // frames are ears-and-arrows work. Typing in a field is left alone.
  keyHandler = (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (!song || !grid()?.bpm) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (previewOn) { stopReelPreview(); return; }
      if (cutPreviewStop) { cutPreviewStop(); return; }
      if (isPlaying()) stopSong();
      else playSong(pausedAt ?? songStart);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      stepFrame(e.key === "ArrowLeft" ? -1 : 1, e.shiftKey);
    }
  };
  document.addEventListener("keydown", keyHandler);
  paint();
}

function wire(el: HTMLElement): void {
  el.querySelector<HTMLButtonElement>(".brp-x")!.onclick = () => {
    if (!busy) closeBeatReelPanel();
  };
  el.onclick = (e) => {
    if (e.target === el && !busy) closeBeatReelPanel();
  };

  const wireScore = (id: string, scores: QuickExportScores | undefined) => {
    const input = el.querySelector<HTMLInputElement>(`#${id}`);
    if (!input || !scores) return;
    const commit = () => {
      const parsed = Number(input.value);
      const value = Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : scores.overall;
      scores.overall = Math.round(value * 10) / 10;
      scores.percentile = aggregateScoreToPercentile(scores.overall);
      input.value = scores.overall.toFixed(1);
      paint();
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
  };
  wireScore("brp-before-score", analysisSource?.before?.scores);
  wireScore("brp-current-score", analysisSource?.scores);

  const clipInput = el.querySelector<HTMLInputElement>("#brp-clip-input")!;
  clipInput.onchange = async () => {
    const files = [...(clipInput.files ?? [])];
    clipInput.value = "";
    for (const file of files) {
      const loaded = await loadClip(file);
      if (loaded) clips.push(loaded);
      paint();
    }
  };

  const songInput = el.querySelector<HTMLInputElement>("#brp-song-input")!;
  songInput.onchange = async () => {
    const file = songInput.files?.[0];
    songInput.value = "";
    if (!file) return;
    note("brp-songnote", "Reading the track…");
    const loaded = await loadSong(file);
    if (!loaded) {
      note("brp-songnote", "That file would not decode as audio.");
      return;
    }
    // A new track is a new buffer and a fresh silence — playback of the old
    // one continuing under the new waveform would be a haunted house.
    stopSong();
    pausedAt = null;
    songBuffer = null;
    song = loaded;
    // Start a quarter of the way in rather than at zero: the opening of a
    // track is where the drums usually are not.
    songStart = nearestDownbeat(loaded.grid, loaded.duration * 0.25);
    dropAt = null;
    clipsBeforeDrop = null;
    paint();
  };
  el.querySelector<HTMLButtonElement>("#brp-song-add")!.onclick = () => songInput.click();

  el.querySelector<HTMLSelectElement>("#brp-pace")!.onchange = (e) => {
    beatsPerClip = Number((e.target as HTMLSelectElement).value) || 2;
    // Choosing a pace is a statement that the pace is what matters, so it
    // releases the section length rather than silently doing nothing.
    fitSeconds = null;
    const fit = host!.querySelector<HTMLInputElement>("#brp-fit");
    if (fit) fit.value = "";
    paint();
  };
  el.querySelector<HTMLInputElement>("#brp-fit")!.oninput = (e) => {
    const raw = (e.target as HTMLInputElement).value.trim();
    const seconds = Number(raw);
    // Emptying the box hands control back to the pace select rather than
    // leaving the edit stuck at whatever was last typed.
    fitSeconds = raw && seconds > 0 ? seconds : null;
    paint();
  };
  el.querySelector<HTMLSelectElement>("#brp-quality")!.onchange = (e) => {
    quality = (e.target as HTMLSelectElement).value === "4k" ? "4k" : "1080";
  };
  el.querySelector<HTMLButtonElement>("#brp-step-back")!.onclick = (e) => stepFrame(-1, e.shiftKey);
  el.querySelector<HTMLButtonElement>("#brp-step-fwd")!.onclick = (e) => stepFrame(1, e.shiftKey);

  el.querySelector<HTMLInputElement>("#brp-outro")!.onchange = (e) => {
    outro = (e.target as HTMLInputElement).checked;
    paint();
  };
  el.querySelector<HTMLInputElement>("#brp-long-cta")!.onchange = (e) => {
    longCta = (e.target as HTMLInputElement).checked;
    paint();
  };
  el.querySelector<HTMLButtonElement>("#brp-drop-set")!.onclick = () => {
    const plan = currentPlan();
    const g = grid();
    if (!plan || !g) return;
    // "Here" is wherever the ear just was: the paused marker (the workflow is
    // stepping frame by frame onto the drop, then marking it), else the live
    // playhead, else the middle of the window as a starting point to move.
    const heard = pausedAt ?? playheadTime();
    dropAt = nearestBeatTo(g, heard ?? songStart + plan.duration / 2);
    defaultClipsBeforeDrop();
    paint();
  };
  el.querySelector<HTMLButtonElement>("#brp-drop-clear")!.onclick = () => {
    dropAt = null;
    clipsBeforeDrop = null;
    paint();
  };
  el.querySelector<HTMLInputElement>("#brp-before")!.oninput = (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    clipsBeforeDrop = Math.max(1, Math.min(reelCount() - 1, v || 1));
    paint();
  };

  const wave = el.querySelector<HTMLCanvasElement>("#brp-wave")!;
  wave.onclick = (e) => {
    const g = grid();
    if (!song || !g) return;
    const rect = wave.getBoundingClientRect();
    const at = ((e.clientX - rect.left) / rect.width) * song.duration;
    // Shift-click marks the drop — or moves it — snapped to a BEAT rather
    // than a bar, because a drop does not always land on a "one".
    if (e.shiftKey) {
      dropAt = nearestBeatTo(g, at);
      if (clipsBeforeDrop === null) defaultClipsBeforeDrop();
      paint();
      return;
    }
    if (dropAt !== null) {
      // With a drop marked, the drop anchors the window and the start is
      // derived from it — so a plain click no longer chooses the section, it
      // just moves the listening position. Choosing and listening split the
      // moment the anchor took over.
      pausedAt = at;
      if (isPlaying()) playSong(at);
      paintPlayButton();
      drawWave();
      return;
    }
    songStart = nearestDownbeat(g, at);
    // Choosing a new section discards the old pause point: resume means
    // "carry on from where I stopped", and this click said "no, from here".
    pausedAt = songStart;
    // Scrubbing by ear: while the song is playing, moving the marker moves
    // playback with it. Choosing a section and listening to it are the same
    // gesture, which is the whole point of having a player here.
    if (isPlaying()) playSong(songStart);
    paint();
  };

  el.querySelector<HTMLButtonElement>("#brp-play")!.onclick = () => {
    if (isPlaying()) stopSong();
    else playSong(pausedAt ?? songStart);
  };
  el.querySelector<HTMLButtonElement>("#brp-preview")!.onclick = () => {
    if (previewOn) stopReelPreview();
    else startReelPreview();
  };

  el.querySelector<HTMLButtonElement>("#brp-go")!.onclick = () => void render();
}

function note(id: string, text: string): void {
  const n = host?.querySelector<HTMLElement>(`#${id}`);
  if (n) n.textContent = text;
}

async function loadClip(file: File): Promise<PanelClip | null> {
  // A photo is a clip that holds one frame. It enters the strip like any
  // video — beats decide how long it shows — and renders through `draw`,
  // reading its framing bias at draw time so the editor's choice applies.
  if (/^image\//.test(file.type)) {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
    const clip: PanelClip = { image, url, name: file.name, startAt: 0, bias: 0, beats: null };
    clip.draw = (ctx, w, h) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      const r = coverRect(image.naturalWidth, image.naturalHeight, w, h, clip.bias ?? 0);
      ctx.drawImage(image, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    };
    return clip;
  }
  if (!/^video\//.test(file.type)) return null;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("no"));
    });
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  return { video, url, name: file.name, startAt: 0, bias: 0, beats: null };
}

async function loadSong(file: File): Promise<Song | null> {
  try {
    const bytes = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i).slice());
    const mono = toMono(channels);
    const g = analyzeBeats(mono, buffer.sampleRate);
    const env = onsetEnvelope(mono, buffer.sampleRate);
    return {
      name: file.name,
      channels,
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      grid: g,
      env: env.values,
      envRate: env.frameRate,
    };
  } catch {
    return null;
  }
}

function paint(): void {
  if (!host) return;
  // Any repaint means the edit changed, and a preview of the OLD plan playing
  // over the new controls is a lie in motion. Stop it; the button restarts it.
  stopReelPreview();
  paintClips();
  paintSong();
  paintWindow();
  paintPlan();
  const plan = currentPlan();
  const go = host.querySelector<HTMLButtonElement>("#brp-go")!;
  go.disabled = busy || !plan;
  // The preview section exists only once there is something to preview —
  // clips in, song in, plan solved. Above the section controls, so the loop
  // is on screen while the knobs below it are being turned.
  host.querySelector<HTMLElement>("#brp-preview-sec")!.hidden = !plan;
  const pv = host.querySelector<HTMLButtonElement>("#brp-preview")!;
  pv.disabled = busy || !plan;
  paintPreviewButton();
}

// Which clip's trim controls are open, by index. One at a time: eight open
// scrubbers is a mixing desk, and this is a phone screen.
let openClip: number | null = null;
// When a cut preview is running, this stops it — held at module level so the
// spacebar can reach a closure that lives inside the editor's paint.
let cutPreviewStop: (() => void) | null = null;

function paintClips(): void {
  const wrap = host!.querySelector<HTMLElement>("#brp-clips")!;
  wrap.innerHTML = "";
  // The trim editor lives OUTSIDE the strip (wrap.after), so clearing the
  // strip's innerHTML does not clear it. Every paint removes the old one and
  // the open clip, if any, gets a fresh one below.
  for (const old of host!.querySelectorAll(".brp-trim")) old.remove();
  const pos = analysisPos();
  // Display numbers count the COMBINED strip — a video after the analysis is
  // one later than its index in clips[], because that is the order the reel
  // actually cuts in.
  const shownNumber = (i: number) => i + (analysisOn && pos <= i ? 1 : 0) + 1;
  const cells: HTMLElement[] = [];
  clips.forEach((clip, i) => {
    const cell = document.createElement("div");
    cell.className = "brp-clip" + (openClip === i ? " open" : "");
    // Reorder is two arrows rather than drag. Drag needs a long-press to
    // disambiguate from scroll on a phone, ghosting, and a drop indicator;
    // arrows need nothing and work identically everywhere. The order IS the
    // edit, so it must be changeable without re-attaching everything.
    cell.innerHTML = `
      ${clip.image ? `<img alt="" />` : `<video muted playsinline preload="metadata"></video>`}
      <button type="button" class="q-cut-x" title="Remove">✕</button>
      <span class="brp-clip-n">${shownNumber(i)}</span>
      <span class="brp-clip-moves">
        <button type="button" data-move="-1" title="Earlier" ${i === 0 ? "disabled" : ""}>‹</button>
        <button type="button" data-move="1" title="Later" ${i === clips.length - 1 ? "disabled" : ""}>›</button>
      </span>`;
    if (clip.image) {
      cell.querySelector("img")!.src = clip.url;
    } else {
      const v = cell.querySelector("video")!;
      v.src = clip.url;
      v.currentTime = clip.startAt + 0.1;
    }
    cell.querySelector(".q-cut-x")!.addEventListener("click", (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(clip.url);
      clips.splice(i, 1);
      openClip = null;
      if (clipsBeforeDrop !== null) clipsBeforeDrop = Math.min(clipsBeforeDrop, Math.max(1, reelCount() - 1));
      paint();
    });
    for (const btn of cell.querySelectorAll<HTMLButtonElement>("[data-move]")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const to = i + Number(btn.dataset.move);
        const [moved] = clips.splice(i, 1);
        clips.splice(to, 0, moved);
        openClip = null;
        paint();
      });
    }
    // Tapping the clip opens its line-up controls under the strip — but only
    // once a plan exists. Until the song is attached nobody knows how many
    // beats this clip owns, and a trim against an unknown window is the
    // guessing game this panel exists to end. The hint says what to do next
    // instead of the tap silently doing nothing.
    cell.addEventListener("click", () => {
      if (!currentPlan()) {
        note("brp-clipnote", "Attach the song first, then tap a clip to line it up with the beats it gets.");
        return;
      }
      openClip = openClip === i ? null : i;
      openAna = false;
      paint();
    });
    cells.push(cell);
  });

  // The analysis segment's tile, spliced into the strip at its position. Not
  // a PanelClip: it has no file, no trim, and a fixed 2x speed — what it has
  // is the same arrows, because its place in the order IS its one edit.
  if (analysisOn && analysisSource) {
    const a = analysisSource;
    const pair = analysisPair && a.before;
    const tile = document.createElement("div");
    tile.className = "brp-clip brp-ana" + (openAna ? " open" : "");
    tile.innerHTML = `
      <canvas class="brp-ana-thumb"></canvas>
      <button type="button" class="q-cut-x" title="Remove">✕</button>
      <span class="brp-clip-n">${pos + 1}</span>
      <span class="brp-ana-badge">${pair ? `GLOW-UP · ${analysisSpeed}×` : `YOUR ANALYSIS · ${analysisSpeed}×`}</span>
      <span class="brp-clip-moves">
        <button type="button" data-amove="-1" title="Earlier" ${pos === 0 ? "disabled" : ""}>‹</button>
        <button type="button" data-amove="1" title="Later" ${pos === clips.length ? "disabled" : ""}>›</button>
      </span>`;
    const thumb = tile.querySelector<HTMLCanvasElement>(".brp-ana-thumb")!;
    // One representative frame, mid-reveal. 0.15 of the authored 720x1280 is
    // thumbnail-sized without being a blur. The glow-up thumbs the AFTER card
    // counting out of the before score — the frame the video exists for.
    renderQuickVideoFrame(
      thumb, a.photo, a.landmarks, a.sex,
      pair ? { ...a.scores, from: a.before!.scores.overall } : a.scores,
      1.2, "breakdown", 0.15,
    );
    tile.querySelector(".q-cut-x")!.addEventListener("click", (e) => {
      e.stopPropagation();
      analysisOn = false;
      openAna = false;
      if (clipsBeforeDrop !== null) clipsBeforeDrop = Math.min(clipsBeforeDrop, Math.max(1, reelCount() - 1));
      paint();
    });
    // The analysis has its own line-up controls — how long it holds, and how
    // fast the breakdown plays inside that hold — behind the same song gate
    // as the clips, and for the same reason: beats mean nothing without a
    // tempo to price them in seconds.
    tile.addEventListener("click", () => {
      if (!currentPlan()) {
        note("brp-clipnote", "Attach the song first, then tap the analysis to set how long it holds.");
        return;
      }
      openAna = !openAna;
      openClip = null;
      paint();
    });
    for (const btn of tile.querySelectorAll<HTMLButtonElement>("[data-amove]")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        analysisAt = analysisPos() + Number(btn.dataset.amove);
        analysisMoved = true;
        openClip = null;
        paint();
      });
    }
    cells.splice(pos, 0, tile);
  }
  for (const cell of cells) wrap.append(cell);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "brp-add";
  add.innerHTML = `<span>+</span>${clips.length ? "More clips" : "Add clips"}`;
  add.onclick = () => host!.querySelector<HTMLInputElement>("#brp-clip-input")!.click();
  wrap.append(add);

  // The way back for a removed analysis: an offer, not a control panel.
  if (analysisSource && !analysisOn) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "brp-add brp-ana-add";
    back.innerHTML = `<span>+</span>Your analysis · ${analysisSpeed}×`;
    back.onclick = () => {
      analysisOn = true;
      paint();
    };
    wrap.append(back);
  }

  // One photo or the glow-up — only a choice when a before scan exists, and
  // shown as chips under the strip rather than buried in a menu, because it
  // decides what the whole video IS.
  const oldChips = host!.querySelector(".brp-anamode");
  oldChips?.remove();
  if (analysisOn && analysisSource?.before) {
    const chips = document.createElement("div");
    chips.className = "brp-anamode";
    chips.innerHTML = `
      <span>The analysis plays as</span>
      <button type="button" class="q-mode${analysisPair ? " on" : ""}" data-am="pair">Before → after</button>
      <button type="button" class="q-mode${analysisPair ? "" : " on"}" data-am="single">This scan only</button>`;
    for (const b of chips.querySelectorAll<HTMLButtonElement>("[data-am]")) {
      b.onclick = () => {
        analysisPair = b.dataset.am === "pair";
        paint();
      };
    }
    wrap.after(chips);
  }

  // The open clip's line-up controls, under the strip. `startAt` is where in
  // the SOURCE this clip begins — the cut still lands on the beat; this
  // decides which moment of the footage is playing when it does. This only
  // renders behind the currentPlan() gate on the tap, so the clip's own beat
  // window is known: the slider spans the clip against that window, and the
  // preview plays the window WITH the matching slice of the song, because
  // "does this move hit the beat" is a question only ears can answer.
  const openPlan = currentPlan();
  if (openClip !== null && clips[openClip] && openPlan) {
    const clip = clips[openClip];
    const combinedIndex = openClip + (analysisOn && pos <= openClip ? 1 : 0);
    const cut = openPlan.cuts.find((c) => c.clip === combinedIndex);
    const windowSec = cut ? cut.end - cut.start : 0;
    const period = 60 / openPlan.bpm;
    const beatsField = `
        <label>Plays for
          <select class="q-input" data-k="beats">
            <option value="">Auto: the pace decides</option>
            ${[1, 2, 3, 4, 6, 8]
              .map((b) => `<option value="${b}"${clip.beats === b ? " selected" : ""}>${b}♩ = ${(b * period).toFixed(2)}s</option>`)
              .join("")}
          </select>
        </label>`;
    const framingField = `
        <label>Framing
          <select class="q-input" data-k="bias">
            <option value="-0.35"${clip.bias === -0.35 ? " selected" : ""}>Favour the top, heads in wide shots</option>
            <option value="0"${!clip.bias ? " selected" : ""}>Centre</option>
            <option value="0.35"${clip.bias === 0.35 ? " selected" : ""}>Favour the bottom</option>
          </select>
        </label>`;
    const previewField = `<button type="button" class="btn gho brp-cutplay" data-k="preview">► Preview this cut with the song</button>`;
    const editor = document.createElement("div");
    editor.className = "brp-trim";
    if (clip.image) {
      // A still has no timeline: nothing to trim, no speed to set. Its whole
      // edit is how long it holds and how it is framed — and its preview is
      // the very seconds of song its cut sits on, under the held frame.
      editor.innerHTML = `
      <img src="${clip.url}" alt="" />
      <div class="brp-trim-fields">
        <b>Clip ${shownNumber(openClip)} · ${cut ? `${cut.beats}♩ = ${windowSec.toFixed(2)}s of song` : ""}: a photo holds its frame</b>
        ${beatsField}
        ${previewField}
        ${framingField}
      </div>`;
    } else {
      const speed = clip.speed ?? 1;
      // The furthest the in-point can sit while the whole window still has
      // footage (at this speed). A shorter clip just gets the full range and
      // the held-last-frame rule.
      const sourceNeed = windowSec * speed;
      const dur = Math.max(0.1, (clip.video!.duration || 0) - 0.3);
      const sliderMax = Math.max(0.1, dur - sourceNeed);
      editor.innerHTML = `
      <video muted playsinline preload="metadata"></video>
      <div class="brp-trim-fields">
        <b>Clip ${shownNumber(openClip)} · ${cut ? `${cut.beats}♩ = ${windowSec.toFixed(2)}s of song` : ""}</b>
        <label>Starts at
          <input type="range" data-k="start" min="0" max="${Math.min(dur, sliderMax).toFixed(1)}" step="0.1" value="${Math.min(clip.startAt, sliderMax).toFixed(1)}" />
          <em data-out>${clip.startAt.toFixed(1)}s</em>
        </label>
        ${beatsField}
        ${previewField}
        ${framingField}
        <label>Speed
          <select class="q-input" data-k="speed">
            ${[0.5, 0.75, 1, 1.5, 2]
              .map(
                (s) =>
                  `<option value="${s}"${(clip.speed ?? 1) === s ? " selected" : ""}>${s}×${
                    s === 0.5 ? ", slow motion" : s === 1 ? ", real time" : ""
                  }</option>`,
              )
              .join("")}
          </select>
        </label>
      </div>`;
    }
    const pv = editor.querySelector("video");
    if (pv) {
      pv.src = clip.url;
      pv.currentTime = clip.startAt + 0.05;
    }
    let previewTimer = 0;
    const stopPreview = () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = 0;
      cutPreviewStop = null;
      pv?.pause();
      stopSong();
    };
    const startInput = editor.querySelector<HTMLInputElement>('[data-k="start"]');
    if (startInput && pv) {
      const out = editor.querySelector<HTMLElement>("[data-out]")!;
      startInput.oninput = (e) => {
        stopPreview();
        clip.startAt = Number((e.target as HTMLInputElement).value);
        pv.currentTime = clip.startAt + 0.05;
        out.textContent = `${clip.startAt.toFixed(1)}s`;
      };
    }
    // The whole point of the gate: the clip's window and the song's slice for
    // that window, played TOGETHER. The video runs at the clip's own speed
    // for exactly the window (a still just holds); the audio is the very
    // seconds of the track this cut will sit on in the export. What you hear
    // here is what renders.
    editor.querySelector<HTMLButtonElement>('[data-k="preview"]')!.onclick = () => {
      if (!cut || !openPlan) return;
      if (previewTimer) {
        stopPreview();
        return;
      }
      if (pv) {
        pv.currentTime = clip.startAt;
        pv.playbackRate = clip.speed ?? 1;
        void pv.play().catch(() => undefined);
      }
      playSong(openPlan.songStart + cut.start, windowSec);
      cutPreviewStop = stopPreview;
      previewTimer = window.setTimeout(() => {
        previewTimer = 0;
        cutPreviewStop = null;
        pv?.pause();
      }, windowSec * 1000);
    };
    // A clip's own length, in beats. This is how a clip is slowed DOWN in the
    // edit sense — the same footage holding longer on the music — without
    // touching how fast the footage itself plays (that is the speed select).
    // The window changes, so the plan changes, so everything repaints.
    editor.querySelector<HTMLSelectElement>('[data-k="beats"]')!.onchange = (e) => {
      stopPreview();
      const v = (e.target as HTMLSelectElement).value;
      clip.beats = v ? Number(v) : null;
      paint();
    };
    editor.querySelector<HTMLSelectElement>('[data-k="bias"]')!.onchange = (e) => {
      clip.bias = Number((e.target as HTMLSelectElement).value) || 0;
    };
    // Speed remaps how fast the SOURCE is consumed; the cut still lands on the
    // beat, because cut times come from the plan, never from the footage. The
    // song is untouched — clips are silent — so there is no pitch to protect.
    // A sped-up clip that runs out of footage holds its last frame, the same
    // rule a too-short clip follows at 1×. Repainted so the slider re-spans
    // against the window at the new speed.
    const speedSel = editor.querySelector<HTMLSelectElement>('[data-k="speed"]');
    if (speedSel) {
      speedSel.onchange = (e) => {
        stopPreview();
        clip.speed = Number((e.target as HTMLSelectElement).value) || 1;
        paint();
      };
    }
    wrap.after(editor);
  }

  // The analysis segment's controls. No video and no trim — the breakdown is
  // synthesised, there is nothing to seek — just how long the cut holds and
  // how fast the breakdown plays inside it. Auto answers the complaint the
  // first live render earned: it holds exactly long enough to play the WHOLE
  // breakdown at the chosen speed, so nothing is ever cut off by default.
  if (openAna && analysisOn && analysisSource && openPlan) {
    const cut = openPlan.cuts.find((c) => c.clip === pos);
    const period = 60 / openPlan.bpm;
    const auto = autoAnalysisBeats();
    const editor = document.createElement("div");
    editor.className = "brp-trim brp-anatrim";
    editor.innerHTML = `
      <div class="brp-trim-fields">
        <b>Your analysis · ${cut ? `${cut.beats}♩ = ${(cut.end - cut.start).toFixed(2)}s of song` : ""}</b>
        <label>Plays for
          <select class="q-input" data-k="abeats">
            <option value="">Auto, long enough to play it all${auto ? ` (${auto}♩)` : ""}</option>
            ${[2, 3, 4, 6, 8, 10, 12]
              .map((b) => `<option value="${b}"${analysisBeats === b ? " selected" : ""}>${b}♩ = ${(b * period).toFixed(2)}s</option>`)
              .join("")}
          </select>
        </label>
        <label>Breakdown speed
          <select class="q-input" data-k="aspeed">
            ${[1, 1.5, 2]
              .map((s) => `<option value="${s}"${analysisSpeed === s ? " selected" : ""}>${s}×${s === 1 ? ", real time" : s === 2 ? ", the format's pace" : ""}</option>`)
              .join("")}
          </select>
        </label>
        <em>A hold shorter than the breakdown at this speed cuts it off mid-read. Auto never does.</em>
      </div>`;
    editor.querySelector<HTMLSelectElement>('[data-k="abeats"]')!.onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      analysisBeats = v ? Number(v) : null;
      paint();
    };
    editor.querySelector<HTMLSelectElement>('[data-k="aspeed"]')!.onchange = (e) => {
      analysisSpeed = Number((e.target as HTMLSelectElement).value) || 2;
      paint();
    };
    wrap.after(editor);
  }

  note(
    "brp-clipnote",
    reelCount()
      ? `${clips.length} clip${clips.length === 1 ? "" : "s"}${
          analysisOn ? ` + your analysis at ${analysisSpeed}×` : ""
        }, cut in the order shown.`
      : "Nothing attached yet.",
  );
}

function paintSong(): void {
  const wrap = host!.querySelector<HTMLElement>("#brp-song")!;
  if (!song) return;
  const g = grid()!;
  const sure = g.confidence >= 0.5;
  wrap.innerHTML = `
    <div class="brp-songcard${sure ? "" : " unsure"}">
      <b>${g.bpm ? g.bpm.toFixed(1) : "–"} BPM</b>
      <span>${escapeHTML(song.name)}</span>
      <em>${
        !g.bpm
          ? "No steady tempo found: this track cannot be cut to automatically."
          : sure
            ? `Steady tempo, read with confidence ${g.confidence.toFixed(2)}. Bars of ${g.beatsPerBar}.`
            : `Read with low confidence (${g.confidence.toFixed(2)}) — check the ticks line up with the spikes below before rendering.`
      }</em>
      <button type="button" class="btn gho" id="brp-song-swap">Different song</button>
    </div>`;
  wrap.querySelector<HTMLButtonElement>("#brp-song-swap")!.onclick = () =>
    host!.querySelector<HTMLInputElement>("#brp-song-input")!.click();
  note("brp-songnote", `Decoded on this device, ${fmt(song.duration)} long. Nothing was uploaded.`);
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

function paintWindow(): void {
  const sec = host!.querySelector<HTMLElement>("#brp-window-sec")!;
  const g = grid();
  sec.hidden = !song || !g?.bpm || !reelCount();
  if (sec.hidden || !song || !g) return;

  const plan = currentPlan();
  const marked = dropAt !== null;
  const pace = host!.querySelector<HTMLSelectElement>("#brp-pace")!;
  pace.disabled = fitSeconds != null && !marked;
  // A fitted length has no say while the drop anchors the window — the
  // input greys out so nobody types into a control that does nothing.
  const fit = host!.querySelector<HTMLInputElement>("#brp-fit")!;
  fit.disabled = marked;
  const startShown = plan?.songStart ?? songStart;
  if (marked && plan) {
    note(
      "brp-wantnote",
      `Anchored to the drop at ${fmt(dropAt!)}: the lead-in pulls the start back to ${fmt(
        startShown,
      )}, the rest runs on from the drop. ${plan.duration.toFixed(2)}s in all.`,
    );
  } else if (plan && fitSeconds != null) {
    // Read the pace back OFF the plan rather than restating what was asked
    // for: with a remainder shared out, the clips are not all the same length,
    // and saying "6 beats each" when two of them are seven is the kind of
    // small lie that makes somebody distrust the whole panel.
    const counts = plan.cuts.map((c) => c.beats);
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    note(
      "brp-wantnote",
      `Filling ${plan.duration.toFixed(2)}s of song with ${reelCount()} clips, ${
        lo === hi ? `${lo} beats each` : `${lo}–${hi} beats each, the spares on the first and last`
      }. Starting at ${fmt(startShown)}.`,
    );
  } else {
    const want = suggestWindow(g.bpm, reelCount(), beatsPerClip);
    note(
      "brp-wantnote",
      `${reelCount()} clips × ${beatsPerClip} beat${beatsPerClip === 1 ? "" : "s"} = ${want.seconds.toFixed(
        2,
      )}s (${want.bars} bars). Starting at ${fmt(startShown)}.`,
    );
  }
  note(
    "brp-wave-hint",
    marked
      ? "The window is anchored to the drop. Click to listen anywhere; shift-click to move the drop; ◂ ▸ or the arrow keys step a frame, shift for a beat."
      : "Click the waveform to set where the reel starts, while playing, playback jumps with it. Step onto the drop with ◂ ▸ or the arrow keys, then shift-click (or Mark) to pin it.",
  );

  const before = host!.querySelector<HTMLInputElement>("#brp-before")!;
  const beforeWrap = host!.querySelector<HTMLElement>("#brp-before-wrap")!;
  const clear = host!.querySelector<HTMLElement>("#brp-drop-clear")!;
  const set = host!.querySelector<HTMLElement>("#brp-drop-set")!;
  beforeWrap.hidden = !marked;
  clear.hidden = !marked;
  set.hidden = marked;
  // The window extends BACKWARD from the drop to hold whatever leads in, so
  // the only ceiling on the lead-in is the song's own runway: there have to
  // be enough beats of track before the drop to play those segments. The
  // input's range states that ceiling instead of accepting a number the song
  // cannot hold.
  let maxBefore = Math.max(1, reelCount() - 1);
  if (marked) {
    const runway = Math.floor(dropAt! / g.period + 1e-6);
    let k = 1;
    while (k < reelCount() - 1 && beatsBeforeDrop(k + 1) <= runway) k++;
    maxBefore = k;
    if (clipsBeforeDrop !== null && clipsBeforeDrop > maxBefore) clipsBeforeDrop = maxBefore;
  }
  before.max = String(maxBefore);
  before.value = String(Math.min(clipsBeforeDrop ?? 1, maxBefore));
  if (marked && plan) {
    const n = Math.min(clipsBeforeDrop ?? 1, maxBefore);
    const lead = beatsBeforeDrop(n);
    note(
      "brp-dropnote",
      `The drop is at ${fmt(dropAt!)}. ${n} segment${n === 1 ? "" : "s"} lead in (${lead}♩ = ${(
        lead * g.period
      ).toFixed(2)}s before it) and the reveal starts exactly on it. Longer lead-in segments pull the start earlier; the drop never moves.`,
    );
  } else {
    note("brp-dropnote", "Optional. The segment that starts on the drop is your reveal.");
  }

  drawWave();
}

/**
 * The onset envelope, the detected beat grid, and the chosen window.
 *
 * Drawn from the envelope rather than the samples because a modern master's
 * waveform is a solid block — every peak is at the ceiling, so it shows a
 * rectangle. The envelope shows the hits, which is what somebody scrubbing for
 * a section is actually looking for, and it lets the grid be checked against
 * the evidence it was derived from.
 */
function drawWave(): void {
  const canvas = host!.querySelector<HTMLCanvasElement>("#brp-wave");
  const g = grid();
  if (!canvas || !song || !g) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#12161a";
  ctx.fillRect(0, 0, W, H);

  // Envelope, one column per pixel, peak-holding so a single-frame spike is
  // never averaged into invisibility.
  const perPx = song.env.length / W;
  let max = 0;
  for (const v of song.env) if (v > max) max = v;
  ctx.fillStyle = "#3f4d57";
  for (let x = 0; x < W; x++) {
    let peak = 0;
    const from = Math.floor(x * perPx);
    const to = Math.min(song.env.length, Math.floor((x + 1) * perPx) + 1);
    for (let i = from; i < to; i++) if (song.env[i] > peak) peak = song.env[i];
    const h = max > 0 ? (peak / max) * (H - 34) : 0;
    ctx.fillRect(x, H - 22 - h, 1, h);
  }

  const xAt = (t: number) => (t / song!.duration) * W;

  // Every beat gets a small tick along the bottom, bars a taller blue one.
  // The ticks are the grid the cuts land on — lining a clip up "with a beat"
  // needs the beats visible, and checking the analysis against the spikes
  // above them is how a low-confidence read gets caught before a render.
  ctx.strokeStyle = "rgba(150,170,185,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i < g.beats.length; i++) {
    if (((i - g.downbeatOffset) % g.beatsPerBar + g.beatsPerBar) % g.beatsPerBar === 0) continue;
    const x = Math.round(xAt(g.beats[i])) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, H - 22);
    ctx.lineTo(x, H - 18);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(120,190,255,0.30)";
  for (let i = g.downbeatOffset; i < g.beats.length; i += g.beatsPerBar) {
    const x = Math.round(xAt(g.beats[i])) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, H - 22);
    ctx.lineTo(x, H - 14);
    ctx.stroke();
  }

  // The chosen window.
  const plan = currentPlan();
  if (plan) {
    const x0 = xAt(plan.songStart);
    const x1 = xAt(plan.songEnd);
    ctx.fillStyle = "rgba(96,214,164,0.16)";
    ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H - 22);
    ctx.strokeStyle = "#60d6a4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, H - 22);
    ctx.stroke();
    // Each cut, so the edit is visible before it is rendered.
    ctx.strokeStyle = "rgba(96,214,164,0.55)";
    ctx.lineWidth = 1;
    for (const cut of plan.cuts.slice(1)) {
      const x = Math.round(xAt(plan.songStart + cut.start)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, H - 22);
      ctx.stroke();
    }
    if (dropAt !== null) {
      // The drop is the loudest mark on the canvas because it is the loudest
      // moment of the edit: everything else is lined up against it. Full
      // height, red, labelled — nothing else here is red.
      const x = Math.round(xAt(dropAt)) + 0.5;
      ctx.strokeStyle = "#ff4d5e";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H - 14);
      ctx.stroke();
      ctx.fillStyle = "#ff4d5e";
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.fillText("DROP", x > W - 40 ? x - 36 : x + 5, 11);
    }
  }

  // A time ruler, so a position on this canvas maps to a position in a player.
  ctx.fillStyle = "#7c8a94";
  ctx.font = "10px ui-monospace, monospace";
  const step = song.duration > 240 ? 60 : song.duration > 90 ? 30 : 10;
  for (let t = 0; t < song.duration; t += step) {
    ctx.fillText(fmt(t), Math.min(W - 30, xAt(t) + 2), H - 6);
  }

  // The playhead, in the same canvas as the ruler it is read against, so the
  // two can never drift apart. White, because every other colour here already
  // means something — bars, window, cuts, drop. Dimmer while paused: the
  // position is still there (that is where space resumes and the arrows step
  // from), it is just not moving.
  const live = playheadTime();
  const at = live ?? pausedAt;
  if (at !== null && at <= song.duration) {
    const x = Math.round(xAt(at)) + 0.5;
    ctx.strokeStyle = live !== null ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H - 14);
    ctx.stroke();
  }
}

function paintPlan(): void {
  const sec = host!.querySelector<HTMLElement>("#brp-plan-sec")!;
  const plan = currentPlan();
  sec.hidden = !plan;
  if (!plan) return;
  const g2 = grid();
  const outroSec = outro && g2 ? g2.period * g2.beatsPerBar : 0;
  note(
    "brp-plannote",
    `${plan.cuts.length} cuts, ${plan.duration.toFixed(2)}s${outroSec ? ` + ${outroSec.toFixed(2)}s card` : ""}${longCta ? " + 30s CTA film" : ""}, every cut on a beat at ${plan.bpm.toFixed(1)} BPM.`,
  );
  const wrap = host!.querySelector<HTMLElement>("#brp-cuts")!;
  // Each tile states its length in beats AND seconds: the beats are the
  // grammar, the seconds are the answer to "so how long does my clip play".
  wrap.innerHTML = plan.cuts
    .map(
      (c) => `<span class="brp-cut${c.onDrop ? " drop" : ""}" style="flex:${c.beats}">
        <b>${c.clip + 1}</b><em>${c.beats}♩ · ${(c.end - c.start).toFixed(2)}s</em>${c.onDrop ? "<i>DROP</i>" : ""}
      </span>`,
    )
    .join("");
}

async function render(): Promise<void> {
  const plan = currentPlan();
  if (!plan || !song || busy) return;
  // The encoder needs the clip videos to itself — a preview still seeking
  // them mid-render would fight the export frame by frame.
  stopReelPreview();
  stopSong();
  busy = true;
  const go = host!.querySelector<HTMLButtonElement>("#brp-go")!;
  go.disabled = true;
  const progress = host!.querySelector<HTMLElement>("#brp-progress")!;
  try {
    const rendered = await renderBeatReel({
      clips: reelClips(),
      plan,
      song: { channels: song.channels, sampleRate: song.sampleRate },
      quality,
      outroBeats: outro ? grid()!.beatsPerBar : 0,
      longCta,
      onProgress: (f, label) => {
        progress.textContent = `${label}, ${Math.round(f * 100)}%`;
      },
    });
    const url = URL.createObjectURL(rendered.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `truemax-reel.${rendered.extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    progress.textContent =
      rendered.container === "mp4"
        ? "Saved."
        : "Saved as WebM: this browser cannot encode H.264. It plays everywhere but some uploaders prefer MP4.";
  } catch (err) {
    progress.textContent = err instanceof Error ? err.message : "The render failed.";
  } finally {
    busy = false;
    go.disabled = false;
  }
}
