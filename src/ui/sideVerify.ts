import type { Pt } from "../engine/geometry.ts";
import { SIDE_POINTS } from "../engine/sideMetrics.ts";
import type { SidePointId, SidePoints } from "../engine/sideMetrics.ts";
import { detect } from "../engine/landmarker.ts";

// Drag-to-verify landmark editor for the side profile. MediaPipe can't place
// true-profile landmarks reliably, so the app seeds a best guess from the
// silhouette and the user corrects it — "verify your landmarks for accuracy".

export interface VerifyHandle {
  points: SidePoints;
  faceDir: number; // +1 subject faces image-right, -1 image-left
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Seeding the thirteen points.
//
// The first version of this scattered points onto the wall behind the subject,
// and it did so for two separate reasons that are worth naming, because both
// are easy to write again.
//
// ONE: it decided which way the face pointed by comparing pixel mass in the
// left half of the FRAME against the right half. What that measures is where
// the person is standing, not which way they are looking. Someone standing
// left of centre and facing left was read as facing right, and every point
// went to the opposite side of the picture.
//
// TWO: it found the profile edge by scanning inward from the frame border for
// the first "skin-coloured" pixel, using fixed RGB thresholds — r > 70, r > g,
// r - b > 12. A beige wall passes that. So the scan stopped on the first column
// it touched and the edge came back as the frame border. Warm indoor lighting
// makes almost any wall qualify.
//
// The replacement never asks whether a pixel looks like skin. It asks whether a
// pixel looks like the BACKGROUND, which is a question the image itself can
// answer: sample the top corners, which in a portrait are background by
// construction, and call anything far from that colour foreground. That has the
// side benefit of being independent of skin tone, which the old test was not —
// a fixed r - b > 12 threshold is a statement about complexion.
// ---------------------------------------------------------------------------

// Downsampled working resolution. The silhouette is a shape, not a texture.
const TRACE_W = 200;

// Landmark-box width over height, below which the mesh is not to be trusted for
// seeding. A frontal face lands near 0.75; a true profile projects far narrower,
// and that is exactly the range where MediaPipe keeps answering confidently and
// stops being correct.
const MESH_TRUSTED_ASPECT = 0.62;

interface Mask {
  fg: Uint8Array;
  w: number;
  h: number;
}

// Foreground mask by distance from a background colour model built from the
// top corners of the frame.
function foregroundMask(canvas: HTMLCanvasElement): Mask {
  const w = TRACE_W;
  const h = Math.max(8, Math.round((canvas.height / canvas.width) * TRACE_W));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d", { willReadFrequently: true })!;
  cx.drawImage(canvas, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;

  // Background samples: the top-left and top-right corner blocks. A head fills
  // the middle of a portrait and the shoulders fill the bottom, so the top
  // corners are the only two regions that are background in essentially every
  // framing. Kept as two separate models rather than one average, because a
  // window on one side and a wall on the other are genuinely two backgrounds
  // and averaging them describes neither.
  const corner = (x0: number, y0: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y0 + Math.round(h * 0.14); y++) {
      for (let x = x0; x < x0 + Math.round(w * 0.16); x++) {
        const i = (y * w + x) * 4;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };
  const bgs = [corner(0, 0), corner(w - Math.round(w * 0.16), 0)];

  // Spread of the background itself, so a busy background raises the bar
  // rather than turning every pixel into foreground.
  let spread = 0;
  let sn = 0;
  for (let y = 0; y < Math.round(h * 0.14); y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let best = Infinity;
      for (const bg of bgs) {
        best = Math.min(best, Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]));
      }
      spread += best;
      sn++;
    }
  }
  const thresh = Math.max(34, (spread / Math.max(1, sn)) * 2.4);

  const fg = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    let best = Infinity;
    for (const bg of bgs) {
      best = Math.min(best, Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]));
    }
    fg[p] = best > thresh ? 1 : 0;
  }
  return { fg, w, h };
}

// Anchors as fractions of HEAD height. The original table was in FRAME
// fractions, which only lands correctly when the head happens to fill the frame
// from 16% to 86% and puts every point somewhere else otherwise. Insets — how
// far in from the silhouette edge a point sits — are in head heights too.
const ANCHORS: Array<[SidePointId, number, number]> = [
  ["trichion", 0.02, 0.0],
  ["glabella", 0.30, 0.0],
  ["nasion", 0.38, 0.02],
  ["pronasale", 0.55, -0.01],
  ["subnasale", 0.66, 0.03],
  ["labialeSuperius", 0.72, 0.03],
  ["labialeInferius", 0.80, 0.03],
  ["pogonion", 0.92, 0.02],
  ["menton", 0.99, 0.05],
  ["gonion", 0.88, 0.42],
  ["condylion", 0.48, 0.48],
  ["cervicale", 1.06, 0.22],
  ["tragion", 0.53, 0.42],
];

