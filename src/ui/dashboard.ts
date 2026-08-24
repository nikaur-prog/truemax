import { DISPLAY_NOISE, readAllComparableHistory, readAllHistory, scanStorageKey } from "../engine/history.js";
import { followUp, regionNote } from "../engine/followUp.js";
import { maxCharacterMarkup, wireMaxInteractions } from "./maxCharacter.js";
import type { MaxMood } from "./maxCharacter.js";
import type { StoredScan } from "../engine/history.js";
import { computeStreak } from "../engine/streak.js";
import type { Streak } from "../engine/streak.js";
import { headline, nextVisit, subline } from "./greeting.js";
import type { GreetingCtx } from "./greeting.js";
import { trend } from "./dashTrend.js";
import { loadPhotos } from "../engine/photoStore.js";
import { historyPanelMarkup, wireHistoryPanel } from "./historyView.js";
import { REEL } from "./demoReelData.js";
import { applyShim } from "./demoReelShim.js";
import { brandClass, logoMarkup } from "./membershipBrand.js";
import type { MembershipBrand } from "./membershipBrand.js";
import { countUp } from "./countUp.js";

// ---------------------------------------------------------------------------
// The dashboard — the app's home.
//
// Restructured around one question: what is a returning user here to find out?
// The answer is their number and whether it has moved, and the old layout put
// both of those a screen and a half down a phone, under a greeting, a quote and
// two navigation cards. The largest element on the page was a salutation, which
// is the least informative thing on it.
//
// So the order is now: the score, its trend, what Max reads into it, where the
// face is strong and weak, then the scans. Navigation is not content and does
// not get a card — it lives in a bar fixed to the bottom of the screen, in the
// thumb's reach, which is also the only arrangement that survives being wrapped
// as a native app.
//
// Two things this screen used to do only on a desktop it now does everywhere.
// The scan-row photos were behind `:hover`, so on a phone — the platform this
// is actually used on — they did not exist. And the region bars ran 0-10 with
// every score landing between 3.9 and 5.9, so eight bars of near-identical
// length said "everything about this face is the same". They are still drawn on
// the honest 0-10 scale, with the person's own average marked, because the fix
// for an unreadable chart is never to rescale its axis until the differences
// look bigger.
//
// Reached from the wordmark. First load still goes straight to capture so the
// TikTok funnel is one tap from a scan, not two.
// ---------------------------------------------------------------------------

let overlay: HTMLDivElement | null = null;
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

// Max's reading of the run so far, on the screen a returning user actually
// lands on.
//
// It sits under the greeting rather than inside a tab because the whole value
// is that nobody has to go looking for it: an app that will tell you your
// routine has not worked, but only if you navigate to the right panel and ask,
// is not doing the thing that makes it worth paying for.
//
// Hidden entirely on a first visit. "One scan is not a trend" is true and worth
// saying once the person has scanned; on an empty dashboard it is a lecture.
// Max's face on the dashboard is decided by the reading, never by the desire to
// be encouraging. "working" earns the excited face; a stall or a slip gets the
// concerned one, because a character who beams while telling you two months
// produced nothing is the tell that the words are decoration.
const MOOD_FOR: Record<string, MaxMood> = {
  working: "excited",
  maintaining: "excited",
  holding: "thinking",
  stalled: "concerned",
  slipping: "concerned",
  "too-soon": "thinking",
};

function followUpCard(scans: StoredScan[]): string {
  if (scans.length < 2) return "";
  const points = scans.map((s) => ({ at: Date.parse(s.date), overall: s.overall }));
  const read = followUp(points);
  if (read.kind === "too-soon") return "";
  // Where the change (or the stall) is actually located. The overall can sit
  // flat while one region climbs and another slips; naming the movers is the
  // difference between reading the average and reading the face.
  const regions = regionNote(
    scans.map((s) => ({ at: Date.parse(s.date), scores: s.regions })),
    REGION_LABEL,
  );
  return `<div class="maxread dash-anim ${read.kind}" style="--d:210ms">
    <div class="maxread-face">${maxCharacterMarkup({ mood: MOOD_FOR[read.kind] ?? "happy" })}</div>
    <span class="maxread-who">MAX</span>
    <b>${escapeHtml(read.headline)}</b>
    <p>${escapeHtml(read.body)}</p>
    ${regions ? `<p class="maxread-regions">${escapeHtml(regions)}</p>` : ""}
    ${read.suggestChange ? `<button class="linkish" id="dash-replan">Rebuild my plan around something else →</button>` : ""}
  </div>`;
}

