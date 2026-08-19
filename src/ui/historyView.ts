import { DISPLAY_NOISE, readAllComparableHistory, readAllHistory } from "../engine/history.js";
import type { StoredScan } from "../engine/history.js";
import { clearAllPhotos } from "../engine/photoStore.js";

// ---------------------------------------------------------------------------
// The history view: every scan owned by the active device-local identity, as a
// trend. Other accounts and prior anonymous sessions are deliberately absent.
//
// This is where the product's honesty about its own noise has to survive
// contact with a chart. A line joining weekly dots invites the eye to read
// every wiggle as progress, and most of the wiggle is measurement spread, not
// the face changing. So the calibrated noise band is drawn as a shaded ribbon
// around the running average: a point inside the ribbon has not moved in any
// way worth believing, and the chart says so by construction rather than by a
// caption nobody reads.
//
// Nothing here is a photograph. Only the numbers are stored, on the device, so
// "look back at an old scan" means look back at what it measured, not at a
// saved picture of a face.
// ---------------------------------------------------------------------------

const NOISE_SD = DISPLAY_NOISE;

const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / (a.length || 1);

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A dot's colour is earned only if it clears the noise band against the running
// average. Inside the band it is neutral, because inside the band it is noise.
function tone(overall: number, avg: number): "up" | "down" | "flat" {
  const d = overall - avg;
  if (Math.abs(d) < NOISE_SD) return "flat";
  return d > 0 ? "up" : "down";
}

function trendSVG(scans: StoredScan[]): string {
  // Oldest to newest, left to right.
  const pts = [...scans].reverse();
  const w = 640;
  const h = 200;
  const padX = 24;
  const padY = 22;
  const n = pts.length;
  const xAt = (i: number) => padX + (n === 1 ? (w - 2 * padX) / 2 : (i / (n - 1)) * (w - 2 * padX));
  // Fixed 0..10 vertical scale, so the chart cannot exaggerate a change by
  // auto-zooming its own axis — the trick every stock-chart screenshot uses.
  const yAt = (v: number) => padY + (1 - v / 10) * (h - 2 * padY);
  const avg = mean(pts.map((p) => p.overall));

  const band = `<rect x="${padX}" y="${yAt(avg + NOISE_SD)}" width="${w - 2 * padX}"
    height="${yAt(avg - NOISE_SD) - yAt(avg + NOISE_SD)}" fill="rgba(120,130,128,0.12)" rx="4" />
    <line x1="${padX}" y1="${yAt(avg)}" x2="${w - padX}" y2="${yAt(avg)}"
      stroke="rgba(90,100,98,0.5)" stroke-width="1" stroke-dasharray="4 4" />`;

  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.overall).toFixed(1)}`)
    .join(" ");

  const dots = pts
    .map((p, i) => {
      const t = tone(p.overall, avg);
      const fill = t === "up" ? "#2f9e73" : t === "down" ? "#c06a54" : "#8a938f";
      return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.overall).toFixed(1)}" r="4.5"
        fill="${fill}" stroke="#fff" stroke-width="1.5"><title>${fmtDate(p.date)} · ${p.overall.toFixed(1)}</title></circle>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${w} ${h}" class="hist-svg" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Score over ${n} scans">
    ${band}
    <path d="${line}" fill="none" stroke="rgba(40,44,48,0.55)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    ${dots}
    <text x="${padX}" y="${h - 4}" class="hist-axis">${fmtDate(pts[0].date)}</text>
    <text x="${w - padX}" y="${h - 4}" class="hist-axis" text-anchor="end">${fmtDate(pts[n - 1].date)}</text>
  </svg>`;
}

function rows(scans: StoredScan[]): string {
  // Newest first, each showing its move against the PREVIOUS scan (the one
  // below it in the list).
  return scans
    .map((s, i) => {
      const prev = scans[i + 1];
      const d = prev ? Math.round((s.overall - prev.overall) * 10) / 10 : null;
      const chip =
        d == null
          ? `<span class="hist-chip first">first scan</span>`
          : Math.abs(d) < NOISE_SD
            ? `<span class="hist-chip flat">${d >= 0 ? "+" : ""}${d.toFixed(1)} · within noise</span>`
            : `<span class="hist-chip ${d > 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${d.toFixed(1)}</span>`;
      return `<div class="hist-row">
        <span class="hist-date">${fmtDate(s.date)}</span>
        <span class="hist-score">${s.overall.toFixed(1)}<small>/10</small></span>
        ${chip}
        <span class="hist-sex">${s.sex === "male" ? "vs men" : "vs women"}</span>
      </div>`;
    })
    .join("");
}

