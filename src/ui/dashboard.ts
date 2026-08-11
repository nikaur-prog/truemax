import { readAllHistory } from "../engine/history.ts";
import type { StoredScan } from "../engine/history.ts";
import { openHistory } from "./historyView.ts";
import { REEL } from "./demoReelData.ts";
import { applyShim } from "./demoReelShim.ts";

// ---------------------------------------------------------------------------
// The dashboard — the app's home.
//
// It offers exactly two things, which is the whole point of it: scan your face,
// or look up a celebrity. Under those sits your own history, so returning is
// about seeing the line move rather than taking a cold first scan. The premium
// surface (the Max coach, goal tracking, the wishlist) hangs off this same
// screen, but it needs accounts and a subscription gate that are not live yet,
// so it is deliberately not here — this is the part that works today.
//
// Reached from the wordmark. First load still goes straight to capture so the
// TikTok funnel is one tap from a scan, not two.
// ---------------------------------------------------------------------------

let overlay: HTMLDivElement | null = null;

export function isDashboardOpen(): boolean {
  return overlay !== null;
}

export function openDashboard(opts: { onScan: () => void }): void {
  close();
  const scans = readAllHistory();
  overlay = document.createElement("div");
  overlay.className = "dash";
  overlay.innerHTML = `
    <div class="dash-inner">
      <header class="dash-head">
        <span class="wordmark dash-logo">TRUE<b>MAX</b></span>
        <h1>Your dashboard</h1>
        <p>Measure your face, watch it over time, and see exactly where you land.</p>
      </header>

      <div class="dash-actions">
        <button class="dash-card pri" id="dash-scan">
          <span class="dash-ic">◎</span>
          <b>Scan your face</b>
          <span>Front and side, measured on your device</span>
        </button>
        <button class="dash-card" id="dash-celeb">
          <span class="dash-ic">★</span>
          <b>Search a celebrity</b>
          <span>See how the numbers read on a famous face</span>
        </button>
      </div>

      ${scanSection(scans)}
    </div>`;

  document.body.appendChild(overlay);
  document.getElementById("dash-scan")!.onclick = () => {
    close();
    opts.onScan();
  };
  document.getElementById("dash-celeb")!.onclick = () => openCelebSearch();
  overlay.querySelector("#dash-history")?.addEventListener("click", () => openHistory());
  for (const row of overlay.querySelectorAll<HTMLElement>(".dash-scan-row")) {
    row.onclick = () => openHistory();
  }
}

export function close(): void {
  overlay?.remove();
  overlay = null;
}

function scanSection(scans: StoredScan[]): string {
  if (!scans.length) {
    return `<section class="dash-scans">
      <h2>Your scans</h2>
      <div class="dash-empty">
        <b>No scans yet.</b>
        <span>Scan your face to see your first measurement — and every one after it lines up here so you can watch it move.</span>
      </div>
    </section>`;
  }
  const best = Math.max(...scans.map((s) => s.overall));
  const avg = scans.reduce((s, x) => s + x.overall, 0) / scans.length;
  const recent = scans.slice(0, 5);
  return `<div class="dash-cols">
    ${profilePanel(scans, avg)}
    <section class="dash-scans">
      <div class="dash-scans-head">
        <h2>Your scans</h2>
        ${scans.length > 5 ? `<button class="linkish" id="dash-history">View all ${scans.length} →</button>` : ""}
      </div>
      <div class="dash-stats">
        <div><b>${scans.length}</b><span>SCANS</span></div>
        <div><b>${avg.toFixed(1)}</b><span>AVERAGE</span></div>
        <div><b>${best.toFixed(1)}</b><span>BEST</span></div>
      </div>
      <div class="dash-scan-list">
        ${recent.map((s) => scanRow(s)).join("")}
      </div>
    </section>
  </div>`;
}

// Region labels, kept local so the dashboard does not drag the whole results
// module in for six words.
const REGION_LABEL: Record<string, string> = {
  eyes: "Eyes", midface: "Midface", jaw: "Jaw", chin: "Chin",
  nose: "Nose", lips: "Lips", proportions: "Proportions", symmetry: "Symmetry",
};

