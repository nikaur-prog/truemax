import { DISPLAY_NOISE, scanStorageKey } from "../engine/history.js";
import type { StoredScan } from "../engine/history.js";
import { REGION_NAMES } from "../engine/scoring.js";
import type { RegionId } from "../engine/types.js";
import { loadPhotos } from "../engine/photoStore.js";
import { hasArchive } from "../engine/scanArchive.js";
import { curveLegend, curveSVG } from "./curve.js";
import { populationLine, rankShort } from "./templates.js";

// ---------------------------------------------------------------------------
// Reopening a scan you already took.
//
// The history list could only ever be read, which made it a chart with a
// legend rather than a record: the one thing somebody wants from a row dated
// three weeks ago is to see that scan again, and there was no way to.
//
// What this can and cannot show is decided by what was stored, and it is worth
// being exact about that rather than discovering it as a blank panel:
//
//   - Scans taken from now on carry the overall percentile, the four pillars,
//     the per-region percentiles and the ceiling, so a recalled scan shows its
//     standing, its curve, its pillar bars and its region bars.
//   - Scans taken BEFORE that carry only the overall and the per-region scores.
//     They still recall — date, score, movement, region bars, photographs — and
//     they say plainly that the rest was not kept, instead of rendering an empty
//     curve or, worse, a plausible-looking one built from nothing.
//   - No scan carries the ~40 individual metrics or the landmarks, so the
//     metric drill-down is not offered at any age. Storing those would be forty
//     objects per scan against a 120-entry localStorage cap, to rebuild a screen
//     that also needs a full-resolution photograph nobody keeps.
//
// The photographs are 320px thumbnails from IndexedDB, per owner, and are
// frequently absent — a scan taken on another device, or before thumbnails
// shipped. That is a normal state and is said in words.
// ---------------------------------------------------------------------------

export interface RecallHandle {
  close(): void;
}

// Where "View the full analysis" goes. Registered once by main.ts, which owns
// the results machinery this module must not import — the recall sheet knows
// WHETHER a scan can be reopened (the archive exists), the app knows HOW.
let reopenScan: ((scan: StoredScan) => void) | null = null;

export function setScanReopen(fn: (scan: StoredScan) => void): void {
  reopenScan = fn;
}

let active: HTMLElement | null = null;

/** Whether a recalled scan is currently on top. */
export function isScanRecallOpen(): boolean {
  return active !== null;
}

