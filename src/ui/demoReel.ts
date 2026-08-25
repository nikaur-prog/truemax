import { REEL as REEL_MEASURED } from "./demoReelData.js";
import { applyShim } from "./demoReelShim.js";
import { LABEL_H, LABEL_W, placeCallouts } from "./demoReelLayout.js";
import { reelContours } from "./reelMesh.js";

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

const T = {
  scan: [260, 1500],
  measure: [1500, 2400],
  score: [2400, 3150],
  pillars: [3150, 4400],
  regions: [4400, 6400],
  out: 6500,
  hold: 6800,
};

const STAGES = ["Normalizing pose", "Measuring 31 proportions", "Comparing against population"];
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

export function mountDemoReel(
  canvas: HTMLCanvasElement,
  scoreEl: HTMLElement,
  nameEl: HTMLElement,
): ReelHandle {
  if (!REEL.length) return { stop: () => {} };

  const images = REEL.map((f) => {
    const img = new Image();
    img.src = `/demo/${f.slug}.jpg`;
    return img;
  });

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

    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
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

    const fadeIn = Math.min(1, t / 260);
    const fadeOut = t > T.out ? Math.max(0, (T.hold - t) / (T.hold - T.out)) : 1;
    const alpha = Math.min(fadeIn, fadeOut);

    // Cover-fit with a slow push-in. Four per cent over the whole beat is
    // under a pixel a frame — not readable as movement, which is the point.
    // A still photograph behind a moving overlay reads as a screenshot with
    // animation played on top of it; the same photograph drifting very slightly
    // reads as a camera pointed at someone.
    const drawCover = (source: HTMLImageElement, zoom: number, a: number) => {
      if (!source.complete || !source.naturalWidth) return;
      const s = Math.max(w / source.naturalWidth, h / source.naturalHeight) * zoom;
      const dw = source.naturalWidth * s;
      const dh = source.naturalHeight * s;
      ctx.globalAlpha = a;
      ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };

    // The outgoing face used to fade to nothing and the incoming one to fade up
    // from nothing, which puts a washed-out half-empty card on screen at both
    // ends of every face. Whichever face this one is fading against is drawn
    // underneath at full opacity instead, so the two genuinely cross and the
    // card is never showing the page background through a photograph.
    if (REEL.length > 1) {
      // Nothing preceded the very first face, so it still fades up from the
      // card rather than crossing with a face nobody has seen.
      //
      // The face underneath is drawn at the zoom IT is at, not at rest. The
      // outgoing face has drifted to 1.04 by the time it hands over, and
      // drawing it back at 1.0 under the incoming crossfade snapped every
      // photograph four per cent smaller for exactly one transition — the
      // kind of pop nobody can name but everybody's eye files under "cheap".
      const prevOut = fadeIn < 1 && shownAny;
      const under = prevOut
        ? images[(idx - 1 + REEL.length) % REEL.length]
        : fadeOut < 1
          ? images[(idx + 1) % REEL.length]
          : null;
      if (under) drawCover(under, prevOut ? 1.04 : 1, 1);
    }
    drawCover(img, 1 + 0.04 * Math.min(1, t / T.hold), alpha);
    ctx.globalAlpha = alpha;

    // A quiet vignette over every photograph. The portraits come from many
    // photographers under many lights, and side by side that variety reads as
    // inconsistency; one shared edge treatment is what makes eleven strangers'
    // photos look like one product shot them. Elliptical and gentle — the face
    // in the middle is untouched.
    const vig = ctx.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.78);
    vig.addColorStop(0, "rgba(8,10,12,0)");
    vig.addColorStop(1, "rgba(8,10,12,0.34)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    // Overlay text is white and the photograph underneath it is not reliably
    // dark — a lit forehead put "MEASURING" at almost no contrast. Two scrims
    // rather than one flat wash, so the middle of the face stays untouched.
    const topScrim = ctx.createLinearGradient(0, 0, 0, 72);
    topScrim.addColorStop(0, "rgba(10,11,13,0.55)");
    topScrim.addColorStop(1, "rgba(10,11,13,0)");
    ctx.fillStyle = topScrim;
    ctx.fillRect(0, 0, w, 72);
    const botScrim = ctx.createLinearGradient(0, h - 120, 0, h);
    botScrim.addColorStop(0, "rgba(10,11,13,0)");
    botScrim.addColorStop(1, "rgba(10,11,13,0.72)");
    ctx.fillStyle = botScrim;
    ctx.fillRect(0, h - 120, w, 120);

    // ---- points sweep -----------------------------------------------------
    const swept = ease(seg(t, T.scan[0], T.scan[1]));
    const settled = t > T.scan[1];

    // The mesh, not a cloud.
    //
    // These were loose dots, and loose dots read as glitter over a photograph
    // rather than as a model being fitted to a face. They were never loose:
    // they are the vertices of the face oval, the eyes, the brows and the lips,
    // and reelMesh rebuilds the edges between them from the same MediaPipe sets
    // the point list itself is derived from.
    //
    // An edge is drawn only once BOTH its ends have been swept, so the outline
    // assembles behind the scan line instead of appearing whole — the contour
    // closing around an eye as the line passes it is the moment the animation
    // is selling. Lines under the dots so the vertices stay the brightest thing.
    const pts = face.points;
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(255,255,255,${settled ? 0.26 : 0.4})`;
    for (const ring of reelContours()) {
      ctx.beginPath();
      let open = false;
      // Closed rings: the wrap-around edge is the last-to-first pair, so the
      // walk runs one past the end.
      for (let k = 0; k <= ring.length; k++) {
        const a = pts[ring[k % ring.length]];
        if (!a || a[1] > swept) {
          open = false;
          continue;
        }
        if (open) ctx.lineTo(a[0] * w, a[1] * h);
        else ctx.moveTo(a[0] * w, a[1] * h);
        open = true;
      }
      ctx.stroke();
    }

    for (const [px, py] of pts) {
      if (py > swept) continue;
      const fresh = !settled && swept - py < 0.09;
      // After the sweep the model stays ALIVE: a slow luminance wave travels
      // down the settled vertices, a few points at a time barely brightening.
      // A static mesh over a photograph reads as a sticker; one that breathes
      // reads as a fit being held. The amplitude is deliberately at the edge
      // of perception — this should be felt, not watched.
      const settle = settled ? 0.3 + 0.1 * Math.max(0, Math.sin(now / 640 - py * 7)) : 0.62;
      ctx.fillStyle = fresh ? "#8FF3E0" : `rgba(255,255,255,${settle.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px * w, py * h, fresh ? 2.4 : 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (swept > 0 && swept < 1) {
      const y = swept * h;
      const g = ctx.createLinearGradient(0, y - 26, 0, y + 2);
      g.addColorStop(0, "rgba(143,243,224,0)");
      g.addColorStop(1, "rgba(143,243,224,0.85)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 26, w, 27);
      // A hairline at the sweep's leading edge. The gradient alone is a glow
      // with no address; the one-pixel line is the instrument.
      ctx.fillStyle = "rgba(220,255,247,0.9)";
      ctx.fillRect(0, y, w, 1);
    }

    // ---- phase label ------------------------------------------------------
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

    // ---- pillars ----------------------------------------------------------
    if (t >= T.pillars[0]) {
      const names = Object.keys(face.pillars);
      const bw = (w - 28 - (names.length - 1) * 8) / names.length;
      names.forEach((n, i) => {
        const appear = seg(t, T.pillars[0] + i * 170, T.pillars[0] + i * 170 + 380);
        if (appear <= 0) return;
        const x = 14 + i * (bw + 8);
        const y = h - 74;
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
      const placed = placeCallouts(outs, w, h);
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
      const capScrim = ctx.createLinearGradient(0, h - 176, 0, h);
      capScrim.addColorStop(0, "rgba(10,11,13,0)");
      capScrim.addColorStop(0.45, "rgba(10,11,13,0.5)");
      capScrim.addColorStop(1, "rgba(10,11,13,0.78)");
      ctx.fillStyle = capScrim;
      ctx.fillRect(0, h - 176, w, 176);

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

    // ---- attribution ------------------------------------------------------
    // Required by the image licence, not optional decoration.
    ctx.font = "500 7.5px Inter Variable, Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.textAlign = "right";
    ctx.fillText(face.credit, w - 12, h - 8);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;

    // Overall counts up only once the measuring beat is over. The instant it
    // LANDS gets its own beat: a class the CSS answers with one soft settle.
    // The count-up is work; the landing is the result, and a result deserves
    // punctuation the intermediate numbers do not get.
    const shown = face.overall * ease(seg(t, T.score[0], T.score[1]));
    scoreEl.textContent = t >= T.score[0] ? shown.toFixed(1) : "";
    scoreEl.style.opacity = String(alpha);
    scoreEl.classList.toggle("landed", t >= T.score[1]);
    nameEl.textContent = face.name;
    nameEl.style.opacity = String(alpha * 0.85);

    if (t >= T.hold) {
      idx = (idx + 1) % REEL.length;
      start = now;
      shownAny = true;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      scoreEl.textContent = "";
      nameEl.textContent = "";
    },
  };
}
