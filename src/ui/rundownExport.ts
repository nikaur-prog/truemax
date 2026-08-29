import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Report, ScoredMetric } from "../engine/types.js";
import type { Beat } from "../engine/reelScript.js";
import { buildReelScript, narrationFrom, narrationOffsets, reelBlockers } from "../engine/reelScript.js";
import { alignTimeline, buildTimeline, fitTimeline } from "../engine/rundownTimeline.js";
import { decodeVoice, fetchNarration, mixRundownAudio, speechSpan } from "./rundownAudio.js";
import { CUTAWAY_TAIL, brollFor, drawRundownFrame, stageChanged } from "./rundownFrame.js";
import { DEFAULT_VERDICT_TONE, loadVerdictTone } from "../engine/analysisMode.js";
import { exportName, saveFile } from "./saveFile.js";
import type { SaveOutcome } from "./saveFile.js";

// ---------------------------------------------------------------------------
// Rendering a rundown.
//
// The two short cuts live in quickVideoExport.ts and are left alone. This is a
// separate path rather than a third branch inside that file, and the duplicated
// twenty lines of encoder setup are the price of that: the rundown has a
// variable duration, an audio track and a completely different compositor, and
// threading three of those through a function whose two existing callers work
// today is how working exports stop working.
//
// The order below is the only order that produces correct timing, and each step
// depends on the one before it:
//
//   1. script    — what is said, and in what order
//   2. narration — one synthesis request for the whole read
//   3. decode    — which is the first moment the real duration is known
//   4. FIT       — stretch the estimated timeline onto that duration
//   5. mix       — stamp the effects at their FITTED positions
//   6. encode    — frames against the fitted timeline, audio alongside
//
// Getting 4 and 5 the wrong way round is the subtle failure: everything still
// renders, and every click lands slightly early, by more and more as the video
// runs on. It would pass a smoke test and be obvious in the finished file.
// ---------------------------------------------------------------------------

// FULL 1080p vertical, not 720.
//
// 720x1280 is a legal TikTok upload and it is not what the reference accounts
// post. The platform re-encodes whatever it is given, so the file that arrives
// at the viewer is a compression of the file that was uploaded — and starting
// from 720 means the text, the measurement lines and the hairline detail in the
// photograph are already soft before that pass runs. At 1080 the same lines
// survive it.
//
// Everything in the compositor is authored in 720x1280 coordinates and scaled,
// so this is one constant rather than a layout rewrite. The cost is 2.25x the
// pixels per frame; a rundown still encodes in well under a minute.
const W = 1080;
const H = 1920;
const FPS = 30;

// The compositor is authored in 720x1280 and drawn through a transform.
//
// Every constant in rundownFrame.ts — safe areas, font sizes, row pitches, the
// caption baseline — was chosen against a 720-wide frame and verified by
// rendering it. Raising the output by rewriting all of them would be a layout
// change dressed as a resolution change, and the first thing to break would be
// the safe-zone arithmetic that took a template to get right. Scaling the
// context instead means the layout is byte-identical and only the raster is
// bigger, which is the whole of what was asked for.
const LOGICAL_W = 720;
const LOGICAL_H = 1280;

