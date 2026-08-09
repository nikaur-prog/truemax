import type { Pt } from "../engine/geometry.ts";
import { SIDE_POINTS } from "../engine/sideMetrics.ts";
import type { SidePointId, SidePoints } from "../engine/sideMetrics.ts";

// Drag-to-verify landmark editor for the side profile. MediaPipe can't place
// true-profile landmarks reliably, so the app seeds a best guess from the
// silhouette and the user corrects it — "verify your landmarks for accuracy".

export interface VerifyHandle {
  points: SidePoints;
  faceDir: number; // +1 subject faces image-right, -1 image-left
  destroy(): void;
}

// Seed guesses from the face silhouette: trace the profile edge, then place
// points at anatomically-proportional heights along it. Rough by design —
// the user drags them into place.
export function seedFromSilhouette(
  canvas: HTMLCanvasElement,
): { points: SidePoints; faceDir: number } {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, w, h).data;

  // Column-wise "is this pixel likely skin/face" mass, used to find which
  // side of the frame the face points toward.
  const isFace = (i: number) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return r > 70 && r > g && g > b * 0.85 && r - b > 12;
  };

  let leftMass = 0;
  let rightMass = 0;
  for (let y = Math.floor(h * 0.15); y < h * 0.85; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      if (!isFace(i)) continue;
      if (x < w / 2) leftMass++;
      else rightMass++;
    }
  }
  // The face profile edge lies on the side with less mass (hair/skull fills
  // the other side), so the subject faces toward the emptier half.
  const faceDir = rightMass < leftMass ? 1 : -1;

  // Find the profile edge x at a set of heights
  const edgeAt = (yFrac: number): number => {
    const y = Math.round(h * yFrac);
    if (faceDir === 1) {
      for (let x = w - 1; x >= 0; x--) if (isFace((y * w + x) * 4)) return x;
      return w * 0.75;
    }
    for (let x = 0; x < w; x++) if (isFace((y * w + x) * 4)) return x;
    return w * 0.25;
  };

  // Vertical anchors as fractions of frame height, tuned for a head-filling
  // portrait; the user corrects from here.
  const P: Array<[SidePointId, number, number]> = [
    ["trichion", 0.16, 0.0],
    ["glabella", 0.34, 0.0],
    ["nasion", 0.40, 0.015],
    ["pronasale", 0.52, -0.01],
    ["subnasale", 0.60, 0.02],
    ["labialeSuperius", 0.65, 0.02],
    ["labialeInferius", 0.71, 0.02],
    ["pogonion", 0.80, 0.015],
    ["menton", 0.86, 0.04],
    ["gonion", 0.76, 0.30],
    ["condylion", 0.46, 0.34],
    ["cervicale", 0.92, 0.16],
    ["tragion", 0.50, 0.30],
  ];

  const points = {} as SidePoints;
  for (const [id, yFrac, inset] of P) {
    const ex = edgeAt(yFrac);
    points[id] = { x: ex - faceDir * inset * w, y: h * yFrac };
  }
  return { points, faceDir };
}

export function mountVerifier(
  host: HTMLElement,
  photo: HTMLCanvasElement,
  seed: { points: SidePoints; faceDir: number },
  onChange: (p: SidePoints) => void,
): VerifyHandle {
  const points: SidePoints = { ...seed.points };
  host.innerHTML = "";
  host.classList.add("verify-layer");

  const labelEl = document.createElement("div");
  labelEl.className = "verify-hint";
  host.appendChild(labelEl);

  const handles = new Map<SidePointId, HTMLElement>();
  for (const spec of SIDE_POINTS) {
    const el = document.createElement("button");
    el.className = "vpoint";
    el.type = "button";
    el.dataset.id = spec.id;
    el.setAttribute("aria-label", spec.label);
    el.innerHTML = `<i></i><span>${spec.label}</span>`;
    host.appendChild(el);
    handles.set(spec.id, el);
  }

  const place = () => {
    for (const [id, el] of handles) {
      el.style.left = `${(points[id].x / photo.width) * 100}%`;
      el.style.top = `${(points[id].y / photo.height) * 100}%`;
    }
  };
  place();

  let dragging: SidePointId | null = null;
  const toPhoto = (clientX: number, clientY: number): Pt => {
    const r = host.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * photo.width,
      y: ((clientY - r.top) / r.height) * photo.height,
    };
  };

  const down = (e: PointerEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(".vpoint");
    if (!target) return;
    dragging = target.dataset.id as SidePointId;
    target.classList.add("grabbing");
    labelEl.textContent = SIDE_POINTS.find((s) => s.id === dragging)?.hint ?? "";
    labelEl.classList.add("show");
    host.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const p = toPhoto(e.clientX, e.clientY);
    points[dragging] = {
      x: Math.max(0, Math.min(photo.width, p.x)),
      y: Math.max(0, Math.min(photo.height, p.y)),
    };
    place();
    onChange(points);
  };
  const up = () => {
    if (!dragging) return;
    handles.get(dragging)?.classList.remove("grabbing");
    dragging = null;
    labelEl.classList.remove("show");
  };

  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);

  return {
    points,
    faceDir: seed.faceDir,
    destroy() {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.innerHTML = "";
      host.classList.remove("verify-layer");
    },
  };
}