export function hasHistory(): boolean {
  return readAllHistory().length > 0;
}

let activeHistory: HTMLDivElement | null = null;
let activeHistoryCleanup: (() => void) | null = null;

export function closeHistory(): void {
  if (activeHistoryCleanup) {
    const cleanup = activeHistoryCleanup;
    activeHistoryCleanup = null;
    cleanup();
    return;
  }
  activeHistory?.remove();
  activeHistory = null;
}

export function openHistory(): void {
  closeHistory();
  const allScans = readAllHistory();
  const scans = readAllComparableHistory();
  const legacyCount = allScans.length - scans.length;
  const wrap = document.createElement("div");
  activeHistory = wrap;
  wrap.className = "hist-overlay";

  if (!scans.length) {
    wrap.innerHTML = `<div class="hist-panel">
      <button class="hist-close" aria-label="Close">✕</button>
      <h2>Your scans</h2>
      <p class="hist-empty">${legacyCount
        ? `${legacyCount} earlier scan${legacyCount === 1 ? "" : "s"} used a previous scoring calibration and will not be mixed into the new trend. Take a new scan to start the calibrated history.`
        : "No scans yet. Your history builds here as you scan, week by week, all on this device."}</p>
    </div>`;
  } else {
    const avg = mean(scans.map((s) => s.overall));
    const best = Math.max(...scans.map((s) => s.overall));
    wrap.innerHTML = `<div class="hist-panel">
      <button class="hist-close" aria-label="Close">✕</button>
      <h2>Your scans</h2>
      <div class="hist-stats">
        <div><b>${scans.length}</b><span>SCANS</span></div>
        <div><b>${avg.toFixed(1)}</b><span>YOUR AVERAGE</span></div>
        <div><b>${best.toFixed(1)}</b><span>BEST</span></div>
      </div>
      ${scans.length >= 2 ? trendSVG(scans) : ""}
      <p class="hist-note">The shaded band is the ±${NOISE_SD.toFixed(1)}-point spread between two photos of one face.
        A dot inside it has not really moved — same face, different photo. Only dots clear of the
        band are a change worth reading.</p>
      ${legacyCount ? `<p class="hist-note">${legacyCount} earlier scan${legacyCount === 1 ? "" : "s"} used a previous calibration and is excluded from this chart.</p>` : ""}
      <div class="hist-list">${rows(scans)}</div>
      <p class="hist-foot">Stored on this device only for this profile: numbers and a thumbnail of each photo.
        Nothing here was ever uploaded, and clearing your browser data clears it.
        <button class="linkish" id="hist-clear-photos">Delete this profile's stored photos</button></p>
    </div>`;
  }

  // Anything stored has to be removable. The numbers stay — they are what the
  // trend is made of, and they are not the sensitive part.
  const clearBtn = wrap.querySelector<HTMLButtonElement>("#hist-clear-photos");
  if (clearBtn) {
    let armed = false;
    clearBtn.onclick = async () => {
      if (!armed) {
        armed = true;
        clearBtn.textContent = "Tap again to delete this profile's stored photos";
        return;
      }
      clearBtn.disabled = true;
      await clearAllPhotos();
      clearBtn.textContent = "Photos deleted";
    };
  }

  function close(): void {
    wrap.remove();
    document.removeEventListener("keydown", esc);
    if (activeHistory === wrap) {
      activeHistory = null;
      activeHistoryCleanup = null;
    }
  }
  function esc(ev: KeyboardEvent): void {
    if (ev.key === "Escape") close();
  }
  activeHistoryCleanup = close;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelector(".hist-close")?.addEventListener("click", close);
  document.addEventListener("keydown", esc);
  document.body.appendChild(wrap);
}
