import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { phi, REGION_NAMES } from "../engine/scoring.ts";
import type { RegionId, RegionScore, Report, ScoredMetric, Sex } from "../engine/types.ts";
import type { ScanDelta } from "../engine/history.ts";
import { regionMatches } from "../engine/celebs.ts";
import { curveLegend, curveSVG } from "./curve.ts";
import { REGION_LANDMARKS, zoomFor } from "./regions.ts";
import { drawCalm, transitionRegion } from "./overlay.ts";
import { drawMeasurement, hasOverlay } from "./measureOverlay.ts";
import { renderShareCard, shareCard } from "./shareCard.ts";
import { egoLine, fmt, leverFor, percentileLine, rarityText, regionSummary, topPctText } from "./templates.ts";
import { stopTypewriter, typewrite } from "./typewriter.ts";
import { chosenGoals, goalBoost, goalsTouching, isQuiet, loadProfile, skinConcernLabels } from "../engine/goals.ts";
import { openQuiz } from "./goalsQuiz.ts";
import { EVIDENCE_LABEL, recsFor } from "../engine/recommendations.ts";
import { GOALS } from "../engine/goals.ts";

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
  // A new scan starts from the calm whole-face state. Without this the first
  // tab change after re-scanning would animate out of the PREVIOUS photo's
  // region, which is a transition from somewhere the user never was.
  transition?.cancel();
  transition = null;
  shownRegion = null;
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

// Which region the overlay is currently lit for, so a transition knows what it
// is coming FROM. Null means the calm whole-face state.
let shownRegion: RegionId | null = null;
let transition: { cancel(): void } | null = null;

