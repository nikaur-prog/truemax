// A stream and its paced presentation are one lifecycle. A reader failure or
// cancellation must settle both, even when animation frames are suspended.
const DRAIN_CPS = 55;
const STALL_MS = 1400;

export interface MaxStreamView {
  signal: AbortSignal;
  /** False after the owning chat closes, changes generation or is detached. */
  isCurrent(): boolean;
  begin(): void;
  write(text: string): void;
  waiting(on: boolean): void;
}

export interface MaxStreamClock {
  now(): number;
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

const frameClock: MaxStreamClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

function scrub(raw: string): string {
  return raw
    .replace(/\*\*|__|`/g, "")
    .replace(/\*([^*\n]{1,80})\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^(\s*)[*•]\s+/gm, "$1- ");
}

/** A deliberate close is silent; a timed-out active request is not. */
export function maxStreamErrorMessage(error: unknown, signal: AbortSignal): string | null {
  const name = (error as { name?: string } | null)?.name;
  if (name === "TimeoutError" || (signal.aborted && signal.reason?.name === "TimeoutError")) {
    return "That took too long to come back. Ask me again?";
  }
  if (signal.aborted || name === "AbortError") return null;
  return "I lost the connection there. Ask me again?";
}

export function drainMaxStream(
  body: ReadableStream<Uint8Array>,
  view: MaxStreamView,
  clock: MaxStreamClock = frameClock,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  return new Promise<string>((resolve, reject) => {
    let frame: number | null = null;
    let settled = false;
    let done = false;
    let raw = "";
    let text = "";
    let shown = 0;
    let carry = 0;
    let last = clock.now();
    let grewAt = last;
    let began = false;
    let waiting = false;
    let lastWritten = "";

    const cleanup = (): void => {
      if (frame !== null) clock.cancel(frame);
      frame = null;
      view.signal.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      // Do not await an underlying source's cancellation: it may itself hang.
      // Cancelling the reader releases a pending read; pump releases its lock.
      void reader.cancel(error).catch(() => {});
      reject(error);
    };
    const onAbort = (): void => fail(view.signal.reason ?? new DOMException("Chat closed", "AbortError"));
    const current = (): boolean => {
      if (settled) return false;
      if (view.signal.aborted) onAbort();
      else if (!view.isCurrent()) fail(new DOMException("Chat closed", "AbortError"));
      return !settled;
    };
    const setWaiting = (on: boolean): void => {
      if (waiting === on || !current()) return;
      waiting = on;
      view.waiting(on);
    };
    const write = (value: string): void => {
      if (!current()) return;
      if (!began) {
        began = true;
        view.begin();
      }
      if (!current()) return;
      if (value !== lastWritten) {
        lastWritten = value;
        view.write(value);
      }
    };
    const finish = (): void => {
      if (!current()) return;
      if (text) write(text);
      setWaiting(false);
      if (!current()) return;
      settled = true;
      cleanup();
      resolve(text);
    };
    const step = (now: number): void => {
      frame = null;
      if (!current()) return;
      try {
        shown = Math.min(shown, text.length);
        if (shown === 0 && text.length === 0) {
          last = now;
        } else {
          const backlog = text.length - shown;
          const cps = DRAIN_CPS + (backlog > 360 ? (backlog - 360) * 1.4 : 0);
          carry += ((now - last) / 1000) * cps;
          last = now;
          const take = Math.floor(carry);
          if (take > 0) {
            carry -= take;
            shown = Math.min(text.length, shown + take);
            write(text.slice(0, shown));
          }
          if (!current()) return;
          if (shown >= text.length) carry = 0;
          setWaiting(!done && shown >= text.length && now - grewAt > STALL_MS);
        }
        if (done && shown >= text.length) finish();
        else if (!settled) frame = clock.request(step);
      } catch (error) {
        fail(error);
      }
    };
    const receive = (chunk: string): void => {
      raw += chunk;
      const next = scrub(raw);
      if (next !== text) grewAt = clock.now();
      text = next;
    };
    const pump = async (): Promise<void> => {
      try {
        while (current()) {
          const chunk = await reader.read();
          if (!current()) return;
          if (chunk.done) {
            receive(decoder.decode());
            done = true;
            return;
          }
          receive(decoder.decode(chunk.value, { stream: true }));
        }
      } catch (error) {
        fail(error);
      } finally {
        reader.releaseLock();
      }
    };

    view.signal.addEventListener("abort", onAbort, { once: true });
    // Start the guarded pump even for an already-aborted view so its finally
    // releases the reader lock. Its error handler is installed immediately.
    void pump();
    if (!settled) frame = clock.request(step);
  });
}
