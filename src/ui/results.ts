import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { phi, REGION_NAMES } from "../engine/scoring.ts";
import type { RegionId, RegionScore, Report, ScoredMetric, Sex } from "../engine/types.ts";
import type { ScanDelta } from "../engine/history.ts";
import { regionMatches } from "../engine/celebs.ts";
import { curveSVG } from "./curve.ts";
import { REGION_LANDMARKS, zoomFor } from "./regions.ts";
import { drawCalm } from "./overlay.ts";
import { drawMeasurement, hasOverlay } from "./measureOverlay.ts";
import { renderShareCard, shareCard } from "./shareCard.ts";
import { fmt, leverFor, rarityN, regionSummary } from "./templates.ts";
import { stopTypewriter, typewrite } from "./typewriter.ts";

interface Ctx {
  report: Report;
  delta: ScanDelta | null;
  landmarks: NormalizedLandmark[];
  photoW: number;
  photoH: number;
  analysis: HTMLElement;
  zoomable: HTMLElement;
  overlay: HTMLCanvasElement;
  onNewPhoto: () => void;
  onSideProfile?: () => void;
}

let ctx: Ctx | null = null;

export function renderResults(c: Ctx): void {
  ctx = c;
  const tabs = document.createElement("div");
  tabs.className = "rtabs";
  const mk = (label: string, id: string) => {
    const b = document.createElement("button");
    b.className = "rtab";
    b.textContent = label;
    b.dataset.id = id;
    b.onclick = () => select(id);
    tabs.appendChild(b);
  };
  mk("Overall", "overall");
  for (const r of c.report.regions) mk(REGION_NAMES[r.region], r.region);
  mk("Plan →", "improve");

  c.analysis.innerHTML = "";
  c.analysis.appendChild(tabs);
  const body = document.createElement("div");
  body.id = "body";
  c.analysis.appendChild(body);
  select("overall");
}

function select(id: string): void {
  if (!ctx) return;
  stopTypewriter();
  for (const b of ctx.analysis.querySelectorAll<HTMLButtonElement>(".rtab")) {
    b.classList.toggle("sel", b.dataset.id === id);
  }
  if (id === "overall") showOverall();
  else if (id === "improve") showImprove();
  else showRegion(id as RegionId);
}

function setZoom(region: RegionId | null): void {
  if (!ctx) return;
  if (!region) {
    ctx.zoomable.style.transform = "none";
    drawCalm(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH);
    return;
  }
  const z = zoomFor(region, ctx.landmarks);
  ctx.zoomable.style.transformOrigin = `${z.originX}% ${z.originY}%`;
  ctx.zoomable.style.transform = `scale(${z.scale})`;
  drawCalm(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH, REGION_LANDMARKS[region]);
}

function body(): HTMLElement {
  return document.getElementById("body")!;
}

function deltaChip(delta: number, label: string): string {
  const cls = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  const sign = delta > 0 ? "+" : "";
  return `<span class="delta-chip ${cls}">${sign}${delta.toFixed(1)} ${label}</span>`;
}

