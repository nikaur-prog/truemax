import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Quaternion, Vector3 } from "three";
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
  assert.ok(binary.byteLength < 1_200_000, "the explicit preview remains a bounded, texture-free asset");
  assert.equal(gltf.materials.length, 3);
  assert.equal(gltf.textures?.length ?? 0, 0);
  assert.equal(gltf.images?.length ?? 0, 0);
  assert.ok(gltf.buffers.every((buffer: { uri?: string }) => !buffer.uri));
  const manifest = JSON.parse(read("../../public/brand/max-rig-v1.json"));
  assert.equal(manifest.bytes, binary.byteLength);
  assert.ok(manifest.triangles < 20_000);
  assert.equal(manifest.approved, false, "first iteration is explicitly awaiting visual approval");
});

test("the transform rig preserves the original SVG identity, without pupils, chest hardware or human limbs", () => {
  const nodes = gltf.nodes.map((node: { name: string }) => node.name);
  for (const part of ["MaxRoot", "Body", "OvalShell", "Visor", "VisorRim", "LeftLightBar", "RightLightBar", "LeftCatchlight", "RightCatchlight", "LeftBrow", "RightBrow", "Smile", "MouthSmile", "MouthOpen", "MouthCavity", "MouthOpeningRim", "ArmLeftFlipper", "ArmRightFlipper", "Antenna", "MirrorProp", "SkateProp", "GuitarProp"]) assert.ok(nodes.includes(part), part);
  assert.ok(!nodes.some((name: string) => /pupil|cloud|statuslight|elbow|knee|leg|phone|tinker/i.test(name)));
  assert.ok(gltf.materials.every((material: { extensions?: Record<string, unknown> }) => material.extensions?.KHR_materials_unlit), "authored SVG colors must not become glossy lighting-dependent materials");
  assert.equal(gltf.skins?.length ?? 0, 0, "this is honestly a rigid transform rig, not a skinned mesh");
});

