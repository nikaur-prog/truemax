// Generate src/ui/cloudPoints.ts: the subset of landmarks the live overlay
// draws as its point cloud.
//
// The overlay used to take every Nth landmark by index. MediaPipe's indices are
// not spatially ordered and not mirror-paired, so that produced a cloud that
// was dense wherever the mesh happens to be dense (eyes, lips), sparse across
// the cheeks and forehead, and visibly different on the left and right of the
// face. It read as random scatter rather than as a thing tracking a face.
//
// This picks the subset ONCE, offline, from an averaged canonical face:
//
//   1. Detect a few dozen real faces, normalise each to a common centre and
//      scale, and average -> a canonical mesh.
//   2. Mirror it about its own midline and pair each landmark with its
//      counterpart, then symmetrise the canonical positions so the pairing is
//      exact rather than approximate.
//   3. Greedy farthest-point sampling: repeatedly take the candidate furthest
//      from everything already chosen. That is what makes the spacing even
//      rather than density-following.
//   4. Whenever a point off the midline is taken, take its mirror partner too,
//      so the cloud is symmetric by construction and not by luck.
//
// Boundary landmarks are excluded: they sit on the anatomical edge of the face,
// which from the front lands on the neck and in front of the ears.
//
// The output is a fixed list, so every frame draws the SAME anatomical points.
// That is what makes the cloud appear to deform with the face instead of
// shimmering — a per-frame sampler would reselect different points each frame.
//
// Run: node tools/cloud-points.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const PHOTOS = process.env.TM_PHOTOS ?? "/tmp/claude-0/-home-user-truemax/d2e733fd-a214-5db9-ad53-45f992c4158c/scratchpad/celebs/photos";
const TARGET = 64; // points drawn; the greedy pass stops here

