import sharp from "sharp";
import { markGlyph } from "./brandMark.mjs";

// The 1200x630 link-preview card: the dark brand ground, the claim, and the
// mark. This used to be Max — see scripts/brandMark.mjs for why the mascot no
// longer stands in for the logo on the images that represent the product.
const mark = markGlyph({ x: 878, y: 168, size: 250 });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#123b35"/>
      <stop offset="65%" stop-color="#071c22"/>
      <stop offset="100%" stop-color="#191b22"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="90" y="255" font-family="Georgia, serif" font-size="92" fill="#f7fffc" font-weight="400">True<tspan fill="#ffd54a">Max</tspan></text>
  <text x="92" y="330" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#8ff3e0">Facial analysis that shows the actual math.</text>
  <text x="92" y="395" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="rgba(247,255,252,.62)">41 measurements · scored on your device · nothing uploaded</text>
  <rect x="92" y="452" width="330" height="64" rx="32" fill="#4bf5c5"/>
  <text x="257" y="494" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="#071e19" text-anchor="middle">truemax.app</text>
  ${mark}
</svg>`;
await sharp(Buffer.from(svg)).png().toFile("public/og.png");
console.log("public/og.png written");
