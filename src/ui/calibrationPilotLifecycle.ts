import type { PilotRecord } from "./calibrationPilotData.js";

/** Bound a caller's wait and abort cancellable work without losing late errors. */
export function waitForPilotStage<T>(
  name: string,
  start: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const workController = new AbortController();
    let settled = false;
    const finish = (succeeded: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (succeeded) resolve(value as T);
      else reject(value);
    };
    const cancel = () => {
      workController.abort();
      finish(false, new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      workController.abort();
      finish(false, new Error(`${name} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    signal.addEventListener("abort", cancel, { once: true });
    // The constructor or promise may reject after cancellation. Both handlers
    // remain attached so its late completion cannot become unhandled.
    Promise.resolve().then(() => {
      if (workController.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      return start(workController.signal);
    }).then((value) => finish(true, value), (error: unknown) => finish(false, error));
  });
}

/**
 * A detector constructor cannot be cancelled. Keep its REAL promise, not a
 * timed-out caller's wrapper, so retries share it until it actually settles.
 */
export function sharePilotStartup<T>(start: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending) return pending;
    const attempt = Promise.resolve().then(start);
    pending = attempt;
    const clear = () => { if (pending === attempt) pending = null; };
    void attempt.then(clear, clear);
    return attempt;
  };
}

export function finishPilotRecords(records: PilotRecord[], cancelled: boolean, failure: string | null): void {
  for (const record of records) if (record.status === "queued" || record.status === "processing") {
    record.status = cancelled ? "cancelled" : "failed";
    record.failure = cancelled ? "Run cancelled before this file completed" : failure ?? "Run did not complete this file";
  }
}
