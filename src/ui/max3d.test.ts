import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

/** Sample an authored key, rather than running the renderer or wall clock. */
function transformAt(clipName: string, nodeName: string, path: string, fraction: number): number[] {
  const clip = gltf.animations.find((clip: { name: string }) => clip.name === clipName);
  const channel = clip.channels.find((channel: { target: { node: number; path: string } }) => gltf.nodes[channel.target.node].name === nodeName && channel.target.path === path);
  assert.ok(channel, `${clipName}: ${nodeName}.${path} must be authored`);
  const sampler = clip.samplers[channel.sampler];
  const times = values(sampler.input), output = values(sampler.output), width = output.length / times.length;
  const desired = times[times.length - 1] * fraction;
  const index = times.length === 2 ? 0 : times.findIndex((time) => Math.abs(time - desired) < 0.00001);
  assert.ok(index >= 0, `${clipName}: requested sample must be an authored key`);
  return output.slice(index * width, (index + 1) * width);
}

const rotationAt = (clip: string, node: string, fraction: number): Quaternion => new Quaternion().fromArray(transformAt(clip, node, "rotation", fraction));
const positionAt = (clip: string, node: string, fraction: number): Vector3 => new Vector3().fromArray(transformAt(clip, node, "translation", fraction));

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

test("mirror is held ahead of Max, faces back toward him and receives a distinct one-eye wink", () => {
  const face = gltf.nodes.find((node: { name: string }) => node.name === "MirrorFace");
  for (const at of [0.25, 0.5, 0.75]) {
    const rotation = rotationAt("mirror", "MirrorProp", at);
    const grip = positionAt("mirror", "MirrorProp", at);
    assert.ok(grip.z > 1.4, "mirror must be in front of the visor, not alongside the ear");
    assert.ok(Math.abs(grip.x) < 1, "mirror stays close enough to look into");
    const faceCenter = new Vector3().fromArray(face.translation).applyQuaternion(rotation).add(grip);
    const reflectiveNormal = new Vector3(0, 0, 1).applyQuaternion(rotation);
    assert.ok(reflectiveNormal.dot(faceCenter.clone().negate().normalize()) > 0.7,
      "the reflective side, rather than its back, points toward Max");
  }
  assert.ok(transformAt("mirror", "LeftEye", "scale", 0.53125)[1] < 0.1, "the wink closes one eye");
  assert.ok(transformAt("mirror", "RightEye", "scale", 0.53125)[1] > 0.9, "the other eye remains open");
  for (const at of [0.375, 0.6875]) assert.ok(transformAt("mirror", "LeftEye", "scale", at)[1] > 0.9,
    "the wink returns to an open eye rather than leaving Max squinting");
});

test("skateboard has a rounded raised-tail deck, two trucks and four wheels independent of Max's jump", () => {
  const boardIndex = gltf.nodes.findIndex((node: { name: string }) => node.name === "SkateProp");
  const parent = gltf.nodes.find((node: { children?: number[] }) => node.children?.includes(boardIndex));
  assert.equal(parent.name, "MaxRoot", "board must not inherit the Body jump");
  const children = gltf.nodes[boardIndex].children.map((index: number) => gltf.nodes[index]);
  assert.equal(children.filter((node: { name: string }) => node.name.startsWith("SkateTruck")).length, 2);
  const wheels = children.filter((node: { name: string }) => node.name.startsWith("SkateWheel"));
  assert.equal(wheels.length, 4);
  for (const axis of [0, 2]) {
    assert.equal(wheels.filter((wheel: { translation: number[] }) => wheel.translation[axis] < 0).length, 2,
      "wheels straddle both trucks and both sides");
  }
  const deck = children.find((node: { name: string }) => node.name === "SkateDeck");
  const points = values(gltf.meshes[deck.mesh].primitives[0].attributes.POSITION);
  const vertices = Array.from({ length: points.length / 3 }, (_, index) => new Vector3().fromArray(points, index * 3));
  const length = Math.max(...vertices.map((p) => p.x)) - Math.min(...vertices.map((p) => p.x));
  const width = Math.max(...vertices.map((p) => p.z)) - Math.min(...vertices.map((p) => p.z));
  assert.ok(length > width * 2, "deck has a readable skateboard silhouette");
  const centralTop = Math.max(...vertices.filter((p) => Math.abs(p.x) < length * 0.3).map((p) => p.y));
  for (const direction of [-1, 1]) {
    const end = vertices.filter((p) => p.x * direction > length * 0.45);
    assert.ok(Math.max(...end.map((p) => p.y)) > centralTop + 0.06, "both kicktails curve upward");
    assert.ok(Math.max(...end.map((p) => Math.abs(p.z))) < width * 0.4, "deck ends are rounded rather than square blocks");
  }
});

