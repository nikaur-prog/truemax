import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  FRONT_GROUPS,
  FRONT_GROUP_LABEL,
  FRONT_POINTS,
  moveFrontPoint,
  movedFrontPoints,
} from "../engine/frontPoints.js";
import type { FrontGroup, FrontPointSpec } from "../engine/frontPoints.js";

// ---------------------------------------------------------------------------
// Correcting the front landmarks by hand.
//
// The counterpart to the side verifier, and deliberately NOT the same screen.
// The side seed is a guess, so its editor is compulsory and walks you through
// all thirteen points one at a time. The frontal mesh is usually right, so
// this one opens on request, shows nothing by default beyond the points of the
// region you asked about, and exists for the specific case where somebody can
// see a dot in the wrong place.
//
// ONE REGION AT A TIME. Thirty-eight handles over a face is not an editor, it
// is a screen door — the points sit centimetres apart and every drag risks
// grabbing a neighbour. The chips pick a region, the region shows four to
// eight points, and everything else stays out of the way.
//
// NOTHING IS APPLIED UNTIL IT IS APPLIED. Dragging edits a working copy; the
// scan behind this screen is untouched until Re-measure is pressed, and Cancel
// throws the copy away. "Reset" puts every point back where the detector put
// it, which is the one thing a person cannot do by dragging.
//
// The magnifier is lifted wholesale from the side verifier for the reason it
// exists there: a fingertip covers the exact pixel being placed.
// ---------------------------------------------------------------------------

export interface FrontEditOptions {
  photo: HTMLCanvasElement;
  landmarks: NormalizedLandmark[];
  /** Applies the corrected cloud. The caller re-runs the analysis. */
  onApply: (landmarks: NormalizedLandmark[]) => void;
  onClose: () => void;
}

let host: HTMLDivElement | null = null;

export function isFrontEditOpen(): boolean {
  return host !== null;
}

export function closeFrontEdit(): void {
  host?.remove();
  host = null;
}

