// ---------------------------------------------------------------------------
// A glyph for every tab on the report.
//
// The row used to be eleven words in identical pills, which is a legible list
// and a slow one: on a phone it scrolls sideways, so finding "Chin" means
// reading four labels that are not Chin. A shape is recognised before it is
// read, and these are all shapes of the thing they name — the eye tab is an
// eye, the jaw tab is a jaw — so the row can be scanned rather than parsed.
//
// Drawn as inline SVG rather than an icon font or a sprite sheet. There are
// eleven of them, they are a few hundred bytes each, and they inherit
// currentColor, which is what makes them work in a pill that inverts to white
// on black the moment it is selected. A sprite would need a second colour
// rule and a second network request to do the same job.
//
// One shared 24×24 grid and one stroke weight, or they read as eleven icons
// from eleven places. Everything sits inside the same implied face oval so the
// row describes one head from several angles instead of a pile of clip art.
// ---------------------------------------------------------------------------

// 1.75 rather than 1.5. These render at nineteen pixels on a phone, where a
// hairline stroke at 78% opacity is a smudge rather than a shape.
const OPEN = `<svg class="rt-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`;

// The face outline several of these sit inside. Kept as one string so the
// eleven glyphs cannot drift apart by a pixel.
const FACE = `<path d="M12 3.4c3.6 0 5.9 2.4 5.9 6 0 4.6-2.6 11.2-5.9 11.2S6.1 14 6.1 9.4c0-3.6 2.3-6 5.9-6Z"/>`;

const ICONS: Record<string, string> = {
  // An eye, with the canthal tilt this app spends so much of its time
  // measuring actually drawn into it.
  eyes: `${OPEN}
    <path d="M2.6 12.2c2.5-3.3 5.6-5 9.4-5s6.9 1.7 9.4 5c-2.5 3.3-5.6 5-9.4 5s-6.9-1.7-9.4-5Z"/>
    <circle cx="12" cy="12.2" r="2.6"/></svg>`,

  // The cheekbone shelf: two arcs sweeping down and in from the outer eye,
  // with the width they span marked between them.
  //
  // Drawn WITHOUT the face outline, unlike the first version of this file.
  // Four of these glyphs used to be the same oval with a different faint mark
  // inside it, and at nineteen pixels on a phone that is four identical
  // blobs — which is worse than no icon, because it takes a moment to
  // discover it says nothing. Only the tabs whose subject genuinely is the
  // whole head keep the outline.
  midface: `${OPEN}
    <path d="M4.2 8.6c2.4 3 5 4.5 7.8 4.5s5.4-1.5 7.8-4.5"/>
    <path d="M2.8 17.4h18.4"/>
    <path d="M5.2 15.2 2.8 17.4l2.4 2.2M18.8 15.2l2.4 2.2-2.4 2.2"/></svg>`,

  // Nose in profile, because a nose drawn front-on is two dots and a line and
  // reads as nothing at all.
  nose: `${OPEN}
    <path d="M12.4 2.6c0 4.4-.8 7.4-3.4 11.6-1.1 1.8-.5 3 1.6 3.2"/>
    <path d="M6.6 17.6c1.4 2.4 4 3.4 6.8 2.7 2.2-.6 3.6-2.1 4-4.1"/>
    <path d="M16.6 13.6c.6.8 1.1 1.7 1.4 2.6"/></svg>`,

  // Lips. Cupid's bow up top, one fuller lower lip, which is the ratio the
  // region actually scores.
  lips: `${OPEN}
    <path d="M3.6 11.4c2-2.4 4-3.6 5.6-3.6 1.4 0 2 .9 2.8.9s1.4-.9 2.8-.9c1.6 0 3.6 1.2 5.6 3.6"/>
    <path d="M3.6 11.4c2.2 3.2 4.9 4.8 8.4 4.8s6.2-1.6 8.4-4.8"/>
    <path d="M3.6 11.4h16.8"/></svg>`,

  // The jaw: the gonial angle, drawn as the angle.
  jaw: `${OPEN}
    <path d="M2.8 3.4v6.8c0 5 4.1 8.8 9.2 8.8s9.2-3.8 9.2-8.8V3.4"/>
    <path d="M2.8 10.2h.01M21.2 10.2h.01" stroke-width="2.8"/></svg>`,

  // Chin: the jawline, and the projection hanging below it. Deliberately not
  // another U — the jaw tab is already a U, and next to each other on a
  // scrolling row two U's are one icon shown twice.
  chin: `${OPEN}
    <path d="M3.4 4.6c0 4 1.4 7 3.6 8.8"/>
    <path d="M20.6 4.6c0 4-1.4 7-3.6 8.8"/>
    <path d="M7 13.4c0 3.4 2.2 5.8 5 5.8s5-2.4 5-5.8"/>
    <path d="M7 13.4h10"/></svg>`,

  // Proportions: the canonical horizontal thirds, as three bands rather than
  // as lines drawn inside a head. Big, flat and unmistakable at 19px.
  proportions: `${OPEN}
    <rect x="4.4" y="3.4" width="15.2" height="17.2" rx="3"/>
    <path d="M4.4 9.2h15.2M4.4 14.8h15.2"/></svg>`,

  // Symmetry: a midline with the same mark mirrored either side of it. The
  // mirroring IS the subject, so the glyph is built out of it.
  symmetry: `${OPEN}
    <path d="M12 2.8v18.4" stroke-dasharray="2.4 2.6"/>
    <path d="M8.8 6.4 4 12l4.8 5.6M15.2 6.4 20 12l-4.8 5.6"/></svg>`,

  // Overall, and Coach Max's read, which occupy the same tab: the whole head,
  // and the only glyph that keeps the outline as its whole point.
  overall: `${OPEN}${FACE}
    <path d="M9.5 9.6h.01M14.5 9.6h.01" stroke-width="2.6"/>
    <path d="M9.6 14.2c.8.7 1.6 1 2.4 1s1.6-.3 2.4-1"/></svg>`,

  // The profile, for the tab that switches to the side photograph.
  side: `${OPEN}
    <path d="M16.6 20.6v-3.2c0-1.2.7-1.8 1.8-2 .9-.2 1.2-.7.8-1.5l-1.4-2.7c.3-4.4-2-7.4-5.9-7.4-3.6 0-6.3 2.7-6.3 6.4 0 2.4 1.1 4 2.6 5.2v5.2"/>
    <path d="M9.6 10.4h.01" stroke-width="2.4"/></svg>`,

  // The plan. Not a face — it is the one tab that is about what happens next
  // rather than about a measurement, and it should not pretend otherwise.
  improve: `${OPEN}
    <path d="M4 18.4 9 12l3.6 3.4L20 6.2"/>
    <path d="M15.4 5.8H20v4.6"/></svg>`,
};

/**
 * The glyph for a tab id, as an SVG string, or "" when there is not one.
 *
 * Side region tabs arrive as `side:jaw`, which is the same jaw seen from a
 * different angle and gets the same icon.
 */
export function regionIconMarkup(id: string): string {
  const key = id.startsWith("side:") ? id.slice(5) : id;
  return ICONS[key] ?? "";
}
