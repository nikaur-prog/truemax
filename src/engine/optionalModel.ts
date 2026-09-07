/** Share one optional model without letting initialization hold a scan open. */
export function createOptionalModelLoader<T>(
  create: () => Promise<T>,
  dispose: (value: T) => void,
  initializationMs = 8_000,
) {
  let ready: T | null = null;
  let pending: Promise<T | null> | null = null;
  let generation = 0;

  const initialize = (): Promise<T | null> => {
    if (ready !== null) return Promise.resolve(ready);
    if (pending) return pending;
    const current = ++generation;
    pending = new Promise<T | null>((resolve) => {
      let settled = false;
      const finish = (value: T | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (current === generation) pending = null;
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), initializationMs);
      // A model constructor is not necessarily abortable. Retire its late
      // value instead of letting it overwrite a newer retry or leak WASM.
      Promise.resolve().then(create).then((value) => {
        if (settled || current !== generation) {
          try { dispose(value); } catch { /* Retired optional resources cannot fail a newer scan. */ }
          return;
        }
        ready = value;
        finish(value);
      }, () => finish(null));
    });
    return pending;
  };

  const load = (waitMs = initializationMs, signal?: AbortSignal): Promise<T | null> => {
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: T | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        resolve(signal?.aborted ? null : value);
      };
      const cancel = (): void => finish(null);
      const timer = setTimeout(cancel, Math.max(0, Math.min(initializationMs, waitMs)));
      signal?.addEventListener("abort", cancel, { once: true });
      void initialize().then(finish);
    });
  };
  return { load };
}
