import { REEL } from "./demoReelData.ts";

// Landing-page demo reel: rattles through real scans — face in, points sweep
// across it, score lands, next. These are the engine's actual outputs on
// public-domain portraits, so the demo is the product rather than a mock-up.

const HOLD_MS = 1650;
const SWEEP_MS = 850;

export interface ReelHandle {
  stop(): void;
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

    // Cross-fade in, hold, fade out
    const fadeIn = Math.min(1, t / 260);
    const fadeOut = t > HOLD_MS - 220 ? Math.max(0, (HOLD_MS - t) / 220) : 1;
    const alpha = Math.min(fadeIn, fadeOut);

    if (img.complete && img.naturalWidth) {
      ctx.globalAlpha = alpha;
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    }

    // Points sweep top-to-bottom across the face
    const sweep = Math.min(1, Math.max(0, (t - 160) / SWEEP_MS));
    const eased = 1 - Math.pow(1 - sweep, 2);
    ctx.globalAlpha = alpha;
    for (const [px, py] of face.points) {
      if (py > eased) continue;
      const x = px * w;
      const y = py * h;
      const fresh = eased - py < 0.09;
      ctx.fillStyle = fresh ? "#8FF3E0" : "rgba(255,255,255,0.62)";
      ctx.beginPath();
      ctx.arc(x, y, fresh ? 2.4 : 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Scan line riding the leading edge
    if (sweep > 0 && sweep < 1) {
      const y = eased * h;
      const g = ctx.createLinearGradient(0, y - 26, 0, y + 2);
      g.addColorStop(0, "rgba(143,243,224,0)");
      g.addColorStop(1, "rgba(143,243,224,0.85)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 26, w, 27);
    }
    ctx.globalAlpha = 1;

    // Score counts up as the sweep completes
    const shown = (face.overall * Math.min(1, sweep * 1.15)).toFixed(1);
    scoreEl.textContent = shown;
    scoreEl.style.opacity = String(alpha);
    nameEl.textContent = face.name;
    nameEl.style.opacity = String(alpha * 0.85);

    if (t >= HOLD_MS) {
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