export function openDashboard(opts: {
  onScan: () => void;
  name?: string | null;
  membership: Exclude<MembershipBrand, "guest">;
  // Absent for a signed-out or preview dashboard, which has no profile to edit.
  onSettings?: () => void;
}): void {
  close();
  dashboardBrand = opts.membership;
  // Advance the rotation once per open, so coming back to the dashboard gives a
  // different headline and a different quote rather than the same pair all day.
  nextVisit();
  const allScans = readAllHistory();
  const scans = readAllComparableHistory();
  const streak = computeStreak(allScans);
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
          ${opts.onSettings ? `<button class="dash-settings" id="dash-settings" type="button" aria-label="Your profile and preferences">
            <svg viewBox="0 0 24 24" aria-hidden="true" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <circle cx="12" cy="12" r="3.1"/>
              <path d="M12 2.6v2.3M12 19.1v2.3M21.4 12h-2.3M4.9 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"/>
            </svg>
          </button>` : ""}
        </div>
      </header>

      <div class="dash-views" id="dash-views">
        <section class="dash-view is-active" data-view="home" role="tabpanel" aria-labelledby="dash-bar-home">
          ${heroBlock(scans, ctx, streak)}
          ${followUpCard(scans)}
          ${scanSection(scans, allScans.length - scans.length)}
          ${faces.length ? `<button class="dash-faces-strip dash-anim" id="dash-celeb-strip" style="--d:520ms">
            <span class="dash-faces-fan">
              ${faces.slice(0, 5).map((f) => `<img src="/demo/${f.slug}.jpg" alt="" loading="lazy" />`).join("")}
            </span>
            <span class="dash-faces-copy">
              <b>${faces.length} famous faces, measured the same way</b>
              <em>See where your numbers sit against theirs →</em>
            </span>
          </button>` : ""}
        </section>
        <section class="dash-view" data-view="scans" role="tabpanel" aria-labelledby="dash-bar-scans" hidden></section>
        <section class="dash-view" data-view="faces" role="tabpanel" aria-labelledby="dash-bar-faces" hidden></section>
      </div>
    </div>

    <nav class="dash-bar" role="tablist" aria-label="TrueMax">
      <button class="dash-bar-btn" id="dash-bar-scans" data-goto="scans" type="button" role="tab" aria-selected="false">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 17.5 8.5 11l4 4L21 6"/><path d="M21 11V6h-5"/>
        </svg>
        <span>Scans</span>
      </button>
      <button class="dash-bar-btn dash-bar-home" id="dash-bar-home" data-goto="home" type="button" role="tab" aria-selected="true">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 10.6 12 4l8 6.6"/><path d="M6 9.6V20h12V9.6"/>
        </svg>
        <span>Home</span>
      </button>
      <button class="dash-bar-scan" id="dash-scan" type="button">
        <span class="dash-bar-ic">${SPLIT_FACE}</span>
        <span>${scans.length ? "New scan" : "Scan"}</span>
      </button>
      <button class="dash-bar-btn" id="dash-bar-faces" data-goto="faces" type="button" role="tab" aria-selected="false">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3.6 14.4 9l5.6.5-4.3 3.8 1.3 5.6L12 15.9 6.9 18.9l1.3-5.6L4 9.5 9.6 9z"/>
        </svg>
        <span>Faces</span>
      </button>
    </nav>`;

  document.body.appendChild(overlay);
  countHero(overlay);
  currentView = "home";
  document.getElementById("dash-scan")!.onclick = () => {
    close();
    opts.onScan();
  };
  for (const btn of overlay.querySelectorAll<HTMLElement>("[data-goto]")) {
    btn.onclick = () => showView(btn.dataset.goto as ViewName);
  }
  overlay.querySelector("#dash-celeb-strip")?.addEventListener("click", () => showView("faces"));
  // The dashboard stays open behind it: settings is a panel over your own
  // screen, not a place you get sent to and have to navigate back from.
  overlay.querySelector("#dash-settings")?.addEventListener("click", () => opts.onSettings?.());
  // Rebuilding the plan means revisiting the goals, which is what the quiz is.
  overlay.querySelector("#dash-replan")?.addEventListener("click", () => opts.onSettings?.());
  overlay.querySelector("#dash-history")?.addEventListener("click", () => showView("scans"));
  for (const row of overlay.querySelectorAll<HTMLElement>(".dash-scan-row")) {
    row.onclick = () => showView("scans");
  }
  wireScanRows(overlay);
  wireMaxInteractions(overlay.querySelector<HTMLElement>(".maxread-face"));
}

// --- the three tabs --------------------------------------------------------
//
// These are tabs now, which they were not before. Scans and Faces each used to
// append a separate full-screen overlay on top of the dashboard, at a z-index
// that covered the bottom bar itself — so the bar vanished the moment you used
// it, there was nothing to show as selected, and getting back meant finding a ✕.
// That is a stack of modals wearing a tab bar.
//
// One host, three panels, one bar that stays put and says where you are.
//
// The order is the order in the bar, and the transition slides in the direction
// of travel: going right moves the outgoing panel left. That is the one cue
// that makes a tab bar feel like a place rather than a menu, because it tells
// you the panels are laid out side by side and you are moving along them.
export type ViewName = "home" | "scans" | "faces";

let currentView: ViewName = "home";
// Each panel remembers where it was scrolled to. Coming back to Home and
// landing at the top of a page you had read half of is the thing that gives a
// web app away.
const scrollMemory = new Map<ViewName, number>();

export function activeView(): ViewName | null {
  return overlay ? currentView : null;
}

// Which way a move between two tabs travels: 1 rightwards, -1 leftwards.
//
// Read off the bar rather than held in a constant beside it. A hand-maintained
// VIEW_ORDER is a second copy of the tab order, and the failure mode when the
// two drift is a transition that slides the wrong way — which nobody files a
// bug about and everybody feels. Reading the DOM makes disagreement impossible
// instead of merely testable.
function viewDirection(from: ViewName, to: ViewName): number {
  if (!overlay) return 1;
  const order = [...overlay.querySelectorAll<HTMLElement>("[data-goto]")].map((b) => b.dataset.goto);
  return Math.sign(order.indexOf(to) - order.indexOf(from));
}

// Built on first visit rather than up front, so opening the dashboard does not
// pay for two screens nobody has asked for yet.
function fillView(name: ViewName, panel: HTMLElement): void {
  if (panel.dataset.filled) return;
  panel.dataset.filled = "1";
  if (name === "scans") {
    panel.innerHTML = historyPanelMarkup({ closable: false });
    wireHistoryPanel(panel);
  } else if (name === "faces") {
    panel.innerHTML = facesMarkup();
    wireFaces(panel);
  }
}

export function showView(name: ViewName): void {
  if (!overlay) return;
  const host = overlay.querySelector<HTMLElement>("#dash-views");
  const next = overlay.querySelector<HTMLElement>(`.dash-view[data-view="${name}"]`);
  const prev = overlay.querySelector<HTMLElement>(`.dash-view[data-view="${currentView}"]`);
  if (!host || !next || !prev || name === currentView) return;

  scrollMemory.set(currentView, overlay.scrollTop);
  const dir = viewDirection(currentView, name);
  fillView(name, next);

  prev.hidden = true;
  prev.classList.remove("is-active");
  next.hidden = false;
  next.classList.add("is-active");
  // Restarting the animation means clearing the class and forcing a reflow;
  // without the read the browser coalesces both writes and nothing plays.
  next.classList.remove("from-left", "from-right");
  void next.offsetWidth;
  next.classList.add(dir > 0 ? "from-right" : "from-left");

  currentView = name;
  for (const btn of overlay.querySelectorAll<HTMLElement>("[data-goto]")) {
    btn.setAttribute("aria-selected", btn.dataset.goto === name ? "true" : "false");
  }
  overlay.scrollTop = scrollMemory.get(name) ?? 0;
}

export function close(): void {
  overlay?.remove();
  overlay = null;
  currentView = "home";
  scrollMemory.clear();
}

// ---------------------------------------------------------------------------
// The hero: the number, whether it moved, and the shape of the run.
//
// This is the whole reason somebody opens the app twice, so it is the first
// thing on the screen and the only thing that gets a large type size.
//
// The figure is the AVERAGE, not the latest scan, and that is a measurement
// decision rather than a design one: a single photograph carries about
// DISPLAY_NOISE points of spread, so "your score" taken from the most recent
// picture is substantially a statement about that picture. The mean over
// several is the first number on this screen that describes a face.
//
// The delta underneath is the latest scan against the mean of the ones before
// it, and it says so in words when it is smaller than the instrument can
// resolve. An app that renders every wobble as a green arrow is training
// people to read noise as progress.
//
// The greeting survives, at the size a greeting deserves.
// ---------------------------------------------------------------------------
// The hero score counts up rather than appearing already written.
//
// The delay lands it just after the hero's own entry animation (--d: 60ms,
// 620ms long), so the number starts moving as the block finishes arriving
// rather than racing it. The digits live in an <i> because the element also
// carries a "/10" in a <small> that writing textContent would delete, and
// .dash-hero-num is already tabular-nums so nothing shifts width while it runs.
function countHero(root: HTMLElement): void {
  const num = root.querySelector<HTMLElement>(".dash-hero-num");
  const digits = num?.querySelector<HTMLElement>("i");
  const to = Number(num?.dataset.to);
  if (!digits || !Number.isFinite(to)) return; // the empty state has no number
  countUp(digits, to, { delay: 420 });
}

function heroBlock(scans: StoredScan[], ctx: GreetingCtx, streak: Streak): string {
  const line = trend(scans);
  if (!scans.length || !line) {
    return `<section class="dash-hero empty dash-anim" style="--d:60ms">
      <h1>${escapeHtml(headline(ctx))}</h1>
      <p>${escapeHtml(subline(ctx))}</p>
    </section>`;
  }
  const sex = scans[0].sex;
  const delta = line.delta;
  const tone = delta === null || line.withinNoise ? "flat" : delta > 0 ? "up" : "down";
  // Against the mean of the scans BEFORE it, not against the one before it:
  // "did it move since Tuesday" can be answered by one unlucky photograph,
  // "where do I usually land" cannot.
  const deltaText =
    delta === null
      ? "Your first scan on this device"
      : line.withinNoise
        ? `Latest scan ${signed(delta)} on your average · inside the noise`
        : `Latest scan ${signed(delta)} on your average`;

  return `<section class="dash-hero dash-anim" style="--d:60ms">
    <div class="dash-hero-top">
      <p class="dash-hero-hello">${escapeHtml(headline(ctx))}</p>
      ${streakChip(streak)}
    </div>
    <div class="dash-hero-row">
      <div class="dash-hero-fig">
        <span class="dash-hero-eyebrow">YOUR AVERAGE · VS ${sex === "male" ? "MEN" : "WOMEN"}</span>
        <b class="dash-hero-num" data-to="${line.average.toFixed(1)}"><i>${line.average.toFixed(1)}</i><small>/10</small></b>
        <span class="dash-hero-delta ${tone}">${escapeHtml(deltaText)}</span>
      </div>
      ${scans.length > 1 ? `<div class="dash-hero-trend">${line.svg}</div>` : ""}
    </div>
    <div class="dash-hero-meta">
      <span>${scans.length} SCAN${scans.length > 1 ? "S" : ""}</span>
      ${scans.length > 1 ? `<span>SHADED BAND = CAMERA NOISE, NOT YOUR FACE</span>` : ""}
    </div>
  </section>`;
}

function signed(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${r >= 0 ? "+" : ""}${r.toFixed(1)}`;
}

