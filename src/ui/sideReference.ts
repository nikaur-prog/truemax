import { SIDE_POINTS } from "../engine/sideMetrics.js";
import type { SidePointId } from "../engine/sideMetrics.js";

// ---------------------------------------------------------------------------
// "Where is this point supposed to go?"
//
// The verifier names each landmark as you touch it — "Nose tip · furthest-
// forward point of the nose" — which answers the question for a point you have
// already found. It does not answer the question people actually have, which is
// where the OTHER twelve belong, and whether the set as a whole looks right.
// Testers were dragging points they did not need to touch and leaving ones they
// did, because there was nothing to compare against.
//
// So: a small profile diagram in the corner of the photo, tappable to fill the
// frame. Every point in its correct anatomical place on a neutral head, in the
// same colour and shape as the live handles, so the comparison is literally
// like-for-like — hold the diagram against the photo and any point sitting in
// the wrong place is obvious.
//
// Drawn as SVG from the same SIDE_POINTS list the verifier uses, so a point can
// never be added to the engine and forgotten here. It faces LEFT to match the
// mirrored front camera, which is how most people shoot the profile; the whole
// group flips when the subject faces the other way, because a reference facing
// the wrong direction is harder to read than no reference at all.
// ---------------------------------------------------------------------------

// Positions on a 100x140 neutral profile, measured off the same hand-corrected
// fixtures the seeding template came from. Nose tip at the front, ear behind.
const DIAGRAM: Record<SidePointId, [number, number]> = {
  trichion: [46, 20],
  glabella: [40, 42],
  nasion: [42, 50],
  pronasale: [26, 62],
  subnasale: [35, 70],
  labialeSuperius: [36, 76],
  labialeInferius: [37, 83],
  pogonion: [40, 92],
  menton: [46, 99],
  gonion: [72, 92],
  condylion: [74, 55],
  cervicale: [61, 104],
  tragion: [76, 62],
};

// The head outline, drawn to pass through those points rather than beside them:
// a reference whose silhouette disagrees with its own dots teaches the wrong
// thing.
const OUTLINE =
  "M46 20 C34 24 36 36 40 42 C43 47 42 48 42 50 C40 54 28 58 26 62 " +
  "C25 65 33 68 35 70 C36 73 35 74 36 76 C38 79 38 81 37 83 C38 88 38 90 40 92 " +
  "C41 96 43 98 46 99 C52 102 57 104 61 104 C67 102 71 98 72 92 " +
  "C75 82 76 70 76 62 C77 58 76 56 74 55 C74 40 66 22 46 20 Z";

// A face inside the outline, because the outline alone was the problem.
//
// A ring floating on an empty silhouette gives nothing to compare against —
// testers could see thirteen circles and still not know which one was wrong,
// which is exactly the confusion this panel exists to end. Drawn features give
// every point a neighbour: the brow-ridge ring sits above a drawn brow, the ear
// notch sits inside a drawn ear, and a point in the wrong place now looks wrong
// instead of merely looking like a dot.
//
// Deliberately generic — no age, no ethnicity read, no expression. This is a
// ruler, not a portrait, and a reference head that looked like somebody in
// particular would imply the measurements expect that face.
const FACE = `
  <path d="M74 40 C74 30 66 22 52 20 C46 19.4 40 21 37.5 25 C34 30 35.5 37 40 42
           C46 38 56 33 66 34 C71 34.5 73 37 74 40 Z" class="sref-hair"/>
  <path d="M52 44 q7 -3 12 1" class="sref-line"/>
  <g class="sref-eye">
    <path d="M50 52 q6 -4 11 1 q-5 4 -11 -1 z" class="sref-eye-white"/>
    <circle cx="55" cy="53" r="2.1" class="sref-iris"/>
  </g>
  <path d="M33 66 q3 1.6 5 1" class="sref-line"/>
  <path d="M40 79.5 q6 -1.6 10 0" class="sref-line"/>
  <path d="M43 96 q4 1.6 7 0" class="sref-line" opacity=".55"/>
  <path d="M69 55 q8 -1 8 8 q0 9 -7 9 q-5 0 -5 -8 q0 -8 4 -9 z" class="sref-ear"/>
  <path d="M71 60 q3 1 2.4 5.4 q-.6 3.6 -3 3.2" class="sref-line"/>
  <path d="M63 104 q7 -2 9 -9" class="sref-line" opacity=".5"/>`;

