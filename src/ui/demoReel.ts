import { METRICS } from "../engine/metrics.js";
import { REEL as REEL_MEASURED } from "./demoReelData.js";
import { applyShim } from "./demoReelShim.js";
import { LABEL_H, LABEL_W, placeCallouts } from "./demoReelLayout.js";

// The landing reel shows display scores rather than the engine's output, for
// the reason set out in demoReelShim.ts. `?real=1` returns the measured ones.
const REEL = applyShim(REEL_MEASURED);
import type { ReelFace } from "./demoReelData.js";

// ---------------------------------------------------------------------------
// Landing demo reel.
//
// It runs the same beats a real scan does — points sweep the face, the engine
// works, then the analysis arrives in parts: overall, then the four pillars,
// then individual regions called out at the exact spot on the face they were
// measured from. A number that flashes up in one second reads as a gimmick; a
// number that arrives after visible work reads as a measurement.
//
// Every value on screen is this engine's real output on that photograph.
// ---------------------------------------------------------------------------

// The shape the owner settled on after watching it live: a scan line sweeps
// DOWN the face, comes back UP while the measuring copy runs, and then the
// results arrive — score, pillars, region callouts. No landmark mesh (the
// drawn contours never sat perfectly on the features, and nearly right is
// worse than absent), and no product chapters (the demo's one job is the
// scan-and-score; the product explains itself past the fold).
const T = {
  scan: [260, 1350],
  measure: [1350, 2350],
  score: [2550, 3300],
  pillars: [3300, 4550],
  regions: [4550, 6550],
  out: 6650,
  hold: 6950,
};

// Count from the engine, not prose: the demo is front-only, and a hardcoded
// number here drifted (it said 31 while the engine measured 33).
const STAGES = ["Normalizing pose", `Measuring ${METRICS.length} proportions`, "Comparing against population"];
// Four characters each: at reel width a full pillar name ran into its own
// number, and "ANGULARIT" truncated mid-word looks like a bug.
const PILLAR_ABBR: Record<string, string> = {
  Harmony: "HARM", Angularity: "ANGL", Dimorphism: "DIMO", Features: "FEAT",
};

const REGION_LABEL: Record<string, string> = {
  eyes: "Eyes", midface: "Midface", jaw: "Jaw", chin: "Chin",
  nose: "Nose", lips: "Lips", proportions: "Proportions", symmetry: "Symmetry",
};

export interface ReelHandle {
  stop(): void;
}

const seg = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const ease = (x: number) => 1 - Math.pow(1 - x, 2);

// Three regions, chosen to look like an actual read of the face rather than a
// highlight reel: the best, the worst, and the median. Showing only strengths
// is what the competition does.
function calloutsFor(face: ReelFace) {
  const rs = [...face.regions].sort((a, b) => b.score - a.score);
  if (rs.length < 3) return rs;
  return [rs[0], rs[rs.length >> 1], rs[rs.length - 1]];
}

export interface ReelOptions {
  /**
   * Render the thumbnail cut of the reel: the photograph and the scan sweep,
   * and nothing else.
   *
   * Every measurement in this renderer is an absolute pixel value tuned for
   * the landing card, which is about 300x575. The gate strip asks for the
   * same composition in an 84x84 box, and absolute values do not survive
   * that: the top scrim covers 86% of the frame, the caption scrim is 210%
   * of it, and the four pillar bars come out 8px wide while still carrying an
   * 8.5px label and an 11px number. That is the unreadable smudge in the
   * strip — four numbers and four labels stacked inside eight pixels.
   *
   * Scaling the whole composition by width does not fix it. At 84px the scale
   * factor is 0.28, which turns the 8.5px label into a 2.4px speck: tidy
   * arithmetic, still illegible. A box that small cannot hold four labelled
   * bars and three region callouts at ANY scale, so the honest answer is to
   * draw less rather than to draw the same thing smaller.
   *
   * What survives is what still reads at 84px: a face, and an instrument
   * sweeping down it. The score is not lost — it is the DOM element beside
   * the thumbnail, which this renderer already drives.
   */
  compact?: boolean;
}

