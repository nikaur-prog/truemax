// ---------------------------------------------------------------------------
// Max, the character. 2D, drawn in code.
//
// One SVG, animated entirely with CSS on named groups — no sprite sheets, no
// video, no per-frame JS. That keeps him a few kilobytes, crisp at any size,
// recolourable from the stylesheet, and cheap enough to idle on screen without
// touching the main thread. The animation classes live in style.css:
//
//   .mx-bob      the whole character breathes and leans
//   .mx-arm      the right arm waves in short bursts, then rests
//   .mx-lid      eyelids blink on a slow cycle
//   .mx-pupils   the eyes glance aside occasionally
//   .mx-antenna  the antenna wobbles against the body's lean
//
// He is a scanner, so he looks like one: a round mint robot with a gold
// antenna, drawn flat with bold outlines. Deliberately NOT a 3D render — the
// flat cartoon reads at 40px, matches the product's drawn silhouettes, and
// leaves room for expression without uncanny territory.
// ---------------------------------------------------------------------------

// Palette. Kept here rather than CSS variables because the character must look
// the same on every surface he appears on, light card or dark takeover.
const MINT = "#4bf5c5";
const MINT_DEEP = "#23cf9e";
const NAVY = "#0b2a26";
const CREAM = "#f7fffc";
const GOLD = "#ffd54a";
const BLUSH = "#17ab84";

// The character. `waving` starts the arm raised so the wave reads from the
// first frame; without it the arm rests and only the idle motion runs.
export function maxCharacterMarkup(options: { waving?: boolean } = {}): string {
  return `<svg viewBox="0 0 150 158" class="mx-svg" aria-hidden="true">
    <g class="mx-bob">
      <!-- shadow -->
      <ellipse cx="75" cy="150" rx="34" ry="6" fill="rgba(9,42,36,.18)" class="mx-shadow"/>
      <!-- left arm, resting against the body -->
      <path d="M45 106 q-12 6 -10 18 q1 7 8 6 q7 -1 8 -9" fill="${MINT_DEEP}" stroke="${NAVY}" stroke-width="3.5" stroke-linejoin="round"/>
      <!-- body -->
      <path d="M50 96 h50 q7 0 7 8 v22 q0 16 -32 16 q-32 0 -32 -16 v-22 q0 -8 7 -8 z"
        fill="${MINT}" stroke="${NAVY}" stroke-width="3.5" stroke-linejoin="round"/>
      <!-- chest screen: the one place his scanner nature shows -->
      <rect x="62" y="110" width="26" height="17" rx="6" fill="${NAVY}"/>
      <path d="M66 118 l5 0 3 -4 3 7 3 -3 5 0" fill="none" stroke="${MINT}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="mx-pulse"/>
      <!-- feet -->
      <path d="M58 141 q-2 8 4 8 q7 0 6 -7" fill="${MINT_DEEP}" stroke="${NAVY}" stroke-width="3.2" stroke-linejoin="round"/>
      <path d="M92 141 q2 8 -4 8 q-7 0 -6 -7" fill="${MINT_DEEP}" stroke="${NAVY}" stroke-width="3.2" stroke-linejoin="round"/>
      <!-- waving arm: pivots at the shoulder -->
      <g class="mx-arm${options.waving ? " waving" : ""}">
        <path d="M104 108 q16 -4 20 -18 q2 -8 -5 -9 q-7 -1 -10 6 q-4 10 -12 13" fill="${MINT_DEEP}" stroke="${NAVY}" stroke-width="3.5" stroke-linejoin="round"/>
      </g>
      <!-- antenna -->
      <g class="mx-antenna">
        <line x1="75" y1="22" x2="75" y2="10" stroke="${NAVY}" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="75" cy="7" r="5.5" fill="${GOLD}" stroke="${NAVY}" stroke-width="3"/>
      </g>
      <!-- head -->
      <circle cx="75" cy="60" r="40" fill="${MINT}" stroke="${NAVY}" stroke-width="3.5"/>
      <!-- cheeks -->
      <ellipse cx="46" cy="72" rx="6" ry="4.4" fill="${BLUSH}" opacity=".55"/>
      <ellipse cx="104" cy="72" rx="6" ry="4.4" fill="${BLUSH}" opacity=".55"/>
      <!-- eyes -->
      <g class="mx-eyes">
        <ellipse cx="59" cy="56" rx="10.5" ry="13" fill="${CREAM}" stroke="${NAVY}" stroke-width="3"/>
        <ellipse cx="91" cy="56" rx="10.5" ry="13" fill="${CREAM}" stroke="${NAVY}" stroke-width="3"/>
        <g class="mx-pupils">
          <circle cx="61" cy="58" r="4.6" fill="${NAVY}"/>
          <circle cx="93" cy="58" r="4.6" fill="${NAVY}"/>
          <circle cx="62.6" cy="56.2" r="1.6" fill="${CREAM}"/>
          <circle cx="94.6" cy="56.2" r="1.6" fill="${CREAM}"/>
        </g>
        <!-- lids: same fill as the head, scaled down from the top to blink -->
        <ellipse cx="59" cy="56" rx="11.5" ry="14" fill="${MINT}" class="mx-lid"/>
        <ellipse cx="91" cy="56" rx="11.5" ry="14" fill="${MINT}" class="mx-lid"/>
      </g>
      <!-- brows: slightly raised, permanently interested -->
      <path d="M50 38 q8 -5 17 -3" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M83 35 q9 -2 17 3" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
      <!-- open smile with a spot of tongue -->
      <path d="M63 76 q12 12 24 0 q-3 12 -12 12 q-9 0 -12 -12 z" fill="${NAVY}"/>
      <path d="M70 84 q5 4 10 0 q-1 5 -5 5 q-4 0 -5 -5 z" fill="${BLUSH}"/>
    </g>
  </svg>`;
}

// The white sticker he swoops in on, Duolingo-style but ours: a tilted rounded
// blob with twinkling sparks. The sparkle timing offsets come from the index so
// they never pulse in unison.
export function maxStickerMarkup(): string {
  const sparks = [
    [12, 24, 0],
    [128, 16, 1],
    [136, 86, 2],
    [8, 96, 3],
  ]
    .map(
      ([x, y, i]) =>
        `<path d="M${x} ${y} l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" class="mx-spark" style="--si:${i}" fill="currentColor"/>`,
    )
    .join("");
  return `<span class="max-sticker" aria-hidden="true">
    <svg viewBox="0 0 144 112" class="max-sticker-sparks">${sparks}</svg>
    ${maxCharacterMarkup({ waving: true })}
  </span>`;
}
