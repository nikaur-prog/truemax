// Build the Living Portraits landing reel from the measured synthetic cast.
//
// Inputs: TM_CAST_DIR holding cand-<id>.png, live-<id>.mp4 and measured.json
// (from measure-synthetic-cast.mjs). Output: public/demo/<slug>.jpg and
// <slug>.mp4 cropped IDENTICALLY, plus src/ui/demoReelData.ts with the
// engine's real output re-expressed in crop coordinates.
//
// The crop is forced to exactly the display ratio (440x550) before anything
// is resized. The celebrity builder cropped to the padded face box and then
// cover-resized, which re-crops whichever dimension the box ratio missed by,
// and every landmark stored against the box drifted by that second crop. An
// exact-ratio rect makes the resize a pure scale, so the same fractions are
// exact on the still AND on the video.
//
// No licence machinery: these faces are AI-generated for this reel, the data
// module carries the AI-GENERATED DEMONSTRATION credit, and the reel renders
// it on every frame.
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const CAST_DIR = process.env.TM_CAST_DIR;
if (!CAST_DIR) {
  console.error("TM_CAST_DIR must point at the cast directory");
  process.exit(1);
}
const FFMPEG = `${APP_DIR}/node_modules/ffmpeg-static/ffmpeg`;
const OUT = `${APP_DIR}/public/demo`;
const W = 440;
const H = 550;

// The cast, in reel order. Names are stage names for AI-generated people;
// they exist so the caption has something human to say next to the credit.
const CAST = [
  { id: "4", name: "Dev" },
  { id: "9", name: "Amara" },
  { id: "10", name: "Kai" },
  { id: "3", name: "Mei" },
  { id: "0", name: "Adrian" },
  { id: "11", name: "Freya" },
];

const measured = JSON.parse(readFileSync(`${CAST_DIR}/measured.json`, "utf8"));

// The padded face box, widened to exactly W:H, clamped inside the frame.
function cropRect(box, imgW, imgH) {
  const pad = 0.34;
  let x = (box.x - box.w * pad) * imgW;
  let y = (box.y - box.h * pad * 1.1) * imgH;
  let w = box.w * (1 + pad * 2) * imgW;
  let h = box.h * (1 + pad * 2.2) * imgH;
  const target = W / H;
  if (w / h < target) {
    const grow = h * target - w;
    x -= grow / 2;
    w = h * target;
  } else {
    const grow = w / target - h;
    y -= grow / 2;
    h = w / target;
  }
  // Clamp by shifting first, shrinking only if the rect is larger than the
  // frame (it is not, for this cast; shrinking would break the exact ratio).
  x = Math.min(Math.max(0, x), imgW - w);
  y = Math.min(Math.max(0, y), imgH - h);
  if (x < 0 || y < 0) throw new Error("crop larger than frame");
  return { x, y, w, h };
}

const entries = [];
for (const { id, name } of CAST) {
  const m = measured.find((e) => e.id === id);
  if (!m) throw new Error(`no measurement for cand-${id}`);
  const slug = name.toLowerCase();
  const png = `${CAST_DIR}/cand-${id}.png`;
  const meta = await sharp(png).metadata();
  const r = cropRect(m.box, meta.width, meta.height);

  await sharp(png)
    .extract({ left: Math.round(r.x), top: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) })
    .resize(W, H)
    .jpeg({ quality: 80 })
    .toFile(`${OUT}/${slug}.jpg`);

  // The same rect in the video's pixel space. The video was generated FROM
  // this exact still at a different resolution, so the fractions transfer.
  // ffmpeg -i with no output exits 1 by design; the dimensions are read from
  // the stderr it leaves on the way out.
  let vw = 0;
  let vh = 0;
  try {
    execFileSync(FFMPEG, ["-i", `${CAST_DIR}/live-${id}.mp4`]);
  } catch (e) {
    const match = /(\d{3,4})x(\d{3,4})[,\s]/.exec(String(e.stderr));
    if (match) { vw = Number(match[1]); vh = Number(match[2]); }
  }
  if (!vw || !vh) throw new Error(`could not read dimensions of live-${id}.mp4`);
  const sx = vw / meta.width;
  const sy = vh / meta.height;
  const cw = 2 * Math.round((r.w * sx) / 2);
  const ch = 2 * Math.round((r.h * sy) / 2);
  const cx = Math.round(r.x * sx);
  const cy = Math.round(r.y * sy);
  execFileSync(FFMPEG, [
    "-y", "-i", `${CAST_DIR}/live-${id}.mp4`,
    "-vf", `crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${H}`,
    "-an", "-c:v", "libx264", "-preset", "veryslow", "-crf", "27",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    `${OUT}/${slug}.mp4`,
  ], { stdio: "ignore" });

  const rel = ([lx, ly]) => [
    +(((lx * meta.width) - r.x) / r.w).toFixed(4),
    +(((ly * meta.height) - r.y) / r.h).toFixed(4),
  ];
  entries.push({
    name,
    sex: m.sex,
    slug,
    overall: m.overall,
    pillars: m.pillars,
    regions: m.regions
      .map((reg) => { const [rx, ry] = rel([reg.x, reg.y]); return { id: reg.id, score: reg.score, x: rx, y: ry }; })
      .filter((reg) => reg.x > 0.04 && reg.x < 0.96 && reg.y > 0.04 && reg.y < 0.96),
    credit: "AI-GENERATED DEMONSTRATION",
    points: m.lm.map(rel),
  });
  console.log(`${name.padEnd(8)} overall ${m.overall}  crop ${Math.round(r.w)}x${Math.round(r.h)} @ ${Math.round(r.x)},${Math.round(r.y)}`);
}

writeFileSync(
  `${APP_DIR}/src/ui/demoReelData.ts`,
  `// GENERATED by tools/build-demo-reel-live.mjs — do not hand-edit.
//
// Real scans of an AI-GENERATED cast: the landing reel shows the engine's
// actual output on these portraits, unshimmed — synthetic faces carry no
// community rating to borrow and no recognisability to contradict, so the
// honest number and the shown number are finally the same number. Each face
// has a matching still (<slug>.jpg) and a living-portrait loop (<slug>.mp4)
// in public/demo/, cropped to identical geometry so the landmark fractions
// hold on both. \`credit\` renders on every frame: these people do not exist.
export interface ReelRegion {
  id: string;
  score: number;
  x: number;
  y: number;
}

export interface ReelFace {
  name: string;
  sex: "male" | "female";
  slug: string;
  overall: number;
  pillars: Record<string, number>;
  regions: ReelRegion[];
  credit: string;
  points: Array<[number, number]>;
}

export const REEL: ReelFace[] = ${JSON.stringify(entries)};
`,
);
console.log(`wrote ${entries.length} reel faces`);
