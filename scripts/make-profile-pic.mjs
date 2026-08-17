// The one image to use as a profile picture, plus a current Max cut-out.
//
// Run with: npx tsx scripts/make-profile-pic.mjs
//
// Two things this fixes. public/brand/max-avatar-v1.png was rasterised before
// Max was redesigned, so the brand page was handing out a character the app no
// longer draws. And the brand page offered eleven files when the actual
// question is "what do I set as my profile picture" — which has one answer.
//
// Rendered from maxCharacterMarkup(), the same drawing the app renders, so the
// picture cannot drift from the product the way the old one did.
//
// SIZED FOR A CIRCLE. Every platform that matters crops a profile picture to a
// circle, which cuts the corners off a square. In a 1024 square the inscribed
// circle has radius 512, so anything outside ~440 from the centre is at risk.
// Max is drawn 560 wide and centred, putting his furthest corner about 410 out
// — inside the safe radius with room to spare, rather than the app icon's 436,
// which fits but only just.
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { maxCharacterMarkup } from "../src/ui/maxCharacter.js";

// The static rasteriser has no stylesheet, so every CSS-hidden part would
// render at once: eyelids down over the eyes, the talking mouth on top of the
// smile. Strip them and the resting happy face is what is left. Same reasoning
// as make-app-icons.mjs, which is where this was first learned the hard way.
function restingMax(x, y, w, h) {
  return maxCharacterMarkup()
    .replace(
      'class="mx-svg mx-mood-happy" aria-hidden="true"',
      `x="${x}" y="${y}" width="${w}" height="${h}"`,
    )
    .replace(/<g class="mx-alt[^"]*">[\s\S]*?<\/g>/g, "")
    .replace(/<path class="mx-alt[^"]*"[^>]*\/>/g, "")
    .replace(/<rect[^>]*mx-lid[^>]*\/>/g, "");
}

const GRADIENT = `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#123b35"/>
      <stop offset="65%" stop-color="#071c22"/>
      <stop offset="100%" stop-color="#191b22"/>
    </linearGradient>
  </defs>`;

// Horizontally centred, sitting a touch above the vertical centre so the head
// lands on the optical centre rather than the geometric one.
//
// Was 560 wide, and that was too timid by half. The safe-radius reasoning above
// is right about the geometry and wrong about the SHAPE: it measured the corner
// of Max's bounding BOX against the inscribed circle, but Max is an egg with
// two stubby arms and his bounding-box corners are empty pixels. The circle
// crop removes the square's corners, and Max's furthest real pixels — the widest
// point of his body and the antenna tip — sit on the horizontal and vertical
// axes, which is exactly where the circle is at its full 512 radius.
//
// So the old picture spent 45% of a profile photograph on empty gradient. That
// does not read as breathing room at the size this is actually seen: a TikTok
// avatar is about 50 pixels across, and 560/1024 of it left roughly twenty
// pixels of character to recognise. At 780 the widest point lands near 390 from
// the centre — still comfortably inside the safe radius — and Max is legible in
// a comment thread, which is the entire job.
const W = 780;
const H = 822;
const X = (1024 - W) / 2;
const Y = 92;

const profile = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${GRADIENT}
  <rect width="1024" height="1024" fill="url(#bg)"/>
  ${restingMax(X, Y, W, H)}
</svg>`;
writeFileSync("public/brand/truemax-profile.svg", profile);
await sharp(Buffer.from(profile)).png().toFile("public/brand/truemax-profile.png");

// A circle-cropped copy, so what the platforms will actually show can be
// checked rather than assumed.
const mask = Buffer.from(
  `<svg width="1024" height="1024"><circle cx="512" cy="512" r="512" fill="#fff"/></svg>`,
);
await sharp(Buffer.from(profile))
  .composite([{ input: mask, blend: "dest-in" }])
  .png()
  .toFile("public/brand/truemax-profile-circle.png");

// Max on his own, transparent, replacing the pre-redesign avatar.
const avatar = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${restingMax(112, 96, 800, 842)}
</svg>`;
await sharp(Buffer.from(avatar)).png().toFile("public/brand/max-avatar.png");
await sharp(Buffer.from(avatar)).webp({ quality: 90 }).toFile("public/brand/max-avatar.webp");

console.log("public/brand/: truemax-profile.png, truemax-profile-circle.png, max-avatar.png/webp");