export interface RundownOptions {
  /** The full name, said once in the hook. */
  name: string;
  /**
   * What to call them for the rest of the video. Defaults to the first word.
   * See ReelScriptOptions.shortName for why it is overridable.
   */
  shortName?: string;
  /** Non-facial context for the fairness beat — height, titles, whatever. */
  context?: string[];
  /** A closing disclaimer in the operator's own words, read verbatim. */
  note?: string;
  /** The opening line, when the default question is not the one being asked. */
  opening?: string;
  /**
   * Extra photographs of the same person, shown but never measured.
   *
   * Cutaways only, on the beats that draw no geometry — see RundownInput.broll
   * for why that restriction is what makes the feature safe rather than what
   * limits it. Nothing here reaches the landmarker, the scoring or the report.
   */
  broll?: Array<{ image: CanvasImageSource; landmarks?: NormalizedLandmark[] }>;
  /**
   * Footage for the disclaimer, and the one point in the video where choosing
   * footage to a duration is actually possible.
   *
   * Everything else is timed by a synthesiser whose real length nobody knows
   * until the mp3 comes back. The disclaimer is different: spokenSeconds gives
   * its length from the text alone, while it is being typed, so an operator can
   * go and find that much footage and say where in it to start.
   *
   * Up to four clips, played in order, sharing that one budget. Fifteen seconds
   * of talking can be five from one clip and ten from another, which is the
   * difference between a disclaimer that looks like a held shot and one that
   * looks cut.
   *
   * `startAt` is where in the source file to begin and `length` is how much of
   * the sentence this clip covers. If the clips together come up short the last
   * frame holds rather than cutting to black — a gap is the one failure that
   * looks like a broken render rather than a short edit.
   */
  disclaimer?: { clips: Array<{ video: HTMLVideoElement; startAt: number; length: number }> };
  /** Supabase access token; the TTS route is staff-gated. */
  accessToken?: string;
  /**
   * Which cut to render. "short" is the fast, trait-led cut (the $2.99
   * product and the TikTok default); "full" (default) is the deep read.
   * One flag, threaded to the script builder and the frame renderer — the
   * pacing difference comes free, because the timeline fits the narration.
   */
  cut?: "short" | "full";
  /** How far off level the capture is, for the publish guard. */
  offAxisDeg?: number;
  jawWarnDeg?: number;
  onProgress?: (progress: number, stage: string) => void;
  /** Stops an export whose owning scan/media set has been replaced. */
  shouldCancel?: () => boolean;
}

export class RundownBlocked extends Error {
  constructor(readonly blockers: string[]) {
    super(blockers.join(" "));
    this.name = "RundownBlocked";
  }
}

export class RundownCancelled extends Error {
  constructor() {
    super("The scan changed, so the old export was stopped.");
    this.name = "RundownCancelled";
  }
}

export interface RundownResult {
  outcome: SaveOutcome;
  beats: Beat[];
  duration: number;
  /** False when the voice track could not be produced and the cut is silent. */
  narrated: boolean;
  /** Which service spoke ("elevenlabs" | "openai"), absent on a silent cut. */
  voiceProvider?: string;
}

