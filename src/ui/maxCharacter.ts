// ---------------------------------------------------------------------------
// Max, the character. 2D, drawn in code.
//
// One SVG, animated entirely with CSS on named groups — no sprite sheets, no
// video, no per-frame JS for the idle. That keeps him a few kilobytes, crisp
// at any size, recolourable from the stylesheet, and cheap enough to idle on
// screen without touching the main thread. The animation classes live in
// style.css:
//
//   .mx-bob      the whole character breathes, leans, and subtly squashes
//   .mx-arm      the right arm waves in short bursts, then rests
//   .mx-lid      eyelids blink on a slow cycle
//   .mx-pupils   the eyes glance aside occasionally (or follow the pointer,
//                see wireMaxInteractions)
//   .mx-antenna  the antenna wobbles against the body's lean
//
// MOODS. Every expression part is drawn once, in this file, and shown or
// hidden by a mood class on the root SVG — so a mood change is a class swap,
// not a re-render, and a new surface gets the whole expression range for free:
//
//   happy       the default: raised brows, open smile
//   excited     star eyes, for a measured improvement worth celebrating
//   thinking    flat mouth, one raised brow, eyes up-left — reading the data
//   concerned   tilted brows, small frown — a number moved the wrong way.
//               Concerned, never disappointed IN the person: he is worried
//               with you, not about you. The mouth is a millimetre of curve
//               away from mockery, which is why it is drawn here once and not
//               improvised per surface.
//
// He is a scanner, so he looks like one: a round blue robot with a gold
// antenna, drawn flat with bold outlines and soft top-light shading.
// Deliberately NOT a 3D render — the flat cartoon reads at 40px, matches the
// product's drawn silhouettes, and leaves room for expression without uncanny
// territory.
// ---------------------------------------------------------------------------

export type MaxMood = "happy" | "excited" | "thinking" | "concerned";

// Palette. Kept here rather than CSS variables because the character must look
// the same on every surface he appears on, light card or dark takeover.
// Blue, not mint. He reads as a device rather than as part of the interface —
// the mint version disappeared into the brand colour behind him, and a mascot
// the same colour as the furniture is furniture.
const BLUE = "#5aa9ff";
const BLUE_DEEP = "#2f7fe0";
const NAVY = "#0a1f3d";
const CREAM = "#f6fbff";
const GOLD = "#ffd54a";
const BLUSH = "#3f8fd8";

