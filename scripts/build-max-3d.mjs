/** Original procedural Max source. Run: node scripts/build-max-3d.mjs */
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// GLTFExporter uses FileReader to pack its generated binary buffer in Node.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.(); });
  }
};

export const MAX_CLIPS = ["idle", "listening", "thinking", "speaking", "celebrate", "quiet", "wave", "shocked", "angry", "mirror", "skate", "guitar"];
export function buildMax3D() {
  const root = new THREE.Group();
  root.name = "MaxRoot";
  root.userData = { asset: "TrueMax original SVG-faithful character", version: 5, rig: "rigid transform hierarchy", units: "metres", forward: "+Z", up: "+Y", identitySource: "src/ui/maxCharacter.ts" };
  const body = new THREE.Group(); body.name = "Body"; root.add(body);
  // The approved drawing is the identity, including its matte blue gradient.
  // Vertex colors keep that palette under every scene light. This is real
  // curved geometry and a transform rig, with no image plane or texture map.
  const palette = new THREE.MeshBasicMaterial({ name: "MaxAuthoredPalette", color: 0xffffff, vertexColors: true, toneMapped: false });
  const halo = new THREE.MeshBasicMaterial({ name: "MintAntennaHalo", color: 0x4bf5c5, opacity: 0.2, transparent: true, depthWrite: false, toneMapped: false });
  const shadowMaterial = new THREE.MeshBasicMaterial({ name: "HoverShadow", color: 0x09162e, opacity: 0.22, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = (name, geometry, material = palette, parent = body) => {
    const item = new THREE.Mesh(geometry, material); item.name = name; parent.add(item); return item;
  };
  const U = 0.023;
  const X = (x) => (x - 75) * U;
  const Y = (y) => (79 - y) * U;
  const color = (hex) => new THREE.Color(hex);
  const gradient = (top, bottom, t) => color(top).lerp(color(bottom), Math.max(0, Math.min(1, t)));
  const paint = (geometry, sample) => {
    const pos = geometry.getAttribute("position");
    const colors = [];
    for (let index = 0; index < pos.count; index++) colors.push(...sample(pos.getX(index), pos.getY(index), pos.getZ(index)).toArray());
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  };
  const solid = (geometry, hex) => paint(geometry, () => color(hex));
  const topCurve = new THREE.CubicBezierCurve(new THREE.Vector2(75, 16), new THREE.Vector2(104, 16), new THREE.Vector2(126, 42), new THREE.Vector2(126, 84));
  const bottomCurve = new THREE.CubicBezierCurve(new THREE.Vector2(126, 84), new THREE.Vector2(126, 120), new THREE.Vector2(104, 146), new THREE.Vector2(75, 146));
  const profile = [...topCurve.getPoints(28), ...bottomCurve.getPoints(28).slice(1)];
  const radiusAt = (svgY) => {
    for (let index = 1; index < profile.length; index++) if (svgY <= profile[index].y) {
      const a = profile[index - 1], b = profile[index];
      const mix = Math.max(0, Math.min(1, (svgY - a.y) / (b.y - a.y || 1)));
      return Math.max(0.001, (THREE.MathUtils.lerp(a.x, b.x, mix) - 75) * U);
    }
    return 0.001;
  };
  // Circular cross sections make a genuinely round egg from the same front
  // outline. The old fixed depth produced a pancake when viewed from the side.
  const depthAt = (svgY) => radiusAt(svgY);
  const front = (x, y) => {
    const svgY = 79 - y / U;
    return depthAt(svgY) * Math.sqrt(Math.max(0, 1 - (x / radiusAt(svgY)) ** 2));
  };
  const bodyColor = (x, y, z) => {
    const svgY = 79 - y / U;
    const t = (svgY - 16) / 130;
    const base = t < 0.55 ? gradient(0x84b5fb, 0x4f82e6, t / 0.55) : gradient(0x4f82e6, 0x2b52a6, (t - 0.55) / 0.45);
    const radius = radiusAt(svgY);
    const side = Math.min(1, Math.abs(x / radius));
    // Keep the approved front palette exactly, then ease into the back shade
    // by angle. A hemisphere branch made both side silhouettes jump from
    // 0.925 to 0.74, including different colors on the duplicate seam vertex.
    // Smoothstep has zero slope at the side, so the transition is continuous
    // in both value and slope without changing the shell or adding geometry.
    const back = THREE.MathUtils.clamp(-z / radius, 0, 1);
    const backMix = back * back * (3 - 2 * back);
    base.multiplyScalar(THREE.MathUtils.lerp(1 - 0.075 * side ** 3, 0.79 - 0.05 * side, backMix));
    // The runtime paints the original ellipse analytically, so its edge does
    // not expose this deliberately bounded mesh's polygon topology.
    return base;
  };
  const pos = [], indices = [];
  const segments = 64;
  for (const point of profile) for (let segment = 0; segment <= segments; segment++) {
    const angle = segment / segments * Math.PI * 2;
    pos.push((point.x - 75) * U * Math.cos(angle), Y(point.y), depthAt(point.y) * Math.sin(angle));
  }
  for (let row = 0; row < profile.length - 1; row++) for (let column = 0; column < segments; column++) {
    const a = row * (segments + 1) + column, b = a + segments + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); shell.setIndex(indices); shell.computeVertexNormals();
  const oval = mesh("OvalShell", paint(shell, bodyColor));
  oval.userData = { highlight: { svgCentre: [57, 34], svgRadius: [21, 12], opacity: 0.32 }, svgUnit: U };
  const roundedShape = (width, height, radius) => {
    const shape = new THREE.Shape();
    const x = -width / 2, y = -height / 2;
    shape.moveTo(x + radius, y);
    shape.lineTo(x + width - radius, y); shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
    shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
    return shape;
  };
  // Conforming front surfaces follow the shell's actual volume. The visor is
  // inset visually into its thin rim, never a separate protruding eye box.
  const patch = (shape, cx, cy, surface, sample, rings = 8) => {
    const raw = shape.getPoints(12);
    if (raw[0].distanceTo(raw.at(-1)) < 0.00001) raw.pop();
    // Shape.getPoints samples curves, but only emits endpoints for straight
    // edges. Subdivide those too: projecting a long top/bottom chord onto a
    // round shell otherwise leaves its middle inside the shell surface.
    const contour = [];
    for (let index = 0; index < raw.length; index++) {
      const from = raw[index], to = raw[(index + 1) % raw.length];
      const count = Math.max(1, Math.ceil(from.distanceTo(to) / 0.07));
      for (let part = 0; part < count; part++) contour.push(from.clone().lerp(to, part / count));
    }
    const positions = [cx, cy, surface(cx, cy)], triangles = [];
    for (let ring = 1; ring <= rings; ring++) for (const p of contour) {
      const x = cx + p.x * ring / rings, y = cy + p.y * ring / rings;
      positions.push(x, y, surface(x, y));
    }
    const count = contour.length;
    for (let column = 0; column < count; column++) triangles.push(0, 1 + column, 1 + (column + 1) % count);
    for (let ring = 1; ring < rings; ring++) for (let column = 0; column < count; column++) {
      const a = 1 + (ring - 1) * count + column, b = 1 + (ring - 1) * count + (column + 1) % count;
      const c = a + count, d = b + count;
      triangles.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(triangles); geometry.computeVertexNormals();
    return paint(geometry, sample);
  };
  const face = new THREE.Group(); face.name = "Face"; body.add(face);
  const visorShape = roundedShape(78 * U, 52 * U, 24 * U);
  mesh("VisorRim", patch(visorShape, 0, Y(71), (x, y) => front(x, y) + 0.035, () => color(0x304567)), palette, face);
  mesh("Visor", patch(roundedShape(75.8 * U, 49.8 * U, 22.9 * U), 0, Y(71), (x, y) => front(x, y) + 0.055,
    (_x, y) => gradient(0x17294e, 0x0a1428, (79 - y / U - 45) / 52)), palette, face);
  const eyes = new THREE.Group(); eyes.name = "Eyes"; face.add(eyes);
  for (const [name, svgX] of [["Left", 58.75], ["Right", 91.25]]) {
    const eye = new THREE.Group(); eye.name = `${name}Eye`; eyes.add(eye);
    eye.position.set(X(svgX), Y(68), front(X(svgX), Y(68)) + 0.078);
    const eyeGeometry = patch(roundedShape(11.5 * U, 22 * U, 5.75 * U), X(svgX), Y(68), (x, y) => front(x, y) + 0.078,
      (_x, y) => gradient(0xffffff, 0xb6dcff, (79 - y / U - 57) / 22), 4);
    eyeGeometry.translate(-eye.position.x, -eye.position.y, -eye.position.z);
    mesh(`${name}LightBar`, eyeGeometry, palette, eye);
    const glintX = X(svgX - 2.35), glintY = Y(61.4);
    const glint = mesh(`${name}Catchlight`, solid(new THREE.SphereGeometry(1, 12, 8), 0xffffff), palette, eye);
    glint.scale.set(1.7 * U, 1.7 * U, 0.007); glint.position.set(glintX, glintY, front(glintX, glintY) + 0.09).sub(eye.position);
  }
  const stroke = (name, points, width, hex, parent = face, origin = new THREE.Vector3()) => {
    const curve = new THREE.QuadraticBezierCurve(...points.map(([x, y]) => new THREE.Vector2(X(x), Y(y))));
    const path = new THREE.CatmullRomCurve3(curve.getPoints(24).map((p) => new THREE.Vector3(p.x, p.y, front(p.x, p.y) + 0.087).sub(origin)));
    mesh(name, solid(new THREE.TubeGeometry(path, 24, width * U / 2, 6, false), hex), palette, parent);
    for (const p of [path.getPoint(0), path.getPoint(1)]) {
      const end = mesh(`${name}End`, solid(new THREE.SphereGeometry(width * U / 2, 8, 6), hex), palette, parent); end.position.copy(p);
    }
  };
  const brows = new THREE.Group(); brows.name = "Brows"; face.add(brows);
  for (const [name, points, svgX] of [["Left", [[52, 52.5], [58, 49.1], [65, 50.3]], 58.5], ["Right", [[85, 50.3], [92, 49.1], [98, 52.5]], 91.5]]) {
    const brow = new THREE.Group(); brow.name = `${name}BrowRig`; brow.position.set(X(svgX), Y(51), front(X(svgX), Y(51)) + 0.087); brows.add(brow);
    stroke(`${name}Brow`, points, 2.4, 0xb5c3d3, brow, brow.position);
  }
  stroke("VisorReflection", [[44, 52], [58, 46], [74, 48]], 3.4, 0x3c4b69);
  const mouth = new THREE.Group(); mouth.name = "Mouth"; face.add(mouth);
  mouth.position.set(0, Y(86.4), front(0, Y(86.4)) + 0.087);
  const smile = new THREE.Group(); smile.name = "MouthSmile"; mouth.add(smile);
  stroke("Smile", [[66, 84.5], [75, 92], [84, 84.5]], 3, 0xe9f6ff, smile, mouth.position);
  const mouthOpen = new THREE.Group(); mouthOpen.name = "MouthOpen"; mouthOpen.position.y = 0.015; mouthOpen.scale.setScalar(0); mouth.add(mouthOpen);
  const opening = new THREE.Shape();
  opening.moveTo(-0.215, 0.1); opening.quadraticCurveTo(0, 0.026, 0.215, 0.1);
  opening.bezierCurveTo(0.195, -0.105, 0.13, -0.183, 0, -0.183);
  opening.bezierCurveTo(-0.13, -0.183, -0.195, -0.105, -0.215, 0.1);
  mesh("MouthCavity", solid(new THREE.ShapeGeometry(opening, 14), 0x050b18), palette, mouthOpen);
  const openingPath = new THREE.CatmullRomCurve3(opening.getPoints(14).slice(0, -1).map((p) => new THREE.Vector3(p.x, p.y, 0.028)), true);
  mesh("MouthOpeningRim", solid(new THREE.TubeGeometry(openingPath, 36, 0.009, 6, true), 0xe9f6ff), palette, mouthOpen);
  // Teeth and tongue live inside the opening rig: authored syllables and the
  // optional audio envelope reveal exactly the same cartoon mouth geometry.
  const teethShape = new THREE.Shape();
  teethShape.moveTo(-0.17, 0.079); teethShape.quadraticCurveTo(0, 0.025, 0.17, 0.079);
  teethShape.lineTo(0.15, 0.008); teethShape.quadraticCurveTo(0, -0.029, -0.15, 0.008); teethShape.closePath();
  const teeth = mesh("MouthTeeth", solid(new THREE.ShapeGeometry(teethShape, 10), 0xf5fbff), palette, mouthOpen); teeth.position.z = 0.045;
  const tongue = mesh("MouthTongue", solid(new THREE.SphereGeometry(1, 12, 8), 0xf595b3), palette, mouthOpen); tongue.scale.set(0.108, 0.043, 0.016); tongue.position.set(0, -0.105, 0.047);
  for (const [name, sign] of [["ArmLeft", -1], ["ArmRight", 1]]) {
    const arm = new THREE.Group(); arm.name = name; arm.position.set(sign * 41 * U, Y(92), front(sign * 41 * U, Y(92)) - 0.04); body.add(arm);
    const point = (x, y) => new THREE.Vector2((x - 116) * U * sign, (92 - y) * U);
    const shape = new THREE.Shape(); const start = point(116, 92); shape.moveTo(start.x, start.y);
    for (const values of [[128, 94, 137, 104, 135, 118], [133.5, 127, 124, 129.5, 119, 122], [114, 115, 114, 102, 116, 92]]) {
      const a = point(values[0], values[1]), b = point(values[2], values[3]), c = point(values[4], values[5]);
      shape.bezierCurveTo(a.x, a.y, b.x, b.y, c.x, c.y);
    }
    // A closed shallow paddle volume, not a blue capsule or articulated arm.
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.105, bevelEnabled: true, bevelSize: 0.009, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 12 });
    mesh(`${name}Flipper`, paint(geometry, (_x, y) => gradient(0x2b52a6, 0x1e3c7d, -y / (36 * U))), palette, arm);
  }
  const antenna = new THREE.Group(); antenna.name = "Antenna"; antenna.position.set(0, Y(18), 0); body.add(antenna);
  const stalk = mesh("AntennaStem", solid(new THREE.CylinderGeometry(1.3 * U, 1.3 * U, 10 * U, 12), 0x2b52a6), palette, antenna); stalk.position.y = 5 * U;
  const lamp = mesh("AntennaLight", solid(new THREE.SphereGeometry(3.4 * U, 20, 12), 0x4bf5c5), palette, antenna); lamp.position.y = 11.5 * U;
  const aura = mesh("AntennaAura", new THREE.SphereGeometry(7 * U, 20, 12), halo, antenna); aura.position.copy(lamp.position);
  const glint = mesh("AntennaCatchlight", solid(new THREE.SphereGeometry(U, 10, 8), 0xeafff8), palette, antenna); glint.position.set(-U, 12.6 * U, 3.2 * U);
  const shadow = mesh("HoverShadow", new THREE.CircleGeometry(1, 48), shadowMaterial, root); shadow.scale.set(28 * U, 4.5 * U, 1); shadow.position.set(0, Y(151), -0.12);

  // Real, deliberately simple props. They are absent at rest and only revealed
  // inside their own complete five-second routine. The normal SVG is unchanged.
  const prop = (name) => { const group = new THREE.Group(); group.name = name; group.scale.setScalar(0); body.add(group); return group; };
  const mirror = prop("MirrorProp");
  const mirrorHandle = mesh("MirrorHandle", solid(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 12), 0x18335b), palette, mirror); mirrorHandle.position.y = 0.15;
  const mirrorRim = mesh("MirrorRim", solid(new THREE.TorusGeometry(0.275, 0.045, 10, 32), 0x4bf5c5), palette, mirror); mirrorRim.position.y = 0.58;
  const mirrorFace = mesh("MirrorFace", solid(new THREE.CircleGeometry(0.265, 32), 0xd9ecfb), palette, mirror); mirrorFace.position.set(0, 0.58, 0.01);
  const mirrorBack = mesh("MirrorBack", solid(new THREE.CylinderGeometry(0.275, 0.275, 0.06, 32), 0x18335b), palette, mirror); mirrorBack.rotation.x = Math.PI / 2; mirrorBack.position.set(0, 0.58, -0.035);
  const reflection = mesh("MirrorGlint", solid(new THREE.BoxGeometry(0.065, 0.32, 0.012), 0xffffff), palette, mirror); reflection.position.set(-0.06, 0.58, 0.02); reflection.rotation.z = -0.45;
  // A tiny mitten extension appears only for the mirror gag. It is a friendly
  // pointing index and raised thumb, not a weapon prop or a human hand rig.
  const fingerGun = prop("MirrorFingerGesture");
  const palm = mesh("GesturePalm", solid(new THREE.SphereGeometry(1, 12, 8), 0x24488d), palette, fingerGun); palm.scale.set(0.13, 0.12, 0.08);
  const finger = (name, from, to, radius) => {
    const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to), direction = end.clone().sub(start);
    const digit = mesh(name, solid(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), 0x315ba6), palette, fingerGun);
    digit.position.copy(start).lerp(end, 0.5); digit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    const cap = mesh(`${name}Tip`, solid(new THREE.SphereGeometry(radius, 8, 6), 0x315ba6), palette, fingerGun); cap.position.copy(end);
  };
  finger("GestureIndex", [0.035, 0.044, 0.01], [0.34, 0.044, 0.01], 0.045);
  finger("GestureThumb", [-0.048, 0.045, 0.01], [-0.082, 0.235, 0.01], 0.049);
  const skate = prop("SkateProp");
  // Independent of Body so Max can jump above the board while it flips.
  root.add(skate);
  const kickTail = (geometry) => {
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const end = THREE.MathUtils.clamp((Math.abs(positions.getX(i)) - 0.55) / 0.28, 0, 1);
      positions.setY(i, positions.getY(i) + 0.12 * end * end);
    }
    geometry.computeVertexNormals();
    return geometry;
  };
  const deckGeometry = new THREE.ExtrudeGeometry(roundedShape(1.64, 0.58, 0.27), { depth: 0.07, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 8 });
  deckGeometry.rotateX(-Math.PI / 2); deckGeometry.translate(0, -0.035, 0);
  mesh("SkateDeck", solid(kickTail(deckGeometry), 0x4bf5c5), palette, skate);
  const gripGeometry = new THREE.ShapeGeometry(roundedShape(1.46, 0.46, 0.22), 8);
  gripGeometry.rotateX(-Math.PI / 2); gripGeometry.translate(0, 0.05, 0);
  mesh("SkateGrip", solid(kickTail(gripGeometry), 0x18335b), palette, skate);
  for (const x of [-0.5, 0.5]) {
    const truck = mesh(`SkateTruck${x}`, solid(new THREE.BoxGeometry(0.14, 0.12, 0.48), 0xb5c3d3), palette, skate); truck.position.set(x, -0.105, 0);
    for (const z of [-0.3, 0.3]) {
      const wheel = mesh(`SkateWheel${x < 0 ? "Left" : "Right"}${z < 0 ? "Back" : "Front"}`, solid(new THREE.CylinderGeometry(0.125, 0.125, 0.1, 16), 0xe9f6ff), palette, skate); wheel.rotation.x = Math.PI / 2; wheel.position.set(x, -0.16, z);
    }
  }
  const guitar = prop("GuitarProp");
  const guitarBody = mesh("GuitarBody", solid(new THREE.SphereGeometry(1, 24, 16), 0x6db3ee), palette, guitar); guitarBody.scale.set(0.33, 0.43, 0.1);
  const guitarTop = mesh("GuitarShoulder", solid(new THREE.SphereGeometry(1, 20, 12), 0x6db3ee), palette, guitar); guitarTop.scale.set(0.25, 0.29, 0.1); guitarTop.position.y = 0.3;
  const neck = mesh("GuitarNeck", solid(new THREE.BoxGeometry(0.11, 0.8, 0.07), 0x18335b), palette, guitar); neck.position.set(0, 0.87, 0);
  const head = mesh("GuitarHead", solid(new THREE.BoxGeometry(0.17, 0.24, 0.085), 0x4bf5c5), palette, guitar); head.position.y = 1.36;
  const sound = mesh("GuitarSoundHole", solid(new THREE.CircleGeometry(0.1, 24), 0x08162e), palette, guitar); sound.position.set(0, 0.11, 0.105);
  const bridge = mesh("GuitarBridge", solid(new THREE.BoxGeometry(0.19, 0.035, 0.04), 0x18335b), palette, guitar); bridge.position.set(0, -0.15, 0.12);
  for (const x of [-0.028, 0, 0.028]) { const string = mesh(`GuitarString${x}`, solid(new THREE.BoxGeometry(0.004, 1.48, 0.004), 0xe9f6ff), palette, guitar); string.position.set(x, 0.59, 0.13); }

  const animated = [root, body, eyes, ...["LeftEye", "RightEye", "LeftBrowRig", "RightBrowRig", "ArmLeft", "ArmRight"].map((name) => root.getObjectByName(name)), mouth, smile, mouthOpen, antenna, mirror, fingerGun, skate, guitar];
  const rest = Object.fromEntries(animated.map((node) => [node.name, { position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray() }]));
  const periodic = (t) => 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  const smooth = (value) => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
  const envelope = (t, edge = 0.16) => smooth(t / edge) * smooth((1 - t) / edge);
  const pulse = (t, centre, halfWidth) => Math.max(0, 1 - Math.abs(t - centre) / halfWidth);
  const euler = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
  const tip = (name) => new THREE.Vector3(name === "ArmLeft" ? -0.27 : 0.27, -0.67, 0.055);
  const aim = (state, name, shoulder, destination, weight = 1) => {
    const end = new THREE.Vector3(...destination), origin = new THREE.Vector3(...shoulder);
    const rotation = new THREE.Quaternion().setFromUnitVectors(tip(name).normalize(), end.clone().sub(origin).normalize());
    const contactOrigin = end.clone().sub(tip(name).applyQuaternion(rotation));
    state[name].position = new THREE.Vector3(...rest[name].position).lerp(contactOrigin, weight).toArray();
    state[name].quaternion = new THREE.Quaternion(...rest[name].quaternion).slerp(rotation, weight).toArray();
  };
  const props = { mirror: "MirrorProp", skate: "SkateProp", guitar: "GuitarProp" };
  const sample = (name, t) => {
    const state = structuredClone(rest);
    if (name === "quiet") {
      state.LeftEye.scale = state.RightEye.scale = [1, 0.72, 1];
      state.LeftBrowRig.position[1] -= 0.025; state.RightBrowRig.position[1] -= 0.025;
      state.MouthSmile.scale = [1, 0.7, 1];
      state.Body.quaternion = euler(0, 0, -0.035);
      return state;
    }
    if (t === 0 || t === 1) return state;
    const ease = envelope(t), wave = Math.sin(t * Math.PI * 2);
    const rotate = (node, xyz) => { state[node].quaternion = euler(...xyz); };
    const offset = (node, xyz) => { state[node].position = rest[node].position.map((value, index) => value + xyz[index]); };
    const open = (amount, width = 1) => { state.MouthOpen.scale = [amount > 0.03 ? width : 0, amount, amount > 0.03 ? 1 : 0]; state.MouthSmile.scale = [1 - smooth(amount * 4), 1 - smooth(amount * 4), 1 - smooth(amount * 4)]; };
    const blink = name === "idle" ? Math.max(pulse(t, 0.24, 0.034), pulse(t, 0.7, 0.034)) : pulse(t, 0.18, 0.035);
    state.LeftEye.scale = state.RightEye.scale = [1, 1 - blink * 0.93, 1];
    if (name === "idle") {
      offset("MaxRoot", [0, periodic(t) * 0.1, 0]);
      state.Body.scale = [1 - periodic(t) * 0.015, 1 + periodic(t) * 0.025, 1 - periodic(t) * 0.015];
      rotate("Body", [0, wave * 0.08, Math.sin(t * Math.PI * 2) * 0.03]);
    } else if (name === "listening") {
      rotate("Body", [-ease * 0.1 + Math.sin(t * Math.PI * 6) * ease * 0.07, ease * 0.1, -ease * 0.15]);
      aim(state, "ArmLeft", [-0.94, -0.12, 0.8], [-0.96, 0.52, 0.91], ease);
      offset("LeftBrowRig", [0, ease * 0.12, ease * 0.04]);
    } else if (name === "thinking") {
      rotate("Body", [-ease * 0.18, ease * 0.25, ease * 0.1]);
      rotate("Eyes", [-ease * 0.055, -ease * 0.04, 0]);
      aim(state, "ArmRight", [0.77, -0.3, 0.91], [0.21, -0.2, 1.31], ease);
      rotate("LeftBrowRig", [0, 0, ease * 0.18]); offset("LeftBrowRig", [0, ease * 0.1, ease * 0.04]);
      rotate("ArmLeft", [0, -ease * 0.1, -ease * 0.32]);
    } else if (name === "speaking") {
      const syllable = Math.max(periodic(t * 7), periodic(t * 4 + 0.17) * 0.8);
      const pause = 1 - smooth(pulse(t, 0.40625, 0.048));
      open((0.12 + syllable * 0.94) * ease * pause, 1.03 + periodic(t * 3) * 0.22);
      rotate("Body", [Math.sin(t * Math.PI * 6) * ease * 0.1, Math.sin(t * Math.PI * 2) * ease * 0.09, 0]);
      rotate("ArmRight", [ease * 0.35, 0, ease * (0.5 + periodic(t * 2) * 0.4)]);
      rotate("ArmLeft", [0, 0, -ease * 0.35]);
      offset("LeftBrowRig", [0, periodic(t * 3) * ease * 0.08, ease * 0.015]);
    } else if (name === "celebrate") {
      offset("MaxRoot", [0, (Math.sin(t * Math.PI * 3) ** 2) * ease * 0.29, 0]);
      rotate("Body", [0, wave * ease * 0.18, Math.sin(t * Math.PI * 4) * ease * 0.14]);
      rotate("ArmLeft", [0, 0, -ease * 2.55]); rotate("ArmRight", [0, 0, ease * 2.55]);
      open(ease * 0.55, 1.12); state.LeftEye.scale = state.RightEye.scale = [1 + ease * 0.04, 1 - ease * 0.15, 1];
    } else if (name === "wave") {
      const bounce = Math.sin(t * Math.PI * 3) ** 2;
      rotate("Body", [0, -ease * 0.1, -ease * 0.08 + wave * ease * 0.04]);
      rotate("ArmRight", [ease * 0.14, 0, ease * (2.6 + Math.sin(t * Math.PI * 10) * 0.32)]);
      rotate("ArmLeft", [0, 0, -ease * (0.3 + bounce * 0.18)]);
      offset("Body", [0, ease * (0.055 + bounce * 0.16), 0]);
      state.Body.scale = [1 - bounce * ease * 0.018, 1 + bounce * ease * 0.026, 1];
      open(ease * 0.53, 1.24);
      offset("LeftBrowRig", [0, ease * 0.035, 0]); offset("RightBrowRig", [0, ease * 0.035, 0]);
    } else if (name === "shocked") {
      open(ease * 1.05, 0.78); state.LeftEye.scale = state.RightEye.scale = [1 + ease * 0.17, 1 + ease * 0.2, 1];
      offset("LeftBrowRig", [0, ease * 0.19, ease * 0.07]); offset("RightBrowRig", [0, ease * 0.19, ease * 0.07]);
      rotate("Body", [-ease * 0.11, 0, 0]); offset("MaxRoot", [0, ease * 0.12, 0]);
      rotate("ArmLeft", [-ease * 0.4, 0, -ease * 1.4]); rotate("ArmRight", [-ease * 0.4, 0, ease * 1.4]);
    } else if (name === "angry") {
      rotate("LeftBrowRig", [0, 0, -ease * 0.55]); rotate("RightBrowRig", [0, 0, ease * 0.55]);
      state.LeftEye.scale = state.RightEye.scale = [1, 1 - ease * 0.25, 1];
      state.MouthSmile.scale = [1, 1 - ease * 1.55, 1];
      rotate("Body", [ease * 0.1, wave * ease * 0.08, Math.sin(t * Math.PI * 4) * ease * 0.065]);
      aim(state, "ArmLeft", [-1.08, -0.08, 0.73], [-0.64, -0.63, 1.0], ease);
      aim(state, "ArmRight", [1.08, -0.08, 0.73], [0.64, -0.63, 1.0], ease);
    } else if (name === "mirror") {
      const reach = smooth((t - 0.03) / 0.18) * (1 - smooth((t - 0.81) / 0.14));
      const grip = new THREE.Vector3(1.12, -0.83, 0.82).lerp(new THREE.Vector3(0.62, -0.38, 1.78), reach).toArray();
      // Hold it ahead of the visor, reflective face toward Max, not beside his ear.
      state.MirrorProp.position = grip; rotate("MirrorProp", [0, -2.40, 0]);
      aim(state, "ArmRight", [0.9, -0.35, 0.83], grip, ease);
      const inspect = smooth((t - 0.17) / 0.12) * (1 - smooth((t - 0.72) / 0.1));
      const point = smooth((t - 0.35) / 0.10) * (1 - smooth((t - 0.67) / 0.10));
      const recoil = smooth(pulse(t, 0.578125, 0.065));
      rotate("Body", [-ease * 0.025 + recoil * 0.055, inspect * 0.09, -ease * 0.045]);
      rotate("Eyes", [inspect * 0.018, inspect * 0.095, 0]);
      const hand = new THREE.Vector3(-1.11, -0.88, 0.83).lerp(new THREE.Vector3(-0.47 - recoil * 0.10, -0.05 + recoil * 0.07, 1.45), point);
      const target = new THREE.Vector3(...grip).add(new THREE.Vector3(0, 0.58, 0));
      const gestureRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), target.sub(hand).normalize());
      state.MirrorFingerGesture.position = hand.toArray(); state.MirrorFingerGesture.quaternion = gestureRotation.toArray();
      state.MirrorFingerGesture.scale = [point, point, point];
      aim(state, "ArmLeft", [-0.94, -0.29, 0.83], hand.toArray(), point);
      const wink = smooth(pulse(t, 0.53125, 0.065));
      state.LeftEye.scale = [1, 1 - wink * 0.95, 1];
      offset("LeftBrowRig", [0, -wink * 0.055, ease * 0.02]);
      offset("RightBrowRig", [0, wink * 0.1, ease * 0.02]);
      const grin = smooth((t - 0.40) / 0.11) * (1 - smooth((t - 0.73) / 0.10));
      open(grin * 0.63, 1.42);
      rotate("Mouth", [0, 0, -wink * 0.07]);
    } else if (name === "skate") {
      // Reveal the rounded deck, trucks and wheels for a beat before riding.
      const reveal = smooth((t - 0.04) / 0.11);
      const drop = smooth((t - 0.25) / 0.13);
      const airborne = THREE.MathUtils.clamp((t - 0.46) / 0.25, 0, 1);
      const hop = Math.sin(Math.PI * airborne);
      const crouch = smooth(pulse(t, 0.43, 0.065));
      const landing = smooth(pulse(t, 0.735, 0.05));
      const held = new THREE.Vector3(0.06, -0.73, 1.43);
      const boardPosition = new THREE.Vector3(0.58, -0.91, 0.7).lerp(held, reveal).lerp(new THREE.Vector3(0, -1.70 + hop * 0.16, 0.13), drop);
      const boardRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.12 * reveal, -0.12 * reveal, -0.18 * reveal));
      boardRotation.slerp(new THREE.Quaternion(), drop);
      boardRotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), smooth(airborne) * Math.PI * 2));
      state.SkateProp.position = boardPosition.toArray(); state.SkateProp.quaternion = boardRotation.toArray();
      const bodyY = hop * 0.32 - crouch * 0.07 - landing * 0.06;
      offset("Body", [0, bodyY, 0]);
      state.Body.scale = [1 + (crouch + landing) * 0.035, 1 - (crouch + landing) * 0.045, 1];
      rotate("Body", [0, 0, Math.sin(t * Math.PI * 4) * ease * 0.055 * drop]);
      rotate("ArmLeft", [ease * 0.12, 0, -ease * (0.65 + hop * 0.65)]);
      rotate("ArmRight", [0, 0, ease * (0.65 + hop * 0.65)]);
      if (drop < 1) {
        const contact = new THREE.Vector3(0.7, 0, 0).applyQuaternion(boardRotation).add(boardPosition);
        aim(state, "ArmRight", [0.91, -0.35, 0.8], contact.toArray(), ease * (1 - drop));
      }
    } else if (name === "guitar") {
      const guitarPosition = new THREE.Vector3(-0.08, -0.75, 1.23), guitarRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.58));
      state.GuitarProp.position = guitarPosition.toArray(); state.GuitarProp.quaternion = guitarRotation.toArray();
      const grip = new THREE.Vector3(0, 1.05, 0.14).applyQuaternion(guitarRotation).add(guitarPosition);
      const strum = new THREE.Vector3(Math.sin(t * Math.PI * 16) * 0.16, 0.11, 0.15).applyQuaternion(guitarRotation).add(guitarPosition);
      aim(state, "ArmRight", [0.76, -0.24, 0.96], grip.toArray(), ease);
      aim(state, "ArmLeft", [-0.76, -0.33, 0.98], strum.toArray(), ease);
      rotate("Body", [Math.sin(t * Math.PI * 4) * ease * 0.055, wave * ease * 0.12, wave * ease * 0.065]);
      offset("MaxRoot", [0, periodic(t * 4) * ease * 0.045, 0]);
    }
    if (props[name]) {
      // Bring the prop out only once the flippers reach its contact pose.
      // Hide it before returning the rig to neutral, never leave a residual prop.
      const show = smooth((t - 0.09) / 0.06) * smooth((0.91 - t) / 0.06);
      state[props[name]].scale = [show, show, show];
    }
    return state;
  };
  const durations = { idle: 4.8, listening: 4, thinking: 4.5, speaking: 3.2, celebrate: 2.4, quiet: 1, wave: 3.2, shocked: 2.4, angry: 3, mirror: 5, skate: 5, guitar: 5 };
  const times = Array.from({ length: 65 }, (_, index) => index / 64);
  const animations = MAX_CLIPS.map((name) => {
    const duration = durations[name], samples = times.map((time) => sample(name, time)), tracks = [];
    for (const node of animated) for (const path of ["position", "quaternion", "scale"]) {
      const values = samples.map((state) => state[node.name][path]);
      const constant = values.every((value) => value.every((component, index) => Math.abs(component - values[0][index]) < 1e-8));
      const trackTimes = constant ? [0, duration] : times.map((time) => time * duration);
      const trackValues = constant ? [...values[0], ...values.at(-1)] : values.flat();
      const Track = path === "quaternion" ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      tracks.push(new Track(`${node.name}.${path}`, trackTimes, trackValues));
    }
    return new THREE.AnimationClip(name, duration, tracks);
  });
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
  const manifest = { version: 5, source: "scripts/build-max-3d.mjs", identitySource: "src/ui/maxCharacter.ts", identity: "Round original oval Max with pupil-less light bars, inset visor, navy flippers and expressive prop routines", rig: "rigid transform hierarchy", triangles, materials, bytes: binary.byteLength, clips: MAX_CLIPS, license: "Original TrueMax project asset. No third-party source meshes or textures.", approved: false };
  await writeFile(resolve(directory, "max-rig-v1.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generateMaxAsset();