function dots(scale: number, withLabels: boolean): string {
  return SIDE_POINTS.map(({ id, label }) => {
    const [x, y] = DIAGRAM[id];
    // Labels sit on the side each point faces away from, so they never cross
    // the head: front-of-face points label to the left, behind-the-face points
    // to the right.
    const front = x < 55;
    return `<g>
      <circle cx="${x}" cy="${y}" r="${2.6 / scale}" class="sref-dot" />
      ${withLabels
        ? `<text x="${front ? x - 5 : x + 5}" y="${y + 1.2}" class="sref-label"
             text-anchor="${front ? "end" : "start"}">${label}</text>`
        : ""}
    </g>`;
  }).join("");
}

function svg(withLabels: boolean, faceDir: number): string {
  // Wider viewBox when labelled, so the text has somewhere to live.
  const box = withLabels ? "-42 4 184 132" : "10 10 88 112";
  // faceDir +1 means the subject faces image-right; the diagram is drawn facing
  // left, so it mirrors to match. Labels are un-mirrored inside the flip or
  // they would render backwards.
  const flip = faceDir > 0
    ? `transform="translate(100 0) scale(-1 1)"`
    : "";
  return `<svg viewBox="${box}" class="sref-svg" aria-hidden="true">
    ${withLabels ? `<defs><clipPath id="sref-head"><path d="${OUTLINE}"/></clipPath></defs>` : ""}
    <g ${flip}>
      <path d="${OUTLINE}" class="sref-skin" />
      ${/* Clipped to the head so a feature can never bleed past the silhouette:
            the hair fill did exactly that, and a reference that spills outside
            its own outline undermines the one thing it is there to teach. */ ""}
      ${withLabels ? `<g clip-path="url(#sref-head)">${FACE}</g>` : ""}
      <path d="${OUTLINE}" class="sref-outline" />
      ${dots(1, false)}
    </g>
    ${withLabels
      ? `<g class="sref-labels">${SIDE_POINTS.map(({ id, label }) => {
          const [x, y] = DIAGRAM[id];
          const dx = faceDir > 0 ? 100 - x : x;
          const front = faceDir > 0 ? dx > 45 : dx < 55;
          return `<text x="${front ? dx - 5 : dx + 5}" y="${y + 1.2}"
            text-anchor="${front ? "end" : "start"}" class="sref-label">${label}</text>`;
        }).join("")}</g>`
      : ""}
  </svg>`;
}

export interface ReferenceHandle {
  destroy(): void;
  setFaceDir(dir: number): void;
}

// Mounts the corner thumbnail into the photo frame. Tapping it opens the
// labelled version over the whole screen; tapping that closes it.
export function mountSideReference(frame: HTMLElement, faceDir: number): ReferenceHandle {
  let dir = faceDir;
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "sref-badge";
  badge.setAttribute("aria-label", "Show where each landmark belongs");
  badge.innerHTML = `${svg(false, dir)}<span>GUIDE</span>`;
  frame.appendChild(badge);

  let overlay: HTMLDivElement | null = null;
  const close = () => {
    overlay?.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const open = () => {
    if (overlay) return close();
    overlay = document.createElement("div");
    overlay.className = "sref-overlay";
    overlay.innerHTML = `<div class="sref-card" role="dialog" aria-modal="true" aria-label="Landmark reference">
      <span class="klabel">WHERE EACH POINT BELONGS</span>
      ${svg(true, dir)}
      <p>Hold this against your photo. Any ring sitting somewhere different to
        this is the one to drag — the five behind the face are the usual
        culprits, since there is no landmark for a jaw corner and they are
        estimated from an average head.</p>
      <button type="button" class="btn gho sref-close">Back to my photo</button>
    </div>`;
    frame.ownerDocument.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (event) => {
      // Backdrop or the explicit button. Clicking the diagram itself should not
      // dismiss the thing somebody just opened to read.
      if (event.target === overlay || (event.target as HTMLElement).closest(".sref-close")) close();
    });
  };
  badge.addEventListener("click", open);

  return {
    destroy() {
      close();
      badge.remove();
    },
    setFaceDir(next: number) {
      if (next === dir) return;
      dir = next;
      badge.innerHTML = `${svg(false, dir)}<span>GUIDE</span>`;
    },
  };
}
