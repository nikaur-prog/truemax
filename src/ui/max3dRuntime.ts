import {
  NoToneMapping, AnimationMixer, Color,
  Group, Material, Mesh, MeshBasicMaterial, OrthographicCamera,
  Scene, SRGBColorSpace, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Max3DRuntime, Max3DState } from "./max3d.js";
import { setMax3DActive } from "./maxMotion.js";
import { createMax3DSchedule, createMaxSpeechOverlay, MAX_3D_STATES, normalizeMaxSpeechLevel } from "./max3dSchedule.js";
import { createMax3DPlayback } from "./max3dPlayback.js";

const FRAME_MS = 1000 / 30;
export async function createMax3D(
  stage: HTMLElement, fallback: SVGSVGElement | null, initial: Max3DState,
  signal: AbortSignal, onFailure: () => void,
  mayStart: () => boolean = () => true,
): Promise<Max3DRuntime> {
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
    if (item.name === "OvalShell" && item.material instanceof MeshBasicMaterial) {
      materials.add(item.material);
      const shell = item.material.clone();
      shell.onBeforeCompile = (shader) => {
        shader.vertexShader = `varying vec3 vMaxSurface;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\nvMaxSurface = position;");
        shader.fragmentShader = `varying vec3 vMaxSurface;\n${shader.fragmentShader}`.replace("#include <color_fragment>", `#include <color_fragment>
          vec2 maxSvg = vec2(vMaxSurface.x / 0.023 + 75.0, 79.0 - vMaxSurface.y / 0.023);
          vec2 maxEllipse = (maxSvg - vec2(57.0, 34.0)) / vec2(21.0, 12.0);
          float maxDistance = dot(maxEllipse, maxEllipse);
          float maxEdge = max(fwidth(maxDistance) * 1.5, 0.001);
          float maxHighlight = 1.0 - smoothstep(1.0 - maxEdge, 1.0 + maxEdge, maxDistance);
          if (vMaxSurface.z > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), maxHighlight * 0.32);
        `);
      };
      shell.customProgramCacheKey = () => "max-svg-highlight-v2";
      item.material = shell;
    }
    geometries.add(item.geometry);
    for (const material of Array.isArray(item.material) ? item.material : [item.material]) materials.add(material);
  });
  const disposeAsset = (): void => { for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); };
  if (signal.aborted || !stage.isConnected || !mayStart()) { disposeAsset(); throw new DOMException("Closed", "AbortError"); }
  // Do not silently show a motionless character when an old/corrupt asset and
  // the launcher disagree. The existing SVG remains the explicit fallback.
  if (!MAX_3D_STATES.every((state) => gltf.animations.some((clip) => clip.name === state && Number.isFinite(clip.duration) && clip.duration > 0))) {
    disposeAsset(); throw new Error("Character animations unavailable");
  }
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
  } catch (error) { disposeAsset(); throw error; }
  renderer.setClearColor(new Color(0x000000), 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
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
  presentation.rotation.y = 0;
  presentation.add(gltf.scene);
  scene.add(presentation);
  // The original SVG palette is authored into unlit vertex colors. Keep its
  // matte appearance rather than introducing glossy lighting or tone shifts.
  const camera = new OrthographicCamera(-2.15, 2.15, 2.15, -2.15, 0.1, 20);
  camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0);
  const mixer = new AnimationMixer(gltf.scene);
  const actions = new Map(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  const playback = createMax3DPlayback(actions);
  const schedule = createMax3DSchedule(initial);
  const mouthOpen = gltf.scene.getObjectByName("MouthOpen");
  const mouthSmile = gltf.scene.getObjectByName("MouthSmile");
  const speech = mouthOpen && mouthSmile ? createMaxSpeechOverlay(mouthOpen.scale, mouthSmile.scale) : null;
  let speechLevel: number | null = null;
  let dead = false;
  let paused = false;
  let frame: number | null = null;
  let last: number | null = null;
  let painted = false;
  const size = (): void => {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // Bound drawing-buffer memory even if a caller accidentally supplies a hero-wide stage.
    const scale = Math.min(1, 640 / Math.max(box.width, box.height));
    renderer.setSize(Math.round(box.width * scale), Math.round(box.height * scale), false);
    const aspect = box.width / box.height;
    const halfHeight = Math.max(2.15, 1.85 / aspect);
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
    if (last === null || time - last >= FRAME_MS) {
      const delta = last === null ? 0 : Math.min(0.08, (time - last) / 1000);
      last = time;
      playback.select(schedule.advance(delta));
      speech?.restore();
      mixer.update(delta);
      playback.advance(delta);
      const finished = playback.finished();
      if (finished) playback.select(schedule.finish(finished));
      const activeClip = schedule.state();
      if (canvas.dataset.animation !== activeClip) canvas.dataset.animation = activeClip;
      // Authored speaking is the default. An external amplitude hook is opt-in
      // and touches only actual opening geometry, never the user's microphone.
      speech?.apply(speechLevel, schedule.state() === "speaking", delta);
      try { renderer.render(scene, camera); }
      catch { fail(); return; }
      if (!painted) {
        painted = true;
        if (fallback) { fallback.style.visibility = "hidden"; setMax3DActive(fallback, true); }
        canvas.style.visibility = "visible";
      }
      // Development clip export copies the live drawing buffer synchronously.
      if (import.meta.env?.DEV) canvas.dispatchEvent(new Event("max3dframe", { bubbles: true }));
    }
    if (schedule.state() !== "quiet" || playback.transitioning()) frame = requestAnimationFrame(tick);
  };
  const requestPaint = (): void => { if (!dead && !paused && frame === null) frame = requestAnimationFrame(tick); };
  const setState = (next: Max3DState): void => {
    if (dead || !MAX_3D_STATES.includes(next)) return;
    schedule.setState(next);
    playback.select(next, true);
    requestPaint();
  };
  const onResize = (): void => { if (dead) return; size(); last = null; requestPaint(); };
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
  if (!resize) window.addEventListener("resize", onResize);
  const onAbort = (): void => dispose();
  const contextLost = (event: Event): void => { event.preventDefault(); fail(); };
  const fail = (): void => { if (dead) return; dispose(); onFailure(); };
  function dispose(): void {
    if (dead) return;
    dead = true;
    if (frame !== null) cancelAnimationFrame(frame);
    resize?.disconnect(); window.removeEventListener("resize", onResize);
    signal.removeEventListener("abort", onAbort);
    canvas.removeEventListener("webglcontextlost", contextLost);
    playback.stop();
    mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
    showFallback(); canvas.remove();
    stage.style.position = previousPosition;
    disposeAsset(); renderer.dispose(); renderer.forceContextLoss();
  }
  size();
  canvas.style.visibility = "hidden";
  stage.append(canvas);
  resize?.observe(stage);
  signal.addEventListener("abort", onAbort, { once: true });
  canvas.addEventListener("webglcontextlost", contextLost);
  setState(initial);
  return {
    setState,
    setView(view) {
      if (dead) return;
      presentation.rotation.y = { front: 0, "three-quarter": -0.48, side: -Math.PI / 2, back: Math.PI }[view];
      last = null; requestPaint();
    },
    setPlayfulEnabled(enabled) {
      if (dead) return;
      schedule.setPlayfulEnabled(enabled);
      playback.select(schedule.state());
      requestPaint();
    },
    setSpeechLevel(level) {
      if (dead) return;
      speechLevel = normalizeMaxSpeechLevel(level);
      requestPaint();
    },
    pause(next) {
      if (dead || paused === next) return;
      paused = next; last = null;
      if (paused) { if (frame !== null) cancelAnimationFrame(frame); frame = null; showFallback(); painted = false; }
      else requestPaint();
    },
    dispose,
  };
}
