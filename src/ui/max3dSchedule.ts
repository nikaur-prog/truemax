/** Small, renderer-independent state machine. Call advance only for visible frames. */
export const MAX_3D_STATES = ["idle", "listening", "thinking", "speaking", "celebrate", "quiet", "wave", "shocked", "angry", "mirror", "skate", "guitar"] as const;
export type Max3DState = typeof MAX_3D_STATES[number];
const BASE_STATES: readonly Max3DState[] = ["idle", "listening", "thinking", "speaking", "quiet"];
const ROUTINES: readonly Max3DState[] = ["mirror", "skate", "guitar"];
const WAIT_SECONDS = [6, 8, 10, 7] as const;
export const MAX_ROUTINE_SECONDS = 5;

export function isMaxOneShot(state: Max3DState): boolean { return !BASE_STATES.includes(state); }

export function createMax3DSchedule(initial: Max3DState = "idle", playful = true) {
  let base: Max3DState = isMaxOneShot(initial) ? "idle" : initial;
  let current = initial;
  let automatic = false;
  let elapsed = 0;
  let waitIndex = 0;
  let routineIndex = 0;
  const reset = (): void => { elapsed = 0; automatic = false; };
  return {
    state: (): Max3DState => current,
    automatic: (): boolean => automatic,
    setState(next: Max3DState): void {
      if (!MAX_3D_STATES.includes(next)) return;
      reset();
      if (!isMaxOneShot(next)) base = next;
      current = next;
    },
    setPlayfulEnabled(enabled: boolean): void {
      if (playful === enabled) return;
      playful = enabled;
      if (automatic) current = base;
      reset();
    },
    advance(seconds: number): Max3DState {
      if (!Number.isFinite(seconds) || seconds <= 0) return current;
      if (automatic) {
        elapsed += seconds;
        if (elapsed >= MAX_ROUTINE_SECONDS) { current = base; reset(); }
      } else if (playful && (current === "idle" || current === "thinking")) {
        elapsed += seconds;
        if (elapsed >= WAIT_SECONDS[waitIndex % WAIT_SECONDS.length]) {
          current = ROUTINES[routineIndex % ROUTINES.length];
          routineIndex++; waitIndex++;
          automatic = true; elapsed = 0;
        }
      }
      return current;
    },
    finish(state: Max3DState): Max3DState {
      // A faded-out action finishing must never override a newer explicit state.
      if (state === current && isMaxOneShot(current)) { current = base; reset(); }
      return current;
    },
  };
}

export function normalizeMaxSpeechLevel(level: number | null): number | null {
  return level === null || !Number.isFinite(level) ? null : Math.min(1, Math.max(0, level));
}

/** Exponential smoothing is bounded and frame-rate independent; no microphone access. */
export function smoothMaxSpeechLevel(current: number, target: number, seconds: number): number {
  const value = normalizeMaxSpeechLevel(current) ?? 0;
  const desired = normalizeMaxSpeechLevel(target) ?? 0;
  if (!Number.isFinite(seconds) || seconds <= 0) return value;
  return Math.min(1, Math.max(0, value + (desired - value) * (1 - Math.exp(-18 * seconds))));
}

interface MouthScale { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }

/** Restore authored transforms before every mixer update, including null input. */
export function createMaxSpeechOverlay(open: MouthScale, smile: MouthScale) {
  let saved = false;
  let ox = 0, oy = 0, oz = 0, sx = 1, sy = 1, sz = 1;
  let smoothed = 0;
  return {
    restore(): void {
      if (!saved) return;
      open.set(ox, oy, oz); smile.set(sx, sy, sz); saved = false;
    },
    apply(level: number | null, speaking: boolean, seconds: number): void {
      if (level === null || !speaking) { smoothed = 0; return; }
      ox = open.x; oy = open.y; oz = open.z;
      sx = smile.x; sy = smile.y; sz = smile.z; saved = true;
      smoothed = smoothMaxSpeechLevel(smoothed, level, seconds);
      const visible = smoothed > 0.025;
      open.set(visible ? 0.9 + smoothed * 0.15 : 0, visible ? 0.12 + smoothed * 0.88 : 0, visible ? 1 : 0);
      smile.set(visible ? 0 : 1, visible ? 0 : 1, visible ? 0 : 1);
    },
  };
}