// No usable silhouette: lay the same anchors over a head box occupying the
// middle of the frame, facing right. Wrong in detail, but on the face.
function centredSeed(w: number, h: number): { points: SidePoints; faceDir: number } {
  const headH = h * 0.7;
  const top = h * 0.13;
  const edge = w * 0.66;
  const points = {} as SidePoints;
  for (const [id, f, inset] of ANCHORS) {
    points[id] = { x: edge - inset * headH, y: top + f * headH };
  }
  return { points, faceDir: 1 };
}

// ---------------------------------------------------------------------------
// Preferred path: real landmarks.
//
// The side capture opens the shutter at 42 degrees of yaw, and MediaPipe holds
// a face well past that — it tracked a 46-degree turn in the reference set. So
// a good proportion of side photographs still carry a full mesh, and when they
// do, tracing a silhouette against the background instead is throwing away the
// better measurement for the worse one.
//
// Every point below is a named landmark rather than a fraction of head height,
// so the seed lands on the anatomy instead of near it. The paired ones — ear,
// jaw corner — are chosen by depth: MediaPipe's z is smaller toward the camera,
// so the near side of the head is the one with the smaller z, which is the side
// actually visible in a profile.
// ---------------------------------------------------------------------------
function seedFromLandmarks(
  canvas: HTMLCanvasElement,
): { points: SidePoints; faceDir: number } | null {
  let lm;
  try {
    lm = detect(canvas)?.faceLandmarks?.[0];
  } catch {
    return null;
  }
  if (!lm || lm.length < 468) return null;

  // The mesh has to be TRUSTWORTHY, not merely present.
  //
  // MediaPipe keeps returning a full mesh well past the angle at which it stops
  // being right — it does not report "I am guessing". Past roughly 55 degrees
  // the far half of the face is invented, and the named landmarks drift off the
  // profile edge and onto the cheek. Seeding from that is worse than not using
  // it, because it is confidently wrong in a way the silhouette trace is not.
  //
  // The tell is the mesh's own width. A face turned to a true profile projects
  // narrow; one the detector thinks is near-frontal projects wide. Below this
  // ratio of landmark-box width to height, the mesh is describing a turn it
  // cannot actually resolve, so the trace takes over.
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const aspect = (x1 - x0) / Math.max(1e-6, y1 - y0);
  if (aspect < MESH_TRUSTED_ASPECT) return null;

  const w = canvas.width;
  const h = canvas.height;
  const P = (i: number): Pt => ({ x: lm[i].x * w, y: lm[i].y * h });

  // Which way the face points, straight from the geometry: the nose tip sits
  // ahead of the head's own centre, on the side the face is turned toward. No
  // sign convention to get wrong and no silhouette to trace.
  let cx = 0;
  for (const p of lm) cx += p.x / lm.length;
  const faceDir = lm[1].x >= cx ? 1 : -1;

  // Near side of the head, by depth.
  const near = (a: number, b: number) => ((lm[a].z ?? 0) <= (lm[b].z ?? 0) ? a : b);
  const tragionId = near(234, 454);
  const gonionId = near(172, 397);
  const condylionId = near(127, 356);

  const menton = P(152);
  const pogonion = P(175);
  // The neck point has no landmark: it is below the jaw where the underside
  // meets the throat. Placed by stepping down and back from the chin, which is
  // the one point here the user will usually still need to nudge.
  const faceH = Math.hypot(menton.x - P(168).x, menton.y - P(168).y) || 1;
  const cervicale = {
    x: menton.x - faceDir * faceH * 0.30,
    y: menton.y + faceH * 0.24,
  };

  const points: SidePoints = {
    trichion: P(10),
    glabella: P(9),
    nasion: P(168),
    pronasale: P(1),
    subnasale: P(2),
    labialeSuperius: P(0),
    labialeInferius: P(17),
    pogonion,
    menton,
    gonion: P(gonionId),
    condylion: P(condylionId),
    cervicale,
    tragion: P(tragionId),
  };
  return { points, faceDir };
}

// Entry point. Real landmarks when the detector can still see the face, the
// silhouette trace when it cannot.
export function seedSidePoints(
  canvas: HTMLCanvasElement,
): { points: SidePoints; faceDir: number } {
  return seedFromLandmarks(canvas) ?? seedFromSilhouette(canvas);
}

