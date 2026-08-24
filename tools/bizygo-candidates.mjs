// Which mirror pair on the face oval IS the bizygomatic width?
//
// tools/bizygo-check.mjs established that our current pair (116/345) sits 10.8%
// inside the face at cheekbone height. This picks the replacement the same way:
// by measuring every mirror pair on the oval across real faces, not by trusting
// a remembered landmark index.
//
// What we want is the pair that is (a) widest, since bizygomatic width is the
// widest point of the midface, and (b) actually at midface height rather than
// at the jaw or the temple, since the widest span on the whole oval could be
// either.
//
//   node tools/bizygo-candidates.mjs
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const PHOTOS = process.env.TM_PHOTOS ?? `${APP_DIR}/.calib/pop-photos`;
const LIMIT = Number(process.env.TM_LIMIT ?? 60);

const files = readdirSync(PHOTOS).filter((f) => f.endsWith(".jpg")).slice(0, LIMIT);
console.log(`Measuring ${files.length} faces...`);

const server = spawn("npx", ["vite", "--port", "4252", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 5000));
const browser = await launchChromium();

let data;
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4252/");
  await page.waitForSelector("html[data-engine=\"ready\"]", { timeout: 90000 });

  data = await page.evaluate(async (imgs) => {
    const { detect } = await import("/src/engine/landmarker.ts");
    const load = (u) => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = u;
    });

    // Right-side oval landmarks paired with their left-side mirrors.
    const PAIRS = [
      [234, 454], [127, 356], [93, 323], [132, 361], [58, 288], [172, 397],
      [136, 365], [150, 379], [149, 378], [176, 400], [148, 377],
      [162, 389], [21, 251], [54, 284], [103, 332], [67, 297],
      [116, 345], [123, 352], [147, 376], [213, 433], [192, 416], [138, 367],
      [215, 435], [177, 401], [137, 366], [227, 447], [34, 264], [143, 372],
    ];
    const out = [];
    for (const u of imgs) {
      let img;
      try { img = await load(u); } catch { continue; }
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = iw; c.height = ih;
      c.getContext("2d").drawImage(img, 0, 0);
      let lm;
      try { lm = detect(c)?.faceLandmarks?.[0]; } catch { continue; }
      if (!lm || !lm.length) continue;
      const P = (i) => ({ x: lm[i].x * iw, y: lm[i].y * ih });

      // Normalise by a span that does not depend on face width, so widths from
      // different photographs are comparable: eye line down to menton.
      const eyeY = (P(159).y + P(386).y) / 2;
      const menton = P(152);
      const vert = Math.abs(menton.y - eyeY);
      if (!(vert > 0)) continue;

      const row = {};
      for (const [a, b] of PAIRS) {
        const pa = P(a), pb = P(b);
        row[`${a}-${b}`] = {
          w: Math.hypot(pb.x - pa.x, pb.y - pa.y) / vert,
          // Height of the pair relative to the eye line, in the same units.
          // 0 is the eye line, 1 is the chin.
          h: ((pa.y + pb.y) / 2 - eyeY) / vert,
        };
      }
      out.push(row);
    }
    return out;
  }, files.map((f) => `data:image/jpeg;base64,${readFileSync(`${PHOTOS}/${f}`).toString("base64")}`));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

if (!data?.length) {
  console.error("No faces measured.");
  process.exit(1);
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

const keys = Object.keys(data[0]);
const rows = keys.map((k) => {
  const ws = data.map((r) => r[k].w);
  const hs = data.map((r) => r[k].h);
  return { pair: k, w: mean(ws), wsd: sd(ws), h: mean(hs) };
}).sort((a, b) => b.w - a.w);

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${data.length} faces. Width and height in "eye line to menton" units.\n`);
console.log(pad("pair", 12) + pad("width", 9) + pad("sd", 9) + pad("height", 9) + "note");
console.log("-".repeat(56));
for (const r of rows) {
  const cheek = r.h > -0.05 && r.h < 0.45;
  console.log(
    pad(r.pair, 12) + pad(r.w.toFixed(4), 9) + pad(r.wsd.toFixed(4), 9) + pad(r.h.toFixed(3), 9) +
      (r.pair === "116-345" ? "<- ours today" : cheek ? "midface height" : ""),
  );
}

const ours = rows.find((r) => r.pair === "116-345");
const best = rows.filter((r) => r.h > -0.05 && r.h < 0.45)[0];
console.log(
  `\nWidest pair at midface height: ${best.pair}, ${(best.w / ours.w * 100 - 100).toFixed(1)}% wider than ours.`,
);
console.log(`Its width varies less across faces than ours does: sd ${best.wsd.toFixed(4)} vs ${ours.wsd.toFixed(4)}.`);