test("skate first shows the board, drops it into place, then performs one airborne long-axis kickflip", () => {
  for (const at of [0.1875, 0.25]) {
    const position = positionAt("skate", "SkateProp", at);
    assert.ok(position.z > 1.2 && position.y > -1, "the board is held visibly ahead of Max before riding");
    const deckNormal = new Vector3(0, 1, 0).applyQuaternion(rotationAt("skate", "SkateProp", at));
    assert.ok(Math.abs(deckNormal.z) > 0.7, "tilted reveal exposes the deck and wheels");
    assert.ok(transformAt("skate", "SkateProp", "scale", at).every((value) => value > 0.99));
  }
  const restingBoard = positionAt("skate", "SkateProp", 0.40625);
  assert.ok(restingBoard.y < -1.5 && restingBoard.z < 0.3, "board drops below Max before the trick");
  assert.ok(rotationAt("skate", "SkateProp", 0.40625).angleTo(new Quaternion()) < 0.00001);
  const angles: number[] = [];
  for (let key = 29; key <= 46; key++) {
    const rotation = rotationAt("skate", "SkateProp", key / 64);
    assert.ok(Math.abs(rotation.y) < 0.00001 && Math.abs(rotation.z) < 0.00001,
      "kickflip rotates about the long deck axis, not an end-over-end somersault");
    angles.push(2 * Math.atan2(rotation.x, rotation.w));
  }
  assert.ok(Math.abs(angles[0]) < 0.00001 && Math.abs(angles[angles.length - 1] - Math.PI * 2) < 0.00001,
    "the board completes a full 360-degree flip and lands upright");
  assert.ok(angles.every((angle, index) => index === 0 || angle >= angles[index - 1]), "one continuous forward flip");
  const peak = 0.578125;
  const bodyRise = positionAt("skate", "Body", peak).y;
  const boardRise = positionAt("skate", "SkateProp", peak).y - restingBoard.y;
  assert.ok(bodyRise > boardRise + 0.1, "Max jumps clear of the flipping board");
  assert.ok(Math.abs(positionAt("skate", "SkateProp", 0.8125).y - restingBoard.y) < 0.00001,
    "board lands at its riding height");
});

test("the eight untouched clips retain their exact authored motion", () => {
  // Canonical numeric channel hashes from the pre-polish asset. Ignore binary
  // offsets and node ordering, which legitimately change when props are rebuilt.
  const approved: Record<string, string> = {
    idle: "07cf4509fa1697124e17235ae30eb20f3d74a32a07bfc22e35a7cf2d2d121f11",
    listening: "7059b480fb6ed09a10cf37ff97306c1d369d3dc6546864f011efd4ab5d88b5c5",
    thinking: "969edd002fb0b1f2f4019be918af4571065d02cd639a4edfcddfc10776e24aa3",
    celebrate: "5db9500b3573149ef71ca59210cac855d2ffdaa158d8b195e3729e528819ada5",
    quiet: "27c88783644b0e49b9652e3c1179b30bc5df966406b920b5484b096885701235",
    shocked: "91b1653a5b0e3453838fa82f5d061aa57300a5b2584020f474b9df7ca3b494d2",
    angry: "7915902f8e3bf7640d219e351d8bb064db00e5c76289f870ebd2c494a8e412df",
    guitar: "a93a5223287ea8697398396946776aecac3becb52c051cc50e99ceb0e1dd7238",
  };
  for (const [name, expected] of Object.entries(approved)) {
    const clip = gltf.animations.find((clip: { name: string }) => clip.name === name);
    const canonical = clip.channels.filter((channel: { target: { node: number } }) => gltf.nodes[channel.target.node].name !== "MirrorFingerGesture").map((channel: { sampler: number; target: { node: number; path: string } }) => {
      const sampler = clip.samplers[channel.sampler];
      return { name: gltf.nodes[channel.target.node].name, path: channel.target.path, time: values(sampler.input), value: values(sampler.output) };
    }).sort((a: { name: string; path: string }, b: { name: string; path: string }) => `${a.name}.${a.path}`.localeCompare(`${b.name}.${b.path}`));
    assert.equal(createHash("sha256").update(JSON.stringify(canonical)).digest("hex"), expected, `${name} must keep its approved motion`);
  }
});

