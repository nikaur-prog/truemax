import { LoopOnce, LoopRepeat } from "three";
import type { AnimationAction } from "three";
import { isMaxOneShot } from "./max3dSchedule.js";
import type { Max3DState } from "./max3dSchedule.js";

const BLEND_SECONDS = 0.28;

/** At most an incoming and outgoing action are enabled during a visible blend. */
export function createMax3DPlayback(actions: ReadonlyMap<string, AnimationAction>) {
  let current: AnimationAction | undefined;
  let state: Max3DState | undefined;
  let outgoing: AnimationAction | undefined;
  let blendLeft = 0;
  return {
    select(next: Max3DState, restart = false): void {
      if (state === next && !restart) return;
      const action = actions.get(next);
      if (!action) throw new Error("Character animation unavailable");
      // Retire any older fade first. Rapid button presses cannot accumulate actions.
      outgoing?.stop(); outgoing = undefined; blendLeft = 0;
      if (current === action) current.stop();
      action.stopFading().stopWarping().reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
      const once = isMaxOneShot(next);
      action.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
      action.clampWhenFinished = once;
      action.play();
      if (current && current !== action) {
        current.stopFading().stopWarping().setEffectiveWeight(1);
        current.crossFadeTo(action, 0.28, false);
        outgoing = current; blendLeft = BLEND_SECONDS;
      }
      current = action; state = next;
    },
    advance(seconds: number): void {
      if (!outgoing || !Number.isFinite(seconds) || seconds <= 0) return;
      blendLeft -= seconds;
      if (blendLeft <= 0) {
        outgoing.stop(); outgoing = undefined; blendLeft = 0;
        current?.stopFading().setEffectiveWeight(1);
      }
    },
    finished(): Max3DState | null {
      return state && isMaxOneShot(state) && current && current.time >= current.getClip().duration ? state : null;
    },
    transitioning: (): boolean => !!outgoing,
    stop(): void {
      outgoing?.stop(); current?.stop();
      outgoing = undefined; current = undefined; state = undefined; blendLeft = 0;
    },
  };
}
