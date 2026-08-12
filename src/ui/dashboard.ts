import { readAllHistory } from "../engine/history.ts";
import type { StoredScan } from "../engine/history.ts";
import { computeStreak } from "../engine/streak.ts";
import { headline, nextVisit, subline } from "./greeting.ts";
import { loadPhotos } from "../engine/photoStore.ts";
import { openHistory } from "./historyView.ts";
import { REEL } from "./demoReelData.ts";
import { applyShim } from "./demoReelShim.ts";
import { mountDemoReel } from "./demoReel.ts";
import { brandClass, logoMarkup } from "./membershipBrand.ts";
import type { MembershipBrand } from "./membershipBrand.ts";

// ---------------------------------------------------------------------------
// The dashboard — the app's home.
//
// It offers exactly two things, which is the whole point of it: scan your face,
// or look up a celebrity. Under those sits your own history, so returning is
// about seeing the line move rather than taking a cold first scan. The premium
// surface (the Max coach, goal tracking, the wishlist) hangs off this same
// screen. The server entitlement can now brand the dashboard as Max, but a
// conversational assistant is still a separate product surface; this module
// does not fake one with generic copy.
//
// Reached from the wordmark. First load still goes straight to capture so the
// TikTok funnel is one tap from a scan, not two.
// ---------------------------------------------------------------------------

let overlay: HTMLDivElement | null = null;
let reel: ReturnType<typeof mountDemoReel> | null = null;
let dashboardBrand: Exclude<MembershipBrand, "guest"> = "member";

// Two half-faces sharing one outline: a squarer, heavier-browed left half and a
// softer, narrower right half, split down the facial midline. It says "this
// measures men and women" at 26px, which a single generic head does not, and it
// echoes the blue/pink chooser that opens every scan. Drawn rather than
// photographed so it stays sharp at any size and adds no image weight.
const SPLIT_FACE = `<svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true" fill="none">
  <g stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
    <!-- left half: broader jaw, flatter crown -->
    <path d="M24 6c-6.2 0-10.4 3.6-10.4 9.6 0 2.1.2 4.4.7 6.6.4 1.9.9 3.6 1.5 5.1 1.6 4.1 4.5 7.2 8.2 8.6"/>
    <path d="M13.9 13.2c2.2-1.1 4.3-1.4 6.3-.9"/>
    <!-- right half: narrower jaw, rounder crown -->
    <path d="M24 6c6.2 0 10.4 3.6 10.4 9.6 0 2.1-.2 4.4-.7 6.6-.4 1.9-.9 3.6-1.5 5.1-1.5 3.9-4.1 6.9-8.2 8.6"/>
    <path d="M34.1 13.9c-2-1.4-4-1.9-6.1-1.5"/>
    <!-- the split -->
    <path d="M24 6v30" opacity=".45" stroke-dasharray="2.4 3"/>
    <!-- shoulders, same on both sides -->
    <path d="M11 43c1.6-4.3 6.6-7 13-7s11.4 2.7 13 7"/>
  </g>
</svg>`;

export function isDashboardOpen(): boolean {
  return overlay !== null;
}

