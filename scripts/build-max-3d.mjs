/** Original procedural Max source. Run: node scripts/build-max-3d.mjs */
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// GLTFExporter uses FileReader to pack its generated binary buffer in Node.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.(); });
  }
};

export const MAX_CLIPS = ["idle", "listening", "thinking", "speaking", "celebrate", "quiet"];
export function buildMax3D() {
  const root = new THREE.Group();
  root.name = "MaxRoot";
  root.userData = { asset: "TrueMax original procedural character", version: 1, rig: "rigid transform hierarchy", units: "metres", forward: "+Z", up: "+Y" };
  const body = new THREE.Group(); body.name = "Body"; root.add(body);
  const blue = new THREE.MeshStandardMaterial({ name: "CobaltShell", color: 0x397de8, roughness: 0.38, metalness: 0.12 });
  const navy = new THREE.MeshStandardMaterial({ name: "NavyVisor", color: 0x0c1932, roughness: 0.24, metalness: 0.08 });
  const mint = new THREE.MeshStandardMaterial({ name: "MintLight", color: 0x8afce1, emissive: 0x31bfa3, emissiveIntensity: 0.3, roughness: 0.35 });
  const mesh = (name, geometry, material, parent = body) => {
    const item = new THREE.Mesh(geometry, material); item.name = name; parent.add(item); return item;
  };
  // A rounded volume, not an extruded badge. Subtle upper lobes preserve the
  // cloud brief without turning the original hovering body into a flower.
  const cloud = new THREE.SphereGeometry(1, 48, 32);
  const positions = cloud.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const angle = Math.atan2(y, x);
    const lobe = 1 + Math.max(0, y) * 0.035 * Math.cos(8 * (angle - Math.PI / 2));
    positions.setXYZ(index, x * 0.96 * lobe, y * 1.15 * lobe, z * 0.64);
  }
  cloud.deleteAttribute("normal"); cloud.deleteAttribute("uv");
  const smoothCloud = mergeVertices(cloud); smoothCloud.computeVertexNormals(); cloud.dispose();
  mesh("CloudShell", smoothCloud, blue);
  const rounded = (width, height, radius, depth) => {
    const shape = new THREE.Shape();
    const x = -width / 2, y = -height / 2;
    shape.moveTo(x + radius, y);
    shape.lineTo(x + width - radius, y); shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
    shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 4, curveSegments: 12 });
    geometry.deleteAttribute("normal"); geometry.deleteAttribute("uv");
    const smooth = mergeVertices(geometry); smooth.computeVertexNormals(); geometry.dispose();
    return smooth;
  };
  const face = new THREE.Group(); face.name = "Face"; body.add(face); face.position.set(0, 0.1, 0.66);
  mesh("Visor", rounded(1.58, 1.05, 0.35, 0.08), navy, face);
  const eyes = new THREE.Group(); eyes.name = "Eyes"; face.add(eyes);
  for (const [name, x] of [["Left", -0.32], ["Right", 0.32]]) {
    const eye = mesh(`${name}Eye`, rounded(0.24, 0.39, 0.12, 0.02), mint, eyes); eye.position.set(x, 0.12, 0.16);
    const pupil = mesh(`${name}Pupil`, new THREE.SphereGeometry(1, 16, 10), navy, eyes); pupil.scale.set(0.055, 0.085, 0.025); pupil.position.set(x + 0.01, 0.12, 0.23);
  }
  const smile = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.21, -0.23, 0.18), new THREE.Vector3(0, -0.43, 0.18), new THREE.Vector3(0.21, -0.23, 0.18));
  const mouth = new THREE.Group(); mouth.name = "Mouth"; face.add(mouth);
  mesh("Smile", new THREE.TubeGeometry(smile, 20, 0.025, 6, false), mint, mouth);
  for (const [name, sign] of [["ArmLeft", -1], ["ArmRight", 1]]) {
    const arm = new THREE.Group(); arm.name = name; arm.position.set(sign * 1.08, -0.31, 0); body.add(arm);
    const stub = mesh(`${name}Stub`, new THREE.SphereGeometry(1, 20, 14), blue, arm); stub.scale.set(0.19, 0.4, 0.22); stub.position.set(sign * 0.07, -0.21, 0); stub.rotation.z = sign * 0.3;
  }
  const antenna = new THREE.Group(); antenna.name = "Antenna"; antenna.position.set(0, 1.27, -0.06); body.add(antenna);
  const stalk = mesh("AntennaStem", new THREE.CylinderGeometry(0.035, 0.045, 0.21, 12), blue, antenna); stalk.position.y = 0.04;
  const lamp = mesh("AntennaLight", new THREE.SphereGeometry(0.105, 20, 14), mint, antenna); lamp.position.y = 0.2;
  const status = mesh("StatusLight", new THREE.SphereGeometry(0.045, 12, 8), mint); status.position.set(0, -0.65, 0.54); status.scale.z = 0.4;

  const times = Array.from({ length: 33 }, (_, index) => index / 32);
  const periodic = (t) => 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  const quaternion = (name, duration, rotation) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times.map((time) => time * duration), times.flatMap((time) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation(time))).toArray()));
  const position = (name, duration, xyz) => new THREE.VectorKeyframeTrack(`${name}.position`, times.map((time) => time * duration), times.flatMap(xyz));
  const clip = (name, duration, tracks) => new THREE.AnimationClip(name, duration, tracks);
  const animations = [
    clip("idle", 4.8, [position("MaxRoot", 4.8, (t) => [0, periodic(t) * 0.045, 0]), quaternion("Body", 4.8, (t) => [0, Math.sin(t * Math.PI * 2) * 0.025, 0])]),
    clip("listening", 3.2, [quaternion("Body", 3.2, (t) => [-periodic(t) * 0.08, 0, periodic(t) * 0.06])]),
    clip("thinking", 4.0, [quaternion("Body", 4.0, (t) => [0, periodic(t) * 0.18, periodic(t) * 0.055]), position("Eyes", 4.0, (t) => [periodic(t) * 0.045, periodic(t) * 0.035, 0])]),
    clip("speaking", 2.2, [quaternion("Body", 2.2, (t) => [Math.sin(t * Math.PI * 4) * 0.025, 0, 0]), new THREE.VectorKeyframeTrack("Mouth.scale", times.map((t) => t * 2.2), times.flatMap((t) => [1, 1 + periodic(t * 3) * 0.28, 1]))]),
    clip("celebrate", 1.8, [position("MaxRoot", 1.8, (t) => [0, periodic(t) * 0.18, 0]), quaternion("Body", 1.8, (t) => [0, Math.sin(t * Math.PI * 2) * 0.14, Math.sin(t * Math.PI * 4) * 0.06]), quaternion("ArmLeft", 1.8, (t) => [0, 0, -periodic(t) * 0.5]), quaternion("ArmRight", 1.8, (t) => [0, 0, periodic(t) * 0.5])]),
    clip("quiet", 1, [position("MaxRoot", 1, () => [0, 0, 0]), quaternion("Body", 1, () => [0, 0, 0])]),
  ];
  let triangles = 0;
  root.traverse((item) => { if (item.isMesh) triangles += (item.geometry.index?.count ?? item.geometry.attributes.position.count) / 3; });
  return { root, animations, triangles, materials: 3 };
}

export async function generateMaxAsset() {
  const { root, animations, triangles, materials } = buildMax3D();
  const binary = await new GLTFExporter().parseAsync(root, { binary: true, animations, onlyVisible: true });
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../public/brand");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "max-rig-v1.glb"), new Uint8Array(binary));
  const manifest = { version: 1, source: "scripts/build-max-3d.mjs", rig: "rigid transform hierarchy", triangles, materials, bytes: binary.byteLength, clips: MAX_CLIPS, license: "Original TrueMax project asset. No third-party source meshes or textures.", approved: false };
  await writeFile(resolve(directory, "max-rig-v1.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generateMaxAsset();
