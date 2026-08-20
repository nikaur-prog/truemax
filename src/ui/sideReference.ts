import { SIDE_POINTS } from "../engine/sideMetrics.js";
import type { SidePointId } from "../engine/sideMetrics.js";
import { TEMPLATE } from "./sideVerify.js";

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
// So: a small profile in the corner of the photo, tappable to fill the frame.
// Every point in its correct anatomical place on a neutral head, in the same
// colour and shape as the live handles, so the comparison is literally
// like-for-like — hold it against the photo and a point in the wrong place is
// obvious.
//
// THE HEAD IS DERIVED, NOT DRAWN. Three hand-authored versions of this shipped
// and all three were wrong in the same way: too narrow, ear at the wrong
// depth, a bite out of the skull where the outline detoured through a landmark
// that lives under the skin. A head is almost entirely proportion, and
// proportion is exactly what eyeballing bezier control points gets wrong.
//
// So the thirteen positions now come from TEMPLATE — the measured average
// profile the seeder itself places points with. The diagram and the engine
// cannot disagree, because they are the same numbers.
// ---------------------------------------------------------------------------

// TEMPLATE is in the head's own axes: u runs 0 at the nose tip to -1 at the ear
// canal, v runs 0 at the hairline to ~1 at the chin bottom. Turning that into
// picture coordinates needs one real-world ratio — the horizontal nose-to-ear
// span against the vertical hairline-to-chin span. On adult heads that is about
// 13.5cm against 18.5cm, so U is roughly 0.73 of V. Guessing that ratio is what
// went wrong before: at 0.65 the head reads as a shoe.
const V_SPAN = 114;
const U_SPAN = Math.round(V_SPAN * 0.73);
const X_NOSE = 20;
const Y_HAIRLINE = 40;

// The remaining two dimensions have no landmark to derive them from, because
// nothing is measured at the back of the head. Both come from the same
// anthropometry as the ratio above: at this scale 1cm is U_SPAN/13.5 units, the
// ear sits about 7cm forward of the occiput, and the vertex is about 23cm above
// the chin.
const PER_CM = U_SPAN / 13.5;
const X_EAR = X_NOSE + U_SPAN;
const BACK_OF_SKULL = Math.round(X_EAR + 7 * PER_CM);
const Y_MENTON = Math.round(Y_HAIRLINE + 0.988 * V_SPAN);
const Y_VERTEX = Math.round(Y_MENTON - 23 * PER_CM);
// The drawing runs a little past the chin, because it includes a neck.
const Y_BOTTOM = 182;

// Exported for the coverage test, which checks the anatomy is in a possible
// order — and, now that these are computed from the seeder's template rather
// than typed here, checks that template too.
export const REFERENCE_DIAGRAM = Object.fromEntries(
  (Object.entries(TEMPLATE) as Array<[SidePointId, [number, number]]>).map(([id, [u, v]]) => [
    id,
    [
      Math.round((X_NOSE - u * U_SPAN) * 10) / 10,
      Math.round((Y_HAIRLINE + v * V_SPAN) * 10) / 10,
    ] as [number, number],
  ]),
) as Record<SidePointId, [number, number]>;

const DIAGRAM = REFERENCE_DIAGRAM;

// Horizontal centre of the head. The mirror pivots here and labels choose their
// side from it, so both follow the drawing rather than being pinned to a number
// that used to be true.
const MID = Math.round((X_NOSE + BACK_OF_SKULL) / 2);

// Which side a label goes on is a different question from where the head's
// centre is. The neck point sits forward of the skull's midline but is still a
// back-of-head landmark, and labelling it to the left ran it straight through
// "Chin bottom". The face/back split is the midpoint of the FACE, not of the
// whole head.
const LABEL_SPLIT = X_NOSE + U_SPAN * 0.5;