export function openDashboard(opts: {
  onScan: () => void;
  name?: string | null;
  membership: Exclude<MembershipBrand, "guest">;
}): void {
  close();
  dashboardBrand = opts.membership;
  // Advance the rotation once per open, so coming back to the dashboard gives a
  // different headline and a different quote rather than the same pair all day.
  nextVisit();
  const scans = readAllHistory();
  const streak = computeStreak(scans);
  const ctx = { name: opts.name ?? null, streak };
  const faces = applyShim([...REEL]).sort((a, b) => b.overall - a.overall);
  overlay = document.createElement("div");
  overlay.className = "dash";
  overlay.innerHTML = `
    <div class="dash-inner">
      <header class="dash-head">
        <div class="dash-brand-row dash-anim" style="--d:0ms">
          <span class="wordmark dash-logo ${brandClass(dashboardBrand)}">${logoMarkup()}</span>
          ${dashboardBrand === "max" ? `<span class="max-ai-badge"><i></i>MAX AI · YOUR ASSISTANT</span>` : ""}
        </div>
        <h1 class="dash-anim" style="--d:70ms">${escapeHtml(headline(ctx))}</h1>
        <p class="dash-anim" style="--d:170ms">${escapeHtml(subline(ctx))}</p>
        ${streakChip(streak)}
      </header>

      <div class="dash-actions">
        <div class="dash-slot scan-slot dash-anim" style="--d:260ms">
          <button class="dash-card pri" id="dash-scan">
            <span class="dash-ic">${SPLIT_FACE}</span>
            <b>Scan your face</b>
            <span>Front and side, measured on your device</span>
          </button>
          <div class="dash-drop">
            <div class="dash-drop-in">
              <div class="dash-reel">
                <canvas id="dash-reel-canvas"></canvas>
                <div class="dash-reel-cap">
                  <b id="dash-reel-score"></b><span id="dash-reel-name"></span>
                </div>
              </div>
              <p>A real scan running on this device. Side-point feedback is shared only when you explicitly choose it.</p>
            </div>
          </div>
        </div>
        <div class="dash-slot dash-anim" style="--d:330ms">
          <button class="dash-card" id="dash-celeb">
            <span class="dash-ic gold">★</span>
            <b>Search a celebrity</b>
            <span>See how the numbers read on a famous face</span>
          </button>
          <div class="dash-drop">
            <div class="dash-drop-in">
              <b>${faces.length} faces measured</b>
              <div class="dash-fan">
                ${faces
                  .slice(0, 6)
                  .map(
                    (f, i) => `<div class="dash-fan-card" style="--i:${i}">
                      <img src="/demo/${f.slug}.jpg" alt="" loading="lazy" />
                      <span>${f.overall.toFixed(1)}</span>
                    </div>`,
                  )
                  .join("")}
              </div>
              <p>The same measurements, on faces people already have a number for.</p>
            </div>
          </div>
        </div>
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
  wireScanHovers(overlay);

  // The scan card's dropdown runs the real reel — the same engine output the
  // landing plays — rather than describing the steps in words. Mounted lazily
  // on first hover so a dashboard nobody hovers never starts an animation loop
  // or decodes nine portraits.
  const scanSlot = overlay.querySelector<HTMLElement>(".dash-slot");
  if (scanSlot) {
    const mountOnce = () => {
      if (reel) return;
      const c = overlay?.querySelector<HTMLCanvasElement>("#dash-reel-canvas");
      const s = overlay?.querySelector<HTMLElement>("#dash-reel-score");
      const n = overlay?.querySelector<HTMLElement>("#dash-reel-name");
      if (c && s && n) reel = mountDemoReel(c, s, n);
    };
    scanSlot.addEventListener("pointerenter", mountOnce);
    scanSlot.addEventListener("focusin", mountOnce);
  }
  startFanCycle(overlay, faces);
}

export function close(): void {
  reel?.stop();
  reel = null;
  if (fanTimer) clearInterval(fanTimer);
  fanTimer = null;
  overlay?.remove();
  overlay = null;
}

// The fan cycles: one card at a time flips to a face that is not currently
// shown. One at a time, on a stagger, because six cards changing together reads
// as the panel reloading rather than as a deck being dealt through.
let fanTimer: ReturnType<typeof setInterval> | null = null;
function startFanCycle(root: HTMLElement, faces: ReturnType<typeof applyShim>): void {
  const cards = Array.from(root.querySelectorAll<HTMLElement>(".dash-fan-card"));
  if (cards.length < 2 || faces.length <= cards.length) return;
  let next = cards.length; // first face not already on screen
  let which = 0;
  if (fanTimer) clearInterval(fanTimer);
  fanTimer = setInterval(() => {
    // Only animate while the panel is actually open; a hidden dropdown flipping
    // cards is work nobody can see.
    const slot = cards[0].closest(".dash-slot");
    if (!slot?.matches(":hover, :focus-within")) return;

    const card = cards[which % cards.length];
    const face = faces[next % faces.length];
    which++;
    next++;
    card.classList.add("flipping");
    // Swap at the midpoint of the flip, while the card is edge-on and its face
    // is not visible — otherwise the change happens in full view and the flip
    // looks like a separate, pointless spin.
    setTimeout(() => {
      const img = card.querySelector("img");
      const val = card.querySelector("span");
      if (img) img.src = `/demo/${face.slug}.jpg`;
      if (val) val.textContent = face.overall.toFixed(1);
    }, 260);
    setTimeout(() => card.classList.remove("flipping"), 560);
  }, 1400);
}

// Only shown once there is a run worth naming. A "0 week streak" is a way of
// telling somebody they have failed at something they had not started.
function streakChip(s: { alive: boolean; weeks: number }): string {
  if (!s.alive || s.weeks < 2) return "";
  return `<span class="dash-streak">${s.weeks} WEEK STREAK</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c,
  );
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
    <section class="dash-scans dash-anim" style="--d:480ms">
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

  return `<aside class="dash-profile dash-anim" style="--d:410ms">
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
  const time = when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const top = Object.entries(s.regions)
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => (b[1] as number) - (a[1] as number));
  const stat = (label: string, v: string) => `<div><span>${label}</span><b>${v}</b></div>`;
  return `<div class="dash-scan-slot">
    <button class="dash-scan-row" data-date="${s.date}">
      <span class="dash-scan-date">${date}</span>
      <span class="dash-scan-sex">${s.sex === "male" ? "VS MEN" : "VS WOMEN"}</span>
      <span class="dash-scan-score">${s.overall.toFixed(1)}<small>/10</small></span>
    </button>
    <div class="dash-scan-pop">
      <div class="dash-scan-pop-in">
        <div class="dash-pop-shots" data-shots="${s.date}">
          <div class="dash-pop-shot ph"><span>FRONT</span></div>
          <div class="dash-pop-shot ph"><span>SIDE</span></div>
        </div>
        <div class="dash-pop-stats">
          ${stat("SCORE", s.overall.toFixed(1))}
          ${stat("TAKEN", time)}
          ${top[0] ? stat("BEST", `${REGION_LABEL[top[0][0]] ?? top[0][0]} ${(top[0][1] as number).toFixed(1)}`) : ""}
          ${top.length > 1 ? stat("WEAKEST", `${REGION_LABEL[top[top.length - 1][0]] ?? top[top.length - 1][0]} ${(top[top.length - 1][1] as number).toFixed(1)}`) : ""}
        </div>
      </div>
    </div>
  </div>`;
}

// Thumbnails are fetched only when a row is actually hovered, and only once.
// Reading every scan's photo up front would mean a dozen IndexedDB round trips
// and a dozen decoded images for a panel most people never open.
function wireScanHovers(root: HTMLElement): void {
  for (const slot of root.querySelectorAll<HTMLElement>(".dash-scan-slot")) {
    const row = slot.querySelector<HTMLElement>(".dash-scan-row");
    const shots = slot.querySelector<HTMLElement>(".dash-pop-shots");
    if (!row || !shots) continue;
    let loaded = false;
    const load = () => {
      if (loaded) return;
      loaded = true;
      const date = row.dataset.date!;
      void loadPhotos(date).then((p) => {
        if (!p || (!p.front && !p.side)) {
          shots.innerHTML = `<p class="dash-pop-none">No photo kept for this scan. Scans taken before thumbnails were added, or on another device, keep only their numbers.</p>`;
          return;
        }
        shots.innerHTML =
          (p.front ? `<div class="dash-pop-shot"><img src="${p.front}" alt="" /><span>FRONT</span></div>` : "") +
          (p.side ? `<div class="dash-pop-shot"><img src="${p.side}" alt="" /><span>SIDE</span></div>` : "");
      });
    };
    slot.addEventListener("pointerenter", load);
    slot.addEventListener("focusin", load);
  }
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
        <button class="wordmark celeb-home ${brandClass(dashboardBrand)}" type="button" title="Back to the dashboard">${logoMarkup()}</button>
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
  for (const card of grid.querySelectorAll<HTMLElement>(".celeb-card")) {
    card.addEventListener("click", () => {
      const f = faces.find((x) => x.slug === card.dataset.slug);
      if (f) openCelebDetail(f);
    });
  }
  q.focus();
}

// The full breakdown for one face: the same pillars and per-region scores the
// user's own report shows, on somebody whose number they already have an
// opinion about. That comparison is the point of the screen.
let detailEl: HTMLDivElement | null = null;
function openCelebDetail(f: ReturnType<typeof applyShim>[number]): void {
  detailEl?.remove();
  const regions = [...f.regions].sort((a, b) => b.score - a.score);
  const tone = (v: number) => (v >= 7.5 ? "hi" : v >= 5.5 ? "mid" : "lo");
  detailEl = document.createElement("div");
  detailEl.className = "dash celeb-detail";
  detailEl.innerHTML = `
    <div class="dash-inner">
      <button class="hist-close" aria-label="Close">✕</button>
      <div class="cd-head">
        <div class="cd-photo"><img src="/demo/${f.slug}.jpg" alt="${f.name}" /></div>
        <div class="cd-meta">
          <h1>${f.name}</h1>
          <div class="cd-score ${tone(f.overall)}">${f.overall.toFixed(1)}<small>/10</small></div>
          <p class="cd-sub">Scored against ${f.sex === "male" ? "men" : "women"}.</p>
        </div>
      </div>

      <h2 class="cd-h2">Pillars</h2>
      <div class="cd-pillars">
        ${Object.entries(f.pillars)
          .map(
            ([k, v]) => `<div class="cd-pillar">
              <b>${(v as number).toFixed(1)}</b><span>${k.toUpperCase()}</span>
              <i><em style="width:${Math.min(100, (v as number) * 10)}%"></em></i>
            </div>`,
          )
          .join("")}
      </div>

      <h2 class="cd-h2">Region by region</h2>
      <div class="cd-regions">
        ${regions
          .map(
            (r) => `<div class="cd-region">
              <span>${REGION_LABEL[r.id] ?? r.id}</span>
              <i><em style="width:${Math.min(100, r.score * 10)}%"></em></i>
              <b class="${tone(r.score)}">${r.score.toFixed(1)}</b>
            </div>`,
          )
          .join("")}
      </div>

      <p class="cd-credit">${f.credit}</p>
      <p class="cd-note">These are the scores this face is commonly given rather than a
        live measurement, and the engine's own output is one query parameter away
        (<code>?real=1</code>). Two photographs of one person differ by about 1.3 points, so any
        single number here is a reading rather than a verdict.</p>
    </div>`;
  document.body.appendChild(detailEl);
  detailEl.querySelector(".hist-close")!.addEventListener("click", () => {
    detailEl?.remove();
    detailEl = null;
  });
}

function celebCard(f: ReturnType<typeof applyShim>[number]): string {
  const tone = f.overall >= 7.5 ? "hi" : f.overall >= 5.5 ? "mid" : "lo";
  const pillars = Object.entries(f.pillars)
    .map(
      ([k, v]) => `<div class="celeb-pill"><i style="width:${Math.round((v as number) * 10)}%"></i>
        <span>${k[0]}</span></div>`,
    )
    .join("");
  return `<div class="celeb-card" data-name="${f.name.toLowerCase()}" data-slug="${f.slug}" role="button" tabindex="0">
    <div class="celeb-photo"><img src="/demo/${f.slug}.jpg" alt="" loading="lazy" /></div>
    <div class="celeb-meta">
      <b>${f.name}</b>
      <span class="celeb-score ${tone}">${f.overall.toFixed(1)}<small>/10</small></span>
    </div>
    <div class="celeb-pillars">${pillars}</div>
  </div>`;
}
