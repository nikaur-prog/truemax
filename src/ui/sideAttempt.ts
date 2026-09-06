/** One owner for asynchronous work on a replaceable side photograph. */
export function createSideAttemptOwner() {
  let active: AbortController | null = null;
  return {
    begin(): AbortSignal {
      active?.abort();
      active = new AbortController();
      return active.signal;
    },
    current(signal: AbortSignal): boolean {
      return active?.signal === signal && !signal.aborted;
    },
    cancel(): void {
      active?.abort();
      active = null;
    },
  };
}