// ---------------- overall ----------------
function showOverall(): void {
  if (!ctx) return;
  const { report: r, delta } = ctx;
  setZoom(null);
  const topPct = Math.max(0.1, Math.round((100 - r.overallPercentile) * 10) / 10);
  const deltaHTML = delta
    ? deltaChip(delta.overall, delta.daysAgo === 0 ? "vs last scan" : `vs ${delta.daysAgo}d ago`)
    : "";

  body().innerHTML = `
    <div class="reveal">
      <div class="score-head">
        <div><div class="klabel">OVERALL</div>
          <div class="big"><span id="cnt">0.0</span><small> /10</small></div></div>
        <div class="chipcol">
          <span class="chip">Top ${topPct}%</span>
          ${deltaHTML}
        </div>
      </div>
      <div class="pillars">${(Object.entries(r.pillars) as [string, number][])
        .map(
          ([p, s]) => `
        <div class="pillar"><b>${s.toFixed(1)}</b><span>${p.toUpperCase()}</span>
        <div class="pbar"><i data-w="${s * 10}"></i></div></div>`,
        )
        .join("")}
      </div>
      <div class="panel"><h4>POPULATION POSITION</h4>${curveSVG(r.overallPercentile)}
        <p class="rarity">Roughly <b>1 in ${rarityN(r.overallPercentile)}</b> ${r.sex} faces share this overall measurement profile.</p></div>
      <div class="navrow"><button class="btn gho" id="btn-new">New photo</button>
        <button class="btn pri" id="btn-plan">See your plan</button></div>
      <div class="navrow">
        <button class="btn gho" id="btn-share">Share card</button>
        ${ctx.onSideProfile ? `<button class="btn gho" id="btn-side">Add side profile →</button>` : ""}
      </div>
    </div>`;

  countUp(document.getElementById("cnt")!, r.overall);
  setTimeout(
    () =>
      document
        .querySelectorAll<HTMLElement>(".pbar i")
        .forEach((i) => (i.style.width = `${i.dataset.w}%`)),
    150,
  );
  document.getElementById("btn-new")!.onclick = () => ctx?.onNewPhoto();
  document.getElementById("btn-plan")!.onclick = () => select("improve");
  const sideBtn = document.getElementById("btn-side");
  if (sideBtn) sideBtn.onclick = () => ctx?.onSideProfile?.();
  document.getElementById("btn-share")!.onclick = async () => {
    if (!ctx) return;
    const photo = document.getElementById("photo-canvas") as HTMLCanvasElement;
    const card = await renderShareCard(ctx.report, photo);
    await shareCard(card, ctx.report.overall);
  };
}

// Side-profile results: same measurement language, its own report, no photo
// zoom (the side view has no landmark mesh to re-light).
export function renderSideResults(report: Report, onRedo: () => void): void {
  if (!ctx) return;
  setZoom(null);
  const regions = report.regions.filter((r) => r.metrics.length);
  const topPct = Math.max(0.1, Math.round((100 - report.overallPercentile) * 10) / 10);

  ctx.analysis.innerHTML = `
    <div class="reveal">
      <div class="score-head">
        <div><div class="klabel">SIDE PROFILE</div>
          <div class="big">${report.overall.toFixed(1)}<small> /10</small></div></div>
        <div class="chipcol"><span class="chip">Top ${topPct}%</span></div>
      </div>
      <div class="panel"><h4>POPULATION POSITION</h4>${curveSVG(report.overallPercentile)}
        <p class="rarity">Roughly <b>1 in ${rarityN(report.overallPercentile)}</b> ${report.sex} profiles measure this way.</p></div>
      ${regions
        .map(
          (r) => `<div class="dcard" style="margin-bottom:12px">
        <h3>${REGION_NAMES[r.region]} · ${r.score.toFixed(1)}<em>SIDE</em></h3>
        ${r.metrics
          .map(
            (m, i) => `<div class="metric" style="animation-delay:${60 + i * 60}ms">
          <div class="mrow"><b>${m.def.name}</b><span>${fmt(m)}<span class="mscore">${m.score.toFixed(1)}</span></span></div>
          <div class="rangebar">${idealWindow(m, report.sex)}<i data-l="${m.markerPct}"></i></div></div>`,
          )
          .join("")}
      </div>`,
        )
        .join("")}
      <div class="navrow">
        <button class="btn gho" id="side-redo">Re-verify landmarks</button>
        <button class="btn pri" id="side-front">Back to front results</button>
      </div>
    </div>`;

  setTimeout(
    () => document.querySelectorAll<HTMLElement>(".rangebar i").forEach((i) => (i.style.left = `${i.dataset.l}%`)),
    120,
  );
  document.getElementById("side-redo")!.onclick = onRedo;
  document.getElementById("side-front")!.onclick = () => renderResults(ctx!);
}

