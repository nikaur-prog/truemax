import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";
import { cloneSidePoints } from "./sideFeedbackPayload.js";
import type { SideSeedMethod } from "./sideFeedbackPayload.js";

export type SideReviewMode = "calibration" | undefined;
export type SideCaptureWarning = "detector-unavailable" | "automatic-placement-failed" | "automatic-placement-timeout" | "cloud-unavailable";

export interface RecoverableSideSeed {
  points: SidePoints;
  faceDir: number;
  method: SideSeedMethod;
  confidence: number;
  templateFallback?: boolean;
}

/** Calibration evidence, not proof that any landmark was correctly detected. */
export interface SideCaptureDiagnostics {
  coordinateSpace: "review-image-pixels";
  localAutomaticPoints: SidePoints | null;
  localMethod: SideSeedMethod | null;
  localConfidence: number | null;
  templateFallback: boolean;
  warnings: SideCaptureWarning[];
  /** Operator-confirmed out-of-range readings remain excluded by the engine. */
  reviewedRangeWarnings?: string[];
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

/** Invalid image dimensions are preparation errors, never detector failures. */
export function sideImageSize(width: number, height: number, maximum = 1400): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(maximum) || maximum < 1) {
    throw new Error("The photo has no usable image dimensions.");
  }
  const scale = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function finiteSeed(seed: RecoverableSideSeed): boolean {
  return SIDE_POINTS.every(({ id }) => Number.isFinite(seed.points?.[id]?.x) && Number.isFinite(seed.points?.[id]?.y));
}

/** Pure point flip: the photograph and captured automatic evidence stay unchanged. */
export function flipSideReviewPoints(points: SidePoints, width: number): SidePoints {
  const next = cloneSidePoints(points);
  for (const { id } of SIDE_POINTS) next[id].x = width - next[id].x;
  return next;
}

/**
 * Public capture retains its existing failure behaviour. An explicitly enabled
 * calibration review attempts the reader even if detector preparation fails,
 * then recovers to a labelled editable template. Cancellation never recovers.
 */
export async function recoverSideSeed(input: {
  mode: SideReviewMode;
  signal: AbortSignal;
  prepare: () => Promise<void>;
  read: (signal: AbortSignal) => Promise<RecoverableSideSeed>;
  template: () => RecoverableSideSeed;
  /** Bounded admin work only; no change to the public reader's budget. */
  timeoutMs?: number;
}): Promise<{ seed: RecoverableSideSeed; diagnostics?: SideCaptureDiagnostics }> {
  const warnings: SideCaptureWarning[] = [];
  const calibration = input.mode === "calibration";
  const local = new AbortController();
  const abort = () => local.abort();
  input.signal.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const work = async (): Promise<RecoverableSideSeed> => {
    cancelled(input.signal);
    try {
      await input.prepare();
    } catch (error) {
      cancelled(input.signal);
      if (!calibration) throw error;
      warnings.push("detector-unavailable");
    }
    cancelled(local.signal);
    const seed = await input.read(local.signal);
    cancelled(local.signal);
    if (!finiteSeed(seed)) throw new Error("Automatic placement returned incomplete points.");
    return seed;
  };
  const abortable = new Promise<never>((_, reject) => {
    local.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  });
  if (calibration) timer = setTimeout(() => { timedOut = true; local.abort(); }, input.timeoutMs ?? 15000);
  try {
    const seed = await Promise.race([work(), abortable]);
    cancelled(input.signal);
    return {
      seed: seed.templateFallback ? { ...seed, confidence: 0 } : seed,
      diagnostics: calibration ? {
        coordinateSpace: "review-image-pixels",
        localAutomaticPoints: cloneSidePoints(seed.points),
        localMethod: seed.method,
        localConfidence: seed.templateFallback ? 0 : Number.isFinite(seed.confidence) ? seed.confidence : null,
        templateFallback: seed.templateFallback === true,
        warnings,
      } : undefined,
    };
  } catch (error) {
    cancelled(input.signal);
    if (!calibration) throw error;
    const seed = input.template();
    if (!finiteSeed(seed)) throw new Error("The starting points could not be prepared.");
    return {
      seed: { ...seed, confidence: 0 },
      diagnostics: {
        coordinateSpace: "review-image-pixels",
        localAutomaticPoints: null,
        localMethod: null,
        localConfidence: null,
        templateFallback: true,
        warnings: [...warnings, timedOut ? "automatic-placement-timeout" : "automatic-placement-failed"],
      },
    };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", abort);
  }
}