const files = readdirSync(PHOTOS).filter((f) => f.endsWith(".jpg")).slice(0, 18);
const server = spawn("npx", ["vite", "--port", "4247", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

let result;
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4247/");
  await page.waitForSelector("#engine-status.ready", { timeout: 90000 });

  result = await page.evaluate(
    async ([imgs, target]) => {
      const { detect } = await import("/src/engine/landmarker.ts");
      const load = (u) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = u;
        });

      // ---- 1. canonical mesh -------------------------------------------------
      let sumX = null;
      let sumY = null;
      let n = 0;
      for (const u of imgs) {
        let img;
        try {
          img = await load(u);
        } catch {
          continue;
        }
        // Read the intrinsic size BEFORE releasing the image: clearing src
        // resets naturalWidth to 0, and an aspect ratio of 0/0 poisons every
        // downstream distance with NaN.
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const c = document.createElement("canvas");
        c.width = iw;
        c.height = ih;
        c.getContext("2d").drawImage(img, 0, 0);
        let lm;
        try {
          lm = detect(c).faceLandmarks?.[0];
        } catch {
          lm = null;
        }
        c.width = 1;
        c.height = 1;
        img.src = "";
        if (!lm) continue;
        // Normalise: centre on the face box, scale by face width, and correct
        // for the image aspect so x and y are in the same units.
        const ar = iw / ih;
        let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
        for (const p of lm) {
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, s = x1 - x0 || 1;
        sumX ??= new Float64Array(lm.length);
        sumY ??= new Float64Array(lm.length);
        for (let i = 0; i < lm.length; i++) {
          sumX[i] += (lm[i].x - cx) / s;
          sumY[i] += ((lm[i].y - cy) / s) / ar;
        }
        n++;
      }
      if (!n) return { error: "no faces detected" };

      const N = sumX.length;
      const X = Array.from({ length: N }, (_, i) => sumX[i] / n);
      const Y = Array.from({ length: N }, (_, i) => sumY[i] / n);

      // ---- 2. mirror pairing + symmetrise -----------------------------------
      // Midline from the landmarks that ARE the midline (nose bridge to chin).
      const MID_SEED = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 0, 17, 18, 175, 152];
      const axis = MID_SEED.reduce((a, i) => a + X[i], 0) / MID_SEED.length;
      for (let i = 0; i < N; i++) X[i] -= axis;

      const partner = new Int32Array(N).fill(-1);
      for (let i = 0; i < N; i++) {
        let best = -1;
        let bestD = Infinity;
        for (let j = 0; j < N; j++) {
          const d = (X[j] + X[i]) ** 2 + (Y[j] - Y[i]) ** 2;
          if (d < bestD) { bestD = d; best = j; }
        }
        partner[i] = best;
      }
      // Keep only mutual pairs; anything else is treated as midline. Computed
      // into a copy: mutating `partner` while reading it cascades, because a
      // point demoted to self-paired then demotes everything that pointed at it.
      const mutual = new Int32Array(N);
      for (let i = 0; i < N; i++) mutual[i] = partner[partner[i]] === i ? partner[i] : i;
      partner.set(mutual);
      // Average each pair so the canonical shape is exactly symmetric.
      for (let i = 0; i < N; i++) {
        const j = partner[i];
        if (j <= i) continue;
        const mx = (X[i] - X[j]) / 2, my = (Y[i] + Y[j]) / 2;
        X[i] = mx; Y[i] = my;
        X[j] = -mx; Y[j] = my;
      }

      // ---- 3. candidates ----------------------------------------------------
      // MediaPipe FACE_LANDMARKS_FACE_OVAL, inlined: a runtime import() inside
      // page.evaluate is not rewritten by the dev server, so the bare package
      // specifier will not resolve here. This is the same fixed 36-point ring.
      const boundary = new Set([
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
        397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
        172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
      ]);
      const EPS = 0.012;
      const candidates = [];
      let nPaired = 0;
      for (let i = 0; i < N; i++) {
        if (boundary.has(i)) continue;
        // Iris landmarks (468+) only exist with refinement and sit on top of
        // each other; they add nothing to a cloud.
        if (i >= 468) continue;
        // One representative per pair: the midline points, plus one side.
        if (partner[i] !== i) { nPaired++; if (X[i] < EPS) continue; }
        candidates.push(i);
      }

      // ---- 4. greedy farthest-point ----------------------------------------
      const chosen = [];
      const dist = (a, b) => Math.hypot(X[a] - X[b], Y[a] - Y[b]);
      // Seed at the point nearest the centroid of the candidate set, so the
      // first pick is not an outlier.
      let seed = candidates[0];
      let bestC = Infinity;
      for (const i of candidates) {
        const d = Math.hypot(X[i], Y[i]);
        if (d < bestC) { bestC = d; seed = i; }
      }
      const add = (i) => {
        chosen.push(i);
        if (partner[i] !== i) chosen.push(partner[i]);
      };
      add(seed);
      while (chosen.length < target) {
        let pick = -1;
        let far = -1;
        for (const i of candidates) {
          if (chosen.includes(i)) continue;
          let m = Infinity;
          for (const c of chosen) m = Math.min(m, dist(i, c));
          if (m > far) { far = m; pick = i; }
        }
        if (pick < 0) break;
        add(pick);
      }

      // Report the coverage that was achieved, so the tool's output is checkable
      const spacing = [];
      for (const a of chosen) {
        let m = Infinity;
        for (const b of chosen) if (a !== b) m = Math.min(m, dist(a, b));
        spacing.push(m);
      }
      spacing.sort((p, q) => p - q);
      return {
        faces: n,
        nCandidates: candidates.length,
        nPaired,
        points: chosen.sort((a, b) => a - b),
        minSpacing: spacing[0],
        medSpacing: spacing[spacing.length >> 1],
        maxSpacing: spacing[spacing.length - 1],
      };
    },
    [files.map((f) => "data:image/jpeg;base64," + readFileSync(`${PHOTOS}/${f}`).toString("base64")), TARGET],
  );
} finally {
  await browser.close();
  server.kill();
}

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

console.log(`averaged ${result.faces} faces -> ${result.points.length} points (candidates ${result.nCandidates}, paired ${result.nPaired})`);
console.log(
  `nearest-neighbour spacing (face widths): min ${result.minSpacing.toFixed(4)}  median ${result.medSpacing.toFixed(4)}  max ${result.maxSpacing.toFixed(4)}`,
);

writeFileSync(
  `${APP_DIR}/src/ui/cloudPoints.ts`,
  `// GENERATED by tools/cloud-points.mjs — do not hand-edit.
//
// Landmark indices for the live overlay's point cloud, chosen by greedy
// farthest-point sampling over an averaged canonical face and mirrored into
// exact left/right pairs. Even spacing, symmetric, no boundary points.
//
// Averaged over ${result.faces} faces. Nearest-neighbour spacing, in face widths:
// min ${result.minSpacing.toFixed(4)}, median ${result.medSpacing.toFixed(4)}, max ${result.maxSpacing.toFixed(4)}.
//
// The list is FIXED so every frame draws the same anatomical points and the
// cloud deforms with the face. Reselecting per frame would shimmer.
export const CLOUD_POINTS: readonly number[] = [
  ${result.points.join(", ")},
];
`,
);
console.log("wrote src/ui/cloudPoints.ts");
process.exit(0);
