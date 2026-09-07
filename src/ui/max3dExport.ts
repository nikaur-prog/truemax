import type { Max3DHandle, Max3DState, Max3DView } from "./max3d.js";

interface ExampleStep { at: number; state: Max3DState; view: Max3DView; label: string }
export interface Max3DExample { id: string; title: string; durationMs: number; steps: readonly ExampleStep[] }
export const MAX_3D_EXAMPLES: readonly Max3DExample[] = [
  { id: "idle-listen-think", title: "Coach presence", durationMs: 12_000, steps: [
    { at: 0, state: "idle", view: "three-quarter", label: "Idle" },
    { at: 4_000, state: "listening", view: "three-quarter", label: "Listening" },
    { at: 8_000, state: "thinking", view: "three-quarter", label: "Thinking" },
  ] },
  { id: "speak-celebrate-listen", title: "Speech and celebration", durationMs: 12_000, steps: [
    { at: 0, state: "speaking", view: "front", label: "Speaking animation" },
    { at: 4_000, state: "celebrate", view: "three-quarter", label: "Celebration, then idle" },
    { at: 8_000, state: "listening", view: "front", label: "Listening" },
  ] },
  { id: "views-and-quiet", title: "Four views", durationMs: 12_000, steps: [
    { at: 0, state: "idle", view: "front", label: "Front / idle" },
    { at: 3_000, state: "quiet", view: "three-quarter", label: "Three-quarter / quiet" },
    { at: 6_000, state: "idle", view: "side", label: "Side / idle" },
    { at: 9_000, state: "quiet", view: "back", label: "Back / quiet" },
  ] },
  { id: "wave-shock-angry", title: "Expressions and waving", durationMs: 15_000, steps: [
    { at: 0, state: "wave", view: "three-quarter", label: "Hello / 3D wave" },
    { at: 5_000, state: "shocked", view: "front", label: "Surprised" },
    { at: 10_000, state: "angry", view: "front", label: "Playfully grumpy" },
  ] },
  { id: "mirror-skate-guitar", title: "Playful routines", durationMs: 15_000, steps: [
    { at: 0, state: "mirror", view: "three-quarter", label: "Mirror check" },
    { at: 5_000, state: "skate", view: "three-quarter", label: "Skating on the spot" },
    { at: 10_000, state: "guitar", view: "front", label: "Air-time guitar" },
  ] },
];

