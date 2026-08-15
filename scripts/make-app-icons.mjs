// Generate the App Store icon set from the Max character — the same drawing
// the app renders, so the icon can never drift from the product.
// Run with: npx tsx scripts/make-app-icons.mjs
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { maxCharacterMarkup } from "../src/ui/maxCharacter.js";

mkdirSync("resources", { recursive: true });

// Max, centred on the dark brand gradient of the TrueMax card. Icons may not
// have transparency on iOS, and the dark ground is what makes the light-bar
// eyes read at 60px on a home screen.
// The character relies on the stylesheet for its states: .mx-alt parts are
// display:none, the eyelids rest at scaleY(0). A static rasteriser has no
// stylesheet, so every hidden part renders at once — lids over the eyes, the
// talking mouth on the smile. Strip everything CSS-controlled; the icon is
// the resting happy face.
const inner = maxCharacterMarkup()
  .replace('class="mx-svg mx-mood-happy" aria-hidden="true"', 'x="212" y="180" width="600" height="632"')
  .replace(/<g class="mx-alt[^"]*">[\s\S]*?<\/g>/g, "")
  .replace(/<path class="mx-alt[^"]*"[^>]*\/>/g, "")
  .replace(/<rect[^>]*mx-lid[^>]*\/>/g, "");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#123b35"/>
      <stop offset="65%" stop-color="#071c22"/>
      <stop offset="100%" stop-color="#191b22"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  ${inner}
</svg>`;
writeFileSync("resources/icon.svg", svg);

for (const size of [1024, 512, 180, 167, 152, 120]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`resources/icon-${size}.png`);
}
// Splash: the same ground, Max smaller, room for the system to letterbox.
const splash = svg.replace('x="212" y="180" width="600" height="632"', 'x="337" y="330" width="350" height="369"')
  .replace('width="1024" height="1024" viewBox="0 0 1024 1024"', 'width="2732" height="2732" viewBox="-854 -854 2732 2732"');
await sharp(Buffer.from(splash)).png().toFile("resources/splash-2732.png");
console.log("resources/ written");
