/** Keep guidance responsive without running synchronous inference at camera FPS. */
export function previewIsVisible(pageVisible: boolean, inViewport: boolean, connected: boolean, covered: boolean): boolean {
  return pageVisible && inViewport && connected && !covered;
}

export function createPreviewCadence() {
  let nextAt = 0;
  return {
    due: (now: number) => now >= nextAt,
    measured(start: number, end: number) {
      // At most ten reads per second. On slower phones leave at least as much
      // time for input/painting as the last inference consumed. Final capture
      // and scoring still use the original full-resolution photograph.
      nextAt = end + Math.max(100 - (end - start), end - start);
    },
    reset() { nextAt = 0; },
  };
}

export interface PreviewLoop {
  resume(): void;
  pause(): void;
}

interface FrameClock {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

/** One cancellable frame chain, including when a callback stops its own camera. */
export function createPreviewLoop(
  onFrame: FrameRequestCallback,
  clock: FrameClock = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  },
): PreviewLoop {
  let active = false;
  let frame: number | null = null;
  const tick: FrameRequestCallback = (now) => {
    frame = null;
    if (!active) return;
    onFrame(now);
    if (active && frame === null) frame = clock.request(tick);
  };
  return {
    resume() {
      if (active) return;
      active = true;
      frame = clock.request(tick);
    },
    pause() {
      active = false;
      if (frame !== null) clock.cancel(frame);
      frame = null;
    },
  };
}