// The silhouette. It passes through the FRONT landmarks — every point from the
// hairline round to the chin sits on this line, which is the whole basis of the
// comparison — and around the jaw and skull it follows the head instead.
//
// What it deliberately does NOT do is detour through the jaw top and the ear
// notch. Those two are inside a real head: the condyle is under the skin and
// the ear notch is inside the ear. Routing the outline through them is what bit
// a notch out of the side of the skull in the previous version.
const OUTLINE =
  "M33 40 " +
  "C25 47 26 55 29 62 " +
  "C30 68 30 71 31 73 " +
  "C29 82 22 94 20 98 " +
  "C19 101 25 104 28 106 " +
  "C27 109 24 112 25 114 " +
  "C28 121 29 126 28 130 " +
  "C27 139 30 145 33 147 " +
  "C36 151 41 153 45 153 " +
  "C57 157 68 155 76 150 " +
  "C87 146 96 141 98 132 " +
  // Down the front of the neck, across, and back up behind it. A reference
  // that stops at the jaw reads as a blob no matter how right the proportions
  // are; the neck is what makes the eye accept it as a head.
  "C101 141 104 152 105 164 " +
  "L105 182 L141 182 " +
  "C141 160 139 140 137 122 " +
  // the cranium
  "C141 104 140 70 140 54 " +
  "C142 28 114 13 84 13 " +
  "C60 12 40 22 33 40 Z";

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
  <!-- hair over the crown, down to the hairline at the front -->
  <path d="M33 40 C40 22 60 12 84 12 C114 13 142 28 140 54
           C138 36 116 26 90 26 C62 26 42 30 33 40 Z" class="sref-hair"/>
  <!-- brow ridge -->
  <path d="M34 65 q10 -4 16 -1" class="sref-line"/>
  <!-- the eye, set back from the brow as it is on a real profile -->
  <g class="sref-eye">
    <path d="M37 77 q8 -6 14 1 q-8 6 -14 -1 z" class="sref-eye-white"/>
    <circle cx="43" cy="77.5" r="2.6" class="sref-iris"/>
  </g>
  <!-- nostril -->
  <path d="M24 101 q5 2 7 1" class="sref-line"/>
  <!-- the mouth line, between the two lip points -->
  <path d="M27 121 q9 -2 14 1" class="sref-line"/>
  <!-- the crease under the lower lip, above the chin -->
  <path d="M30 138 q6 2 10 0" class="sref-line" opacity=".55"/>
  <!-- the ear, its notch where the tragion ring lands -->
  <path d="M96 74 q14 0 14 14 q0 16 -12 16 q-10 0 -10 -15 q0 -14 8 -15 z" class="sref-ear"/>
  <path d="M100 82 q5 2 4.5 8 q-.5 6 -5 5.5" class="sref-line"/>
  <!-- the rear border of the jaw, from the hinge down to the corner -->
  <path d="M91 79 q4 28 6 51" class="sref-line" opacity=".45"/>
  <!-- the jaw line, from the corner forward toward the chin -->
  <path d="M95 136 q-15 15 -32 16" class="sref-line" opacity=".5"/>
  <!-- where the jaw meets the neck -->
  <path d="M104 150 q-14 6 -26 4" class="sref-line" opacity=".35"/>`;

function dots(scale: number, withLabels: boolean): string {
  return SIDE_POINTS.map(({ id, label }) => {
    const [x, y] = DIAGRAM[id];
    // Labels sit on the side each point faces away from, so they never cross
    // the head: front-of-face points label to the left, behind-the-face points
    // to the right.
    const front = x < LABEL_SPLIT;
    return `<g>
      <circle cx="${x}" cy="${y}" r="${3.2 / scale}" class="sref-dot" />
      ${withLabels
        ? `<text x="${front ? x - 6 : x + 6}" y="${y + 1.4}" class="sref-label"
             text-anchor="${front ? "end" : "start"}">${label}</text>`
        : ""}
    </g>`;
  }).join("");
}


// ---------------------------------------------------------------------------
// Placing the labels so they can be read.
//
// The first version printed each label at its own point's height. Around the
// nose and mouth the landmarks are a few units apart — nose tip, nose base,
// upper lip, lower lip — so at 5.5px the words simply stacked on top of one
// another and the guide became unreadable exactly where it is needed most.
//
// Two rules fix it, and they are the same two any anatomical diagram uses.
// Labels are pushed apart vertically until each has room, then the whole
// column is re-centred so the block does not drift off the head. And they are
// aligned in a column per side rather than floating at each point's own x, so
// a leader line can run from the dot to its word without crossing another.
// ---------------------------------------------------------------------------

// Comfortable line spacing for a 5.5px face, in viewBox units.
const LABEL_GAP = 8;
// How far outside the head the two label columns sit.
const LABEL_MARGIN = 16;

function labelLayer(faceDir: number): string {
  const rows = SIDE_POINTS.map(({ id, label }) => {
    const [x, y] = DIAGRAM[id];
    // Everything below works in RENDERED coordinates, after the mirror, or a
    // label placed by the unflipped x lands on the wrong side of the face.
    const dx = faceDir > 0 ? MID * 2 - x : x;
    return { label, dx, y, ly: y, left: false };
  });

  // Two columns, both OUTSIDE the head. The previous version split on a line
  // through the middle of the face, which put the ear and jaw labels on top of
  // the drawing they were meant to annotate. Which side a point belongs to is
  // simply which side of the head's centre it sits on.
  const minX = Math.min(...rows.map((r) => r.dx));
  const maxX = Math.max(...rows.map((r) => r.dx));
  const centre = (minX + maxX) / 2;
  for (const r of rows) r.left = r.dx < centre;
  const leftColumn = minX - LABEL_MARGIN;
  const rightColumn = maxX + LABEL_MARGIN;

  let out = "";
  for (const left of [true, false]) {
    const side = rows.filter((r) => r.left === left).sort((a, b) => a.y - b.y);
    if (!side.length) continue;
    // Push apart until every label has a clear line...
    for (let i = 1; i < side.length; i++) {
      if (side[i].ly - side[i - 1].ly < LABEL_GAP) side[i].ly = side[i - 1].ly + LABEL_GAP;
    }
    // ...then shift the column back so it stays centred on the features it
    // describes instead of sliding toward the chin.
    const drift = (side[0].ly - side[0].y + (side[side.length - 1].ly - side[side.length - 1].y)) / 2;
    for (const r of side) r.ly -= drift;

    const column = left ? leftColumn : rightColumn;
    for (const r of side) {
      const from = left ? r.dx - 2.5 : r.dx + 2.5;
      out += `<path d="M${from.toFixed(1)} ${r.y.toFixed(1)} L${column.toFixed(1)} ${r.ly.toFixed(1)}" class="sref-leader"/>`;
      out += `<text x="${(left ? column - 2 : column + 2).toFixed(1)}" y="${(r.ly + 1.8).toFixed(1)}"
        text-anchor="${left ? "end" : "start"}" class="sref-label">${r.label}</text>`;
    }
  }
  return out;
}

function svg(withLabels: boolean, faceDir: number): string {
  // Wider viewBox when labelled, so the text has somewhere to live.
  const box = withLabels
    ? `-52 ${Y_VERTEX - 6} ${BACK_OF_SKULL + 122} ${Y_BOTTOM - Y_VERTEX + 14}`
    : `${X_NOSE - 8} ${Y_VERTEX - 4} ${BACK_OF_SKULL - X_NOSE + 20} ${Y_BOTTOM - Y_VERTEX + 10}`;
  // faceDir +1 means the subject faces image-right; the diagram is drawn facing
  // left, so it mirrors to match. Labels are un-mirrored inside the flip or
  // they would render backwards. Mirrored about the head's own centre, or the
  // flipped head walks sideways out of the box.
  const flip = faceDir > 0 ? `transform="translate(${MID * 2} 0) scale(-1 1)"` : "";
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
    ${withLabels ? `<g class="sref-labels">${labelLayer(faceDir)}</g>` : ""}
  </svg>`;
}