// Only shown once there is a run worth naming. A "0 week streak" is a way of
// telling somebody they have failed at something they had not started.
function streakChip(s: Streak): string {
  if (!s.alive || s.weeks < 2) return "";
  return `<span class="dash-streak">${s.weeks} WEEK STREAK</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c,
  );
}

function scanSection(scans: StoredScan[], legacyCount = 0): string {
  if (!scans.length) {
    return `<section class="dash-scans">
      <h2>Your scans</h2>
      <div class="dash-empty">
        <b>No scans yet.</b>
        <span>${legacyCount
          ? `${legacyCount} earlier scan${legacyCount === 1 ? "" : "s"} used the previous scoring calibration. Take a new scan to start a clean, comparable trend.`
          : "Scan your face to see your first measurement — and every one after it lines up here so you can watch it move."}</span>
      </div>
    </section>`;
  }
  const avg = scans.reduce((s, x) => s + x.overall, 0) / scans.length;
  const recent = scans.slice(0, 5);
  // Several scans in one day is the normal case while somebody is testing, and
  // then a column of identical dates tells them nothing. The list runs newest
  // first, so the FIRST row of each day carries the date and the rest of that
  // day carry their times.
  const sameDayAsAbove = (i: number) =>
    i > 0 && new Date(recent[i].date).toDateString() === new Date(recent[i - 1].date).toDateString();
  return `<div class="dash-cols">
    ${profilePanel(scans, avg)}
    <section class="dash-scans dash-anim" style="--d:480ms">
      <div class="dash-scans-head">
        <h2>Your scans</h2>
        ${scans.length > 5 ? `<button class="linkish" id="dash-history">View all ${scans.length} →</button>` : ""}
      </div>
      <div class="dash-scan-list">
        ${recent.map((s, i) => scanRow(s, scans[i + 1], sameDayAsAbove(i))).join("")}
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
// A single scan carries about 0.6 points of photo-to-photo noise on the current
// scale, so "your strongest feature" taken
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
    <div class="dash-prof-head">
      <h2>Region by region</h2>
      ${means.length ? `<span class="dash-prof-tickkey">▏ your average</span>` : ""}
    </div>
    ${
      means.length
        ? `<div class="dash-prof-bars">
            ${means
              .map((m) => {
                // Bars stay on the honest 0-10 scale. What makes the
                // differences legible is the tick at the person's own average:
                // "Jaw 4.5" and "Proportions 6.0" both fill about half a 0-10
                // bar, but they sit visibly either side of the mark. Rescaling
                // the axis until the gaps look bigger is the trick every
                // stock-chart screenshot uses, and it is not available here.
                const above = m.mean >= avg;
                return `<div class="dash-prof-row ${above ? "above" : "below"}">
                  <span>${REGION_LABEL[m.region] ?? m.region}</span>
                  <i style="--avg:${Math.max(0, Math.min(100, avg * 10))}%">
                    <b style="width:${Math.max(3, Math.min(100, m.mean * 10))}%"></b>
                  </i>
                  <em>${m.mean.toFixed(1)}</em>
                </div>`;
              })
              .join("")}
          </div>
          <div class="dash-prof-ends">
            <div><span>STRONGEST</span><b>${REGION_LABEL[means[0].region] ?? means[0].region}</b></div>
            <div><span>WEAKEST</span><b>${REGION_LABEL[means[means.length - 1].region] ?? means[means.length - 1].region}</b></div>
          </div>`
        : ""
    }
    <p class="dash-prof-note">Scored against ${sex === "male" ? "men" : "women"}, and averaged across every
      comparable scan on this device — one photograph carries about ${DISPLAY_NOISE.toFixed(1)} points of noise on its own.${
        spread != null
          ? ` Yours vary by ${spread.toFixed(1)} points either side of the average, and anything inside that band is the camera.`
          : ""
      }</p>
  </aside>`;
}

function scanRow(s: StoredScan, prev: StoredScan | undefined, sameDay: boolean): string {
  const when = new Date(s.date);
  const date = when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const top = Object.entries(s.regions)
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => (b[1] as number) - (a[1] as number));
  const stat = (label: string, v: string) => `<div><span>${label}</span><b>${v}</b></div>`;
  const storageKey = scanStorageKey(s);
  // Against the scan below it in the list. A move smaller than the calibrated
  // spread between two photographs of one face is labelled as such rather than
  // coloured, because colouring it would be the app agreeing it means something.
  const d = prev ? Math.round((s.overall - prev.overall) * 10) / 10 : null;
  const chip =
    d === null
      ? `<span class="dash-scan-chip first">first</span>`
      : Math.abs(d) < DISPLAY_NOISE
        ? `<span class="dash-scan-chip flat">${signed(d)} · noise</span>`
        : `<span class="dash-scan-chip ${d > 0 ? "up" : "down"}">${signed(d)}</span>`;
  return `<div class="dash-scan-slot">
    <button class="dash-scan-row" data-scan-key="${storageKey}" aria-expanded="false">
      <span class="dash-scan-date">${sameDay ? time : date}</span>
      ${chip}
      <span class="dash-scan-score">${s.overall.toFixed(1)}<small>/10</small></span>
    </button>
    <div class="dash-scan-pop">
      <div class="dash-scan-pop-in">
        <div class="dash-pop-shots" data-shots="${storageKey}">
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

// Tap to expand, on every device.
//
// This panel used to open on `:hover` alone. On a phone — which is where this
// app is used — that meant the row was a button that did nothing, and the
// thumbnails of your own scans were desktop-only. Opening is now an explicit
// tap that also works with a keyboard, and the row reports its state.
//
// Thumbnails are still fetched only on first open, and only once: reading every
// scan's photo up front would be a dozen IndexedDB round trips and a dozen
// decoded images for a panel most people never open.
function wireScanRows(root: HTMLElement): void {
  for (const slot of root.querySelectorAll<HTMLElement>(".dash-scan-slot")) {
    const row = slot.querySelector<HTMLButtonElement>(".dash-scan-row");
    const shots = slot.querySelector<HTMLElement>(".dash-pop-shots");
    if (!row || !shots) continue;
    let loaded = false;
    const load = () => {
      if (loaded) return;
      loaded = true;
      const scanKey = row.dataset.scanKey!;
      void loadPhotos(scanKey).then((p) => {
        if (!p || (!p.front && !p.side)) {
          shots.innerHTML = `<p class="dash-pop-none">No photo kept for this scan. Scans taken before thumbnails were added, or on another device, keep only their numbers.</p>`;
          return;
        }
        shots.innerHTML =
          (p.front ? `<div class="dash-pop-shot"><img src="${p.front}" alt="" /><span>FRONT</span></div>` : "") +
          (p.side ? `<div class="dash-pop-shot"><img src="${p.side}" alt="" /><span>SIDE</span></div>` : "");
      });
    };
    row.addEventListener("click", () => {
      const open = slot.classList.toggle("is-open");
      row.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) load();
    });
  }
}