function setZoom(region: RegionId | null): void {
  if (!ctx) return;
  // A fast tab-to-tab click must not leave two animations fighting over the
  // same canvas; the newer one wins outright.
  transition?.cancel();
  transition = null;

  if (region) {
    const z = zoomFor(region, ctx.landmarks);
    ctx.zoomable.style.transformOrigin = `${z.originX}% ${z.originY}%`;
    ctx.zoomable.style.transform = `scale(${z.scale})`;
  } else {
    ctx.zoomable.style.transform = "none";
  }

  const from = shownRegion ? REGION_LANDMARKS[shownRegion] : undefined;
  const to = region ? REGION_LANDMARKS[region] : undefined;
  shownRegion = region;

  // Nothing to animate between on the very first paint of the calm state.
  if (!from && !to) {
    drawCalm(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH);
    return;
  }
  transition = transitionRegion(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH, from, to);
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
  const deltaHTML = delta
    ? deltaChip(delta.overall, delta.daysAgo === 0 ? "vs last scan" : `vs ${delta.daysAgo}d ago`)
    : "";
  // A front scan is a complete measurement, but it is a measurement of one
  // plane. Projection, chin and jaw angle only exist in profile, so a
  // front-only number says so rather than quietly presenting itself as the
  // whole picture.
  const merged = Number.isFinite(r.zScores["view:side"]);

  body().innerHTML = `
    <div class="reveal">
      <div class="score-head">
        <div><div class="klabel">${merged ? "OVERALL · FRONT + SIDE" : "OVERALL · FRONT ONLY"}</div>
          <div class="big"><span id="cnt">0.0</span><small> /10</small></div></div>
        <div class="chipcol">
          <span class="chip big-chip">${percentileLine(r.overallPercentile, r.sex)}</span>
          ${deltaHTML}
        </div>
      </div>
      <p class="ego">${egoLine(r.overallPercentile)}</p>
      ${
        merged
          ? `<p class="viewnote done">Measured from both views. Projection, chin and jaw angle can only be seen in profile — they are in this number.</p>`
          : ctx.onSideProfile
            ? `<p class="viewnote">This is your front measurement. Chin projection, jaw angle and facial convexity do not exist in a front photo — <button class="linkish" id="side-nudge">add a side profile</button> and the score is recomputed from both.</p>`
            : ""
      }
      <div class="pillars">${(Object.entries(r.pillars) as [string, number][])
        .map(
          ([p, s]) => `
        <div class="pillar"><b>${s.toFixed(1)}</b><span>${p.toUpperCase()}</span>
        <div class="pbar"><i data-w="${s * 10}"></i></div></div>`,
        )
        .join("")}
      </div>
      <div class="panel"><h4>POPULATION POSITION</h4>${curveSVG(r.overallPercentile, "overall", r.sex)}
        ${curveLegend()}
        <p class="rarity">Roughly <b>${rarityText(r.overallPercentile)}</b> ${r.sex} faces share this overall measurement profile.</p></div>
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
  const nudge = document.getElementById("side-nudge");
  if (nudge) nudge.onclick = () => ctx?.onSideProfile?.();
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
  const topPct = topPctText(report.overallPercentile);

  ctx.analysis.innerHTML = `
    <div class="reveal">
      <div class="score-head">
        <div><div class="klabel">SIDE PROFILE</div>
          <div class="big">${report.overall.toFixed(1)}<small> /10</small></div></div>
        <div class="chipcol"><span class="chip">${topPct}</span></div>
      </div>
      <div class="panel"><h4>POPULATION POSITION</h4>${curveSVG(report.overallPercentile, "overall", report.sex)}
        ${curveLegend()}
        <p class="rarity">Roughly <b>${rarityText(report.overallPercentile)}</b> ${report.sex} profiles measure this way.</p></div>
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
          ${
            // The overlay is the credibility feature and it was invisible: a
            // 9px glyph at 55% opacity is not an affordance. Say it in words.
            r.metrics.some((m) => hasOverlay(m.def.id))
              ? `<button class="tap-hint" id="tap-hint"><i>◱</i>Tap a measurement to draw it on your face</button>`
              : ""
          }
          <div class="typebox" id="tw"></div>
        </div>
        <div class="dcard">
          <h3>Similar measurements<em>REFERENCE</em></h3>
          ${matchCard}
          <p class="footnote">Reference set grows with every analyzed face. Matches are on specific metrics where you genuinely align.</p>
        </div>
      </div>
      <div class="panel"><h4>${REGION_NAMES[id].toUpperCase()} POSITION</h4>${curveSVG(r.percentile, `region:${id}`, ctx!.report.sex, true)}
        ${curveLegend()}
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
    ? `Roughly <b>${rarityText(r.percentile)}</b> faces measure this well across the ${REGION_NAMES[r.region].toLowerCase()}.`
    : `About <b>${Math.round(100 - r.percentile)}%</b> of faces score higher here — the drill-down above shows exactly why.`;
}

// Tapping a measurement row draws that exact measurement on the face. A
// number in a table is a claim; the same number drawn across the cheekbones
// is evidence — this is the credibility wedge made visible.
let activeMetric: string | null = null;

const HINT_IDLE = `<i>◱</i>Tap a measurement to draw it on your face`;

function wireMeasurementTaps(r: RegionScore, region: RegionId): void {
  // Switching tabs re-renders the rows but used to leave this pointing at the
  // previous region's metric, so the first tap after coming back toggled the
  // overlay OFF instead of on.
  activeMetric = null;
  const hint = document.getElementById("tap-hint");
  const rows: HTMLElement[] = [];

  for (const row of document.querySelectorAll<HTMLElement>(".metric[data-metric]")) {
    const id = row.dataset.metric!;
    const metric = r.metrics.find((m) => m.def.id === id);
    if (!metric || !hasOverlay(id)) continue;
    rows.push(row);
    row.onclick = () => {
      if (!ctx) return;
      if (activeMetric === id) {
        activeMetric = null;
        row.classList.remove("active");
        if (hint) {
          hint.classList.remove("on");
          hint.innerHTML = HINT_IDLE;
        }
        drawCalm(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH, REGION_LANDMARKS[region]);
        shownRegion = region;
        return;
      }
      activeMetric = id;
      for (const other of document.querySelectorAll(".metric")) other.classList.remove("active");
      row.classList.add("active");
      if (hint) {
        hint.classList.add("on");
        hint.innerHTML = `<i>◱</i>Drawing <b>${metric.def.name}</b> — tap the row again to clear`;
      }
      drawMeasurement(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH, metric);
    };
  }

  // The hint is the affordance, so it has to do the thing it describes:
  // demonstrate on the first measurement, and clear whatever is drawn.
  if (hint && rows.length) {
    hint.onclick = () => (rows.find((x) => x.dataset.metric === activeMetric) ?? rows[0]).click();
  }
}

