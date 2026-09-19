import { createHash } from "node:crypto";
import sharp from "sharp";
import { prepareLandmarkImage } from "../api/_sideLandmarks.js";
import type { LandmarkPass, PreparedImage, SideLandmarkResult } from "../api/_sideLandmarks.js";
import { fuseSideSeeds } from "../src/engine/sideSeedFusion.js";
import type { FusedSideSeed } from "../src/engine/sideSeedFusion.js";
import type { SidePoints } from "../src/engine/sideMetrics.js";
import {
  SIDE_PLACEMENT_DEFAULT_TIMEOUT_MS,
  SIDE_PLACEMENT_MAX_TIMEOUT_MS,
  SIDE_PLACEMENT_RESPONSE_RESERVE_MS,
  sidePlacementDeadline,
  sidePlacementProtocolVersion,
} from "../src/engine/sidePlacementRequest.js";
import { cloudSideSeedFractions, parseCloudSidePlacement } from "../src/ui/sideCloudPlacement.js";

export const EVALUATION_REVIEW_WIDTH = 640;
export const EVALUATION_CAPTURE_MAX_SIDE = 1400;
export type EvaluationMode = "production" | "diagnostic";
export type EvaluationDelivery = "cloud" | "signed_out" | "device_choice";
export type EvaluationOutcome = "success" | "timeout" | "rate_limited" | "unavailable" | "invalid_response" | "invalid_seed" | "refused" | "signed_out" | "device_choice";

export interface EvaluationSettings {
  mode: EvaluationMode;
  delivery: EvaluationDelivery;
  seeded: boolean;
  zoom: boolean;
  samples: number;
  timeoutMs: number;
  responseReserveMs: number;
}

/** Production options cannot accidentally become an unlimited raw benchmark. */
export function evaluationSettings(input: {
  mode?: string;
  delivery?: string;
  seeded?: boolean;
  zoom?: boolean;
  samples?: number;
  timeoutMs?: number;
} = {}): EvaluationSettings {
  const mode = input.mode ?? "production";
  const delivery = input.delivery ?? "cloud";
  if (mode !== "production" && mode !== "diagnostic") throw new Error("Use --mode production or diagnostic");
  if (delivery !== "cloud" && delivery !== "signed_out" && delivery !== "device_choice") throw new Error("Invalid delivery cohort");
  if (mode === "production" && (input.seeded === false || input.zoom === false || (input.samples !== undefined && input.samples !== 1) || (input.timeoutMs !== undefined && input.timeoutMs !== SIDE_PLACEMENT_DEFAULT_TIMEOUT_MS))) {
    throw new Error("Changed seed, zoom, samples or timeout require --mode diagnostic");
  }
  const samples = input.samples ?? 1;
  const timeoutMs = input.timeoutMs ?? (mode === "production" ? SIDE_PLACEMENT_DEFAULT_TIMEOUT_MS : SIDE_PLACEMENT_MAX_TIMEOUT_MS);
  if (!Number.isInteger(samples) || samples < 1 || samples > 5) throw new Error("Samples must be an integer from 1 to 5");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= SIDE_PLACEMENT_RESPONSE_RESERVE_MS || timeoutMs > SIDE_PLACEMENT_MAX_TIMEOUT_MS) throw new Error("Invalid evaluation timeout");
  return {
    mode, delivery, seeded: input.seeded ?? true, zoom: input.zoom ?? true, samples, timeoutMs,
    responseReserveMs: SIDE_PLACEMENT_RESPONSE_RESERVE_MS,
  };
}

export interface EvaluationSource {
  /** Upright pixels, materialized before the request clock starts, like the capture canvas. */
  upright: Buffer;
  width: number;
  height: number;
  frame: { w: number; h: number };
}

export async function prepareEvaluationSource(bytes: Buffer): Promise<EvaluationSource> {
  const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: EVALUATION_CAPTURE_MAX_SIDE, height: EVALUATION_CAPTURE_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  // metadata() on a queued rotate still describes its input. Only the actual
  // output dimensions may normalize hints or map returned points to labels.
  return { upright: data, width: info.width, height: info.height, frame: { w: EVALUATION_REVIEW_WIDTH, h: info.height * EVALUATION_REVIEW_WIDTH / info.width } };
}

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Cannot fingerprint nonfinite input");
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Cannot fingerprint missing input");
  return encoded;
}

export function evaluationHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export interface EvaluationFingerprint { imageHash: string; seedHash: string; protocolHash: string }
export function evaluationFingerprint(image: Buffer, seed: SidePoints | null, protocolHash: string): EvaluationFingerprint {
  return { imageHash: createHash("sha256").update(image).digest("hex"), seedHash: evaluationHash(seed), protocolHash };
}

export function evaluationCacheMatches(
  cached: { fingerprint?: EvaluationFingerprint; runs?: unknown[] } | null | undefined,
  fingerprint: EvaluationFingerprint,
  repeat = 1,
): boolean {
  return !!cached?.fingerprint && Object.keys(fingerprint).every((key) => cached.fingerprint![key as keyof EvaluationFingerprint] === fingerprint[key as keyof EvaluationFingerprint])
    && (cached.runs?.length ?? 0) + 1 >= repeat;
}

export interface EvaluationMetrics {
  attemptedCalls: number;
  calls?: number;
  usage: LandmarkPass["usage"];
  failureOutcome?: EvaluationOutcome;
}

