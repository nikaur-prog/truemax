// Generate the App Store icon set from the TrueMax mark.
// Run with: npx tsx scripts/make-app-icons.mjs
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { markGlyph } from "./brandMark.mjs";

mkdirSync("resources", { recursive: true });

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
console.log("resources/ written");
