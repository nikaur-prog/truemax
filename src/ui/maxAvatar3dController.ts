import { MAX_3D_STATES, isMaxOneShot, normalizeMaxSpeechLevel, type Max3DState } from "./max3dSchedule.js";
import type { Max3DHandle, Max3DOptions } from "./max3d.js";

export type MaxAvatar3DState = Max3DState | "celebrating";
export interface MaxAvatar3DOptions { state?: MaxAvatar3DState; playful?: boolean }
export interface MaxAvatar3DHandle {
  setState(state: MaxAvatar3DState): void;
  /** Optional real audio amplitude; null keeps the authored speaking animation. */
  setSpeechLevel(level: number | null): void;
  destroy(): void;
}

function animation(state: MaxAvatar3DState): Max3DState {
  return state === "celebrating" ? "celebrate" : MAX_3D_STATES.includes(state) ? state : "idle";
}

/**
 * A chat can cover its Coach tab. Keep a single renderer, then restore the
 * underlying connected surface when the chat closes. Suspended surfaces retain
 * their latest state, not an abandoned renderer or an animation loop.
 */
export function createMaxAvatar3DManager<Stage>(
  mount: (stage: Stage, initial: Max3DState, options: Max3DOptions) => Max3DHandle,
  connected: (stage: Stage) => boolean,
): (stage: Stage, options?: MaxAvatar3DOptions) => MaxAvatar3DHandle {
  type Entry = { stage: Stage; state: Max3DState; playful: boolean; speech: number | null; dead: boolean };
  const stack: Entry[] = [];
  let active: Entry | undefined;
  let renderer: Max3DHandle | undefined;
  function sync(): void {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].dead || !connected(stack[i].stage)) {
        stack[i].dead = true;
        stack.splice(i, 1);
      }
    }
    const next = stack[stack.length - 1];
    if (next === active) return;
    renderer?.destroy(); renderer = undefined; active = next;
    if (next) {
      renderer = mount(next.stage, next.state, { playful: next.playful });
      renderer.setSpeechLevel(next.speech);
    }
  }
  return (stage, options = {}) => {
    const entry: Entry = {
      stage, state: animation(options.state ?? "idle"), playful: options.playful !== false,
      speech: null, dead: false,
    };
    stack.push(entry); sync();
    return {
      setState(state) {
        if (entry.dead) return;
        const next = animation(state);
        // Typing fires on every keystroke. Repeated listening/thinking events
        // must not continually rewind the animation to its first frame.
        if (next === entry.state && !isMaxOneShot(next)) return;
        entry.state = next;
        if (active === entry) renderer?.setAnimation(entry.state);
      },
      setSpeechLevel(level) {
        if (entry.dead) return;
        entry.speech = normalizeMaxSpeechLevel(level);
        if (active === entry) renderer?.setSpeechLevel(entry.speech);
      },
      destroy() {
        if (entry.dead && !stack.includes(entry)) return;
        entry.dead = true; sync();
      },
    };
  };
}
