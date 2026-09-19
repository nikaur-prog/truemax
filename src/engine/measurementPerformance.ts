/** In-memory interaction timings only. No face, account, metric ID or value. */
export interface MeasurementInteractionTiming {
  view: "front" | "side";
  firstDrawMs: number | null;
  durationMs: number;
  outcome: "pending" | "completed" | "cancelled" | "error";
}

const LIMIT = 64;
const MAX_DURATION_MS = 60_000;

export function createMeasurementPerformanceRecorder(now: () => number = () => performance.now()) {
  const samples: MeasurementInteractionTiming[] = [];
  const counts = { requested: 0, completed: 0, cancelledOrSuperseded: 0, cancelledBeforeFirstDraw: 0, errors: 0 };
  let generation = 0;
  const clock = () => { const value = now(); return Number.isFinite(value) ? value : 0; };
  return {
    start(view: "front" | "side") {
      const started = clock();
      const mine = generation;
      const sample: MeasurementInteractionTiming = { view, firstDrawMs: null, durationMs: 0, outcome: "pending" };
      const elapsed = () => Math.round(Math.min(MAX_DURATION_MS, Math.max(0, clock() - started)) * 10) / 10;
      samples.push(sample);
      if (samples.length > LIMIT) samples.shift();
      counts.requested++;
      return {
        drawn() {
          if (mine === generation && sample.outcome === "pending" && sample.firstDrawMs === null) sample.firstDrawMs = elapsed();
        },
        finish(outcome: "completed" | "cancelled" | "error") {
          if (mine !== generation || sample.outcome !== "pending") return;
          sample.durationMs = elapsed();
          sample.outcome = outcome;
          if (outcome === "completed") counts.completed++;
          else if (outcome === "error") counts.errors++;
          else {
            counts.cancelledOrSuperseded++;
            if (sample.firstDrawMs === null) counts.cancelledBeforeFirstDraw++;
          }
        },
      };
    },
    read: () => ({ counts: { ...counts }, samples: samples.map((sample) => ({ ...sample })) }),
    clear() {
      generation++;
      samples.length = 0;
      for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] = 0;
    },
  };
}

const recorder = createMeasurementPerformanceRecorder();
export const startMeasurementInteraction = recorder.start;
export const readMeasurementPerformance = recorder.read;
export const clearMeasurementPerformance = recorder.clear;
