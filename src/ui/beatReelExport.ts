import type { BeatPlan } from "../engine/beatPlan.js";
import { activeCut, applyEdgeFades, coverRect, sliceAudio, sourceTime } from "../engine/reelFrame.js";
import { drawCtaCard } from "./ctaCard.js";

// ---------------------------------------------------------------------------
// The beat-cut reel, rendered and encoded.
//
// One clip per cut, each held for a whole number of beats, over the window of
// the song the cuts were planned against. The cuts are not "close to" the beat
// — every start time in the plan IS a beat time, computed from the tempo rather
// than rounded to a frame at the end, so the only quantisation left is the
// video frame rate itself.
//
// EVERYTHING IS A FUNCTION OF t. Clips are seeked, never played: a video
// element left running drifts against the encoder, which does not run in real
// time, and the drift is invisible on a short clip and obvious on a long one.
// Seeking each frame makes a re-render byte-identical and means the export
// cannot be affected by how busy the machine is.
//
// NOTHING IS UPLOADED. The clips and the song are read from the user's disk
// into memory, muxed here, and saved back to disk. For a tool whose input is
// somebody else's copyrighted track, that is the only defensible design.
// ---------------------------------------------------------------------------

export interface ReelClip {
  /** Absent on a synthetic segment — see `draw`. */
  video?: HTMLVideoElement;
  /** Seconds into the source where this clip starts. */
  startAt: number;
  /** Crop bias along the cropped axis, -1 to 1. Heads want a little negative. */
  bias?: number;
  /** Playback rate through the source. 1 is real time. */
  speed?: number;
  /**
   * A segment RENDERED rather than seeked: the analysis reel, drawn per frame
   * as a pure function of time into the cut. It rides the same beat plan as
   * every video clip — the planner neither knows nor cares that one of its
   * cuts is synthesised — and it owns its own playback speed internally, so
   * `speed` is ignored when this is set. `dur` is the cut's full length, so a
   * segment can stage itself (a before card handing over to an after card at
   * the midpoint) without guessing how long it has.
   */
  draw?: (ctx: CanvasRenderingContext2D, w: number, h: number, into: number, dur: number) => void;
}

/** 1080×1920 is the platform native; 2160×3840 is the opt-in. */
export type ReelQuality = "1080" | "4k";

const SIZES: Record<ReelQuality, { w: number; h: number; bitrate: number }> = {
  // Bitrates chosen for footage that CUTS every couple of beats. Each cut is a
  // new keyframe's worth of information, so a beat reel is far harder to encode
  // than a talking head at the same resolution and starves at the bitrate that
  // would be generous for one.
  "1080": { w: 1080, h: 1920, bitrate: 12_000_000 },
  // Four times the pixels does not need four times the bits, but it needs most
  // of it. Below about 35 the extra resolution is spent on compression noise,
  // which is worse than not having gone up at all.
  "4k": { w: 2160, h: 3840, bitrate: 38_000_000 },
};

const FPS = 30;

export interface BeatReelOptions {
  clips: ReelClip[];
  plan: BeatPlan;
  /** The decoded song. Only the plan's window is written into the export. */
  song: { channels: Float32Array[]; sampleRate: number };
  quality?: ReelQuality;
  /**
   * End on the TrueMax card, held for this many beats after the last clip.
   *
   * The card starts exactly where the final cut ends — a beat by construction
   * — and a four-beat outro is one bar, so the music underneath it finishes a
   * phrase rather than being chopped mid-thought. The CTA is the one part of
   * the reel that is ours rather than the creator's, which is why it is an
   * option and not a default they cannot see.
   */
  outroBeats?: number;
  /** Painted over the clip that lands on the drop — the reveal. */
  onDropFrame?: (ctx: CanvasRenderingContext2D, w: number, h: number, into: number, hold: number) => void;
  onProgress?: (fraction: number, label: string) => void;
}