export function closeScanRecall(): void {
  active?.remove();
  active = null;
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const escapeHTML = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * The move against the scan before it, or null when this is the first.
 *
 * A guest's scan gets nothing — not even "first scan", which would claim a
 * sequence. It is one record of one face, compared against no one.
 */
function movement(scan: StoredScan, previous: StoredScan | undefined): string {
  if (scan.subject) return "";
  if (!previous) return `<span class="hist-chip first">first scan</span>`;
  const d = Math.round((scan.overall - previous.overall) * 10) / 10;
  const sign = d >= 0 ? "+" : "";
  if (Math.abs(d) < DISPLAY_NOISE) {
    return `<span class="hist-chip flat">${sign}${d.toFixed(1)} · within noise</span>`;
  }
  return `<span class="hist-chip ${d > 0 ? "up" : "down"}">${sign}${d.toFixed(1)}</span>`;
}

function bars(scan: StoredScan): string {
  const entries = Object.entries(scan.regions) as Array<[RegionId, number]>;
  if (!entries.length) return "";
  const avg = entries.reduce((s, [, v]) => s + v, 0) / entries.length;
  return `<div class="recall-bars" style="--avg:${(avg * 10).toFixed(1)}%">
    ${entries
      .sort((a, b) => b[1] - a[1])
      .map(
        ([id, v]) => `<div class="recall-bar">
          <span>${REGION_NAMES[id] ?? id}</span>
          <i><b style="width:${Math.min(100, v * 10).toFixed(1)}%"></b></i>
          <em>${v.toFixed(1)}</em>
        </div>`,
      )
      .join("")}
  </div>`;
}

function pillars(scan: StoredScan): string {
  const entries = Object.entries(scan.pillars ?? {});
  if (!entries.length) return "";
  return `<div class="recall-pillars">
    ${entries
      .map(
        ([name, v]) => `<div class="recall-pillar">
          <b>${(v as number).toFixed(1)}</b><span>${name.toUpperCase()}</span>
          <i><em style="width:${Math.min(100, (v as number) * 10).toFixed(1)}%"></em></i>
        </div>`,
      )
      .join("")}
  </div>`;
}

/**
 * Open a past scan. `previous` is the scan immediately older than this one, so
 * the recalled screen can show the same movement chip the list did.
 */
export function openScanRecall(scan: StoredScan, previous?: StoredScan): RecallHandle {
  closeScanRecall();

  const pct = scan.overallPercentile;
  const hasStanding = typeof pct === "number" && Number.isFinite(pct);

  const wrap = document.createElement("div");
  active = wrap;
  wrap.className = "hist-overlay recall-overlay";
  // Whose face this is stays attached to it. The list labels a guest's row
  // with their name, and losing that label the moment the row opened turned
  // the full-detail view into "a scan you took" over somebody else's
  // photographs.
  const who = scan.subject ? `${escapeHTML(scan.subject.name)} · ` : "";
  wrap.innerHTML = `<div class="hist-panel recall-panel" role="dialog" aria-modal="true" aria-label="${scan.subject ? `${escapeHTML(scan.subject.name)}'s scan from` : "A scan you took on"} ${fullDate(scan.date)}">
    <button class="hist-close" aria-label="Close">✕</button>
    <span class="recall-when">${fullDate(scan.date)} · ${timeOf(scan.date)}</span>
    <div class="recall-head">
      <b class="recall-score">${scan.overall.toFixed(1)}<small>/10</small></b>
      ${movement(scan, previous)}
      <span class="hist-sex">${who}${scan.sex === "male" ? "vs men" : "vs women"}</span>
      ${hasStanding ? `<span class="recall-rank">${rankShort(pct!)}</span>` : ""}
    </div>

    <div class="recall-shots" id="recall-shots">
      <p class="recall-note">Looking for the photographs…</p>
    </div>

    ${hasStanding
      ? `<div class="panel"><h4>POPULATION POSITION</h4>${curveSVG(pct!, "overall", scan.sex, false, {
          score: scan.overall,
          rank: rankShort(pct!),
        })}
        ${curveLegend()}
        <p class="rarity">${populationLine(pct!, scan.sex, "faces")}</p></div>`
      : `<p class="recall-note recall-old">This scan was taken before standings were kept, so its position against the reference set was not saved. Its score and its regions are exactly as measured.</p>`}

    ${pillars(scan)}
    ${bars(scan)}
    ${typeof scan.potential === "number"
      ? `<p class="recall-note">Ceiling at the time: <b>${scan.potential.toFixed(1)}</b>.</p>`
      : ""}
    <p class="recall-note recall-foot">Recalled from this device. The individual measurements behind these numbers are not kept, so this is the scan as it was scored rather than a re-analysis of the photograph.</p>
  </div>`;

  const close = () => {
    wrap.remove();
    document.removeEventListener("keydown", esc);
    if (active === wrap) active = null;
  };
  function esc(ev: KeyboardEvent): void {
    if (ev.key === "Escape") close();
  }
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelector(".hist-close")?.addEventListener("click", close);
  document.addEventListener("keydown", esc);
  document.body.appendChild(wrap);

  // The full interactive analysis, for scans whose archive was kept. The
  // sheet above stays exactly as it is: this is the way THROUGH it for
  // anybody who wants to walk the measurements again rather than read the
  // summary. Scans from before archives shipped never grow the button, in
  // keeping with the footnote right above it.
  void hasArchive(scanStorageKey(scan)).then((ok) => {
    if (!ok || !reopenScan) return;
    const panel = wrap.querySelector<HTMLElement>(".recall-panel");
    if (!panel || !panel.isConnected) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn pri recall-full";
    btn.textContent = "View the full analysis";
    btn.onclick = () => {
      close();
      reopenScan?.(scan);
    };
    panel.appendChild(btn);
  });

  // The photographs are a separate, frequently-empty store, so they arrive
  // after the numbers rather than holding them up.
  const shots = wrap.querySelector<HTMLElement>("#recall-shots");
  void loadPhotos(scanStorageKey(scan)).then((p) => {
    if (!shots || !shots.isConnected) return;
    if (!p || (!p.front && !p.side)) {
      shots.innerHTML = `<p class="recall-note">No photograph kept for this scan. It was taken before thumbnails were stored, or on another device.</p>`;
      return;
    }
    shots.innerHTML =
      (p.front ? `<figure class="recall-shot"><img src="${p.front}" alt="" /><figcaption>FRONT</figcaption></figure>` : "") +
      (p.side ? `<figure class="recall-shot"><img src="${p.side}" alt="" /><figcaption>SIDE</figcaption></figure>` : "");
  });

  return { close };
}