// ---------------- improvements ----------------
function showImprove(): void {
  if (!ctx) return;
  const { report: r, delta } = ctx;
  setZoom(null);
  const profile = loadProfile();

  // The plan is where someone's answers have to actually bite. Regions they
  // asked us to leave alone are dropped from the WRITTEN plan — their scores
  // are still on every other tab, untouched — and the goals they picked pull
  // their own levers to the front.
  const fixables = r.metrics
    .filter((m) => m.def.fixability >= 0.2 && m.zEff < 0.4)
    .filter((m) => !isQuiet(m.def.region, profile))
    .sort((a, b) => a.zEff - goalBoost(a.def.id, profile) - (b.zEff - goalBoost(b.def.id, profile)))
    .slice(0, 4);

  const unmeasured = chosenGoals(profile).filter((g) => !g.measurable);
  const quietNote = profile.quiet.length
    ? `<p class="q-foot" style="margin:0 2px 14px">Your plan skips ${profile.quiet
        .map((q) => REGION_NAMES[q].toLowerCase())
        .join(", ")} because you asked it to. Every one of those measurements is still on its own tab — nothing was hidden or softened.</p>`
    : "";

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
      ${goalHead(profile)}
      ${quietNote}
      ${progress}
      ${fixables
        .map((m) => {
          const lever = leverFor(m);
          const why = goalsTouching(m.def.id, profile);
          const muted = !profile.advice[lever.channel];
          return `<div class="imp"><b>${lever.title}<em>${REGION_NAMES[m.def.region].toUpperCase()} · ${m.score.toFixed(1)} · ${lever.tag}</em></b>
          <p>${muted ? lever.neutral(m, r.sex) : lever.body(m, r.sex)}</p>
          ${why.length ? `<span class="because">Because you chose ${why.map((g) => g.label.toLowerCase()).join(" + ")}</span>` : ""}
          <span class="why">MOVES ${m.def.pillar.toUpperCase()} →</span></div>`;
        })
        .join("")}
      ${unmeasured
        .map(
          (g) => `<div class="imp"><b>${g.label}<em>NOT MEASURED · YOUR GOAL</em></b>
        <p>${g.blurb}. Nothing in a 478-point face mesh reads this, so TrueMax will never hand you a number for it or claim your score moved because of it. It's on your list because you put it there.</p>
        <span class="because">Because you chose ${g.label.toLowerCase()}</span></div>`,
        )
        .join("")}
      ${recsHTML(profile)}
      <div class="navrow"><button class="btn gho" id="btn-back">Back to results</button>
        <button class="btn pri" id="btn-again">Scan another face</button></div>
    </div>`;

  document.getElementById("btn-back")!.onclick = () => select("overall");
  document.getElementById("btn-again")!.onclick = () => ctx?.onNewPhoto();
  const edit = document.getElementById("goal-edit");
  if (edit) edit.onclick = () => openQuiz(() => showImprove(), "all");

  // First time someone reaches their plan, ask what to leave alone — the
  // moment prose is about to be written, and the first moment they have the
  // numbers in front of them to answer with.
  if (!profile.postDone) openQuiz(() => showImprove(), "post");
}

// Recommendations: what to actually do, drawn only from things sold over a
// counter and things that are simply true about food. Ordered by how well the
// evidence holds up, because "strong" and "no good evidence" both appear here
// and the person deserves to see which is which before they spend anything.
function recsHTML(p: ReturnType<typeof loadProfile>): string {
  // A goal whose regions are all off-limits stays off-limits here too
  const quietGoals = new Set(
    GOALS.filter((g) => g.regions.length && g.regions.every((r) => isQuiet(r, p))).map((g) => g.id),
  );
  const recs = recsFor(p, quietGoals);
  if (!recs.length) return "";

  const order: Record<string, number> = { strong: 0, moderate: 1, limited: 2, none: 3 };
  recs.sort((a, b) => order[a.evidence] - order[b.evidence]);

  // Grouped, because a flat list of thirty cards is a wall. Within each group
  // the best-evidenced thing comes first, so the cheapest and most certain
  // options are what someone reads before anything they could spend money on.
  const GROUPS: Array<[string, string, string]> = [
    ["topical", "APPLY", "Over-the-counter only. Availability and permitted strengths differ by country — a pharmacist will know what's on the shelf where you are."],
    ["food", "EAT", "Facts about food, not a diet. No targets, no counting, nothing to buy."],
    ["habit", "DO", "Free, and mostly the things that compound."],
    ["professional", "ASK SOMEONE", "The things worth paying a person for rather than guessing at."],
  ];

  const sections = GROUPS.map(([g, label, blurb]) => {
    const items = recs.filter((r) => r.group === g);
    if (!items.length) return "";
    return `<div class="rec-group">
      <h5>${label}</h5>
      <p class="rec-group-note">${blurb}</p>
      ${items
        .map(
          (r) => `<div class="rec ev-${r.evidence}">
        <b>${r.title}<em>${EVIDENCE_LABEL[r.evidence].toUpperCase()}</em></b>
        <span class="rec-what">${r.what}</span>
        <p>${r.detail}</p>
        ${r.caution ? `<span class="rec-caution">${r.caution}</span>` : ""}
      </div>`,
        )
        .join("")}
    </div>`;
  }).join("");

  return `<div class="recs">
    <h4>WORTH TRYING</h4>
    <p class="recs-note">Nothing here is a prescription, a supplement or a procedure — over-the-counter items and facts about food only. It isn't medical advice and none of it is required; a pharmacist or doctor knows your situation and we don't. Where the evidence for something popular is weak, it says so.</p>
    ${sections}
  </div>`;
}

function goalHead(p: ReturnType<typeof loadProfile>): string {
  const goals = chosenGoals(p);
  if (!p.preDone && !p.postDone) return "";
  return `<div class="goal-head">
    <h4>YOUR PLAN</h4>
    ${p.endGoal ? `<div class="endgoal">“${p.endGoal}”</div>` : ""}
    <div class="goal-tags">
      ${goals.length
        ? goals.map((g) => `<span class="goal-tag">${g.label}</span>`).join("")
        : `<span class="goal-tag mut">No goals set — showing your weakest fixable numbers</span>`}
      ${skinConcernLabels(p)
        .map((l) => `<span class="goal-tag alt">${l}</span>`)
        .join("")}
      ${p.quiet.length ? `<span class="goal-tag mut">${p.quiet.length} topic${p.quiet.length > 1 ? "s" : ""} off-limits</span>` : ""}
    </div>
    ${
      skinConcernLabels(p).length
        ? `<p class="goal-declared">You told us this — the scan didn't. It measures how evenly your face reflects light, which cannot tell one skin condition from another.</p>`
        : ""
    }
    <button class="goal-edit" id="goal-edit">Edit your goals</button>
  </div>`;
}

function progressCopy(d: ScanDelta): string {
  if (d.overall > 0.15)
    return `<p class="rarity">Up <b>+${d.overall.toFixed(1)}</b> overall. The numbers moved — whatever you're doing, keep doing it.</p>`;
  if (d.overall < -0.15)
    return `<p class="rarity">Down <b>${d.overall.toFixed(1)}</b> overall. Before reading into it: lighting, expression and angle explain most small drops — recapture in the same conditions first.</p>`;
  return `<p class="rarity">Overall is <b>flat</b> (${d.overall >= 0 ? "+" : ""}${d.overall.toFixed(1)}) — within capture variance. Structural change shows up over weeks, not days.</p>`;
}
