import {
  ACESFilmicToneMapping, AnimationMixer, AmbientLight, Color, DirectionalLight,
  Group, HemisphereLight, LoopOnce, LoopRepeat, Material, Mesh, OrthographicCamera,
  Scene, SRGBColorSpace, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AnimationAction } from "three";
import type { Max3DState, Max3DView } from "./max3d.js";
import { setMax3DActive } from "./maxMotion.js";

const FRAME_MS = 1000 / 30;
export async function createMax3D(
  stage: HTMLElement, fallback: SVGSVGElement | null, initial: Max3DState,
  signal: AbortSignal, onFailure: () => void,
  mayStart: () => boolean = () => true,
): Promise<{ setState(state: Max3DState): void; setView(view: Max3DView): void; dispose(): void; pause(paused: boolean): void }> {
  const response = await fetch("/brand/max-rig-v1.glb", { signal, credentials: "omit", cache: import.meta.env?.DEV ? "no-store" : "force-cache" });
  if (!response.ok) throw new Error("Character asset unavailable");
  const data = await response.arrayBuffer();
  signal.throwIfAborted();
  if (!mayStart()) throw new DOMException("Preview inactive", "AbortError");
  const gltf = await new GLTFLoader().parseAsync(data, "/brand/");
  const geometries = new Set<import("three").BufferGeometry>();
  const materials = new Set<Material>();
  gltf.scene.traverse((item) => {
    if (!(item instanceof Mesh)) return;
    geometries.add(item.geometry);
    for (const material of Array.isArray(item.material) ? item.material : [item.material]) materials.add(material);
  });
  const disposeAsset = (): void => { for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); };
  if (signal.aborted || !stage.isConnected || !mayStart()) { disposeAsset(); throw new DOMException("Closed", "AbortError"); }
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
  } catch (error) { disposeAsset(); throw error; }
  renderer.setClearColor(new Color(0x000000), 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.max3d = "true";
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  const previousPosition = stage.style.position;
  if (getComputedStyle(stage).position === "static") stage.style.position = "relative";
  const previousVisibility = fallback?.style.visibility ?? "";
  const scene = new Scene();
  const presentation = new Group();
  presentation.rotation.y = -0.16;
  presentation.add(gltf.scene);
  scene.add(presentation);
  scene.add(new HemisphereLight(0xdaf6ff, 0x203456, 2.5));
  scene.add(new AmbientLight(0xffffff, 0.6));
  const key = new DirectionalLight(0xf0faff, 3); key.position.set(-3, 4, 5); scene.add(key);
  const rim = new DirectionalLight(0x80e4ff, 1.6); rim.position.set(3, 2, -3); scene.add(rim);
  const camera = new OrthographicCamera(-1.8, 1.8, 2, -1.6, 0.1, 20);
  camera.position.set(0, 0.2, 6); camera.lookAt(0, 0.2, 0);
  const mixer = new AnimationMixer(gltf.scene);
  const actions = new Map(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  let current: AnimationAction | undefined;
  let state: Max3DState | undefined;
  let dead = false;
  let paused = false;
  let frame: number | null = null;
  let last = 0;
  let painted = false;
  let quietUntil = 0;
  const size = (): void => {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // Bound drawing-buffer memory even if a caller accidentally supplies a hero-wide stage.
    const scale = Math.min(1, 640 / Math.max(box.width, box.height));
    renderer.setSize(Math.round(box.width * scale), Math.round(box.height * scale), false);
    const aspect = box.width / box.height;
    const halfHeight = Math.max(1.9, 1.55 / aspect);
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
    camera.top = halfHeight; camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  };
  const showFallback = (): void => {
    if (fallback) { fallback.style.visibility = previousVisibility; setMax3DActive(fallback, false); }
    canvas.style.visibility = "hidden";
  };
  const tick = (time: number): void => {
    frame = null;
    if (dead || paused || signal.aborted || !stage.isConnected) return;
    if (!last || time - last >= FRAME_MS) {
      const delta = last ? Math.min(0.08, (time - last) / 1000) : 0;
      last = time;
      mixer.update(delta);
      try { renderer.render(scene, camera); }
      catch { fail(); return; }
      if (!painted) {
        painted = true;
        if (fallback) { fallback.style.visibility = "hidden"; setMax3DActive(fallback, true); }
        canvas.style.visibility = "visible";
      }
    }
    if (state !== "quiet" || time < quietUntil) frame = requestAnimationFrame(tick);
  };
  const requestPaint = (): void => { if (!dead && !paused && frame === null) frame = requestAnimationFrame(tick); };
  const setState = (next: Max3DState): void => {
    if (dead || state === next) return;
    const action = actions.get(next);
    if (!action) return;
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
    action.setLoop(next === "celebrate" ? LoopOnce : LoopRepeat, next === "celebrate" ? 1 : Infinity);
    action.clampWhenFinished = next === "celebrate";
    action.play();
    current?.crossFadeTo(action, 0.28, false);
    current = action; state = next;
    if (next === "quiet") quietUntil = performance.now() + 320;
    requestPaint();
  };
  const finished = (): void => { if (state === "celebrate") setState("idle"); };
  mixer.addEventListener("finished", finished);
  const resize = new ResizeObserver(() => { if (dead) return; size(); last = 0; requestPaint(); });
  const onAbort = (): void => dispose();
  const contextLost = (event: Event): void => { event.preventDefault(); fail(); };
  const fail = (): void => { if (dead) return; dispose(); onFailure(); };
  function dispose(): void {
    if (dead) return;
    dead = true;
    if (frame !== null) cancelAnimationFrame(frame);
    resize.disconnect();
    signal.removeEventListener("abort", onAbort);
    canvas.removeEventListener("webglcontextlost", contextLost);
    mixer.removeEventListener("finished", finished);
    mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
    showFallback(); canvas.remove();
    stage.style.position = previousPosition;
    disposeAsset(); renderer.dispose(); renderer.forceContextLoss();
  }
  size();
  canvas.style.visibility = "hidden";
  stage.append(canvas);
  resize.observe(stage);
  signal.addEventListener("abort", onAbort, { once: true });
  canvas.addEventListener("webglcontextlost", contextLost);
  setState(initial);
  return {
    setState,
    setView(view) {
      if (dead) return;
      presentation.rotation.y = { front: 0, "three-quarter": -0.48, side: -Math.PI / 2, back: Math.PI }[view];
      last = 0; requestPaint();
    },
    pause(next) {
      if (dead || paused === next) return;
      paused = next; last = 0;
      if (paused) { if (frame !== null) cancelAnimationFrame(frame); frame = null; showFallback(); painted = false; }
      else { if (state === "quiet") quietUntil = performance.now() + 320; requestPaint(); }
    },
    dispose,
  };
}