// Everything here is averaged across scans rather than read off the latest one.
// A single scan carries about 1.3 points of photo-to-photo noise, which is more
// than the gap between two different people — so "your strongest feature" taken
// from one photograph is mostly a statement about that photograph. The mean over
// several is the first number on this screen that describes the face.
function profilePanel(scans: StoredScan[], avg: number): string {
  const sex = scans[0].sex;
  const totals: Record<string, { sum: number; n: number }> = {};
  for (const s of scans) {
    for (const [region, score] of Object.entries(s.regions)) {
      if (typeof score !== "number") continue;
      totals[region] = totals[region] ?? { sum: 0, n: 0 };
      totals[region].sum += score;
      totals[region].n++;
    }
  }
  const means = Object.entries(totals)
    .map(([region, t]) => ({ region, mean: t.sum / t.n }))
    .sort((a, b) => b.mean - a.mean);

  const spread =
    scans.length > 1
      ? Math.sqrt(scans.reduce((a, s) => a + (s.overall - avg) ** 2, 0) / (scans.length - 1))
      : null;

  return `<aside class="dash-profile">
    <h2>Your profile</h2>
    <div class="dash-prof-score">
      <b>${avg.toFixed(1)}</b>
      <span>AVERAGE OF ${scans.length} SCAN${scans.length > 1 ? "S" : ""}</span>
    </div>
    <p class="dash-prof-note">Scored against ${sex === "male" ? "men" : "women"}. Averaged across
      every scan on this device, because one photograph carries about 1.3 points of noise on its own.</p>
    ${
      means.length
        ? `<div class="dash-prof-bars">
            ${means
              .map(
                (m) => `<div class="dash-prof-row">
                  <span>${REGION_LABEL[m.region] ?? m.region}</span>
                  <i><b style="width:${Math.max(3, Math.min(100, m.mean * 10))}%"></b></i>
                  <em>${m.mean.toFixed(1)}</em>
                </div>`,
              )
              .join("")}
          </div>
          <div class="dash-prof-ends">
            <div><span>STRONGEST</span><b>${REGION_LABEL[means[0].region] ?? means[0].region}</b></div>
            <div><span>WEAKEST</span><b>${REGION_LABEL[means[means.length - 1].region] ?? means[means.length - 1].region}</b></div>
          </div>`
        : ""
    }
    ${
      spread != null
        ? `<p class="dash-prof-note">Your scans vary by ${spread.toFixed(1)} points either side of that
           average. Anything inside that band is the camera, not your face.</p>`
        : ""
    }
  </aside>`;
}

function scanRow(s: StoredScan): string {
  const when = new Date(s.date);
  const date = when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `<button class="dash-scan-row">
    <span class="dash-scan-date">${date}</span>
    <span class="dash-scan-sex">${s.sex === "male" ? "VS MEN" : "VS WOMEN"}</span>
    <span class="dash-scan-score">${s.overall.toFixed(1)}<small>/10</small></span>
  </button>`;
}

// --- celebrity search ------------------------------------------------------

let celebEl: HTMLDivElement | null = null;

export function openCelebSearch(): void {
  celebEl?.remove();
  const faces = applyShim([...REEL]).sort((a, b) => b.overall - a.overall);
  celebEl = document.createElement("div");
  celebEl.className = "dash celeb-search";
  celebEl.innerHTML = `
    <div class="dash-inner">
      <button class="hist-close" aria-label="Close">✕</button>
      <header class="dash-head">
        <button class="wordmark celeb-home" type="button" title="Back to the dashboard">TRUE<b>MAX</b></button>
        <h1>Celebrities</h1>
        <p>How the same measurements read on a face people already have a number for. Search a name, or browse.</p>
      </header>
      <input class="celeb-q" id="celeb-q" placeholder="Search a name" autocomplete="off" />
      <div class="celeb-grid" id="celeb-grid">${faces.map(celebCard).join("")}</div>
      <p class="celeb-empty hidden" id="celeb-empty">No one by that name in the set yet.</p>
    </div>`;

  document.body.appendChild(celebEl);
  const closeCeleb = () => {
    celebEl?.remove();
    celebEl = null;
  };
  celebEl.querySelector(".hist-close")!.addEventListener("click", closeCeleb);
  // The wordmark means the same thing everywhere: go home. Here home is the
  // dashboard sitting underneath, so this only has to close the overlay.
  celebEl.querySelector(".celeb-home")!.addEventListener("click", closeCeleb);
  const q = celebEl.querySelector("#celeb-q") as HTMLInputElement;
  const grid = celebEl.querySelector("#celeb-grid")!;
  const empty = celebEl.querySelector("#celeb-empty")!;
  q.oninput = () => {
    const term = q.value.trim().toLowerCase();
    let shown = 0;
    for (const card of grid.querySelectorAll<HTMLElement>(".celeb-card")) {
      const hit = (card.dataset.name || "").includes(term);
      card.classList.toggle("hidden", !hit);
      if (hit) shown++;
    }
    empty.classList.toggle("hidden", shown > 0);
  };
  q.focus();
}

function celebCard(f: ReturnType<typeof applyShim>[number]): string {
  const tone = f.overall >= 7.5 ? "hi" : f.overall >= 5.5 ? "mid" : "lo";
  const pillars = Object.entries(f.pillars)
    .map(
      ([k, v]) => `<div class="celeb-pill"><i style="width:${Math.round((v as number) * 10)}%"></i>
        <span>${k[0]}</span></div>`,
    )
    .join("");
  return `<div class="celeb-card" data-name="${f.name.toLowerCase()}">
    <div class="celeb-photo"><img src="/demo/${f.slug}.jpg" alt="" loading="lazy" /></div>
    <div class="celeb-meta">
      <b>${f.name}</b>
      <span class="celeb-score ${tone}">${f.overall.toFixed(1)}<small>/10</small></span>
    </div>
    <div class="celeb-pillars">${pillars}</div>
  </div>`;
}