// A four-point star for the excited eyes, centred on (cx, cy).
const star = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r} L${cx + r * 0.32} ${cy - r * 0.32} L${cx + r} ${cy} L${cx + r * 0.32} ${cy + r * 0.32} ` +
  `L${cx} ${cy + r} L${cx - r * 0.32} ${cy + r * 0.32} L${cx - r} ${cy} L${cx - r * 0.32} ${cy - r * 0.32} Z`;

export function maxCharacterMarkup(options: { waving?: boolean; mood?: MaxMood } = {}): string {
  const mood = options.mood ?? "happy";
  return `<svg viewBox="0 0 150 158" class="mx-svg mx-mood-${mood}" aria-hidden="true">
    <defs>
      <!-- Top-light shading: the one concession to depth a flat cartoon needs.
           Fixed ids are safe because every instance defines identical
           gradients — whichever copy the browser resolves, he looks the same. -->
      <radialGradient id="mxg-head" cx="38%" cy="26%" r="85%">
        <stop offset="0%" stop-color="#a9d4ff"/>
        <stop offset="55%" stop-color="${BLUE}"/>
        <stop offset="100%" stop-color="#2f7fe0"/>
      </radialGradient>
      <linearGradient id="mxg-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BLUE}"/>
        <stop offset="100%" stop-color="${BLUE_DEEP}"/>
      </linearGradient>
      <linearGradient id="mxg-limb" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6fb6ff"/>
        <stop offset="100%" stop-color="${BLUE_DEEP}"/>
      </linearGradient>
    </defs>
    <g class="mx-bob">
      <!-- shadow -->
      <ellipse cx="75" cy="150" rx="34" ry="6" fill="rgba(10,31,61,.18)" class="mx-shadow"/>
      <!-- left arm, resting against the body -->
      <path d="M45 106 q-12 6 -10 18 q1 7 8 6 q7 -1 8 -9" fill="url(#mxg-limb)" stroke="${NAVY}" stroke-width="3.5" stroke-linejoin="round"/>
      <!-- body -->
      <path d="M50 96 h50 q7 0 7 8 v22 q0 16 -32 16 q-32 0 -32 -16 v-22 q0 -8 7 -8 z"
        fill="url(#mxg-body)" stroke="${NAVY}" stroke-width="3.5" stroke-linejoin="round"/>
      <!-- chest screen: the one place his scanner nature shows -->
      <rect x="62" y="110" width="26" height="17" rx="6" fill="${NAVY}"/>
      <path d="M66 118 l5 0 3 -4 3 7 3 -3 5 0" fill="none" stroke="${BLUE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="mx-pulse"/>
      <!-- feet -->
      <path d="M58 141 q-2 8 4 8 q7 0 6 -7" fill="${BLUE_DEEP}" stroke="${NAVY}" stroke-width="3.2" stroke-linejoin="round"/>
      <path d="M92 141 q2 8 -4 8 q-7 0 -6 -7" fill="${BLUE_DEEP}" stroke="${NAVY}" stroke-width="3.2" stroke-linejoin="round"/>
      <!-- Waving arm, pivoting at the shoulder.
           Drawn HANGING DOWN, which is the resting pose. The previous version
           drew it already raised, so the wave keyframes returned him to an arm
           held permanently in the air: he looked like he was signalling an
           aircraft rather than saying hello. The raise is now entirely in the
           animation, which means every path back to zero is an arm coming
           down. -->
      <g class="mx-arm${options.waving ? " waving" : ""}">
        <path d="M104 108 q16 4 20 18 q2 8 -5 9 q-7 1 -10 -6 q-4 -10 -12 -13" fill="url(#mxg-limb)" stroke="${NAVY}" stroke-width="3.5" stroke-linejoin="round"/>
      </g>
      <!-- antenna -->
      <g class="mx-antenna">
        <line x1="75" y1="22" x2="75" y2="10" stroke="${NAVY}" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="75" cy="7" r="5.5" fill="${GOLD}" stroke="${NAVY}" stroke-width="3"/>
        <circle cx="73.4" cy="5.4" r="1.5" fill="#fff2c4" class="mx-antenna-glint"/>
      </g>
      <!-- head -->
      <circle cx="75" cy="60" r="40" fill="url(#mxg-head)" stroke="${NAVY}" stroke-width="3.5"/>
      <!-- specular sweep on the crown -->
      <path d="M50 36 q10 -11 24 -9" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4.5" stroke-linecap="round"/>
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
        <!-- excited: the pupils give way to stars -->
        <g class="mx-alt mx-eye-stars">
          <path d="${star(60, 56.5, 6.5)}" fill="${GOLD}" stroke="${NAVY}" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="${star(92, 56.5, 6.5)}" fill="${GOLD}" stroke="${NAVY}" stroke-width="1.6" stroke-linejoin="round"/>
        </g>
        <!-- lids: same fill as the head, scaled down from the top to blink -->
        <ellipse cx="59" cy="56" rx="11.5" ry="14" fill="${BLUE}" class="mx-lid"/>
        <ellipse cx="91" cy="56" rx="11.5" ry="14" fill="${BLUE}" class="mx-lid"/>
      </g>
      <!-- brows, one set per mood -->
      <g class="mx-brows-happy">
        <path d="M50 38 q8 -5 17 -3" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M83 35 q9 -2 17 3" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
      </g>
      <g class="mx-alt mx-brows-thinking">
        <path d="M50 40 q8 -2 17 -1" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M83 33 q9 -4 17 1" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
      </g>
      <!-- Concerned, NOT angry. The inner ends of the brows go UP; a brow whose
           inner end drops is a scowl, and a scanner that scowls at somebody
           whose score slipped is the whole failure mode this product exists to
           avoid. He is worried with you, never disappointed in you. -->
      <g class="mx-alt mx-brows-concerned">
        <path d="M50 41 q9 -5 17 -7" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M83 34 q9 2 17 7" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
      </g>
      <!-- mouths, one per mood -->
      <g class="mx-mouth-open">
        <path d="M63 76 q12 12 24 0 q-3 12 -12 12 q-9 0 -12 -12 z" fill="${NAVY}"/>
        <path d="M70 84 q5 4 10 0 q-1 5 -5 5 q-4 0 -5 -5 z" fill="${BLUSH}"/>
      </g>
      <path class="mx-alt mx-mouth-flat" d="M67 81 q8 2.5 16 0" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
      <path class="mx-alt mx-mouth-down" d="M67 84 q8 -5 16 0" fill="none" stroke="${NAVY}" stroke-width="3.2" stroke-linecap="round"/>
      <!-- The talking mouth. Shown only while .speaking is on the root and
           scaled vertically on a fast loop, which is how every 2D character
           since Saturday morning television has "spoken": the shape does not
           have to match the words, it only has to move with them. -->
      <g class="mx-alt mx-mouth-talk">
        <ellipse cx="75" cy="80" rx="12" ry="9" fill="${NAVY}" class="mx-talk-shape"/>
        <ellipse cx="75" cy="84" rx="5" ry="3.4" fill="${BLUSH}" class="mx-talk-tongue"/>
      </g>
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