export interface ReferenceHandle {
  destroy(): void;
  setFaceDir(dir: number): void;
}

// Whether the corner badge is dismissed, remembered across mounts for the
// session. The badge sits over the photo, and a landmark that happens to land
// underneath it cannot be grabbed — the badge takes the tap. So it has to be
// hideable, and somebody working through fifty calibration profiles should not
// have to dismiss it fifty times; by the third face the layout it teaches has
// been learned anyway. Deliberately not persisted to storage: a new session is
// a reasonable moment for the guide to come back.
let badgeHidden = false;

// Mounts the corner thumbnail into the photo frame. Tapping it opens the
// labelled version over the whole screen; tapping that closes it. The × on the
// badge collapses it to a small GUIDE pill, so a point underneath becomes
// reachable; the pill brings it back.
export function mountSideReference(frame: HTMLElement, faceDir: number): ReferenceHandle {
  let dir = faceDir;
  const badge = document.createElement("div");
  badge.className = "sref-badge";

  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "sref-show";
  pill.textContent = "GUIDE";
  pill.setAttribute("aria-label", "Show the landmark guide");

  const setHidden = (next: boolean) => {
    badgeHidden = next;
    badge.classList.toggle("hidden", next);
    pill.classList.toggle("hidden", !next);
  };
  pill.onclick = () => setHidden(false);

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
  // The badge is a <div> holding two buttons rather than a button itself,
  // because the hide control cannot be a button nested inside another one.
  const renderBadge = () => {
    badge.innerHTML = `<button type="button" class="sref-open" aria-label="Show where each landmark belongs">${svg(false, dir)}<span>GUIDE</span></button>
      <button type="button" class="sref-hide" aria-label="Hide the guide">×</button>`;
    badge.querySelector<HTMLButtonElement>(".sref-open")!.onclick = open;
    badge.querySelector<HTMLButtonElement>(".sref-hide")!.onclick = () => setHidden(true);
  };
  renderBadge();
  frame.appendChild(badge);
  frame.appendChild(pill);
  setHidden(badgeHidden);

  return {
    destroy() {
      close();
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