// --- the Faces tab ---------------------------------------------------------

// Content only, so it can be mounted inside a tab. A celebrity's full breakdown
// is still a stacked overlay: it is a drill-down into one face, not a peer of
// the three tabs, and giving it a tab of its own would put a bottom-bar
// destination behind whichever card you happened to tap.
function facesMarkup(): string {
  const faces = applyShim([...REEL]).sort((a, b) => b.overall - a.overall);
  return `
    <header class="dash-head">
      <h1>Celebrities</h1>
      <p>How the same measurements read on a face people already have a number for. Search a name, or browse.</p>
    </header>
    <input class="celeb-q" id="celeb-q" placeholder="Search a name" autocomplete="off" />
    <div class="celeb-grid" id="celeb-grid">${faces.map(celebCard).join("")}</div>
    <p class="celeb-empty hidden" id="celeb-empty">No one by that name in the set yet.</p>`;
}

function wireFaces(root: ParentNode): void {
  const faces = applyShim([...REEL]).sort((a, b) => b.overall - a.overall);
  const q = root.querySelector<HTMLInputElement>("#celeb-q");
  const grid = root.querySelector("#celeb-grid");
  const empty = root.querySelector("#celeb-empty");
  if (!q || !grid || !empty) return;
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
}

/** Open the dashboard on its Faces tab. Kept for callers outside this module. */
export function openCelebSearch(): void {
  showView("faces");
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
        (<code>?real=1</code>). Two photographs of one person differ by about ${DISPLAY_NOISE.toFixed(1)} points, so any
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