export function openFrontEdit(opts: FrontEditOptions): void {
  if (host) return;
  const { photo } = opts;
  const original = opts.landmarks;
  let working = original;
  let group: FrontGroup = "face";

  host = document.createElement("div");
  host.className = "fedit";
  host.innerHTML = `
    <div class="fedit-sheet" role="dialog" aria-modal="true" aria-label="Correct the measurement points">
      <header class="fedit-head">
        <div>
          <b>Correct the points</b>
          <small>Drag any point that landed in the wrong place, then re-measure.</small>
        </div>
        <button type="button" class="fedit-x" aria-label="Close">&times;</button>
      </header>
      <div class="fedit-chips" role="tablist"></div>
      <div class="fedit-stage">
        <canvas class="fedit-photo"></canvas>
        <div class="fedit-layer"></div>
      </div>
      <p class="fedit-note" role="status"></p>
      <div class="fedit-actions">
        <button type="button" class="btn gho fedit-reset">Reset all points</button>
        <button type="button" class="btn pri fedit-apply" disabled>Re-measure</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const canvas = host.querySelector<HTMLCanvasElement>(".fedit-photo")!;
  canvas.width = photo.width;
  canvas.height = photo.height;
  canvas.getContext("2d")!.drawImage(photo, 0, 0);

  const layer = host.querySelector<HTMLElement>(".fedit-layer")!;
  const chips = host.querySelector<HTMLElement>(".fedit-chips")!;
  const note = host.querySelector<HTMLElement>(".fedit-note")!;
  const apply = host.querySelector<HTMLButtonElement>(".fedit-apply")!;
  const reset = host.querySelector<HTMLButtonElement>(".fedit-reset")!;

  const magnifier = document.createElement("div");
  magnifier.className = "verify-magnifier";
  magnifier.setAttribute("aria-hidden", "true");
  const lens = document.createElement("canvas");
  lens.width = 180;
  lens.height = 180;
  const lensLabel = document.createElement("span");
  magnifier.append(lens, lensLabel);
  layer.appendChild(magnifier);

  const hint = document.createElement("div");
  hint.className = "verify-hint";
  layer.appendChild(hint);

  for (const g of FRONT_GROUPS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "fedit-chip";
    chip.dataset.group = g;
    chip.setAttribute("role", "tab");
    chip.textContent = FRONT_GROUP_LABEL[g];
    chip.onclick = () => {
      group = g;
      paint();
    };
    chips.appendChild(chip);
  }

  // The handles for the visible region, rebuilt on every group change. Kept as
  // a map so a drag can find its own element without a DOM query per frame.
  const handles = new Map<string, HTMLElement>();

  function visible(): FrontPointSpec[] {
    return FRONT_POINTS.filter((s) => s.group === group);
  }

  function place(): void {
    for (const spec of visible()) {
      const el = handles.get(spec.id);
      const p = working[spec.index];
      if (!el || !p) continue;
      el.style.left = `${p.x * 100}%`;
      el.style.top = `${p.y * 100}%`;
    }
  }

  function paintNote(): void {
    const moved = movedFrontPoints(original, working, photo.width, photo.height);
    apply.disabled = moved.length === 0;
    reset.disabled = moved.length === 0;
    note.textContent = moved.length
      ? `${moved.length} point${moved.length === 1 ? "" : "s"} moved: ${moved
          .map((s) => s.label.toLowerCase())
          .join(", ")}. Re-measure to score the corrected face.`
      : "Nothing moved yet. Every point is where the detector put it.";
  }

  function paint(): void {
    for (const chip of chips.querySelectorAll<HTMLButtonElement>(".fedit-chip")) {
      chip.classList.toggle("on", chip.dataset.group === group);
      chip.setAttribute("aria-selected", chip.dataset.group === group ? "true" : "false");
    }
    for (const el of handles.values()) el.remove();
    handles.clear();
    for (const spec of visible()) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "vpoint";
      el.dataset.id = spec.id;
      el.setAttribute("aria-label", spec.label);
      el.innerHTML = `<i></i><span>${spec.label}</span>`;
      layer.appendChild(el);
      handles.set(spec.id, el);
    }
    place();
    paintNote();
  }

  const specById = new Map(FRONT_POINTS.map((s) => [s.id, s]));
  let dragging: FrontPointSpec | null = null;

  const toPhoto = (clientX: number, clientY: number) => {
    const r = layer.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * photo.width,
      y: ((clientY - r.top) / r.height) * photo.height,
    };
  };

  function paintLens(spec: FrontPointSpec): void {
    const p = working[spec.index];
    if (!p) return;
    const r = layer.getBoundingClientRect();
    const ctx = lens.getContext("2d")!;
    const displayPatch = Math.max(34, Math.min(54, r.width * 0.12));
    const sourceSize = displayPatch * (photo.width / Math.max(1, r.width));
    const cxp = p.x * photo.width;
    const cyp = p.y * photo.height;
    const sx = cxp - sourceSize / 2;
    const sy = cyp - sourceSize / 2;
    ctx.clearRect(0, 0, 180, 180);
    ctx.imageSmoothingQuality = "high";
    const x0 = Math.max(0, sx);
    const y0 = Math.max(0, sy);
    const x1 = Math.min(photo.width, sx + sourceSize);
    const y1 = Math.min(photo.height, sy + sourceSize);
    if (x1 > x0 && y1 > y0) {
      const k = 180 / sourceSize;
      ctx.drawImage(photo, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
    }
    ctx.strokeStyle = "rgba(143, 243, 224, 0.98)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(90, 72); ctx.lineTo(90, 108);
    ctx.moveTo(72, 90); ctx.lineTo(108, 90);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(90, 90, 7, 0, Math.PI * 2);
    ctx.stroke();
    lensLabel.textContent = spec.label;
    // Opposite side to the point, so the lens and the finger never cover the
    // same half of the face.
    magnifier.classList.toggle("at-left", cxp > photo.width / 2);
    magnifier.classList.toggle("at-right", cxp <= photo.width / 2);
  }

  const down = (e: PointerEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(".vpoint");
    if (!target) return;
    const spec = specById.get(target.dataset.id ?? "");
    if (!spec) return;
    dragging = spec;
    target.classList.add("grabbing");
    hint.textContent = spec.hint;
    hint.classList.add("show");
    paintLens(spec);
    magnifier.classList.add("show");
    layer.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const p = toPhoto(e.clientX, e.clientY);
    working = moveFrontPoint(
      working,
      dragging,
      {
        x: Math.max(0, Math.min(photo.width, p.x)),
        y: Math.max(0, Math.min(photo.height, p.y)),
      },
      photo.width,
      photo.height,
    );
    place();
    paintLens(dragging);
    paintNote();
  };

  const up = () => {
    if (!dragging) return;
    handles.get(dragging.id)?.classList.remove("grabbing");
    dragging = null;
    hint.classList.remove("show");
    magnifier.classList.remove("show");
  };

  const blockMenu = (e: Event) => e.preventDefault();
  layer.addEventListener("pointerdown", down);
  layer.addEventListener("pointermove", move);
  layer.addEventListener("pointerup", up);
  layer.addEventListener("pointercancel", up);
  layer.addEventListener("contextmenu", blockMenu);

  reset.onclick = () => {
    working = original;
    place();
    paintNote();
  };
  apply.onclick = () => {
    const corrected = working;
    closeFrontEdit();
    opts.onApply(corrected);
  };
  const bail = () => {
    closeFrontEdit();
    opts.onClose();
  };
  host.querySelector<HTMLButtonElement>(".fedit-x")!.onclick = bail;
  host.addEventListener("click", (e) => {
    if (e.target === host) bail();
  });
  const onKey = (e: KeyboardEvent) => {
    if (!host) {
      document.removeEventListener("keydown", onKey);
      return;
    }
    if (e.key === "Escape") bail();
  };
  document.addEventListener("keydown", onKey);

  paint();
}