export interface EvaluationRun {
  result: SideLandmarkResult | null;
  outcome: EvaluationOutcome;
  delivered: FusedSideSeed;
  usage: LandmarkPass["usage"];
  attemptedCalls: number;
  calls: number;
  ms: number;
  zoomed?: LandmarkPass["zoomed"];
  stages?: LandmarkPass["stages"];
  gonion?: LandmarkPass["gonion"];
  gonionDisagreement?: number | null;
  mentonRetried?: boolean;
  seeded?: boolean;
  windows?: LandmarkPass["windows"];
  spread?: LandmarkPass["spread"];
}

export function evaluationFailureOutcome(error: unknown): EvaluationOutcome {
  const value = error && typeof error === "object" ? error as { name?: string; code?: string; status?: number } : {};
  if (value.name === "AbortError" || value.code === "ETIMEDOUT" || value.status === 408) return "timeout";
  if (value.status === 429) return "rate_limited";
  if (value.code === "refusal") return "refused";
  if (value.code === "invalid_response") return "invalid_response";
  return "unavailable";
}

/** Also used when scoring cached runs, so stale stored bands are never trusted. */
export function deliveredEvaluationPoints(seed: SidePoints, result: SideLandmarkResult | null, frame: EvaluationSource["frame"], version: string, seeded: boolean): FusedSideSeed {
  const cloud = result && parseCloudSidePlacement({ ...result, version: sidePlacementProtocolVersion(version, seeded) }, frame.w, frame.h);
  return fuseSideSeeds(seed, cloud?.points ?? null, cloud?.confidenceByPoint, undefined, cloud?.evidence);
}

export interface EvaluationAttemptDependencies {
  read: (image: PreparedImage, hint: SidePoints | null, signal: AbortSignal) => Promise<LandmarkPass>;
  metrics?: () => EvaluationMetrics;
  /** Injected only by synthetic tests. Normal runs use production preparation and deadline. */
  encode?: (source: EvaluationSource) => Promise<PreparedImage>;
  deadline?: typeof sidePlacementDeadline;
}

/**
 * Local replay of the client's one total budget and server response reserve.
 * Encoding and server preparation count; source capture happened beforehand.
 * Browser upload, auth and quota latency are not simulated, so this is not a
 * substitute for a separately authorized end-to-end latency study.
 */
export async function runEvaluationAttempt(source: EvaluationSource, seed: SidePoints, settings: EvaluationSettings, version: string, dependencies: EvaluationAttemptDependencies): Promise<EvaluationRun> {
  const started = performance.now();
  const fallback = (outcome: EvaluationOutcome): EvaluationRun => {
    const metrics = dependencies.metrics?.();
    return { result: null, outcome, delivered: fuseSideSeeds(seed, null), usage: { ...(metrics?.usage ?? { inputTokens: 0, outputTokens: 0 }) }, attemptedCalls: metrics?.attemptedCalls ?? 0, calls: metrics?.calls ?? 0, ms: performance.now() - started, seeded: settings.seeded };
  };
  if (settings.delivery !== "cloud") return fallback(settings.delivery);
  const hint = cloudSideSeedFractions(seed, source.frame.w, source.frame.h);
  if (settings.seeded && !hint) return fallback("invalid_seed");
  const deadline = (dependencies.deadline ?? sidePlacementDeadline)(settings.timeoutMs - settings.responseReserveMs);
  let removeAbort = () => {};
  const aborted = new Promise<EvaluationRun>((resolve) => {
    const onAbort = () => resolve(fallback("timeout"));
    removeAbort = () => deadline.signal.removeEventListener("abort", onAbort);
    if (deadline.signal.aborted) onAbort();
    else deadline.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const work = async (): Promise<EvaluationRun> => {
      deadline.signal.throwIfAborted();
      const image = await (dependencies.encode ?? (async (input) => {
        const jpeg = await sharp(input.upright).jpeg({ quality: 82 }).toBuffer();
        if (jpeg.length > 2_000_000) throw Object.assign(new Error("Image exceeds the upload bound"), { code: "invalid_response" });
        return prepareLandmarkImage(jpeg);
      }))(source);
      deadline.signal.throwIfAborted();
      const pass = await dependencies.read(image, settings.seeded ? hint : null, deadline.signal);
      deadline.signal.throwIfAborted();
      if (performance.now() - started >= settings.timeoutMs - settings.responseReserveMs) return fallback("timeout");
      const cloud = parseCloudSidePlacement({ ...pass.result, version: sidePlacementProtocolVersion(version, pass.seeded) }, source.frame.w, source.frame.h);
      if (!cloud) return fallback("invalid_response");
      const metrics = dependencies.metrics?.();
      return {
        result: pass.result, outcome: "success",
        delivered: fuseSideSeeds(seed, cloud.points, cloud.confidenceByPoint, undefined, cloud.evidence),
        usage: { ...(metrics?.usage ?? pass.usage) }, attemptedCalls: metrics?.attemptedCalls ?? pass.attemptedCalls, calls: metrics?.calls ?? pass.calls,
        ms: performance.now() - started, zoomed: pass.zoomed, stages: pass.stages, gonion: pass.gonion,
        gonionDisagreement: pass.gonionDisagreement, mentonRetried: pass.mentonRetried, seeded: pass.seeded, windows: pass.windows, spread: pass.spread,
      };
    };
    return await Promise.race([work(), aborted]);
  } catch (error) {
    if (deadline.signal.aborted) return fallback("timeout");
    const outcome = evaluationFailureOutcome(error);
    return fallback(outcome === "unavailable" ? dependencies.metrics?.().failureOutcome ?? outcome : outcome);
  } finally {
    removeAbort();
    deadline.dispose();
  }
}
