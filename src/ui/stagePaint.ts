/** One owner for a deferred photograph swap and its temporary hidden state. */
export function createStagePaint(
  setHidden: (hidden: boolean) => void,
  schedule: (callback: () => void, delay: number) => number = (callback, delay) => window.setTimeout(callback, delay),
  unschedule: (timer: number) => void = (timer) => window.clearTimeout(timer),
) {
  let timer: number | null = null;
  let generation = 0;
  const cancel = () => {
    generation++;
    if (timer !== null) unschedule(timer);
    timer = null;
    // Cancelling the timer must also undo the state that timer owned. A rapid
    // front -> side -> front reversal otherwise leaves the whole stage hidden.
    setHidden(false);
  };
  return {
    cancel,
    run(paint: () => void, delay: number) {
      cancel();
      if (delay <= 0) { paint(); return; }
      const mine = generation;
      setHidden(true);
      timer = schedule(() => {
        if (mine !== generation) return;
        timer = null;
        try { paint(); } finally { setHidden(false); }
      }, delay);
    },
  };
}
