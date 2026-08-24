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
import { markGlyph } from "./brandMark.mjs";

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

// The profile picture is the MARK, not Max.
//
// It used to be Max at 780px on the gradient, and the long note that used to
// live here was all about how large to draw him so he stayed recognisable in a
// 50-pixel TikTok avatar. That reasoning was sound and answering the wrong
// question: this image is what the product is called, not who its mascot is,
// and an account whose picture is a cartoon reads as a cartoon's account. The
// mark also wins the legibility argument outright — an axis, a landmark and two
// contours survive being 50 pixels wide, which is more than can be said for a
// blue egg with two lighter smudges on it.
//
// Max keeps public/brand/max-avatar.*, below, which is a mascot asset and says
// so. He also keeps every surface inside the app, and the loader.
//
// 620 of 1024 leaves the strokes clear of the circle crop the platforms apply,
// without the timidity of the old 560: the mark's furthest pixels sit on the
// axes, where the inscribed circle is at its full radius.
const MARK = 620;
const MARK_XY = (1024 - MARK) / 2;

const profile = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${GRADIENT}
  <rect width="1024" height="1024" fill="url(#bg)"/>
  ${markGlyph({ x: MARK_XY, y: MARK_XY, size: MARK })}
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