function countUp(el: HTMLElement, target: number): void {
  let n = 0;
  const iv = setInterval(() => {
    n = Math.min(target, n + 0.12);
    el.textContent = n.toFixed(1);
    if (n >= target) clearInterval(iv);
  }, 22);
}

// ---------------- region ----------------
function showRegion(id: RegionId): void {
  if (!ctx) return;
  const r = ctx.report.regions.find((x) => x.region === id)!;
  setZoom(id);

  const matches = regionMatches(id, r.metrics, ctx.report.sex);
  const matchCard = matches.length
    ? matches
        .map(
          (m) => `<div class="celeb"><div class="ava">${m.name[0]}</div>
        <div class="nm">${m.name}<span>${m.metricName}</span></div>
        <div class="val">Δ ${m.deltaSigma.toFixed(2)}σ</div></div>`,
        )
        .join("")
    : `<p class="footnote" style="margin-top:2px">No match shown here: matches are only offered on metrics where you measure at or above average, and this region has none. That restraint is the point — a flattering comparison you did not earn would make every other number worth less.</p>`;

  body().innerHTML = `
    <div class="reveal">
      <div class="dots" id="dots"><i class="on"></i><i></i></div>
      <div class="deck" id="deck">
        <div class="dcard">
          <h3>${REGION_NAMES[id]} · ${r.score.toFixed(1)}<em>MEASURED</em></h3>
          ${r.metrics
            .map(
              (m, i) => `<div class="metric${hasOverlay(m.def.id) ? " tappable" : ""}" data-metric="${m.def.id}" style="animation-delay:${80 + i * 70}ms">
            <div class="mrow"><b>${m.def.name}</b><span>${fmt(m)}<span class="mscore">${m.score.toFixed(1)}</span></span></div>
            <div class="rangebar">${idealWindow(m, ctx!.report.sex)}<i data-l="${m.markerPct}"></i></div></div>`,
            )
            .join("")}
          <div class="typebox" id="tw"></div>
        </div>
        <div class="dcard">
          <h3>Similar measurements<em>REFERENCE</em></h3>
          ${matchCard}
          <p class="footnote">Reference set grows with every analyzed face. Matches are on specific metrics where you genuinely align.</p>
        </div>
      </div>
      <div class="panel"><h4>${REGION_NAMES[id].toUpperCase()} POSITION</h4>${curveSVG(r.percentile, true)}
        <p class="rarity">${rarityLine(r)}</p></div>
    </div>`;

  setTimeout(
    () =>
      document
        .querySelectorAll<HTMLElement>(".rangebar i")
        .forEach((i) => (i.style.left = `${i.dataset.l}%`)),
    120,
  );
  typewrite(document.getElementById("tw")!, regionSummary(r, ctx.report.sex));
  wireMeasurementTaps(r, id);

  const deck = document.getElementById("deck")!;
  const dots = document.getElementById("dots")!;
  deck.onscroll = () => {
    const on = deck.scrollLeft > deck.clientWidth / 2 ? 1 : 0;
    dots.querySelectorAll("i").forEach((x, j) => x.classList.toggle("on", j === on));
  };
}

// Ideal window on the gradient bar, drawn in the same population-percentile
// space as the marker so "inside the window" always means "in the ideal band".
function idealWindow(m: ScoredMetric, sex: Sex): string {
  const d = m.def.dist[sex];
  const lo = phi((m.idealRange[0] - d.mean) / d.sd) * 100;
  const hi = phi((m.idealRange[1] - d.mean) / d.sd) * 100;
  return `<div class="ideal" style="left:${lo.toFixed(1)}%;width:${Math.max(4, hi - lo).toFixed(1)}%"></div>`;
}

function rarityLine(r: RegionScore): string {
  return r.percentile >= 50
    ? `Roughly <b>1 in ${rarityN(r.percentile)}</b> faces measure this well across the ${REGION_NAMES[r.region].toLowerCase()}.`
    : `About <b>${Math.round(100 - r.percentile)}%</b> of faces score higher here — the drill-down above shows exactly why.`;
}