export async function downloadRundownVideo(
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  report: Report,
  options: RundownOptions,
): Promise<RundownResult> {
  const { onProgress } = options;
  const ensureCurrent = () => {
    if (options.shouldCancel?.()) throw new RundownCancelled();
  };
  ensureCurrent();

  // The refusal comes first, before any work and before any billable call. A
  // capture the app itself would warn a paying customer about must not be
  // published with a number on it — nobody but us will ever check, which is
  // exactly why it has to be checked here.
  const blockers = reelBlockers(report, options.offAxisDeg ?? 0, options.jawWarnDeg ?? 8);
  if (blockers.length) throw new RundownBlocked(blockers);

  onProgress?.(0, "Writing the running order");
  const beats = buildReelScript(report, {
    name: options.name,
    shortName: options.shortName,
    context: options.context,
    note: options.note,
    opening: options.opening,
    // The operator's chosen register, so the video and the page it was exported
    // from call one face the same thing.
    tone: loadVerdictTone() ?? DEFAULT_VERDICT_TONE,
    cut: options.cut,
  });

  onProgress?.(0.05, "Recording the voiceover");
  const spoken = options.accessToken
    ? await fetchNarration(narrationFrom(beats), options.accessToken)
    : null;
  ensureCurrent();
  const voice = await decodeVoice(spoken?.audio ?? null);
  ensureCurrent();

  // Time before mixing. See the header — this is the ordering that matters.
  //
  // THREE PATHS, best first.
  //
  //   1. The synthesiser told us when it said every character. Beat starts are
  //      looked up rather than predicted, and there is nothing left to be wrong
  //      about. This is the path a narrated rundown takes.
  //
  //   2. Audio but no alignment — an older model, or a voice that does not
  //      return it. Fall back to fitting the estimate onto the span of real
  //      sound, which is where this was before and is slightly late.
  //
  //   3. No audio at all. The estimate stands on its own and the cut is silent.
  //
  // Two rounds of tuning path 2 got closer and stayed visibly late, because it
  // is a model of how a voice reads and a model of a thing is not the thing.
  const estimated = buildTimeline(beats);
  const span = voice ? speechSpan(voice) : null;
  const timeline = spoken?.alignment
    ? alignTimeline(estimated, spoken.alignment, narrationOffsets(beats))
    : span
      ? fitTimeline(estimated, span.end - span.start, span.start)
      : estimated;

  onProgress?.(0.12, "Mixing the audio");
  // The cutaway whoosh, stamped where a shot will actually arrive. The
  // timeline cannot know whether B-roll exists, so the cues are appended here
  // — after fitting, before mixing — by asking the same brollFor the renderer
  // will ask, so a cue can never sound over a cut that does not happen.
  if (options.broll?.length) {
    const probe = { timeline, broll: options.broll } as Parameters<typeof brollFor>[0];
    for (const b of timeline.beats) {
      // A stage change is a cut to a different photograph — the same event a
      // cutaway's whoosh marks, so it takes the same sound, at the boundary.
      if (b.beat.kind === "metric" && stageChanged(probe, b)) {
        timeline.sfx.push({ at: b.start, kind: "whoosh" });
      }
      const at = b.beat.kind === "metric" ? b.start + b.duration * (1 - CUTAWAY_TAIL) : b.start;
      if (brollFor(probe, b, at + 0.01)) timeline.sfx.push({ at, kind: "whoosh" });
    }
    timeline.sfx.sort((a, b) => a.at - b.at);
  }
  const audio = await mixRundownAudio(voice, timeline);
  ensureCurrent();

  const metrics = new Map<string, ScoredMetric>();
  for (const metric of report.metrics) metrics.set(metric.def.id, metric);

  const {
    Output,
    BufferTarget,
    Mp4OutputFormat,
    CanvasSource,
    AudioBufferSource,
    QUALITY_HIGH,
    getFirstEncodableVideoCodec,
    getFirstEncodableAudioCodec,
  } = await import("mediabunny");
  ensureCurrent();

  const format = new Mp4OutputFormat({ fastStart: "in-memory" });
  // 1080p first, 720p when the encoder refuses. Mobile browsers report codec
  // support per RESOLUTION, and "Couldn't render" on a phone was that refusal
  // surfacing as a dead button. The compositor is authored at 720x1280 and
  // drawn through a transform, so the fallback changes only the raster: same
  // layout, softer pixels, a video that actually exists.
  let outW = W;
  let outH = H;
  let videoCodec = null as Awaited<ReturnType<typeof getFirstEncodableVideoCodec>>;
  for (const [tryW, tryH] of [[W, H], [LOGICAL_W, LOGICAL_H]]) {
    videoCodec = await getFirstEncodableVideoCodec(
      format.getSupportedVideoCodecs().filter((candidate) => candidate === "avc"),
      { width: tryW, height: tryH, quality: QUALITY_HIGH },
    );
    if (videoCodec) {
      outW = tryW;
      outH = tryH;
      break;
    }
  }
  if (!videoCodec) throw new Error("This browser cannot encode an H.264 MP4.");
  const scale = outW / LOGICAL_W;
  const audioCodec = await getFirstEncodableAudioCodec(
    format.getSupportedAudioCodecs().filter((candidate) => candidate === "aac"),
    { numberOfChannels: 1, sampleRate: audio.buffer.sampleRate },
  );
  if (!audioCodec) throw new Error("This browser cannot encode AAC audio.");

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // One overlay canvas for the whole render. drawMeasurement reallocates its
  // backing buffer whenever the size changes, and at thirty frames a second for
  // a minute that would be eighteen hundred reallocations of a full-resolution
  // canvas — which is precisely the lag that had to be fixed in the interactive
  // overlay for the same reason.
  const overlayCanvas = document.createElement("canvas");

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const videoSource = new CanvasSource(canvas, {
    codec: videoCodec,
    // Retain texture through social-platform recompression. The old six-megabit
    // encode was technically 1080p but visibly softened hair and thin overlays
    // before TikTok compressed it a second time. Scale the compatibility
    // fallback rather than spending 1080p bitrate on a 720p raster.
    bitrate: outW >= W ? 12_000_000 : 6_000_000,
    keyFrameInterval: 2,
  });
  const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 128_000 });
  const frameCount = Math.round(FPS * audio.duration);
  output.addVideoTrack(videoSource, { frameRate: FPS, maximumPacketCount: frameCount + 4 });
  output.addAudioTrack(audioSource);
  output.setMetadataTags({ title: `TrueMax rundown — ${options.name}`, artist: "TrueMax" });
  await output.start();

  // Audio first and in one call: the whole track is a single buffer, so there is
  // no interleaving to get wrong and the encoder can work through it while the
  // frames are still being composited.
  await audioSource.add(audio.buffer);

  const input = {
    timeline,
    metrics,
    // The short form: this feeds the bottom bar and the curve marker, and a
    // full name under a marker is a label that owns the frame it sits in.
    name: (options.shortName?.trim() || options.name.trim().split(/\s+/)[0] || options.name).trim(),
    broll: options.broll,
    disclaimerLine: options.note?.trim() || undefined,
    // Set per frame below: which clip is on screen depends on t.
    disclaimerClip: undefined as CanvasImageSource | undefined,
    cut: options.cut,
  };

  // The disclaimer beat, so the clip can be seeked to the right frame rather
  // than played from wherever it happened to stop.
  const noteBeat = options.note?.trim()
    ? timeline.beats.find((b) => b.beat.kind === "context" && b.beat.line === options.note!.trim())
    : undefined;

  for (let frame = 0; frame < frameCount; frame++) {
    ensureCurrent();
    const t = frame / FPS;
    // Seeked per frame, and only while its own beat is on screen. A video
    // element left running would drift against a timeline that is fitted to the
    // audio afterwards; seeking makes the clip a function of t like everything
    // else in this renderer, which is what keeps a re-render identical.
    // Which clip is showing, and where in it. Walking the list per frame rather
    // than precomputing a schedule, because the beat's start and duration are
    // only final after the timeline has been fitted to the real audio.
    if (options.disclaimer?.clips.length && noteBeat) {
      const local = t - noteBeat.start;
      if (local >= 0 && local < noteBeat.duration) {
        let cursor = 0;
        let active = options.disclaimer.clips[options.disclaimer.clips.length - 1];
        let into = Math.max(0, local - (totalOf(options.disclaimer.clips) - active.length));
        for (const clip of options.disclaimer.clips) {
          if (local < cursor + clip.length) {
            active = clip;
            into = local - cursor;
            break;
          }
          cursor += clip.length;
        }
        await seekTo(active.video, active.startAt + into);
        input.disclaimerClip = active.video;
      } else {
        input.disclaimerClip = undefined;
      }
    }
    // Reset and re-apply per frame rather than once outside the loop: the
    // compositor saves and restores freely, and a transform that survived a
    // stray restore would silently draw one frame at the wrong size.
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawRundownFrame(ctx, photo, landmarks, input, t, {
      width: LOGICAL_W,
      height: LOGICAL_H,
      overlayCanvas,
    });
    await videoSource.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 15 === 0) onProgress?.(0.15 + 0.8 * (frame / frameCount), "Rendering");
  }

  await output.finalize();
  ensureCurrent();
  if (!target.buffer) throw new Error("The MP4 encoder returned no file.");

  onProgress?.(0.98, "Saving");
  const outcome = await saveFile(
    new Blob([target.buffer], { type: format.mimeType }),
    exportName("rundown", "mp4", options.name),
    "rundown",
  );
  onProgress?.(1, "Done");
  return {
    outcome,
    beats,
    duration: audio.duration,
    narrated: Boolean(voice),
    voiceProvider: voice ? spoken?.provider : undefined,
  };
}

const totalOf = (clips: Array<{ length: number }>) => clips.reduce((a, c) => a + c.length, 0);

// Seek and wait for the frame to actually be there.
//
// drawImage on a video that has not finished seeking paints the PREVIOUS frame,
// which on a per-frame render is not a glitch but a systematic one-frame lag
// that gets worse the further the seek travels.
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, Math.min(time, Math.max(0, (video.duration || 0) - 0.05)));
  if (Math.abs(video.currentTime - target) < 0.001) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = target;
    // A seek that never lands must not hang a ninety-second render.
    window.setTimeout(done, 400);
  });
}

// The local slug is gone: exportName in saveFile.ts slugifies its own label,
// so keeping a second copy here would be two spellings of one rule waiting to
// disagree about what an apostrophe does.
