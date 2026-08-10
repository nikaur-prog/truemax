import { initLandmarker, isReady, setRunningMode } from "./engine/landmarker.ts";
import { detectStable } from "./engine/consensus.ts";
import { assessQuality } from "./engine/quality.ts";
import { analyze } from "./engine/scoring.ts";
import { storedSex } from "./engine/sexPref.ts";
import type { Sex } from "./engine/types.ts";

// ---------------------------------------------------------------------------
// The calibration bench.
//
// The product's central problem is not that any one score is wrong, it is that
// the score for ONE face moves by more than the gap between two different
// faces. Measured on Commons photographs of four well-photographed people:
//
//   person            photos   score range   SD
//   Margot Robbie       18      3.6 - 7.8   1.13
//   Chris Hemsworth     14      4.3 - 8.3   1.42
//   Henry Cavill        15      4.0 - 7.8   0.94
//   Sydney Sweeney      18      3.7 - 8.2   1.27
//
// and the spread between those four people's own averages is 0.56 points. An
// instrument whose noise is twice its signal cannot rank an individual.
//
// The standard fix for a noisy instrument is to measure more than once and
// average, which shrinks the noise by the square root of the count while
// leaving the signal alone. Whether that is enough here is an empirical
// question about real photographs of real people, and answering it needs sets
// of photographs nobody should have to hand over.
//
// Hence this page. It runs the whole thing on the user's own device, exactly
// like the product, and emits numbers rather than faces. Someone can measure
// themselves twenty times and share the table without sharing a single image.
// ---------------------------------------------------------------------------

const MAX_DIM = 1280;

const el = {
  pick: document.getElementById("pick") as HTMLButtonElement,
  files: document.getElementById("files") as HTMLInputElement,
  drop: document.getElementById("drop")!,
  status: document.getElementById("status")!,
  out: document.getElementById("out")!,
  summary: document.getElementById("summary")!,
  rows: document.getElementById("rows") as HTMLTableElement,
  conv: document.getElementById("conv")!,
};

interface Row {
  name: string;
  ok: boolean;
  overall: number | null;
  yaw: number;
  pitch: number;
  smile: number;
  clean: boolean;
  note: string;
}

const sex: Sex = storedSex() ?? "male";
const results: Row[] = [];

void (async () => {
  try {
    await initLandmarker();
    await setRunningMode("IMAGE");
    el.status.textContent = `Engine ready. Scoring against the ${sex === "male" ? "male" : "female"} reference population.`;
  } catch {
    el.status.textContent = "Engine failed to load. Reload the page.";
    el.status.classList.add("error");
  }
})();

el.pick.onclick = () => el.files.click();
el.files.onchange = () => el.files.files && run([...el.files.files]);
el.drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.drop.classList.add("over");
});
el.drop.addEventListener("dragleave", () => el.drop.classList.remove("over"));
el.drop.addEventListener("drop", (e) => {
  e.preventDefault();
  el.drop.classList.remove("over");
  const f = [...(e.dataTransfer?.files ?? [])].filter((x) => x.type.startsWith("image/"));
  if (f.length) void run(f);
});

async function decode(file: File): Promise<HTMLCanvasElement | null> {
  // createImageBitmap applies EXIF rotation, which matters here more than
  // anywhere: every one of these is a phone portrait stored as landscape pixels
  // plus a flag, and a face measured on its side is not a measurement.
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const s = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return c;
  } catch {
    return null;
  }
}

