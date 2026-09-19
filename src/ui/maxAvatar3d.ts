/** Production-only surface bridge. The heavy renderer is still visibility-lazy. */
import { mountMax3D } from "./max3d.js";
import { createMaxAvatar3DManager, type MaxAvatar3DHandle, type MaxAvatar3DOptions } from "./maxAvatar3dController.js";
import "./maxAvatar3d.css";
export type { MaxAvatar3DHandle, MaxAvatar3DOptions, MaxAvatar3DState } from "./maxAvatar3dController.js";

const mount = createMaxAvatar3DManager(mountMax3D, (stage) => stage.isConnected);
const mounted = new WeakMap<HTMLElement, MaxAvatar3DHandle>();
const inactive: MaxAvatar3DHandle = { setState() {}, setSpeechLevel() {}, destroy() {} };

/** Large chat and Coach stages only. Small report/scan icons keep their SVG. */
export function mountMaxAvatar3D(stage: HTMLElement | null, options: MaxAvatar3DOptions = {}): MaxAvatar3DHandle {
  if (!stage || !stage.isConnected) return inactive;
  const previous = mounted.get(stage);
  if (previous) {
    if (options.state) previous.setState(options.state);
    return previous;
  }
  stage.classList.add("max-avatar-3d");
  stage.dataset.maxState = options.state ?? "idle";
  const renderer = mount(stage, options);
  let dead = false;
  // Dashboard panels may be replaced without an explicit component unmount.
  // This also releases the stack slot, allowing the next live surface to resume.
  const removal = new MutationObserver(() => { if (!stage.isConnected) handle.destroy(); });
  const handle: MaxAvatar3DHandle = {
    setState(state) {
      if (dead) return;
      stage.dataset.maxState = state;
      renderer.setState(state);
    },
    setSpeechLevel(level) { if (!dead) renderer.setSpeechLevel(level); },
    destroy() {
      if (dead) return;
      dead = true;
      removal.disconnect();
      renderer.destroy();
      mounted.delete(stage);
      stage.classList.remove("max-avatar-3d");
      delete stage.dataset.maxState;
    },
  };
  removal.observe(document.documentElement, { childList: true, subtree: true });
  mounted.set(stage, handle);
  return handle;
}