export interface RenderedReel {
  blob: Blob;
  /** "mp4" everywhere it is possible; see the fallback note in the renderer. */
  container: "mp4" | "webm";
  codec: string;
  /** The extension to save under — the container, but without the guessing. */
  extension: string;
}

/**
 * Render the plan to a video file and hand back the blob.
 *
 * Returned rather than saved, so the caller decides between a download and a
 * preview without this module knowing which.
 */
export async function renderBeatReel(options: BeatReelOptions): Promise<RenderedReel> {
  const { clips, plan, song } = options;
  if (!clips.length) throw new Error("No clips to cut.");
  if (!plan.cuts.length) throw new Error("The plan has no cuts.");
  const size = SIZES[options.quality ?? "1080"];
  const { onProgress } = options;
  const period = plan.bpm > 0 ? 60 / plan.bpm : 0;
  const outroSeconds = Math.max(0, options.outroBeats ?? 0) * period;
  const total = plan.duration + outroSeconds;

  onProgress?.(0.02, "Preparing the music");
  // The music runs under the outro too — the card is the last cut of the
  // edit, not a separate video stapled on after the song stops.
  const channels = sliceAudio(song.channels, song.sampleRate, plan.songStart, total);
  applyEdgeFades(channels, song.sampleRate);

  const {
    Output,
    BufferTarget,
    Mp4OutputFormat,
    WebMOutputFormat,
    CanvasSource,
    AudioBufferSource,
    QUALITY_HIGH,
    getFirstEncodableVideoCodec,
    getFirstEncodableAudioCodec,
  } = await import("mediabunny");

  // MP4/H.264 first, because it is the file every platform ingests without
  // re-encoding and the one that will play on a phone somebody AirDrops it to.
  //
  // But H.264 is patent-encumbered and genuinely absent from some builds —
  // Chromium compiled without proprietary codecs cannot encode it at all, which
  // is not a hypothetical: it is exactly the state of the browser this feature
  // is tested in. Refusing there means the entire render is thrown away over
  // the container. VP9-in-WebM is universally available, costs nothing in
  // quality, and the caller is handed the container so it can name the file
  // honestly rather than writing .mp4 on something that is not one.
  const attempts: Array<{ container: "mp4" | "webm"; format: InstanceType<typeof Mp4OutputFormat | typeof WebMOutputFormat>; video: string[]; audio: string[] }> = [
    { container: "mp4", format: new Mp4OutputFormat({ fastStart: "in-memory" }), video: ["avc"], audio: ["aac"] },
    { container: "webm", format: new WebMOutputFormat(), video: ["vp9", "vp8", "av1"], audio: ["opus"] },
  ];

  let chosen: { container: "mp4" | "webm"; format: (typeof attempts)[number]["format"]; videoCodec: string; audioCodec: string } | null = null;
  for (const attempt of attempts) {
    const videoCodec = await getFirstEncodableVideoCodec(
      attempt.format.getSupportedVideoCodecs().filter((c) => attempt.video.includes(c)) as never,
      { width: size.w, height: size.h, quality: QUALITY_HIGH },
    );
    if (!videoCodec) continue;
    const audioCodec = await getFirstEncodableAudioCodec(
      attempt.format.getSupportedAudioCodecs().filter((c) => attempt.audio.includes(c)) as never,
      { numberOfChannels: channels.length, sampleRate: song.sampleRate },
    );
    if (!audioCodec) continue;
    chosen = { container: attempt.container, format: attempt.format, videoCodec, audioCodec };
    break;
  }

  // Named for what the person can do about it: at 4K the first thing to try is
  // the 1080 export, which is a different sentence from "your browser cannot
  // make videos".
  if (!chosen) {
    throw new Error(
      options.quality === "4k"
        ? "This browser cannot encode video at 4K. Try the 1080 export."
        : "This browser cannot encode video.",
    );
  }
  const { format, videoCodec, audioCodec } = chosen;

  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const videoSource = new CanvasSource(canvas, {
    codec: videoCodec as never,
    bitrate: size.bitrate,
    keyFrameInterval: 2,
  });
  const audioSource = new AudioBufferSource({ codec: audioCodec as never, bitrate: 192_000 });
  const frameCount = Math.max(1, Math.round(FPS * total));
  output.addVideoTrack(videoSource, { frameRate: FPS, maximumPacketCount: frameCount + 4 });
  output.addAudioTrack(audioSource);
  output.setMetadataTags({ title: "TrueMax reel", artist: "TrueMax" });
  await output.start();

  // The music goes in as one buffer while the frames are still being drawn.
  const buffer = new AudioBuffer({
    numberOfChannels: channels.length,
    length: channels[0]?.length || 1,
    sampleRate: song.sampleRate,
  });
  // Copied into a fresh view rather than handed over directly: a Float32Array
  // is typed by the kind of buffer behind it, and copyToChannel will not accept
  // one that might be shared.
  channels.forEach((ch, i) => buffer.copyToChannel(new Float32Array(ch), i));
  await audioSource.add(buffer);

  onProgress?.(0.08, "Cutting");
  for (let frame = 0; frame < frameCount; frame++) {
    const t = frame / FPS;

    // The outro claims everything after the last cut. Checked FIRST, because
    // activeCut deliberately hands t >= the final cut's end back to the final
    // clip (its guard against a black last frame), and here that time belongs
    // to the card instead.
    if (outroSeconds > 0 && t >= plan.duration) {
      drawCtaCard(ctx, size.w, size.h, t - plan.duration, period);
      await videoSource.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
      if (frame % 10 === 0) onProgress?.(0.08 + 0.88 * (frame / frameCount), "Cutting");
      continue;
    }

    const hit = activeCut(plan.cuts, t);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size.w, size.h);

    if (hit) {
      const clip = clips[hit.cut.clip % clips.length];
      if (clip?.draw) {
        clip.draw(ctx, size.w, size.h, hit.into, hit.cut.end - hit.cut.start);
      } else if (clip?.video) {
        await seekTo(clip.video, sourceTime(
          { startAt: clip.startAt, duration: clip.video.duration || 0 },
          hit.into,
          clip.speed,
        ));
        const sw = clip.video.videoWidth;
        const sh = clip.video.videoHeight;
        const r = coverRect(sw, sh, size.w, size.h, clip.bias ?? 0);
        if (r.sw > 0 && r.sh > 0) {
          ctx.drawImage(clip.video, r.sx, r.sy, r.sw, r.sh, 0, 0, size.w, size.h);
        }
      }
      if (hit.cut.onDrop && options.onDropFrame) {
        options.onDropFrame(ctx, size.w, size.h, hit.into, hit.cut.end - hit.cut.start);
      }
    }

    await videoSource.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 10 === 0) onProgress?.(0.08 + 0.88 * (frame / frameCount), "Cutting");
  }

  await output.finalize();
  if (!target.buffer) throw new Error("The encoder returned no file.");
  onProgress?.(1, "Done");
  return {
    blob: new Blob([target.buffer], { type: format.mimeType }),
    container: chosen.container,
    codec: videoCodec,
    extension: chosen.container,
  };
}

/**
 * Seek, and wait for the frame to actually arrive.
 *
 * drawImage on a video mid-seek paints the PREVIOUS frame, which shows up as
 * an edit that is consistently one cut behind — the failure mode that looks
 * like a beat-detection bug and is not one. The timeout exists because a seek
 * on a damaged file can simply never fire, and a render must not hang on it;
 * a stale frame is a far better outcome than a stuck export.
 */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, Math.min(time, Math.max(0, (video.duration || 0) - 0.05)));
  if (Math.abs(video.currentTime - target) < 0.001) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      clearTimeout(timer);
      resolve();
    };
    video.addEventListener("seeked", done);
    const timer = setTimeout(done, 2000);
    video.currentTime = target;
  });
}