async function run(files: File[]): Promise<void> {
  if (!isReady()) {
    el.status.textContent = "Engine still loading. One moment.";
    return;
  }
  results.length = 0;
  el.out.classList.remove("hidden");
  await setRunningMode("IMAGE");

  for (const [i, f] of files.entries()) {
    el.status.textContent = `Measuring ${i + 1} of ${files.length}…`;
    // Yield so the status line actually paints between images.
    await new Promise((r) => setTimeout(r, 0));

    const canvas = await decode(f);
    if (!canvas) {
      results.push({ name: f.name, ok: false, overall: null, yaw: 0, pitch: 0, smile: 0, clean: false, note: "could not decode" });
      continue;
    }
    let row: Row;
    try {
      const res = detectStable(canvas);
      const q = assessQuality(res);
      if (!q.faceFound) {
        row = { name: f.name, ok: false, overall: null, yaw: 0, pitch: 0, smile: 0, clean: false, note: "no face found" };
      } else {
        const report = analyze(res.faceLandmarks[0], canvas.width, canvas.height, sex);
        row = {
          name: f.name,
          ok: true,
          overall: report.overall,
          yaw: q.yawDeg,
          pitch: q.pitchDeg,
          smile: q.smileScore,
          clean: q.pass,
          note: q.issues[0] ?? "",
        };
      }
    } catch (err) {
      row = { name: f.name, ok: false, overall: null, yaw: 0, pitch: 0, smile: 0, clean: false, note: String(err).slice(0, 60) };
    }
    results.push(row);
    paint();
  }
  el.status.textContent = `Done. ${results.filter((r) => r.ok).length} of ${files.length} photographs measured.`;
}

const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a: number[]): number => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

function paint(): void {
  const ok = results.filter((r) => r.ok && r.overall != null);
  const scores = ok.map((r) => r.overall as number);

  el.summary.innerHTML = scores.length
    ? `<div class="stat"><b>${mean(scores).toFixed(2)}</b><span>MEAN OF ${scores.length}</span></div>
       <div class="stat"><b>${scores.length > 1 ? sd(scores).toFixed(2) : "—"}</b><span>SD ACROSS PHOTOS</span></div>
       <div class="stat"><b>${Math.min(...scores).toFixed(1)}–${Math.max(...scores).toFixed(1)}</b><span>RANGE</span></div>
       <div class="stat"><b>${ok.filter((r) => r.clean).length}/${ok.length}</b><span>PASS CAPTURE GATE</span></div>`
    : `<p class="status">No face measured yet.</p>`;

  el.rows.innerHTML =
    `<tr><th>photo</th><th>score</th><th>yaw</th><th>pitch</th><th>smile</th><th>capture</th></tr>` +
    results
      .map(
        (r) => `<tr class="${r.ok ? (r.clean ? "clean" : "") : "bad"}">
        <td class="fn">${escapeHtml(r.name)}</td>
        <td class="num">${r.overall == null ? "—" : r.overall.toFixed(1)}</td>
        <td class="num">${r.ok ? r.yaw.toFixed(0) + "°" : ""}</td>
        <td class="num">${r.ok ? r.pitch.toFixed(0) + "°" : ""}</td>
        <td class="num">${r.ok ? r.smile.toFixed(2) : ""}</td>
        <td class="note">${r.ok ? (r.clean ? "clean" : escapeHtml(r.note)) : escapeHtml(r.note)}</td>
      </tr>`,
      )
      .join("");

  // What averaging buys. Drawing two disjoint samples of k photos and comparing
  // their means is the honest version of "how repeatable is a k-photo scan",
  // because it never compares a sample against itself.
  if (scores.length >= 4) {
    const rows: string[] = [];
    for (let k = 1; k <= Math.floor(scores.length / 2); k++) {
      const gaps: number[] = [];
      for (let t = 0; t < 600; t++) {
        const pool = shuffle(scores.slice());
        gaps.push(Math.abs(mean(pool.slice(0, k)) - mean(pool.slice(k, 2 * k))));
      }
      gaps.sort((a, b) => a - b);
      rows.push(
        `<tr><td class="num">${k}</td><td class="num">${gaps[Math.floor(gaps.length / 2)].toFixed(2)}</td></tr>`,
      );
    }
    el.conv.innerHTML = `<h2>What averaging buys</h2>
      <p>Two separate sets of k photographs of this same face. How far apart do their averages land?</p>
      <table><tr><th>photos averaged</th><th>typical gap between two such averages</th></tr>${rows.join("")}</table>`;
  } else {
    el.conv.innerHTML = "";
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Filenames come from the user's disk and go straight into innerHTML.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
