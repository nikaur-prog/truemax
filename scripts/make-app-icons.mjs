// Generate the store artwork from the TrueMax mark: the App Store icon set,
// and the two Play-only shapes Apple has no equivalent of.
// Run with: npx tsx scripts/make-app-icons.mjs
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { markGlyph } from "./brandMark.mjs";

mkdirSync("resources", { recursive: true });
mkdirSync("resources/android", { recursive: true });

// The brand ground, shared by every surface below so the icon, the splash and
// the listing banner cannot drift apart. Each caller supplies its own id
// because two gradients with the same id in one document collide.
const ground = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#123b35"/>
      <stop offset="65%" stop-color="#071c22"/>
      <stop offset="100%" stop-color="#191b22"/>
    </linearGradient>`;

// This used to be Max. He is the mascot, and a mascot on the home screen makes
// the icon look like the character's app rather than the measurement's — see
// scripts/brandMark.mjs. The mark also survives the size this has to work at:
// at 60 points Max is a blue blob with two lighter smudges, while an axis, a
// landmark and two contours stay legible because they were drawn to.
//
// Icons may not have transparency on iOS, so the dark brand gradient is the
// ground rather than a rounded tile — the system applies its own mask.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#123b35"/>
      <stop offset="65%" stop-color="#071c22"/>
      <stop offset="100%" stop-color="#191b22"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  ${markGlyph({ x: 212, y: 212, size: 600 })}
</svg>`;
writeFileSync("resources/icon.svg", svg);

for (const size of [1024, 512, 180, 167, 152, 120]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`resources/icon-${size}.png`);
}
// Splash: the same ground, the mark smaller, room for the system to letterbox.
const splash = svg
  .replace('x="212" y="212" width="600" height="600"', 'x="337" y="337" width="350" height="350"')
  .replace('width="1024" height="1024" viewBox="0 0 1024 1024"', 'width="2732" height="2732" viewBox="-854 -854 2732 2732"');
await sharp(Buffer.from(splash)).png().toFile("resources/splash-2732.png");

// ---------------------------------------------------------------------------
// Play only, from here down.
//
// Two shapes the App Store has no equivalent of, which is why they were
// missing rather than wrong: an adaptive icon and a feature graphic. Both are
// mandatory for a Play listing.
// ---------------------------------------------------------------------------

// The adaptive icon is two layers, not one square. Android composites them and
// then draws its OWN mask over the result — a circle, a squircle, a rounded
// square, whatever the launcher wants — so anything the designer treats as an
// edge is somebody else's crop line.
//
// The canvas is 108dp. The mask can eat 18dp from every side, leaving 72dp
// visible, and only the centre 66dp is guaranteed to survive on every device.
// So the artwork is sized against that 66dp circle, not against the canvas:
// 432px here is 108dp at xxxhdpi, the safe circle is 264px, and the glyph is
// drawn at 246px so it clears the mask on the diagonal too. It looks
// generously margined as a flat PNG. That is the point: the margin is the part
// the launcher is allowed to take.
const ADAPTIVE = 432;
const GLYPH = 246;
const inset = Math.round((ADAPTIVE - GLYPH) / 2);

const foreground = `<svg xmlns="http://www.w3.org/2000/svg" width="${ADAPTIVE}" height="${ADAPTIVE}" viewBox="0 0 ${ADAPTIVE} ${ADAPTIVE}">
  ${markGlyph({ x: inset, y: inset, size: GLYPH })}
</svg>`;
// Transparent by design: the foreground layer composites over the background
// layer, and a ground baked into it would show through the parallax the
// launcher applies between the two.
await sharp(Buffer.from(foreground)).png().toFile("resources/android/ic_launcher_foreground.png");

const background = `<svg xmlns="http://www.w3.org/2000/svg" width="${ADAPTIVE}" height="${ADAPTIVE}" viewBox="0 0 ${ADAPTIVE} ${ADAPTIVE}">
  <defs>${ground("adaptiveBg")}</defs>
  <rect width="${ADAPTIVE}" height="${ADAPTIVE}" fill="url(#adaptiveBg)"/>
</svg>`;
// No alpha: this layer IS the ground, and a transparent pixel in it shows the
// launcher's wallpaper through the icon.
await sharp(Buffer.from(background)).removeAlpha().png().toFile("resources/android/ic_launcher_background.png");

// The feature graphic: 1024x500, the banner at the top of the Play listing.
//
// Play draws its own chrome over this on some surfaces and crops it on others,
// and on a phone it renders about a thumbnail wide. Three consequences, all
// visible in the layout: nothing that matters goes near an edge, the type is
// far larger than the canvas makes it look, and the image still reads with
// every word unreadable, because the mark and the ground carry it alone at
// thumbnail size.
//
// Same wordmark treatment as scripts/make-og.mjs. A listing banner and a link
// preview are the same promise in two places and should not disagree.
const FEATURE_W = 1024;
const FEATURE_H = 500;
const feature = `<svg xmlns="http://www.w3.org/2000/svg" width="${FEATURE_W}" height="${FEATURE_H}" viewBox="0 0 ${FEATURE_W} ${FEATURE_H}">
  <defs>
    ${ground("featureBg")}
    <radialGradient id="glow" cx="0.78" cy="0.5" r="0.55">
      <stop offset="0%" stop-color="#56E6C7" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#56E6C7" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${FEATURE_W}" height="${FEATURE_H}" fill="url(#featureBg)"/>
  <rect width="${FEATURE_W}" height="${FEATURE_H}" fill="url(#glow)"/>
  <text x="88" y="222" font-family="Georgia, serif" font-size="86" fill="#f7fffc">True<tspan fill="#ffd54a">Max</tspan></text>
  <text x="90" y="288" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#8ff3e0">Facial analysis that shows the actual math.</text>
  <text x="90" y="344" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="rgba(247,255,252,.62)">43 measurements · scored on your device</text>
  ${markGlyph({ x: 718, y: 126, size: 248 })}
</svg>`;
// Play rejects a feature graphic carrying an alpha channel: it must be a JPEG
// or a 24-bit PNG. The art is opaque anyway, so this only drops the channel.
await sharp(Buffer.from(feature)).removeAlpha().png().toFile("resources/feature-graphic-1024x500.png");

console.log("resources/ written (Apple icon set, splash, Play adaptive icon and feature graphic)");
