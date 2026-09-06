/** Local, bounded timing diagnostics. Never includes image, score or account data. */
export const SCAN_PERFORMANCE_STAGES = [
  "download", "model_init", "front_inference", "capture_review", "side_seed",
  "side_cloud", "report_paint", "auth_return",
] as const;
export type ScanPerformanceStage = typeof SCAN_PERFORMANCE_STAGES[number];
export const SCAN_PERFORMANCE_OUTCOMES = [
  "success", "error", "cancelled", "timeout", "refused", "fallback", "skipped",
] as const;
export type ScanPerformanceOutcome = typeof SCAN_PERFORMANCE_OUTCOMES[number];
export interface ScanStageTiming {
  stage: ScanPerformanceStage;
  durationMs: number;
  outcome: ScanPerformanceOutcome;
}
export interface ScanAttemptTiming {
  /** Ephemeral sequence in this page only, not a scan or person identifier. */
  attempt: number;
  durationMs: number;
  outcome: ScanPerformanceOutcome | "pending";
  stages: ScanStageTiming[];
}
export interface ScanPerformanceAttempt {
  /** First call per stage wins. Finishing is idempotent. */
  start(stage: ScanPerformanceStage): (outcome?: ScanPerformanceOutcome) => void;
  finish(outcome?: ScanPerformanceOutcome): void;
  cancel(): void;
}

const LIMIT = 8;
const MAX_DURATION_MS = 30 * 60 * 1_000;
const noop = (): void => {};
const validOutcome = (value: ScanPerformanceOutcome): ScanPerformanceOutcome =>
  SCAN_PERFORMANCE_OUTCOMES.includes(value) ? value : "error";

/** Injectable monotonic clock for deterministic tests. Nothing is persisted or sent. */
export function createScanPerformanceRecorder(now: () => number = () => performance.now()) {
  let next = 0;
  const attempts: { snapshot: ScanAttemptTiming; dispose(): void }[] = [];
  const clock = (): number => {
    const value = now();
    return Number.isFinite(value) ? value : 0;
  };
  const elapsed = (start: number): number =>
    Math.round(Math.min(MAX_DURATION_MS, Math.max(0, clock() - start)));

  const startAttempt = (): ScanPerformanceAttempt => {
    const begun = clock();
    const snapshot: ScanAttemptTiming = { attempt: ++next, durationMs: 0, outcome: "pending", stages: [] };
    const stages = new Map<ScanPerformanceStage, (outcome: ScanPerformanceOutcome) => void>();
    let closed = false;
    const finish = (outcome: ScanPerformanceOutcome = "success"): void => {
      if (closed) return;
      // Pending work never becomes a reported success merely because the report finished.
      for (const end of stages.values()) end("cancelled");
      closed = true;
      snapshot.durationMs = elapsed(begun);
      snapshot.outcome = validOutcome(outcome);
    };
    attempts.push({ snapshot, dispose: () => { closed = true; } });
    if (attempts.length > LIMIT) attempts.shift()?.dispose();
    return {
      start(stage) {
        if (closed || stages.has(stage) || !SCAN_PERFORMANCE_STAGES.includes(stage)) return noop;
        const started = clock();
        let ended = false;
        const end = (outcome: ScanPerformanceOutcome = "success"): void => {
          if (ended || closed) return;
          ended = true;
          snapshot.stages.push({ stage, durationMs: elapsed(started), outcome: validOutcome(outcome) });
        };
        stages.set(stage, end);
        return end;
      },
      finish,
      cancel: () => finish("cancelled"),
    };
  };
  return {
    startAttempt,
    read: (): ScanAttemptTiming[] => attempts.map(({ snapshot }) => ({
      ...snapshot, stages: snapshot.stages.map((stage) => ({ ...stage })),
    })),
    clear: (): void => {
      for (const attempt of attempts) attempt.dispose();
      attempts.length = 0;
    },
  };
}

const recorder = createScanPerformanceRecorder();
export const startScanPerformanceAttempt = recorder.startAttempt;
export const readScanPerformance = recorder.read;
export const clearScanPerformance = recorder.clear;
