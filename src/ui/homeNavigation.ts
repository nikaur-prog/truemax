/** One navigation at a time, with visible feedback for lazy-load/network failure. */
export function createHomeNavigation(options: {
  open: () => Promise<void>;
  busy: (active: boolean) => void;
  failed: () => void;
}): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (pending) return pending;
    options.busy(true);
    pending = Promise.resolve().then(options.open)
      .catch(() => { options.failed(); })
      .finally(() => {
        pending = null;
        options.busy(false);
      });
    return pending;
  };
}
