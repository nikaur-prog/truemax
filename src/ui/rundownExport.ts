import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Report, ScoredMetric } from "../engine/types.js";
import type { Beat } from "../engine/reelScript.js";
import { buildReelScript, narrationFrom, reelBlockers } from "../engine/reelScript.js";
import { buildTimeline, fitTimeline } from "../engine/rundownTimeline.js";
import { decodeVoice, fetchNarration, mixRundownAudio } from "./rundownAudio.js";
import { drawRundownFrame } from "./rundownFrame.js";
import { saveFile } from "./saveFile.js";
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

const W = 720;
const H = 1280;
const FPS = 30;

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
  /**
   * Extra photographs of the same person, shown but never measured.
   *
   * Cutaways only, on the beats that draw no geometry — see RundownInput.broll
   * for why that restriction is what makes the feature safe rather than what
   * limits it. Nothing here reaches the landmarker, the scoring or the report.
   */
  broll?: CanvasImageSource[];
  /**
   * Footage for the disclaimer, and the one point in the video where choosing
   * footage to a duration is actually possible.
   *
   * Everything else is timed by a synthesiser whose real length nobody knows
   * until the mp3 comes back. The disclaimer is different: spokenSeconds gives
   * its length from the text alone, while it is being typed, so an operator can
   * go and find that much footage and say where in it to start.
   *
   * `startAt` is where in the file to begin. The clip plays forward from there
   * for as long as the sentence takes; anything past that is never reached.
   */
  disclaimer?: { video: HTMLVideoElement; startAt: number };
  /** Supabase access token; the TTS route is staff-gated. */
  accessToken?: string;
  /** How far off level the capture is, for the publish guard. */
  offAxisDeg?: number;
  jawWarnDeg?: number;
  onProgress?: (progress: number, stage: string) => void;
}

export class RundownBlocked extends Error {
  constructor(readonly blockers: string[]) {
    super(blockers.join(" "));
    this.name = "RundownBlocked";
  }
}

export interface RundownResult {
  outcome: SaveOutcome;
  beats: Beat[];
  duration: number;
  /** False when the voice track could not be produced and the cut is silent. */
  narrated: boolean;
}

export async function downloadRundownVideo(
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  report: Report,
  options: RundownOptions,
): Promise<RundownResult> {
  const { onProgress } = options;

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
  });

  onProgress?.(0.05, "Recording the voiceover");
  const spoken = options.accessToken
    ? await fetchNarration(narrationFrom(beats), options.accessToken)
    : null;
  const voice = await decodeVoice(spoken);

  // Fit before mixing. See the header — this is the ordering that matters.
  const estimated = buildTimeline(beats);
  const timeline = voice ? fitTimeline(estimated, voice.duration) : estimated;

  onProgress?.(0.12, "Mixing the audio");
  const audio = await mixRundownAudio(voice, timeline);

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

  const format = new Mp4OutputFormat({ fastStart: "in-memory" });
  const videoCodec = await getFirstEncodableVideoCodec(
    format.getSupportedVideoCodecs().filter((candidate) => candidate === "avc"),
    { width: W, height: H, quality: QUALITY_HIGH },
  );
  if (!videoCodec) throw new Error("This browser cannot encode an H.264 MP4.");
  const audioCodec = await getFirstEncodableAudioCodec(
    format.getSupportedAudioCodecs().filter((candidate) => candidate === "aac"),
    { numberOfChannels: 1, sampleRate: audio.buffer.sampleRate },
  );
  if (!audioCodec) throw new Error("This browser cannot encode AAC audio.");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
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
    bitrate: 6_000_000,
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
    disclaimerClip: options.disclaimer?.video,
  };

  // The disclaimer beat, so the clip can be seeked to the right frame rather
  // than played from wherever it happened to stop.
  const noteBeat = options.note?.trim()
    ? timeline.beats.find((b) => b.beat.kind === "context" && b.beat.line === options.note!.trim())
    : undefined;

  for (let frame = 0; frame < frameCount; frame++) {
    const t = frame / FPS;
    // Seeked per frame, and only while its own beat is on screen. A video
    // element left running would drift against a timeline that is fitted to the
    // audio afterwards; seeking makes the clip a function of t like everything
    // else in this renderer, which is what keeps a re-render identical.
    if (options.disclaimer && noteBeat && t >= noteBeat.start && t < noteBeat.start + noteBeat.duration) {
      await seekTo(options.disclaimer.video, options.disclaimer.startAt + (t - noteBeat.start));
    }
    drawRundownFrame(ctx, photo, landmarks, input, t, { width: W, height: H, overlayCanvas });
    await videoSource.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 15 === 0) onProgress?.(0.15 + 0.8 * (frame / frameCount), "Rendering");
  }

  await output.finalize();
  if (!target.buffer) throw new Error("The MP4 encoder returned no file.");

  onProgress?.(0.98, "Saving");
  const outcome = await saveFile(
    new Blob([target.buffer], { type: format.mimeType }),
    `truemax-rundown-${slug(options.name)}-${Date.now()}.mp4`,
  );
  onProgress?.(1, "Done");
  return { outcome, beats, duration: audio.duration, narrated: Boolean(voice) };
}

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

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "face";
}
