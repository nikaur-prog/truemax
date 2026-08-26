import { applyEnhance, lookFor } from "../engine/enhance.js";
import type { EnhanceLook } from "../engine/enhance.js";
import { seekTo } from "./beatReelExport.js";

// ---------------------------------------------------------------------------
// The video half of the Enhance pillar.
//
// Same discipline as the reel export: frames are SEEKED, never played, so the
// result is deterministic and immune to how busy the phone is; everything
// stays on the device. Each frame is resampled to the output size, run
// through the same enhancement math the preview showed (identical code, so
// the preview cannot lie), and encoded. The source's own soundtrack is
// decoded from the original bytes and muxed back in untouched — enhancing a
// clip must never cost it its audio.
// ---------------------------------------------------------------------------

const FPS = 30;

export interface EnhancedFile {
  blob: Blob;
  container: "mp4" | "webm";
  extension: string;
}

export interface EnhanceVideoOptions {
  video: HTMLVideoElement;
  /** The original file bytes, for decoding the audio track. */
  bytes: ArrayBuffer;
  look: EnhanceLook;
  /** Output scale (1 = keep size). Callers use upscaleFor(). */
  scale: number;
  onProgress?: (fraction: number, label: string) => void;
}

export async function enhanceVideo(opts: EnhanceVideoOptions): Promise<EnhancedFile> {
  const { video, look, scale, onProgress } = opts;
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) throw new Error("That video has no readable frames.");
  // Encoders want even dimensions; a stray odd pixel fails the whole export.
  const w = Math.max(2, Math.round((sw * scale) / 2) * 2);
  const h = Math.max(2, Math.round((sh * scale) / 2) * 2);
  const duration = Math.max(0.1, (video.duration || 0) - 0.05);
  const frameCount = Math.max(1, Math.round(FPS * duration));
  const scaled = lookFor(look, Math.max(w, h));

  onProgress?.(0.02, "Reading the sound");
  // The source's own audio, decoded from the file bytes. Failure is normal —
  // a silent clip, or a codec this browser cannot decode — and costs only the
  // sound, never the export.
  let audio: AudioBuffer | null = null;
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    audio = await ctx.decodeAudioData(opts.bytes.slice(0));
  } catch {
    audio = null;
  }

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

  // MP4/H.264 first for the same reason the reel tries it first: it is the
  // file every platform ingests. VP9-in-WebM is the honest fallback on
  // builds without proprietary codecs.
  const attempts: Array<{
    container: "mp4" | "webm";
    format: InstanceType<typeof Mp4OutputFormat | typeof WebMOutputFormat>;
    video: string[];
    audio: string[];
  }> = [
    { container: "mp4", format: new Mp4OutputFormat({ fastStart: "in-memory" }), video: ["avc"], audio: ["aac"] },
    { container: "webm", format: new WebMOutputFormat(), video: ["vp9", "vp8", "av1"], audio: ["opus"] },
  ];

  let chosen:
    | { container: "mp4" | "webm"; format: (typeof attempts)[number]["format"]; videoCodec: string; audioCodec: string | null }
    | null = null;
  for (const attempt of attempts) {
    const videoCodec = await getFirstEncodableVideoCodec(
      attempt.format.getSupportedVideoCodecs().filter((c) => attempt.video.includes(c)) as never,
      { width: w, height: h, quality: QUALITY_HIGH },
    );
    if (!videoCodec) continue;
    let audioCodec: string | null = null;
    if (audio) {
      audioCodec = await getFirstEncodableAudioCodec(
        attempt.format.getSupportedAudioCodecs().filter((c) => attempt.audio.includes(c)) as never,
        { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate },
      );
      // A container that can hold the video but not the sound is not chosen
      // over one that can hold both.
      if (!audioCodec) continue;
    }
    chosen = { container: attempt.container, format: attempt.format, videoCodec, audioCodec };
    break;
  }
  if (!chosen && audio) {
    // Nothing can carry this audio — keep the enhancement, lose the sound,
    // rather than refusing the whole job.
    audio = null;
    for (const attempt of attempts) {
      const videoCodec = await getFirstEncodableVideoCodec(
        attempt.format.getSupportedVideoCodecs().filter((c) => attempt.video.includes(c)) as never,
        { width: w, height: h, quality: QUALITY_HIGH },
      );
      if (!videoCodec) continue;
      chosen = { container: attempt.container, format: attempt.format, videoCodec, audioCodec: null };
      break;
    }
  }
  if (!chosen) throw new Error("This browser cannot encode video at this size.");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";

  // Bitrate scales with pixels off the reel's 12 Mbps @ 1080x1920 anchor —
  // enhanced footage exists to look better, so starving it defeats the point.
  const bitrate = Math.round(Math.min(40_000_000, Math.max(6_000_000, (w * h) / 2_073_600 * 12_000_000)));

  const target = new BufferTarget();
  const output = new Output({ format: chosen.format, target });
  const videoSource = new CanvasSource(canvas, {
    codec: chosen.videoCodec as never,
    bitrate,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: FPS, maximumPacketCount: frameCount + 4 });
  let audioSource: InstanceType<typeof AudioBufferSource> | null = null;
  if (audio && chosen.audioCodec) {
    audioSource = new AudioBufferSource({ codec: chosen.audioCodec as never, bitrate: 192_000 });
    output.addAudioTrack(audioSource);
  }
  await output.start();
  if (audio && audioSource) await audioSource.add(audio);

  onProgress?.(0.06, "Enhancing");
  for (let frame = 0; frame < frameCount; frame++) {
    const t = frame / FPS;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, sw, sh, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    applyEnhance(data.data, w, h, scaled);
    ctx.putImageData(data, 0, 0);
    await videoSource.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 5 === 0) onProgress?.(0.06 + 0.9 * (frame / frameCount), "Enhancing");
  }

  await output.finalize();
  if (!target.buffer) throw new Error("The encoder returned no file.");
  onProgress?.(1, "Done");
  return {
    blob: new Blob([target.buffer], { type: chosen.format.mimeType }),
    container: chosen.container,
    extension: chosen.container,
  };
}
