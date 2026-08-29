import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const OUT = "/tmp/claude-0/-home-user-truemax/d2e733fd-a214-5db9-ad53-45f992c4158c/scratchpad";
const server = spawn("npx", ["vite", "--port", "4291", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 6000));
const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") console.log("page-err:", m.text().slice(0, 300)); });
  await page.goto("http://localhost:4291/");
  await page.waitForSelector('html[data-engine="ready"]', { timeout: 120000 });

  for (const path of ["/side-guide/reference.jpg", "/tutorial/side-do.jpg"]) {
    const out = await page.evaluate(async (p) => {
      const V = await import("/src/ui/_probeSideVerify.ts");
      const { sideMaskGeometry } = await import("/src/engine/sideMask.ts");
      const { segmentCategories } = await import("/src/engine/headCovering.ts");
      const { setRunningMode } = await import("/src/engine/landmarker.ts");
      await setRunningMode("IMAGE");
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = p; });
      const MAX_DIM = 1400;
      const s = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);

      const g = await sideMaskGeometry(c);
      if (!g) return { error: "no mask" };
      const seg = await segmentCategories(c);
      // person span (hair 1, body skin 2, face skin 3, plus clothes? print class histogram)
      const hist = {};
      for (let i = 0; i < seg.data.length; i++) hist[seg.data[i]] = (hist[seg.data[i]] || 0) + 1;
      const personL = new Int32Array(seg.height).fill(-1);
      const personR = new Int32Array(seg.height).fill(-1);
      for (let y = 0; y < seg.height; y++) {
        for (let x = 0; x < seg.width; x++) {
          const cl = seg.data[y * seg.width + x];
          if (cl === 1 || cl === 2 || cl === 3) { if (personL[y] < 0) personL[y] = x; personR[y] = x; }
        }
      }
      const personSpan = (y) => { const yy = Math.round(y); if (yy < 0 || yy >= seg.height || personL[yy] < 0) return null; return [personL[yy], personR[yy]]; };

      const mesh = V.seedFromLandmarks(c);
      const maskSeed = V.seedFromMask(g);
      const detail = (pts) => {
        const ids = Object.keys(pts);
        return ids.map((id) => {
          const q = pts[id];
          const row = q.y / g.scaleY;
          const span = g.headSpan(row);
          const ps = personSpan(row);
          const pad = c.width * 0.02;
          const on = !!(span && q.x >= span[0] * g.scaleX - pad && q.x <= span[1] * g.scaleX + pad);
          const onP = !!(ps && q.x >= ps[0] * g.scaleX - pad && q.x <= ps[1] * g.scaleX + pad);
          return { id, x: Math.round(q.x), y: Math.round(q.y), head: span ? [span[0], span[1]] : null, person: ps ? [ps[0], ps[1]] : null, on, onP };
        });
      };
      const frac = (pts) => V.onMaskFraction(pts, g, c.width);
      const fa = (pts) => V.frontAgreement(pts, g, c.width);
      const personFrac = (pts) => {
        const ids = Object.keys(pts); let on = 0;
        for (const id of ids) { const q = pts[id]; const ps = personSpan(q.y / g.scaleY); const pad = c.width * 0.02;
          if (ps && q.x >= ps[0] * g.scaleX - pad && q.x <= ps[1] * g.scaleX + pad) on++; }
        return on / ids.length;
      };
      const smart = await V.seedSidePointsSmart(c);
      return {
        canvas: [c.width, c.height],
        mask: [g.w, g.h, g.scaleX, g.scaleY],
        classes: hist,
        faceDir: g.faceDir, faceTop: g.faceTop, faceBottom: g.faceBottom,
        mesh: mesh ? { faceDir: mesh.faceDir, detail: detail(mesh.points), onMask: frac(mesh.points), front: fa(mesh.points), onPerson: personFrac(mesh.points) } : null,
        maskSeed: maskSeed ? { faceDir: maskSeed.faceDir, clipped: maskSeed.clipped, detail: detail(maskSeed.points), onMask: frac(maskSeed.points), front: fa(maskSeed.points), onPerson: personFrac(maskSeed.points) } : null,
        smart: { method: smart.method, confidence: smart.confidence, points: Object.fromEntries(Object.entries(smart.points).map(([k, v]) => [k, [Math.round(v.x), Math.round(v.y)]])) },
      };
    }, path);
    console.log("=== " + path);
    console.log(JSON.stringify(out, null, 1));
  }
} finally {
  await browser.close();
  server.kill();
}
