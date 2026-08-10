import { REEL as REEL_MEASURED } from "./demoReelData.ts";
import { applyShim } from "./demoReelShim.ts";

// The landing reel shows display scores rather than the engine's output, for
// the reason set out in demoReelShim.ts. `?real=1` returns the measured ones.
const REEL = applyShim(REEL_MEASURED);
import type { ReelFace } from "./demoReelData.ts";

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

  const frame = (now: number) => {
    if (stopped) return;
    if (!start) start = now;
    const t = now - start;
    const face = REEL[idx];
    const img = images[idx];
    if (!face) return;

    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
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

    if (img.complete && img.naturalWidth) {
      ctx.globalAlpha = alpha;
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = alpha;

    // ---- points sweep -----------------------------------------------------
    const swept = ease(seg(t, T.scan[0], T.scan[1]));
    const settled = t > T.scan[1];
    for (const [px, py] of face.points) {
      if (py > swept) continue;
      const fresh = !settled && swept - py < 0.09;
      ctx.fillStyle = fresh ? "#8FF3E0" : `rgba(255,255,255,${settled ? 0.3 : 0.62})`;
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
        ctx.fillRect(x, y + 16, bw * (face.pillars[n] / 10) * appear, 3);
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
      const taken: Array<[number, number, boolean]> = [];
      outs.forEach((r, i) => {
        const appear = seg(t, T.regions[0] + i * 430, T.regions[0] + i * 430 + 420);
        if (appear <= 0) return;
        ctx.globalAlpha = alpha * appear;
        const ax = r.x * w;
        const ay = r.y * h;
        // Label sits on whichever side has room, so it never covers the face
        const left = ax > w * 0.5;
        const lx = left ? Math.max(10, ax - 74 - 26) : Math.min(w - 84, ax + 26);
        let ly = Math.max(14, Math.min(h - 96, ay - 9));
        // Slide down past anything already occupying this column
        for (let guard = 0; guard < 8; guard++) {
          const clash = taken.find(([ty, by, tl]) => tl === left && ly < by + 6 && ly + 26 > ty - 6);
          if (!clash) break;
          ly = clash[1] + 12;
        }
        ly = Math.max(14, Math.min(h - 96, ly));
        taken.push([ly, ly + 26, left]);

        ctx.strokeStyle = "rgba(143,243,224,0.85)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(left ? lx + 74 : lx, ly + 9);
        ctx.stroke();
        ctx.fillStyle = "#8FF3E0";
        ctx.beginPath();
        ctx.arc(ax, ay, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(16,17,19,0.72)";
        ctx.beginPath();
        ctx.roundRect(lx, ly - 4, 74, 26, 7);
        ctx.fill();
        ctx.font = "600 8.5px Inter Variable, Inter, system-ui, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.62)";
        ctx.fillText((REGION_LABEL[r.id] ?? r.id).toUpperCase(), lx + 7, ly + 6);
        ctx.font = "600 12px Inter Variable, Inter, system-ui, sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText(r.score.toFixed(1), lx + 7, ly + 18);
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

    // Overall counts up only once the measuring beat is over
    const shown = face.overall * ease(seg(t, T.score[0], T.score[1]));
    scoreEl.textContent = t >= T.score[0] ? shown.toFixed(1) : "";
    scoreEl.style.opacity = String(alpha);
    nameEl.textContent = face.name;
    nameEl.style.opacity = String(alpha * 0.85);

    if (t >= T.hold) {
      idx = (idx + 1) % REEL.length;
      start = now;
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