test("all twelve named clips have finite bounded samples and matching start/end transforms", () => {
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

test("the egg is genuinely round in depth and every clip resets the entire animated rig", () => {
  const shellNode = gltf.nodes.find((node: { name: string }) => node.name === "OvalShell");
  const positions = values(gltf.meshes[shellNode.mesh].primitives[0].attributes.POSITION);
  const xs = positions.filter((_, index) => index % 3 === 0), zs = positions.filter((_, index) => index % 3 === 2);
  const width = Math.max(...xs) - Math.min(...xs), depth = Math.max(...zs) - Math.min(...zs);
  assert.ok(depth / width > 0.95 && depth / width < 1.05, "round cross sections, not a flattened silhouette");
  const trackKeys = (clip: typeof gltf.animations[number]): string[] => clip.channels.map((channel: { target: { node: number; path: string } }) => `${gltf.nodes[channel.target.node].name}.${channel.target.path}`).sort();
  for (const clip of gltf.animations) assert.deepEqual(trackKeys(clip), trackKeys(gltf.animations[0]), `${clip.name} explicitly restores all rig and prop transforms`);
  for (const prop of ["MirrorProp", "SkateProp", "GuitarProp"]) {
    const index = gltf.nodes.findIndex((node: { name: string }) => node.name === prop);
    for (const clip of gltf.animations) {
      const channel = clip.channels.find((channel: { target: { node: number; path: string } }) => channel.target.node === index && channel.target.path === "scale");
      const scale = values(clip.samplers[channel.sampler].output);
      assert.deepEqual(scale.slice(0, 3), [0, 0, 0]);
      assert.deepEqual(scale.slice(-3), [0, 0, 0]);
      if (clip.name !== prop.replace("Prop", "").toLowerCase()) assert.ok(scale.every((value) => value === 0), `${clip.name} cannot leave ${prop} visible`);
      else assert.ok(Math.max(...scale) > 0.99, `${prop} is fully visible in its routine`);
    }
  }
});

test("the matte shell colors meet continuously at both front-to-back sides", () => {
  const shellNode = gltf.nodes.find((node: { name: string }) => node.name === "OvalShell");
  const attributes = gltf.meshes[shellNode.mesh].primitives[0].attributes;
  const positions = values(attributes.POSITION), colors = values(attributes.COLOR_0);
  const vertices = positions.length / 3;
  let ringWidth = 1;
  while (ringWidth < vertices && positions[ringWidth * 3 + 1] === positions[1]) ringWidth++;
  assert.ok(ringWidth > 32 && vertices % ringWidth === 0, "shell contains complete smooth rings");
  for (let start = 0; start < vertices; start += ringWidth) {
    // The first and last vertices share a position. Their colors must also
    // match, even though floating-point sine approaches zero from each side.
    for (let component = 0; component < 3; component++) {
      assert.ok(Math.abs(colors[start * 3 + component] - colors[(start + ringWidth - 1) * 3 + component]) < 0.000001, "duplicate side seam has identical color");
    }
    for (let column = 1; column < ringWidth; column++) for (let component = 0; component < 3; component++) {
      const previous = colors[(start + column - 1) * 3 + component];
      const current = colors[(start + column) * 3 + component];
      assert.ok(Math.abs(current - previous) < 0.03, "adjacent angular samples do not contain a hemisphere color step");
    }
  }
});

test("speaking opens distinct mouth geometry and quiet stays completely motionless", () => {
  const sampleTrack = (clipName: string, nodeName: string, path: string): number[] => {
    const clip = gltf.animations.find((clip: { name: string }) => clip.name === clipName);
    const channel = clip.channels.find((channel: { target: { node: number; path: string } }) => gltf.nodes[channel.target.node].name === nodeName && channel.target.path === path);
    return values(clip.samplers[channel.sampler].output);
  };
  const opening = sampleTrack("speaking", "MouthOpen", "scale");
  assert.ok(Math.max(...opening.filter((_, index) => index % 3 === 1)) > 0.9, "mouth visibly opens");
  assert.ok(sampleTrack("speaking", "MouthSmile", "scale").includes(0), "smile closes while actual cavity is open");
  for (const channel of gltf.animations.find((clip: { name: string }) => clip.name === "quiet").channels) {
    const sampler = gltf.animations.find((clip: { name: string }) => clip.name === "quiet").samplers[channel.sampler];
    assert.equal(values(sampler.input).length, 2, "quiet only contains constant reset tracks");
  }
  assert.ok(sampleTrack("quiet", "LeftEye", "scale")[1] < 0.8, "quiet visibly relaxes its eyes without ongoing motion");
  assert.ok(sampleTrack("quiet", "MouthSmile", "scale")[1] < 0.8, "quiet has a softer smile");
  const idleBlink = sampleTrack("idle", "LeftEye", "scale").filter((_, index) => index % 3 === 1);
  assert.ok(Math.min(...idleBlink) < 0.25, "idle has a readable blink");
  for (const clipName of ["listening", "thinking", "wave", "celebrate", "shocked", "angry"]) {
    const channels = gltf.animations.find((clip: { name: string }) => clip.name === clipName).channels;
    assert.ok(channels.some((channel: { target: { node: number; path: string }; sampler: number }) => {
      if (!gltf.nodes[channel.target.node].name.startsWith("Arm") || channel.target.path !== "rotation") return false;
      const clip = gltf.animations.find((clip: { name: string }) => clip.name === clipName);
      const rotation = values(clip.samplers[channel.sampler].output);
      return rotation.some((component, index) => index % 4 !== 3 && Math.abs(component) > 0.15);
    }), `${clipName} has a visible shoulder gesture`);
  }
});

test("mirror and guitar flipper endpoints meet their prop contacts through the held routine", () => {
  const transform = (clipName: string, nodeName: string, path: string, at: number): number[] => {
    const clip = gltf.animations.find((clip: { name: string }) => clip.name === clipName);
    const channel = clip.channels.find((channel: { target: { node: number; path: string } }) => gltf.nodes[channel.target.node].name === nodeName && channel.target.path === path);
    const sampler = clip.samplers[channel.sampler];
    const time = values(sampler.input), output = values(sampler.output), width = output.length / time.length;
    const desired = time[time.length - 1] * at;
    let index = time.findIndex((value) => value >= desired - 0.00001);
    if (time.length === 2) index = 0;
    return output.slice(index * width, (index + 1) * width);
  };
  const point = (clip: string, node: string, local: Vector3, at: number): Vector3 => local
    .applyQuaternion(new Quaternion(...transform(clip, node, "rotation", at) as [number, number, number, number]))
    .add(new Vector3(...transform(clip, node, "translation", at) as [number, number, number]));
  for (const at of [0.25, 0.34375, 0.5, 0.6875, 0.75]) {
    const mirrorGrip = point("mirror", "MirrorProp", new Vector3(), at);
    const mirrorHand = point("mirror", "ArmRight", new Vector3(0.27, -0.67, 0.055), at);
    assert.ok(mirrorGrip.distanceTo(mirrorHand) < 0.00001, "right flipper holds the mirror handle");
    const guitarGrip = point("guitar", "GuitarProp", new Vector3(0, 1.05, 0.14), at);
    const frettingHand = point("guitar", "ArmRight", new Vector3(0.27, -0.67, 0.055), at);
    assert.ok(guitarGrip.distanceTo(frettingHand) < 0.00001, "right flipper holds the guitar neck");
    const strings = point("guitar", "GuitarProp", new Vector3(Math.sin(at * Math.PI * 16) * 0.16, 0.11, 0.15), at);
    const strummingHand = point("guitar", "ArmLeft", new Vector3(-0.27, -0.67, 0.055), at);
    assert.ok(strings.distanceTo(strummingHand) < 0.00001, "left flipper crosses the strings instead of waving beside them");
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
  for (const required of ["1000 / 30", "640 / Math.max", "1.5", "createMax3DPlayback", "webglcontextlost", "renderer.dispose()", "renderer.forceContextLoss()", "geometry.dispose()", "material.dispose()", "mixer.uncacheRoot", "setMax3DActive(fallback, true)"]) assert.ok(source.includes(required), required);
  assert.match(source, /if \(dead \|\| paused \|\| signal\.aborted \|\| !stage\.isConnected\) return/);
  assert.match(source, /schedule\.state\(\) !== "quiet" \|\| playback\.transitioning\(\)/);
  assert.ok(source.indexOf("speech?.restore()") < source.indexOf("mixer.update(delta)"), "previous speech overrides are restored before the mixer");
  assert.ok(source.indexOf("mixer.update(delta)") < source.indexOf("speech?.apply"), "explicit speech amplitude overrides the authored animation only after the mixer");
  assert.match(source, /speech\?\.apply\(speechLevel, schedule\.state\(\) === "speaking", delta\)/);
  assert.match(source, /if \(canvas\.dataset\.animation !== activeClip\) canvas\.dataset\.animation = activeClip/);
  assert.ok(source.indexOf("schedule.finish(finished)") < source.indexOf("canvas.dataset.animation = activeClip"), "published clip reflects a completed one-shot returning to its base state");
  assert.doesNotMatch(source, /getUserMedia|setTimeout|setInterval|quietUntil/);
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