export function max3DRecordingMime(supported: (mime: string) => boolean): string | null {
  return ["video/mp4;codecs=avc1.42001E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(supported) ?? null;
}

export interface Max3DRecording { blob: Blob; extension: "mp4" | "webm"; filename: string }

/** Local development capture only. Never accesses a camera, microphone, account or network. */
export function recordMax3DExample(stage: HTMLElement, handle: Max3DHandle, example: Max3DExample, options: {
  signal: AbortSignal;
  onStatus?: (message: string) => void;
}): Promise<Max3DRecording> {
  if (!MAX_3D_EXAMPLES.includes(example)) return Promise.reject(new Error("Choose one of the bounded example clips."));
  if (options.signal.aborted) return Promise.reject(new DOMException("Export cancelled.", "AbortError"));
  if (typeof MediaRecorder === "undefined") return Promise.reject(new Error("Video export is not supported in this browser. Try desktop Chrome."));
  const mime = max3DRecordingMime((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) return Promise.reject(new Error("This browser has no supported video recorder."));
  const output = document.createElement("canvas");
  const snapshot = document.createElement("canvas");
  output.width = output.height = 576;
  snapshot.width = snapshot.height = 576;
  const g = output.getContext("2d", { alpha: false });
  const pixels = snapshot.getContext("2d");
  if (!g || !pixels || typeof output.captureStream !== "function") return Promise.reject(new Error("Canvas video export is unavailable."));

  return new Promise((resolve, reject) => {
    let settled = false;
    let stopping = false;
    let source: HTMLCanvasElement | null = null;
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const chunks: Blob[] = [];
    let bytes = 0;
    let startedAt = 0;
    let frameCount = 0;
    let step = example.steps[0];

    function cleanup(): void {
      if (tick !== null) clearInterval(tick);
      for (const timer of timers) clearTimeout(timer);
      stage.removeEventListener("max3dframe", frame);
      source?.removeEventListener("webglcontextlost", lost);
      document.removeEventListener("visibilitychange", visibility);
      options.signal.removeEventListener("abort", abort);
      if (recorder) {
        recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
        if (recorder.state !== "inactive") { try { recorder.stop(); } catch { /* already closing */ } }
      }
      stream?.getTracks().forEach((track) => track.stop());
      output.width = output.height = snapshot.width = snapshot.height = 1;
    }
    function fail(error: unknown): void {
      if (settled) return;
      settled = true;
      cleanup();
      chunks.length = 0;
      reject(error instanceof Error ? error : new Error("The video could not be recorded."));
    }
    function abort(): void { fail(new DOMException("Export cancelled.", "AbortError")); }
    function lost(): void { fail(new Error("The 3D context closed. Reload the character and export again.")); }
    function visibility(): void { if (document.hidden) fail(new Error("Export stopped because the tab was hidden. Keep the preview visible while recording.")); }
    function setStep(next: ExampleStep): void {
      if (settled || stopping) return;
      step = next;
      handle.setView(next.view); handle.setAnimation(next.state);
      options.onStatus?.(`Recording ${example.title}: ${next.label.toLowerCase()}. Keep this tab and character visible.`);
    }
    function paint(): void {
      if (settled || stopping) return;
      if (options.signal.aborted) return abort();
      if (document.hidden) return visibility();
      if (!stage.isConnected || !source?.isConnected || source.style.visibility === "hidden") return fail(new Error("The character is no longer visible. Keep the preview onscreen and try again."));
      try {
        g!.fillStyle = "#eef3f7"; g!.fillRect(0, 0, 576, 576);
        g!.fillStyle = "#20364a"; g!.font = "600 20px system-ui,sans-serif"; g!.textAlign = "left";
        g!.fillText("TRUEMAX / MAX", 30, 40);
        g!.fillStyle = "#6a7c8b"; g!.font = "12px system-ui,sans-serif"; g!.textAlign = "right";
        g!.fillText("3D PROTOTYPE", 546, 39);
        const fit = Math.min(496 / snapshot.width, 438 / snapshot.height);
        const width = snapshot.width * fit, height = snapshot.height * fit;
        g!.drawImage(snapshot, (576 - width) / 2, 62 + (438 - height) / 2, width, height);
        g!.textAlign = "center"; g!.fillStyle = "#20364a"; g!.font = "600 20px system-ui,sans-serif";
        g!.fillText(step.label, 288, 528);
        g!.fillStyle = "#667988"; g!.font = "12px system-ui,sans-serif";
        g!.fillText("Actual character animation / silent local capture", 288, 552);
      } catch (error) { fail(error); }
    }
    function finish(): void {
      if (settled || stopping) return;
      paint();
      if (settled) return;
      if (frameCount < 12) return fail(new Error("Too few 3D frames were rendered. Keep the preview visible and try again."));
      stopping = true;
      if (tick !== null) clearInterval(tick);
      options.onStatus?.("Finishing the local video file...");
      try { recorder!.stop(); } catch (error) { fail(error); }
    }
    function start(): void {
      try {
        // The first real WebGL frame has already been copied, never the SVG fallback.
        paint();
        if (settled) return;
        stream = output.captureStream(30);
        recorder = new MediaRecorder(stream, { mimeType: mime!, videoBitsPerSecond: 3_000_000 });
        recorder.ondataavailable = (event) => {
          if (settled || !event.data.size) return;
          bytes += event.data.size;
          if (bytes > 32_000_000) return fail(new Error("The recording exceeded its local size budget."));
          chunks.push(event.data);
        };
        recorder.onerror = () => fail(new Error("The browser video recorder failed. Try another supported browser."));
        recorder.onstop = () => {
          if (settled) return;
          if (!stopping || !chunks.length) return fail(new Error("The browser returned an empty or incomplete video."));
          const type = recorder!.mimeType || mime!;
          const blob = new Blob(chunks, { type });
          const extension = type.startsWith("video/mp4") ? "mp4" : "webm";
          settled = true;
          cleanup();
          resolve({ blob, extension, filename: `max-${example.id}.${extension}` });
        };
        recorder.start(250);
        startedAt = performance.now();
        tick = setInterval(paint, 1000 / 30);
        for (const next of example.steps.slice(1)) timers.push(setTimeout(() => setStep(next), next.at));
        timers.push(setTimeout(finish, example.durationMs));
        timers.push(setTimeout(() => fail(new Error("The video recorder did not finish in time.")), example.durationMs + 5_000));
      } catch (error) { fail(error); }
    }
    function frame(event: Event): void {
      if (settled || stopping) return;
      const candidate = event.target as HTMLCanvasElement;
      if (candidate.dataset?.max3d !== "true" || !candidate.width || !candidate.height) return;
      if (source && source !== candidate) return fail(new Error("The character was replaced during recording."));
      if (!source) { source = candidate; source.addEventListener("webglcontextlost", lost); }
      try {
        // This event runs synchronously after WebGL rendering, before its non-preserved
        // drawing buffer is cleared by browser compositing. Quiet frames reuse this copy.
        const scale = Math.min(1, 720 / Math.max(source.width, source.height));
        const width = Math.round(source.width * scale), height = Math.round(source.height * scale);
        if (snapshot.width !== width || snapshot.height !== height) { snapshot.width = width; snapshot.height = height; }
        pixels!.clearRect(0, 0, width, height);
        pixels!.drawImage(source, 0, 0, width, height);
        frameCount++;
        if (!recorder) start();
      } catch (error) { fail(error); }
    }
    stage.addEventListener("max3dframe", frame);
    document.addEventListener("visibilitychange", visibility);
    options.signal.addEventListener("abort", abort, { once: true });
    timers.push(setTimeout(() => { if (!startedAt) fail(new Error("No 3D frame arrived. Load the character, keep it visible and check motion preferences.")); }, 15_000));
    if (document.hidden) return visibility();
    setStep(step);
    options.onStatus?.("Waiting for the first real 3D frame...");
  });
}
