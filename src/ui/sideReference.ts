import { SIDE_POINTS } from "../engine/sideMetrics.js";
import {
  GUIDE_PHOTO_URL,
  GUIDE_POINTS,
  guidePhotoReady,
} from "./sideGuidePhoto.js";

// ---------------------------------------------------------------------------
// "Where is this point supposed to go?" — answered with a photograph.
//
// This used to be a line-drawn head, derived from the seeder's template so it
// could not lie about proportions. It still looked like a drawing, and the
// question people actually stall on — "what does the jaw hinge look like ON A
// FACE" — is one a diagram cannot answer. The AI reference photograph (nobody's
// real face, hand-verified points) answers it directly, and it already existed
// for the walkthrough's crops. The drawing is gone; the photo is the guide.
//
// PLACEMENT. Top-right of the frame, which on a phone is the one corner the
// thumb and the points rarely need — and, more to the point, where somebody
// told us they expect to find it. Collapsible to a pill for the case where a
// landmark lands underneath it, and the collapse is remembered for the
// session: somebody working through fifty calibration profiles should not
// dismiss it fifty times.
//
// Tapping it fills the screen with the photograph and every ring, so the set
// as a whole can be compared against the photo being corrected.
// ---------------------------------------------------------------------------

export interface ReferenceHandle {
  destroy(): void;
  setFaceDir(dir: number): void;
}

let badgeHidden = false;

/**
 * Draw the whole reference with a ring on every landmark.
 *
 * The rings are the same colour and weight as the live handles, so holding
 * the overlay against the photo is a like-for-like comparison. Mirrored when
 * the subject faces image-left — geometry is bilateral, so a mirrored
 * reference is exactly as true.
 */
export function drawGuideFull(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  faceDir: number,
  maxSize = 720,
): void {
  if (!GUIDE_POINTS || !image.naturalWidth) return;
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(image.naturalWidth * scale * dpr);
  const h = Math.round(image.naturalHeight * scale * dpr);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (faceDir === -1) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = "rgba(143, 243, 224, 0.98)";
  ctx.lineWidth = 2 * dpr;
  ctx.shadowColor = "rgba(6, 20, 17, 0.85)";
  ctx.shadowBlur = 3 * dpr;
  for (const { id } of SIDE_POINTS) {
    const [px, py] = GUIDE_POINTS[id];
    const x = faceDir === -1 ? w - px * w : px * w;
    ctx.beginPath();
    ctx.arc(x, py * h, 7 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * Full-screen reference: the photograph, every ring, a line of instruction.
 * Returns a close function; Escape and the backdrop both close it too.
 */
export function openReferenceOverlay(faceDir: number, doc = document): () => void {
  const overlay = doc.createElement("div");
  overlay.className = "sref-overlay";
  overlay.innerHTML = `<div class="sref-card" role="dialog" aria-modal="true" aria-label="Landmark reference">
    <span class="klabel">WHERE EACH POINT BELONGS</span>
    <canvas class="sref-photo-full"></canvas>
    <p>Hold this against your photo. Any ring sitting somewhere different is the
      one to drag: the five behind the face are the usual culprits, since a jaw
      corner has no landmark and they are estimated from an average head.</p>
    <button type="button" class="btn gho sref-close">Back to my photo</button>
  </div>`;
  doc.body.appendChild(overlay);

  const image = new Image();
  image.src = GUIDE_PHOTO_URL;
  const paint = () => {
    const canvas = overlay.querySelector<HTMLCanvasElement>(".sref-photo-full");
    if (canvas) drawGuideFull(canvas, image, faceDir, 1024);
  };
  if (image.complete) paint();
  else image.onload = paint;

  const close = () => {
    overlay.remove();
    doc.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  doc.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || (event.target as HTMLElement).closest(".sref-close")) close();
  });
  return close;
}

export function mountSideReference(frame: HTMLElement, faceDir: number): ReferenceHandle {
  // No hand-verified points yet would mean a photo with no rings — worse than
  // nothing, since it teaches nothing and covers the corner of the photo.
  if (!guidePhotoReady()) {
    return { destroy() {}, setFaceDir() {} };
  }
  let dir = faceDir;
  const badge = document.createElement("div");
  badge.className = "sref-badge";

  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "sref-show";
  pill.textContent = "REFERENCE";
  pill.setAttribute("aria-label", "Show the reference photo");

  const setHidden = (next: boolean) => {
    badgeHidden = next;
    badge.classList.toggle("hidden", next);
    pill.classList.toggle("hidden", !next);
  };
  pill.onclick = () => setHidden(false);

  let closeOverlay: (() => void) | null = null;
  const open = () => {
    if (closeOverlay) {
      closeOverlay();
      closeOverlay = null;
      return;
    }
    const close = openReferenceOverlay(dir, frame.ownerDocument);
    closeOverlay = () => {
      close();
      closeOverlay = null;
    };
  };

  // The thumbnail is the photograph itself, mirrored with CSS to match the
  // subject's own facing. A <div> holding two buttons, because the hide
  // control cannot be a button nested inside another one.
  const renderBadge = () => {
    badge.innerHTML = `<button type="button" class="sref-open" aria-label="Show where each landmark belongs">
        <img src="${GUIDE_PHOTO_URL}" alt="" ${dir === -1 ? 'class="mirrored"' : ""} draggable="false" />
        <span>REFERENCE</span>
      </button>
      <button type="button" class="sref-hide" aria-label="Hide the reference">×</button>`;
    badge.querySelector<HTMLButtonElement>(".sref-open")!.onclick = open;
    badge.querySelector<HTMLButtonElement>(".sref-hide")!.onclick = () => setHidden(true);
  };
  renderBadge();
  frame.appendChild(badge);
  frame.appendChild(pill);
  setHidden(badgeHidden);

  return {
    destroy() {
      closeOverlay?.();
      badge.remove();
      pill.remove();
    },
    setFaceDir(next: number) {
      if (next === dir) return;
      dir = next;
      renderBadge();
    },
  };
}
