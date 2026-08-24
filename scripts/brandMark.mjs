// The TrueMax mark, for the images that represent the product rather than the
// ones inside it.
//
// Max used to be the primary image everywhere that mattered — the link preview,
// the App Store icon, the social profile picture. He is the mascot, not the
// logo, and a mascot standing in for a mark makes the product look like the
// character's, which is backwards: people are here to have a face measured, and
// the thing doing the measuring should be what they see first. Max keeps every
// surface inside the app, and gets the loader, where a character is exactly
// what you want to be looking at.
//
// Kept as one module because three scripts draw it and a mark that drifts
// between the icon, the preview card and the avatar is not a mark. The geometry
// is the same as public/brand/truemax-mark.svg: a centre axis, a central
// landmark, and two mirrored profile contours.

export const INK = "#141518";
export const MINT = "#56E6C7";

/**
 * The mark's strokes on their own, drawn into a 128-unit box placed at x/y.
 * No background — the caller supplies the ground.
 */
export function markGlyph({ x, y, size, colour = MINT }) {
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 128 128" fill="none">
    <path d="M34 31h60M64 31v68" stroke="${colour}" stroke-width="10" stroke-linecap="round"/>
    <path d="M46 47c-10 8-12 25-6 38 4 8 10 14 18 18M82 47c10 8 12 25 6 38-4 8-10 14-18 18" stroke="${colour}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="64" cy="64" r="5" fill="${colour}"/>
  </svg>`;
}

/** The full mark including its rounded ink tile — the icon as designed. */
export function markTile({ x, y, size, radius = size * 0.234, ground = INK, colour = MINT }) {
  return `<g>
    <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${radius}" fill="${ground}"/>
    ${markGlyph({ x, y, size, colour })}
  </g>`;
}
