import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_3D_STATES, mountMax3D } from "./max3d.js";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const binary = readFileSync(new URL("../../public/brand/max-rig-v1.glb", import.meta.url));
const jsonLength = binary.readUInt32LE(12);
const gltf = JSON.parse(binary.subarray(20, 20 + jsonLength).toString("utf8"));
const binOffset = 20 + jsonLength + 8;

function values(accessorIndex: number): number[] {
  const accessor = gltf.accessors[accessorIndex];
  assert.equal(accessor.componentType, 5126, "animation values are floats");
  const view = gltf.bufferViews[accessor.bufferView];
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type as "SCALAR" | "VEC3" | "VEC4"];
  return Array.from({ length: accessor.count * width }, (_, index) => binary.readFloatLE(binOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + index * 4));
}

test("Max ships a real bounded GLB with no remote images, textures or paid-provider requirement", () => {
  assert.equal(binary.toString("ascii", 0, 4), "glTF");
  assert.equal(binary.readUInt32LE(4), 2);
  assert.equal(binary.readUInt32LE(8), binary.byteLength);
  assert.ok(binary.byteLength < 600_000);
  assert.equal(gltf.materials.length, 3);
  assert.equal(gltf.textures?.length ?? 0, 0);
  assert.equal(gltf.images?.length ?? 0, 0);
  assert.ok(gltf.buffers.every((buffer: { uri?: string }) => !buffer.uri));
  const manifest = JSON.parse(read("../../public/brand/max-rig-v1.json"));
  assert.equal(manifest.bytes, binary.byteLength);
  assert.ok(manifest.triangles < 10_000);
  assert.equal(manifest.approved, false, "first iteration is explicitly awaiting visual approval");
});

test("the original transform rig carries the approved identity and no articulated human limbs or props", () => {
  const nodes = gltf.nodes.map((node: { name: string }) => node.name);
  for (const part of ["MaxRoot", "Body", "CloudShell", "Visor", "LeftPupil", "RightPupil", "ArmLeft", "ArmRight", "Antenna"]) assert.ok(nodes.includes(part), part);
  assert.ok(!nodes.some((name: string) => /elbow|knee|leg|phone|skate|mirror|tinker/i.test(name)));
  assert.equal(gltf.skins?.length ?? 0, 0, "this is honestly a rigid transform rig, not a skinned mesh");
});

test("all six named clips have finite bounded samples and matching start/end transforms", () => {
  assert.deepEqual(gltf.animations.map((clip: { name: string }) => clip.name), MAX_3D_STATES);
  for (const clip of gltf.animations) for (const channel of clip.channels) {
    const sampler = clip.samplers[channel.sampler];
    const time = values(sampler.input);
    const output = values(sampler.output);
    assert.equal(time[0], 0);
    assert.ok(time[time.length - 1] > 0 && time[time.length - 1] <= 5);
    assert.ok(time.every((value, index) => Number.isFinite(value) && (index === 0 || value > time[index - 1])));
    assert.ok(output.every(Number.isFinite));
    const width = output.length / time.length;
    for (let index = 0; index < width; index++) assert.ok(Math.abs(output[index] - output[output.length - width + index]) < 0.00001, `${clip.name} ${channel.target.path} has a loop seam`);
  }
});

test("the opt-in launcher defers renderer and asset work and disposes replaced surfaces", () => {
  const source = read("./max3d.ts");
  assert.ok(!/^import .*from ["']three/m.test(source));
  assert.match(source, /if \(!allowed\(\) \|\| loading \|\| failed \|\| renderer\) return/);
  assert.match(source, /import\("\.\/max3dRuntime\.js"\)/);
  assert.match(source, /releaseCurrent\?\.\(\)/);
  assert.match(source, /abort\.abort\(\)/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /connection\?\.saveData/);
  assert.match(source, /!document\.hidden/);
});

test("runtime owns bounded rendering, clip blending and full GPU/fallback cleanup", () => {
  const source = read("./max3dRuntime.ts");
  for (const required of ["1000 / 30", "640 / Math.max", "1.5", "crossFadeTo(action, 0.28", "webglcontextlost", "renderer.dispose()", "renderer.forceContextLoss()", "geometry.dispose()", "material.dispose()", "mixer.uncacheRoot", "setMax3DActive(fallback, true)"]) assert.ok(source.includes(required), required);
  assert.match(source, /if \(dead \|\| paused \|\| signal\.aborted \|\| !stage\.isConnected\) return/);
  assert.match(source, /state !== "quiet" \|\| time < quietUntil/);
});

test("a delayed runtime import cannot upload or create a renderer after its surface is replaced", async () => {
  // Load the module without constructing WebGL so the deferred branch is real,
  // not a text assertion or a mocked successful renderer.
  await import("./max3dRuntime.js");
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown): void => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const observers: { callback: (entries: unknown[]) => void; disconnected: boolean }[] = [];
  class Visibility {
    state: typeof observers[number];
    constructor(callback: (entries: unknown[]) => void) { this.state = { callback, disconnected: false }; observers.push(this.state); }
    observe(): void {}
    disconnect(): void { this.state.disconnected = true; }
  }
  class PassiveObserver { observe(): void {} disconnect(): void {} }
  const media = Object.assign(new EventTarget(), { matches: false });
  const doc = Object.assign(new EventTarget(), { hidden: false, documentElement: {} });
  const stage = Object.assign(new EventTarget(), { isConnected: true, querySelector: () => null, getBoundingClientRect: () => ({ width: 320, height: 320 }) }) as unknown as HTMLElement;
  let requests = 0;
  try {
    install("window", { matchMedia: () => media });
    install("document", doc);
    install("IntersectionObserver", Visibility);
    install("ResizeObserver", PassiveObserver);
    install("MutationObserver", PassiveObserver);
    install("fetch", () => { requests++; throw new Error("Disposed preview must not fetch"); });
    const first = mountMax3D(stage);
    assert.equal(requests, 0, "invisible stage is lazy");
    observers[0].callback([{ isIntersecting: true, intersectionRatio: 1 }]);
    const second = mountMax3D(stage);
    assert.equal(observers[0].disconnected, true, "new mount owns the single surface slot");
    observers[1].callback([{ isIntersecting: true, intersectionRatio: 1 }]);
    second.destroy(); first.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(requests, 0);
    assert.ok(observers.every((observer) => observer.disconnected));
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("a stage hidden during the asset request cannot begin parsing or WebGL allocation", async () => {
  const { createMax3D } = await import("./max3dRuntime.js");
  const original = globalThis.fetch;
  let active = true;
  globalThis.fetch = async () => {
    active = false;
    return new Response(new Uint8Array(binary));
  };
  try {
    await assert.rejects(createMax3D({ isConnected: true } as HTMLElement, null, "idle", new AbortController().signal, () => {}, () => active), (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  } finally { globalThis.fetch = original; }
});
