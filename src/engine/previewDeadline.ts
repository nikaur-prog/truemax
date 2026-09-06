/** A total async budget, including response-body reads, that also drops late work. */
export function previewDeadline(parent: AbortSignal | undefined, milliseconds: number, message: string) {
  const controller = new AbortController();
  const endsAt = Date.now() + milliseconds;
  const expire = () => controller.abort(new DOMException(message, "TimeoutError"));
  const aborted = () => controller.abort(parent?.reason ?? new DOMException("Cancelled", "AbortError"));
  if (parent?.aborted) aborted();
  else parent?.addEventListener("abort", aborted, { once: true });
  const timer = setTimeout(expire, milliseconds);
  return {
    signal: controller.signal,
    run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (Date.now() >= endsAt) expire();
      if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
      return new Promise<T>((resolve, reject) => {
        const cancel = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", cancel, { once: true });
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw controller.signal.reason;
          return operation(controller.signal);
        }).then((value) => {
          // A synchronous decoder/inference may delay the timer task. Check
          // wall time again before publishing its result, without pretending
          // that its already-running work could be interrupted mid-call.
          if (Date.now() >= endsAt) expire();
          if (controller.signal.aborted) reject(controller.signal.reason);
          else resolve(value);
        }, reject).finally(() => controller.signal.removeEventListener("abort", cancel));
      });
    },
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", aborted);
    },
  };
}