// Tapping a measurement row draws that exact measurement on the face. A
// number in a table is a claim; the same number drawn across the cheekbones
// is evidence — this is the credibility wedge made visible.
let activeMetric: string | null = null;

function wireMeasurementTaps(r: RegionScore, region: RegionId): void {
  for (const row of document.querySelectorAll<HTMLElement>(".metric[data-metric]")) {
    const id = row.dataset.metric!;
    const metric = r.metrics.find((m) => m.def.id === id);
    if (!metric || !hasOverlay(id)) continue;
    row.onclick = () => {
      if (!ctx) return;
      if (activeMetric === id) {
        activeMetric = null;
        row.classList.remove("active");
        drawCalm(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH, REGION_LANDMARKS[region]);
        return;
      }
      activeMetric = id;
      for (const other of document.querySelectorAll(".metric")) other.classList.remove("active");
      row.classList.add("active");
      drawMeasurement(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH, metric);
    };
  }
}

// ---------------- improvements ----------------
function showImprove(): void {
  if (!ctx) return;
  const { report: r, delta } = ctx;
  setZoom(null);

  const fixables = r.metrics
    .filter((m) => m.def.fixability >= 0.2 && m.zEff < 0.4)
    .sort((a, b) => a.zEff - b.zEff)
    .slice(0, 4);

  const progress = delta
    ? `<div class="panel"><h4>SINCE YOUR LAST SCAN${delta.daysAgo ? ` · ${delta.daysAgo}D AGO` : ""}</h4>
        ${progressCopy(delta)}
        ${delta.regions
          .filter((x) => Math.abs(x.delta) > 0.05)
          .map(
            (x) => `<div class="prog-row"><span>${REGION_NAMES[x.region]}</span>
            <span class="d ${x.delta > 0 ? "up" : "down"}">${x.delta > 0 ? "+" : ""}${x.delta.toFixed(1)}</span></div>`,
          )
          .join("") || `<div class="prog-row"><span>All regions</span><span class="d flat">within capture variance</span></div>`}
      </div>`
    : "";

  body().innerHTML = `
    <div class="reveal">
      <div class="pot"><div class="n">${r.overall.toFixed(1)}</div><div class="arr">→</div>
        <div class="n p">${r.potential.toFixed(1)}</div>
        <p>Potential recomputed from your fixable metrics only. Habits, composition and grooming — no surgery, anywhere.</p></div>
      ${progress}
      ${fixables
        .map((m) => {
          const lever = leverFor(m);
          return `<div class="imp"><b>${lever.title}<em>${REGION_NAMES[m.def.region].toUpperCase()} · ${m.score.toFixed(1)} · ${lever.tag}</em></b>
          <p>${lever.body(m, r.sex)}</p>
          <span class="why">MOVES ${m.def.pillar.toUpperCase()} →</span></div>`;
        })
        .join("")}
      <div class="navrow"><button class="btn gho" id="btn-back">Back to results</button>
        <button class="btn pri" id="btn-again">Scan another face</button></div>
    </div>`;

  document.getElementById("btn-back")!.onclick = () => select("overall");
  document.getElementById("btn-again")!.onclick = () => ctx?.onNewPhoto();
}

function progressCopy(d: ScanDelta): string {
  if (d.overall > 0.15)
    return `<p class="rarity">Up <b>+${d.overall.toFixed(1)}</b> overall. The numbers moved — whatever you're doing, keep doing it.</p>`;
  if (d.overall < -0.15)
    return `<p class="rarity">Down <b>${d.overall.toFixed(1)}</b> overall. Before reading into it: lighting, expression and angle explain most small drops — recapture in the same conditions first.</p>`;
  return `<p class="rarity">Overall is <b>flat</b> (${d.overall >= 0 ? "+" : ""}${d.overall.toFixed(1)}) — within capture variance. Structural change shows up over weeks, not days.</p>`;
}
