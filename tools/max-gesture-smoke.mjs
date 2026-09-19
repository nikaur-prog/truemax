// Deterministic asset poses plus live production-bridge checks. No account/API.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4189";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-max-gestures-"));
const browser = await launchChromium({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 740, height: 740 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
  await page.goto(`${origin}/tools/cmpcheck.html`);
  await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { GLTFLoader } = await import("/node_modules/three/examples/jsm/loaders/GLTFLoader.js");
    const bytes = await (await fetch("/brand/max-rig-v1.glb", { cache: "no-store" })).arrayBuffer();
    const asset = await new GLTFLoader().parseAsync(bytes, "/brand/");
    document.body.replaceChildren();
    document.body.style.cssText = "margin:0;background:#eff6fa";
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(740, 740);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    document.body.append(renderer.domElement);
    const scene = new THREE.Scene(); scene.add(asset.scene);
    const camera = new THREE.OrthographicCamera(-2.15, 2.15, 2.15, -2.15, .1, 20);
    camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0);
    const mixer = new THREE.AnimationMixer(asset.scene);
    window.poseMax = (clip, seconds, side = false) => {
      mixer.stopAllAction();
      const action = mixer.clipAction(asset.animations.find((item) => item.name === clip));
      action.reset().play();
      mixer.setTime(seconds);
      asset.scene.rotation.y = side ? -.5 : 0;
      renderer.render(scene, camera);
    };
  });
  for (const [name, clip, at] of [
    ["front", "idle", 0], ["mirror-hold", "mirror", 1.75], ["mirror-wink", "mirror", 2.65625],
    ["skate-reveal", "skate", 1], ["skate-ride", "skate", 2],
    ["skate-kickflip", "skate", 2.92], ["skate-land", "skate", 3.78],
  ]) {
    await page.evaluate(([clip, at]) => window.poseMax(clip, at), [clip, at]);
    await page.screenshot({ path: join(artifacts, `${name}.png`) });
  }
  await page.goto(`${origin}/?preview=max-coach&gestures=4`);
  await page.locator("[data-preview-open-chat]").click();
  await page.waitForFunction(() => document.querySelector(".maxchat-face canvas[data-max3d]")?.style.visibility === "visible");
  assert.equal(await page.locator("canvas[data-max3d]").count(), 1);
  for (const state of ["mirror", "skate", "speaking"]) {
    await page.locator(`[data-preview-coach-state=${state}]`).click();
    await page.waitForFunction((state) => document.querySelector(".maxchat-face canvas")?.dataset.animation === state, state);
    if (state !== "speaking") await page.waitForFunction(() => document.querySelector(".maxchat-face canvas")?.dataset.animation === "idle", undefined, { timeout: 10000 });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ clips: ["mirror", "skate", "speaking"], returnedToIdle: true, errors, artifacts }));
} finally { await browser.close(); }
