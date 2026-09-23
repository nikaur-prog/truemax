/** Camera-only feedback. Sound and animation must never prevent photo review. */
export const CAPTURE_FEEDBACK_MS = 420;
export const CAPTURE_REDUCED_FEEDBACK_MS = 120;

export const CAPTURE_TICKS = {
  2: { frequency: 660, gain: 0.035, seconds: 0.09 },
  1: { frequency: 880, gain: 0.065, seconds: 0.12 },
} as const;

let context: AudioContext | null = null;

function captureAudio(): AudioContext | null {
  try {
    const Audio = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return null;
    if (!context || context.state === "closed") context = new Audio();
    // Safari can interrupt audio while acquiring the camera. Some DOM type
    // definitions omit that state, but it needs the same recovery as suspend.
    const state = context.state as string;
    if (state === "suspended" || state === "interrupted") void context.resume().catch(() => {});
    return context;
  } catch { return null; }
}

/** Call from the gesture that opens/arms the camera, not from an upload. */
export function primeCaptureAudio(): void {
  const audio = captureAudio();
  if (!audio) return;
  try {
    // Playing one silent sample also unlocks older mobile Web Audio engines.
    const source = audio.createBufferSource();
    source.buffer = audio.createBuffer(1, 1, audio.sampleRate);
    source.connect(audio.destination);
    source.onended = () => source.disconnect();
    source.start();
  } catch { /* Unsupported or blocked audio leaves visual feedback working. */ }
}

/** Exactly two countdown notes: a soft 2, then a higher, stronger 1. */
export function playCaptureTick(remaining: number): void {
  if (remaining !== 2 && remaining !== 1) return;
  const audio = captureAudio();
  if (!audio) return;
  try {
    const tick = CAPTURE_TICKS[remaining];
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const at = audio.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(tick.frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(tick.gain, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + tick.seconds);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at);
    oscillator.stop(at + tick.seconds + 0.02);
  } catch { /* A failed beep never cancels a photograph. */ }
}

/** Short, paired noise impulses read as a mechanical shutter, not another beep. */
function playShutter(): void {
  const audio = captureAudio();
  if (!audio) return;
  try {
    const source = audio.createBufferSource();
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.14), audio.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) {
      const time = index / audio.sampleRate;
      const first = time < 0.04 ? Math.exp(-time * 105) : 0;
      const second = time >= 0.055 ? Math.exp(-(time - 0.055) * 75) * 0.7 : 0;
      samples[index] = (Math.random() * 2 - 1) * (first + second);
    }
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 850;
    const gain = audio.createGain();
    gain.gain.value = 0.16;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  } catch { /* The captured image still proceeds to review. */ }
}

export interface CaptureFeedbackOptions {
  /** The existing camera viewport, before its video styles are reset. */
  frame: HTMLElement;
  /** Copies the current zoom/crop so the frozen photograph does not jump. */
  video?: HTMLVideoElement;
  signal?: AbortSignal;
}

/**
 * Only call with a successfully captured camera frame. The source canvas is
 * never edited: a temporary presentation copy freezes the exact photograph.
 * Resolves on completion or cancellation, including browsers without animation.
 */
export function showCaptureFeedback(snapshot: HTMLCanvasElement, options: CaptureFeedbackOptions): Promise<void> {
  if (options.signal?.aborted || !snapshot.width || !snapshot.height) return Promise.resolve();
  return new Promise((resolve) => {
    let layer: HTMLDivElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const animations: Animation[] = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", finish);
      animations.forEach((animation) => { try { animation.cancel(); } catch { /* Already detached. */ } });
      layer?.remove();
      resolve();
    };
    try {
      const bounds = options.frame.getBoundingClientRect();
      if (!bounds.width || !bounds.height || options.frame.isConnected === false) { finish(); return; }
      const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      layer = document.createElement("div");
      layer.className = "capture-feedback";
      Object.assign(layer.style, {
        position: "fixed", left: `${bounds.left}px`, top: `${bounds.top}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`, zIndex: "1000",
        overflow: "hidden", pointerEvents: "none", background: "#101412",
        borderRadius: getComputedStyle(options.frame).borderRadius,
      });
      const frozen = document.createElement("canvas");
      frozen.width = snapshot.width;
      frozen.height = snapshot.height;
      frozen.setAttribute("aria-hidden", "true");
      const drawing = frozen.getContext("2d");
      if (!drawing) { finish(); return; }
      if (options.video) {
        // Camera.capture() has already mirrored the user-facing source. Undo
        // that on this copy before applying the video's existing CSS mirror.
        if (!options.video.classList.contains("unmirrored")) {
          drawing.translate(frozen.width, 0);
          drawing.scale(-1, 1);
        }
        const preview = getComputedStyle(options.video);
        Object.assign(frozen.style, {
          position: "absolute", left: preview.left, top: preview.top,
          width: preview.width, height: preview.height,
          objectFit: preview.objectFit, objectPosition: preview.objectPosition,
          transform: preview.transform, transformOrigin: preview.transformOrigin,
        });
      } else {
        Object.assign(frozen.style, { width: "100%", height: "100%", objectFit: "contain" });
      }
      drawing.drawImage(snapshot, 0, 0);
      layer.append(frozen);
      const status = document.createElement("div");
      status.setAttribute("role", "status");
      status.textContent = "Photo captured";
      Object.assign(status.style, {
        position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        borderRadius: "999px", padding: "10px 18px", background: "rgba(9, 20, 17, 0.78)",
        color: "#fff", font: "600 15px system-ui, sans-serif", whiteSpace: "nowrap",
      });
      layer.append(status);
      if (!reducedMotion) {
        for (const side of ["top", "bottom"] as const) {
          const curtain = document.createElement("div");
          curtain.setAttribute("aria-hidden", "true");
          const away = `translateY(${side === "top" ? "-" : ""}101%)`;
          Object.assign(curtain.style, {
            position: "absolute", left: "0", width: "100%", height: "50.2%",
            [side]: "0", background: "#0e1412", transform: away,
          });
          layer.append(curtain);
          if (typeof curtain.animate === "function") {
            animations.push(curtain.animate([
              { transform: away, offset: 0 },
              { transform: "translateY(0)", offset: 0.22 },
              { transform: "translateY(0)", offset: 0.33 },
              { transform: away, offset: 0.76 },
              { transform: away, offset: 1 },
            ], { duration: CAPTURE_FEEDBACK_MS, easing: "ease-in-out", fill: "both" }));
          }
        }
      }
      document.body.append(layer);
      options.signal?.addEventListener("abort", finish, { once: true });
      if (options.signal?.aborted) { finish(); return; }
      playShutter();
      timer = setTimeout(finish, reducedMotion ? CAPTURE_REDUCED_FEEDBACK_MS : CAPTURE_FEEDBACK_MS);
    } catch { finish(); }
  });
}