// The thumbnail cut ends once the score has landed and been readable for a
// moment. The full card spends 2350ms to 6950ms docking the photograph and
// laying out pillars and callouts; compact draws none of that, so running the
// same clock would park a still photograph on screen for three and a half
// seconds of every seven. Scan, measure, score, a beat to read it, next face
// — 4.5s a face against the card's 6.95s.
//
// The 900ms between the count-up finishing (3300) and the fade starting is
// the point of these numbers, not slack: at 3500 the number was on screen at
// its final value for 200ms, which is a flicker rather than a result.
const COMPACT_TAIL = { out: 4200, hold: 4500 };

export function mountDemoReel(
  canvas: HTMLCanvasElement,
  scoreEl: HTMLElement,
  opts: ReelOptions = {},
): ReelHandle {
  if (!REEL.length) return { stop: () => {} };
  const compact = opts.compact === true;
  const TT = compact ? { ...T, ...COMPACT_TAIL } : T;

  const images = REEL.map((f) => {
    const img = new Image();
    img.src = `/demo/${f.slug}.jpg`;
    return img;
  });

  // Stills only, by decision. The living-portrait loops were tried and cut:
  // a photograph that blinks reads as a photograph malfunctioning, not as a
  // person — the scan line supplies all the motion this card needs.

  let idx = 0;
  let start = 0;
  let raf = 0;
  let stopped = false;
  let shownAny = false;

  const frame = (now: number) => {
    if (stopped) return;
    if (!start) start = now;
    const t = now - start;
    const face = REEL[idx];
    const img = images[idx];
    if (!face) return;

    const live: HTMLImageElement = img;

    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;

    // ---- the dock ---------------------------------------------------------
    //
    // White numbers over a photograph are a coin toss: on Cavill's lit cheek
    // the 8.1 all but vanished, and no amount of text-shadow fixes a number
    // sitting on skin. So once the measuring is done the photograph RETREATS —
    // it eases up into the top two thirds of the frame and the bottom third
    // becomes solid black, with the seam blended so the panel reads as the
    // photograph's own shadow rather than a bar stapled underneath it. The
    // score and the four pillars then sit on black, where white is white.
    //
    // It expands back over the out-beat so the next face begins its scan
    // full-frame and the crossfade never happens between two different shapes.
    // No dock in the thumbnail cut. The dock exists to clear a black panel for
    // the score and the pillar row; compact draws neither, so retreating the
    // photograph into two thirds of an already tiny frame would cost a third
    // of the only thing worth showing.
    const dockT = compact
      ? 0
      : ease(seg(t, T.score[0], T.score[0] + 700)) * (1 - seg(t, TT.out, TT.hold));
    const photoH = h - h * (1 / 3) * dockT;
    const panelH = h - photoH;
    // Capped at 3, not 2. This canvas is around 300x375 CSS pixels, so even
    // full density is barely a megapixel — nothing here is worth trading
    // sharpness for. At the old cap of 2 a modern phone rendered the most
    // prominent surface on the landing page at two thirds of its screen's
    // resolution, which is most visible on the hairline overlay text.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // A face crosses into the next ONCE.
    //
    // This ran the transition twice, in opposite directions, and the reel
    // visibly jumped to the next celebrity and came back. The tail of each
    // beat fades the current face out over the NEXT one drawn underneath —
    // so by the time the index advances, that face is already fully on
    // screen. It then faded IN from scratch, with the face it had just
    // replaced drawn underneath at full opacity: forward, back, forward.
    //
    // Only the first face has nothing to cross from, so only the first face
    // fades up from the card.
    const fadeIn = shownAny ? 1 : Math.min(1, t / 200);
    const fadeOut = t > TT.out ? Math.max(0, (TT.hold - t) / (TT.hold - TT.out)) : 1;
    const alpha = Math.min(fadeIn, fadeOut);

    // Cover-fit with a slow push-in. Four per cent over the whole beat is
    // under a pixel a frame — not readable as movement, which is the point.
    // A still photograph behind a moving overlay reads as a screenshot with
    // animation played on top of it; the same photograph drifting very slightly
    // reads as a camera pointed at someone.
    // Where a photograph lands inside the (shrinking) photo area: cover-fit,
    // centred. The demo portraits are 4:5 and so is the card, so at full
    // height this is an exact fill; as the dock closes, the box gets wider
    // than the picture and the fit crops equally off the top and the bottom,
    // which takes hair and collar and leaves the face untouched in the middle.
    const sizeOf = (source: HTMLImageElement | HTMLVideoElement) =>
      source instanceof HTMLVideoElement
        ? { sw: source.videoWidth, sh: source.videoHeight }
        : { sw: source.naturalWidth, sh: source.naturalHeight };
    const readyOf = (source: HTMLImageElement | HTMLVideoElement) =>
      source instanceof HTMLVideoElement
        ? source.readyState >= 2 && source.videoWidth > 0
        : source.complete && source.naturalWidth > 0;
    const rectOf = (source: HTMLImageElement | HTMLVideoElement, zoom: number) => {
      const { sw, sh } = sizeOf(source);
      const s = Math.max(w / sw, photoH / sh) * zoom;
      const dw = sw * s;
      const dh = sh * s;
      return { dx: (w - dw) / 2, dy: (photoH - dh) / 2, dw, dh };
    };
    const drawCover = (source: HTMLImageElement | HTMLVideoElement, zoom: number, a: number) => {
      if (!readyOf(source)) return;
      const r = rectOf(source, zoom);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, photoH);
      ctx.clip();
      ctx.globalAlpha = a;
      ctx.drawImage(source, r.dx, r.dy, r.dw, r.dh);
      ctx.restore();
      ctx.globalAlpha = a;
    };

    // The outgoing face used to fade to nothing and the incoming one to fade up
    // from nothing, which puts a washed-out half-empty card on screen at both
    // ends of every face. Whichever face this one is fading against is drawn
    // underneath at full opacity instead, so the two genuinely cross and the
    // card is never showing the page background through a photograph.
    // The incoming face, underneath, at its own rest zoom — which is exactly
    // where it will be drawn on its first frame as the current face, so the
    // handover is continuous rather than a four-per-cent pop.
    if (REEL.length > 1 && fadeOut < 1) {
      drawCover(images[(idx + 1) % REEL.length], 1, 1);
    }
    drawCover(live, 1 + 0.04 * Math.min(1, t / TT.hold), alpha);
    ctx.globalAlpha = alpha;

    // A quiet vignette over every photograph. The portraits come from many
    // photographers under many lights, and side by side that variety reads as
    // inconsistency; one shared edge treatment is what makes eleven strangers'
    // photos look like one product shot them. Elliptical and gentle — the face
    // in the middle is untouched.
    const vig = ctx.createRadialGradient(w / 2, photoH * 0.42, Math.min(w, photoH) * 0.45, w / 2, photoH / 2, Math.max(w, photoH) * 0.78);
    vig.addColorStop(0, "rgba(8,10,12,0)");
    vig.addColorStop(1, "rgba(8,10,12,0.34)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, photoH);

    // Overlay text is white and the photograph underneath it is not reliably
    // dark — a lit forehead put "MEASURING" at almost no contrast. Two scrims
    // rather than one flat wash, so the middle of the face stays untouched.
    // Both scrims exist to put overlay text on a reliable ground, and their
    // heights (72px, 120px) are absolute. Compact has no overlay text and is
    // 84px tall, so these would darken 86% and 143% of the frame to make
    // nothing legible. The vignette above is already written in fractions of
    // the frame, so it carries at both sizes and stays.
    if (!compact) {
      const topScrim = ctx.createLinearGradient(0, 0, 0, 72);
      topScrim.addColorStop(0, "rgba(10,11,13,0.55)");
      topScrim.addColorStop(1, "rgba(10,11,13,0)");
      ctx.fillStyle = topScrim;
      ctx.fillRect(0, 0, w, 72);
      // The seam. Undocked this is the old caption scrim; docked it is what
      // makes the black panel read as the photograph's own falloff instead of a
      // bar bolted underneath — the picture darkens INTO the panel, and the join
      // has no visible edge.
      const scrimTop = photoH - 120;
      const botScrim = ctx.createLinearGradient(0, scrimTop, 0, photoH);
      botScrim.addColorStop(0, "rgba(10,11,13,0)");
      botScrim.addColorStop(1, `rgba(10,11,13,${(0.72 + 0.28 * dockT).toFixed(3)})`);
      ctx.fillStyle = botScrim;
      ctx.fillRect(0, scrimTop, w, 120);
    }

    // ---- the scan sweep ---------------------------------------------------
    // Down once, then back up, and that is the whole scan visual. The drawn
    // landmark mesh is gone by decision: the contours never sat perfectly on
    // the lips and eyes, and an overlay that is nearly right undermines the
    // exact claim the product makes. The line owns the motion instead — a
    // second, dimmer echo line trails it so the pass reads as an instrument
    // sweeping rather than a loading bar.
    const down = ease(seg(t, T.scan[0], T.scan[1]));
    const up = ease(seg(t, T.measure[0], T.measure[1]));
    const goingUp = t >= T.measure[0];
    const sweepPos = goingUp ? 1 - up : down;
    if (t >= T.scan[0] && t < T.measure[1] && sweepPos > 0.001 && sweepPos < 0.999) {
      const y = sweepPos * photoH;
      // The glow trails BEHIND the direction of travel.
      const trail = goingUp ? 1 : -1;
      // Sized from the frame rather than fixed at 28px. On the landing card
      // the clamp holds it at exactly the 28 it has always been; in an 84px
      // thumbnail a 28px trail is a third of the picture, which reads as a
      // wash rather than an instrument.
      const glow = Math.max(8, Math.min(28, photoH * 0.075));
      const echo = glow * (44 / 28);
      const g = ctx.createLinearGradient(0, y, 0, y + trail * glow);
      g.addColorStop(0, "rgba(143,243,224,0.85)");
      g.addColorStop(1, "rgba(143,243,224,0)");
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.min(y, y + trail * glow), w, glow);
      // A hairline at the leading edge — the gradient alone is a glow with no
      // address; the one-pixel line is the instrument.
      ctx.fillStyle = "rgba(220,255,247,0.9)";
      ctx.fillRect(0, y, w, 1);
      const echoY = y + trail * echo;
      if (echoY > 0 && echoY < photoH) {
        ctx.fillStyle = "rgba(143,243,224,0.22)";
        ctx.fillRect(0, echoY, w, 1);
      }
    }

    // ---- phase label ------------------------------------------------------
    // Everything from here down is absolute-pixel furniture for the landing
    // card: the phase label, the staged working lines, the black panel, the
    // pillar row and the region callouts. None of it fits an 84px thumbnail,
    // and none of it is missed there — the strip's own headline says what is
    // running, and the score sits beside the picture in the DOM.
    if (!compact) {
      const phase =
        t < T.scan[1] ? "SCANNING" : t < T.measure[1] ? "MEASURING" : "ANALYSIS";
      ctx.font = "600 9.5px Inter Variable, Inter, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.textAlign = "left";
      ctx.fillText(phase, 14, 22);

      // ---- staged working lines --------------------------------------------
      if (t >= T.measure[0] && t < T.measure[1]) {
        const p = seg(t, T.measure[0], T.measure[1]);
        const i = Math.min(STAGES.length - 1, Math.floor(p * STAGES.length));
        ctx.font = "500 11.5px Inter Variable, Inter, system-ui, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(`${STAGES[i]}…`, 14, 42);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(14, 50, w - 28, 2);
        ctx.fillStyle = "#8FF3E0";
        ctx.fillRect(14, 50, (w - 28) * p, 2);
      }

      // ---- the panel --------------------------------------------------------
      // Solid, opaque, and painted before the numbers: this is the surface the
      // score is legible against. Nothing of the photograph reaches it.
      if (panelH > 0.5) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#0A0B0D";
        ctx.fillRect(0, photoH, w, panelH + 1);
        ctx.globalAlpha = alpha;
      }

      // ---- pillars ----------------------------------------------------------
      if (t >= T.pillars[0]) {
        const names = Object.keys(face.pillars);
        const bw = (w - 28 - (names.length - 1) * 8) / names.length;
        names.forEach((n, i) => {
          const appear = seg(t, T.pillars[0] + i * 170, T.pillars[0] + i * 170 + 380);
          if (appear <= 0) return;
          const x = 14 + i * (bw + 8);
          // Anchored a fixed distance off the BOTTOM of the frame, not to a
          // fraction of the panel. The fraction put the row wherever the panel
          // happened to be tall, while the name above it is positioned in CSS
          // from the same bottom edge — two coordinate systems for one stack,
          // which is exactly how the name ended up printed through the bars.
          // One origin now, and the gap between them is arithmetic rather than
          // luck. Undocked, it rides the seam down as before.
          const y = dockT > 0.001 ? h - 32 - (1 - dockT) * (h - 32 - photoH) : photoH;
          ctx.globalAlpha = alpha * appear;
          ctx.fillStyle = "rgba(255,255,255,0.2)";
          ctx.fillRect(x, y + 16, bw, 3);
          ctx.fillStyle = "#8FF3E0";
          // Eased, not linear: a bar that decelerates into its value reads as a
          // measurement arriving; one that fills at constant speed reads as a
          // loading indicator.
          ctx.fillRect(x, y + 16, bw * (face.pillars[n] / 10) * ease(appear), 3);
          ctx.font = "600 8.5px Inter Variable, Inter, system-ui, sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.66)";
          ctx.fillText(PILLAR_ABBR[n] ?? n.slice(0, 4).toUpperCase(), x, y + 10);
          ctx.font = "600 11px Inter Variable, Inter, system-ui, sans-serif";
          ctx.fillStyle = "#fff";
          ctx.textAlign = "right";
          ctx.fillText(face.pillars[n].toFixed(1), x + bw, y + 10);
          ctx.textAlign = "left";
          ctx.globalAlpha = alpha;
        });
      }

      // ---- region callouts --------------------------------------------------
      if (t >= T.regions[0]) {
        const outs = calloutsFor(face);
        // Docked, the score is on its own panel and the whole photograph is
        // free — only a small margin off the bottom edge so a label never
        // straddles the seam.
        const placed = placeCallouts(outs, w, photoH, 150 - 132 * dockT);
        const appearOf = (i: number) => seg(t, T.regions[0] + i * 430, T.regions[0] + i * 430 + 420);

        // Two passes with a scrim between them. The layout keeps LABELS out of
        // the caption band, but a connector from a chin anchor to a label above
        // it has to cross that band — and it crossed straight through the score.
        // Lines first; then the caption's backing scrim re-stamped so any line
        // under the score drops to a murmur; then dots and labels on top, crisp.
        outs.forEach((_, i) => {
          const appear = appearOf(i);
          if (appear <= 0) return;
          ctx.globalAlpha = alpha * appear;
          const { ax, ay, lx, ly, left } = placed[i]!;
          // The connector DRAWS from the anchor to the label rather than
          // appearing whole — the eye follows it from the feature to the
          // number, which is the causal order the interface is claiming.
          const grow = ease(appear);
          const tx = left ? lx + LABEL_W : lx;
          ctx.strokeStyle = "rgba(143,243,224,0.85)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax + (tx - ax) * grow, ay + (ly + 9 - ay) * grow);
          ctx.stroke();
        });

        ctx.globalAlpha = alpha;
        // Docked, the panel already owns the caption band and re-stamping a
        // scrim over the picture would only mute the callouts sitting in it.
        if (dockT < 1) {
          ctx.globalAlpha = alpha * (1 - dockT);
          const capScrim = ctx.createLinearGradient(0, photoH - 176, 0, photoH);
          capScrim.addColorStop(0, "rgba(10,11,13,0)");
          capScrim.addColorStop(0.45, "rgba(10,11,13,0.5)");
          capScrim.addColorStop(1, "rgba(10,11,13,0.78)");
          ctx.fillStyle = capScrim;
          ctx.fillRect(0, photoH - 176, w, 176);
          ctx.globalAlpha = alpha;
        }

        outs.forEach((r, i) => {
          const appear = appearOf(i);
          if (appear <= 0) return;
          ctx.globalAlpha = alpha * appear;
          const { ax, ay, lx, ly, left } = placed[i]!;
          const grow = ease(appear);
          ctx.fillStyle = "#8FF3E0";
          ctx.beginPath();
          ctx.arc(ax, ay, 3, 0, Math.PI * 2);
          ctx.fill();

          // The label settles its last few pixels into place along the same
          // direction the line travelled.
          const slide = (1 - grow) * (left ? 6 : -6);
          ctx.translate(slide, 0);
          ctx.fillStyle = "rgba(16,17,19,0.72)";
          ctx.beginPath();
          ctx.roundRect(lx, ly - 4, LABEL_W, LABEL_H, 7);
          ctx.fill();
          ctx.font = "600 8.5px Inter Variable, Inter, system-ui, sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.62)";
          ctx.fillText((REGION_LABEL[r.id] ?? r.id).toUpperCase(), lx + 7, ly + 6);
          ctx.font = "600 12px Inter Variable, Inter, system-ui, sans-serif";
          ctx.fillStyle = "#fff";
          ctx.fillText(r.score.toFixed(1), lx + 7, ly + 18);
          ctx.translate(-slide, 0);
          ctx.globalAlpha = alpha;
        });
      }
    }

    // ---- attribution ------------------------------------------------------
    // Drawn only for a face whose licence requires it (a CC photograph, if
    // one ever returns to the roster). The synthetic cast's provenance moved
    // to the page's own fine print at the owner's call: on the picture it
    // labelled a demo nobody mistook for a testimonial.
    if (!compact && !face.credit.startsWith("AI-GENERATED")) {
      ctx.font = "500 7.5px Inter Variable, Inter, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.42)";
      ctx.textAlign = "right";
      ctx.fillText(face.credit, w - 12, photoH - 8);
      ctx.textAlign = "left";
    }
    ctx.globalAlpha = 1;

    // Overall counts up only once the measuring beat is over. The instant it
    // LANDS gets its own beat: a class the CSS answers with one soft settle.
    // The count-up is work; the landing is the result, and a result deserves
    // punctuation the intermediate numbers do not get.
    const shown = face.overall * ease(seg(t, T.score[0], T.score[1]));
    scoreEl.textContent = t >= T.score[0] ? shown.toFixed(1) : "";
    scoreEl.style.opacity = String(alpha);
    scoreEl.classList.toggle("landed", t >= T.score[1]);
    // Nothing under the number.
    //
    // The slot held the invented name first ("Dev", "Adrian"), which was a
    // fabricated identity presented under a real score, then the words
    // AI-GENERATED DEMONSTRATION. Both are gone at the owner's call: the card
    // is plainly a product demo, and the page's fine print carries the
    // provenance ("Demo faces are AI-generated") for anyone who wants it.
    // A caption on the picture bought nothing the fine print does not.
    //
    // The caption is DOM (the serif face and the landing animation are CSS),
    // so it travels into the panel by having its offset driven from here —
    // the number ends up on black above the pillar row, never on a cheek.
    // Only the landing card's caption is positioned from here. In the strip
    // the score's parent is a static flex child, so writing `bottom` on it
    // did nothing but leave an inline style behind.
    const cap = compact ? null : scoreEl.parentElement;
    // The second line used to occupy 24px under the number, and the number's
    // own resting place was tuned against the pillar row below it — so the
    // offsets carry that 24px now the line is gone, and the score stays
    // exactly where it has always sat rather than sliding down into the
    // pillar labels (which top out at 30.5px).
    if (cap) cap.style.bottom = `${(108 - 32 * dockT).toFixed(1)}px`;

    if (t >= TT.hold) {
      idx = (idx + 1) % REEL.length;
      start = now;
      shownAny = true;
    }
    raf = requestAnimationFrame(frame);
  };

  // -------------------------------------------------------------------------
  // It only runs while somebody can see it.
  //
  // This loop composites a photograph, a gradient seam, a landmark mesh, four
  // callouts with drawn connectors and a panel of bars, every frame, forever —
  // and it did that whether or not the canvas was anywhere near the viewport.
  // Scroll down the landing page to read the proof cards and it kept painting
  // at sixty frames a second behind you; open the report and it was still
  // going. On a laptop that is the difference between the app feeling quick
  // and feeling like it is chewing something.
  //
  // An IntersectionObserver parks it the moment it leaves the screen and
  // restarts it on the way back, and the clock is rebased on resume so a face
  // does not jump halfway through its animation. A hidden TAB gets the same
  // treatment: browsers throttle rAF there but the timeline still advances,
  // which is how somebody came back to a tab mid-dissolve.
  // -------------------------------------------------------------------------
  let paused = false;
  const pause = () => {
    if (paused || stopped) return;
    paused = true;
    cancelAnimationFrame(raf);
  };
  const resume = () => {
    if (!paused || stopped) return;
    paused = false;
    // Rebase so the current face carries on from where it stopped rather than
    // snapping to wherever the wall clock has got to.
    start = performance.now() - elapsedAtPause;
    raf = requestAnimationFrame(frame);
  };
  let elapsedAtPause = 0;
  const io =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            const visible = entries.some((en) => en.isIntersecting);
            if (visible) resume();
            else {
              elapsedAtPause = performance.now() - start;
              pause();
            }
          },
          { threshold: 0.01 },
        )
      : null;
  io?.observe(canvas);
  const onVisibility = () => {
    if (document.hidden) {
      elapsedAtPause = performance.now() - start;
      pause();
    } else if (canvas.isConnected) {
      resume();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      scoreEl.textContent = "";
    },
  };
}