// Fallback: trace the profile edge against the background, then place points at
// anatomically-proportional heights along it. Rough by design — the user drags
// them into place.
export function seedFromSilhouette(
  canvas: HTMLCanvasElement,
): { points: SidePoints; faceDir: number } {
  const w = canvas.width;
  const h = canvas.height;
  const m = foregroundMask(canvas);
  const at = (x: number, y: number) => m.fg[y * m.w + x] === 1;

  // Head band: the upper part of the foreground, above the shoulders. Rows are
  // scanned for their foreground extent, and the head is where that extent is
  // narrow — shoulders are wide.
  const rowSpan = (y: number): [number, number] | null => {
    let a = -1;
    let b = -1;
    for (let x = 0; x < m.w; x++) if (at(x, y)) { a = x; break; }
    for (let x = m.w - 1; x >= 0; x--) if (at(x, y)) { b = x; break; }
    return a < 0 || b < a ? null : [a, b];
  };

  let top = -1;
  for (let y = 0; y < m.h; y++) {
    const s = rowSpan(y);
    if (s && s[1] - s[0] > m.w * 0.06) { top = y; break; }
  }
  if (top < 0) top = Math.round(m.h * 0.1);

  // The chin is where the silhouette stops narrowing and starts widening into
  // the neck and shoulders. Taken as the first row below the head's midpoint
  // whose span exceeds 1.5x the narrowest span found so far.
  let narrow = Infinity;
  let chin = m.h - 1;
  for (let y = top; y < m.h; y++) {
    const s = rowSpan(y);
    if (!s) continue;
    const width = s[1] - s[0];
    if (y < top + (m.h - top) * 0.55) narrow = Math.min(narrow, width);
    else if (width > narrow * 1.5) { chin = y; break; }
  }
  const headH = Math.max(8, chin - top);

  // The background model assumes the top corners of the frame ARE background,
  // which holds for a portrait and fails for a tight crop where those corners
  // are hair. The tell is that the "head" then swallows the frame. There is no
  // way to trace an edge that is off-picture, so rather than return a confident
  // wrong answer, fall back to a plain centred head box: still only a starting
  // point for dragging, but one that is on the face instead of on the wall.
  if (top <= m.h * 0.02 && headH >= m.h * 0.85) {
    return centredSeed(w, h);
  }

  // Which way the face points, decided INSIDE the head's own box rather than
  // against the frame. The back of a head is a smooth convex curve; the front
  // is not — brow, nose, lips and chin all stick out and cut back in. So the
  // side whose edge wanders more is the face. Measured as the mean absolute
  // change in edge position from row to row, down the middle of the head where
  // the features are.
  const wander = (side: "l" | "r"): number => {
    let prev = -1;
    let s = 0;
    let n = 0;
    for (let y = top + Math.round(headH * 0.25); y < top + Math.round(headH * 0.95); y++) {
      const sp = rowSpan(y);
      if (!sp) continue;
      const e = side === "l" ? sp[0] : sp[1];
      if (prev >= 0) { s += Math.abs(e - prev); n++; }
      prev = e;
    }
    return n ? s / n : 0;
  };
  const faceDir = wander("r") >= wander("l") ? 1 : -1;

  // Profile edge at a given fraction of head height, in source pixels.
  const edgeAt = (f: number): number => {
    const y = Math.max(0, Math.min(m.h - 1, Math.round(top + headH * f)));
    const sp = rowSpan(y);
    if (!sp) return (faceDir === 1 ? 0.7 : 0.3) * w;
    return ((faceDir === 1 ? sp[1] : sp[0]) / m.w) * w;
  };

  const headPx = (headH / m.h) * h;
  const points = {} as SidePoints;
  for (const [id, f, inset] of ANCHORS) {
    points[id] = {
      x: edgeAt(f) - faceDir * inset * headPx,
      y: (top / m.h) * h + f * headPx,
    };
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

  // Ground truth, exportable.
  //
  // The automatic placement has now failed three times on real photographs and
  // been "fixed" three times against synthetic tests that could not see the
  // failure. What is missing is not another idea, it is a set of profiles with
  // the thirteen points KNOWN to be in the right place, to test against.
  //
  // Nobody should have to hand over photographs to produce that, and reading
  // coordinates off a screenshot is worth about two percent of the frame. So
  // the verifier can emit what it currently holds: drag the points until they
  // are right, press this, and what lands on the clipboard is numbers. The
  // photograph stays where it is. Normalised 0..1 so the fixture survives a
  // re-crop or a different capture size.
  if (new URLSearchParams(location.search).has("dev")) {
    const dump = document.createElement("button");
    dump.type = "button";
    dump.className = "vdump";
    dump.textContent = "Copy points";
    dump.onclick = () => {
      const out: Record<string, [number, number]> = {};
      for (const spec of SIDE_POINTS) {
        out[spec.id] = [
          +(points[spec.id].x / photo.width).toFixed(4),
          +(points[spec.id].y / photo.height).toFixed(4),
        ];
      }
      const json = JSON.stringify(out, null, 1);
      void navigator.clipboard?.writeText(json).then(
        () => { dump.textContent = "Copied"; setTimeout(() => (dump.textContent = "Copy points"), 1400); },
        () => { dump.textContent = "See console"; console.log(json); },
      );
    };
    host.appendChild(dump);
  }

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