// The two interactions that cannot be keyframes, because they answer the
// person rather than the clock:
//
//   - the pupils follow the pointer (fine pointers only — on touch there is
//     no hover, and pupils snapping to old tap positions read as a glitch);
//   - poking him gets a happy hop, a wave, and a burst of sparks. A character
//     you can poke and who reacts is the cheapest aliveness there is, and
//     Duolingo has been dining on it for a decade.
//
// Listeners hang off the stage element and self-disarm once it leaves the
// document, so a dismissed offer screen cannot leak a document-level handler.
export function wireMaxInteractions(stage: HTMLElement | null): void {
  if (!stage) return;
  const svg = stage.querySelector<SVGSVGElement>(".mx-svg");
  if (!svg || (svg as unknown as { __mxWired?: boolean } & SVGSVGElement).__mxWired) return;
  (svg as unknown as { __mxWired?: boolean } & SVGSVGElement).__mxWired = true;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const pupils = svg.querySelector<SVGGElement>(".mx-pupils");
  if (pupils && !reduced && window.matchMedia("(pointer: fine)").matches) {
    const onMove = (event: PointerEvent) => {
      if (!stage.isConnected) {
        document.removeEventListener("pointermove", onMove);
        return;
      }
      const box = svg.getBoundingClientRect();
      if (!box.width) return;
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height * 0.38);
      const reach = Math.hypot(dx, dy) || 1;
      // Clamp to the white of the eye. Beyond ~3px the pupil crosses the iris
      // outline and he stops looking attentive and starts looking unwell.
      const r = Math.min(3, reach / 40);
      pupils.style.animation = "none";
      pupils.style.transform = `translate(${((dx / reach) * r).toFixed(2)}px, ${((dy / reach) * r).toFixed(2)}px)`;
    };
    document.addEventListener("pointermove", onMove, { passive: true });
  }

  stage.addEventListener("click", () => {
    if (reduced) return;
    const sticker = stage.querySelector(".max-sticker") ?? stage;
    for (const el of [svg, sticker]) {
      el.classList.remove("poked");
      // Reflow, or re-adding the class in the same frame does nothing.
      void (el as HTMLElement).offsetWidth;
      el.classList.add("poked");
    }
    const arm = svg.querySelector(".mx-arm");
    arm?.classList.remove("waving");
    void (arm as HTMLElement | null)?.offsetWidth;
    arm?.classList.add("waving");
  });
}