test("mirror gesture points into the mirror with a raised thumb, grin and connected flipper", () => {
  const nodes = gltf.nodes.map((node: { name: string }) => node.name);
  for (const name of ["GesturePalm", "GestureIndex", "GestureThumb", "MouthTeeth", "MouthTongue"]) assert.ok(nodes.includes(name));
  const at = 0.53125;
  assert.ok(transformAt("mirror", "MirrorFingerGesture", "scale", at).every((value) => value > 0.99));
  const hand = positionAt("mirror", "MirrorFingerGesture", at);
  const flipper = new Vector3(-0.27, -0.67, 0.055).applyQuaternion(rotationAt("mirror", "ArmLeft", at)).add(positionAt("mirror", "ArmLeft", at));
  assert.ok(hand.distanceTo(flipper) < 0.00001, "gesture stays attached to the reaching flipper");
  const direction = new Vector3(1, 0, 0).applyQuaternion(rotationAt("mirror", "MirrorFingerGesture", at));
  const mirror = positionAt("mirror", "MirrorProp", at).add(new Vector3(0, 0.58, 0));
  assert.ok(direction.dot(mirror.sub(hand).normalize()) > 0.99, "index points at the reflection, not at the viewer");
  const grin = transformAt("mirror", "MouthOpen", "scale", at);
  assert.ok(grin[0] > 1.3 && grin[1] > 0.5, "broad grin reveals the teeth and tongue");
  for (const clip of MAX_3D_STATES) for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    if (clip === "mirror" && fraction > 0 && fraction < 1) continue;
    assert.deepEqual(transformAt(clip, "MirrorFingerGesture", "scale", fraction), [0, 0, 0], "no stray hand after an interruption or in other clips");
  }
});

test("welcome wave bounces above its stable shadow and smiles while speaking has real pauses", () => {
  const rise = positionAt("wave", "Body", 0.5).y;
  assert.ok(rise > 0.2, "the entrance has a readable happy bounce");
  assert.deepEqual(positionAt("wave", "MaxRoot", 0.5).toArray(), [0, 0, 0], "floor shadow does not jump with Max");
  assert.ok(transformAt("wave", "MouthOpen", "scale", 0.5)[1] > 0.5);
  assert.ok(transformAt("speaking", "MouthOpen", "scale", 0.40625)[1] < 0.001, "authored speech has a short closed-mouth pause");
  assert.ok(transformAt("speaking", "MouthOpen", "scale", 0.5)[1] > 0.8, "mouth resumes speaking after the pause");
  const opening = gltf.nodes.find((node: { name: string }) => node.name === "MouthOpen");
  for (const name of ["MouthTeeth", "MouthTongue"]) {
    const index = gltf.nodes.findIndex((node: { name: string }) => node.name === name);
    assert.ok(opening.children.includes(index), "audio-level overlay scales every inner mouth detail together");
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
  assert.match(source, /max-rig-v1\.glb\?v=\$\{maxAsset\.version\}/, "new character revisions cannot reuse a stale force-cached asset");
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
