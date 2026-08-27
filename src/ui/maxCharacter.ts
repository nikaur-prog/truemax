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
//   excited     star eyes and a hover-lift, for a result worth celebrating
//   thinking    flat mouth, one raised brow, eyes up-left — reading the data
//   sad         drooping brows and a full frown
//   mad         scowl and gritted teeth — slapstick only, never aimed at a
//               person's numbers
//   concerned   tilted brows, small frown — a number moved the wrong way.
//               Concerned, never disappointed IN the person: he is worried
//               with you, not about you. The mouth is a millimetre of curve
//               away from mockery, which is why it is drawn here once and not
//               improvised per surface.
//
// The register he is drawn in is "device", not "children's television". The
// first version had thick navy colouring-book outlines, googly white-sclera
// eyes, blush marks, a gold antenna ball and a toy chest screen — every one of
// those is a kids'-cartoon tell, and next to an $11.99 price it cheapened the
// exact card he was there to sell. This version is a single strokeless
// silhouette with product-render shading, a dark glass visor, and two soft
// light-bar eyes: closer to EVE and Copilot than to Saturday morning. He stays
// blue, because the mint version disappeared into the brand colour behind him,
// and a mascot the same colour as the furniture is furniture.
// ---------------------------------------------------------------------------

export type MaxMood = "happy" | "excited" | "thinking" | "concerned" | "sad" | "mad";

// Palette. Kept here rather than CSS variables because the character must look
// the same on every surface he appears on, light card or dark takeover.
const BODY_TOP = "#84b5fb";
const BODY_MID = "#4f82e6";
const BODY_DEEP = "#2b52a6";
const GLASS_TOP = "#17294e";
const GLASS_DEEP = "#0a1428";
const LIGHT = "#e9f6ff";
const MINT = "#4bf5c5";

// A four-point star for the excited eyes, centred on (cx, cy).
const star = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r} L${cx + r * 0.32} ${cy - r * 0.32} L${cx + r} ${cy} L${cx + r * 0.32} ${cy + r * 0.32} ` +
  `L${cx} ${cy + r} L${cx - r * 0.32} ${cy + r * 0.32} L${cx - r} ${cy} L${cx - r * 0.32} ${cy - r * 0.32} Z`;

export function maxCharacterMarkup(options: { waving?: boolean; mood?: MaxMood } = {}): string {
  const mood = options.mood ?? "happy";
  return `<svg viewBox="0 0 150 158" class="mx-svg mx-mood-${mood}" aria-hidden="true">
    <defs>
      <!-- Fixed ids are safe because every instance defines identical
           gradients — whichever copy the browser resolves, he looks the same. -->
      <linearGradient id="mxg-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BODY_TOP}"/>
        <stop offset="55%" stop-color="${BODY_MID}"/>
        <stop offset="100%" stop-color="${BODY_DEEP}"/>
      </linearGradient>
      <linearGradient id="mxg-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${GLASS_TOP}"/>
        <stop offset="100%" stop-color="${GLASS_DEEP}"/>
      </linearGradient>
      <linearGradient id="mxg-eye" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#b6dcff"/>
      </linearGradient>
      <!-- A step darker than the body: the paddles sit against the lower
           body, and limbs the same colour as the torso are invisible limbs. -->
      <linearGradient id="mxg-limb" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BODY_DEEP}"/>
        <stop offset="100%" stop-color="#1e3c7d"/>
      </linearGradient>
    </defs>
    <g class="mx-bob">
      <!-- He hovers: a soft pool of shadow, no feet. Feet are a toddler
           proportion; a small hover gap reads as hardware. -->
      <ellipse cx="75" cy="151" rx="28" ry="4.5" fill="rgba(9,22,46,.28)" class="mx-shadow"/>
      <!-- thinking: a thought bubble with messenger dots, floating beside the
           antenna. Part of the drawing rather than DOM around it, so every
           surface that sets the mood gets it for free. -->
      <g class="mx-alt mx-thought">
        <circle cx="103" cy="34" r="3" fill="#ffffff" opacity=".85"/>
        <circle cx="111" cy="24" r="4.4" fill="#ffffff" opacity=".92"/>
        <rect x="103" y="1" width="46" height="25" rx="12.5" fill="#ffffff"/>
        <circle cx="116" cy="13.5" r="3.1" fill="#8b93a4" class="mx-dot" style="--di:0"/>
        <circle cx="126" cy="13.5" r="3.1" fill="#8b93a4" class="mx-dot" style="--di:1"/>
        <circle cx="136" cy="13.5" r="3.1" fill="#8b93a4" class="mx-dot" style="--di:2"/>
      </g>
      <!-- antenna: a thin stem and a lit mint tip, the one brand-coloured
           point on him -->
      <g class="mx-antenna">
        <line x1="75" y1="18" x2="75" y2="8" stroke="${BODY_DEEP}" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="75" cy="6.5" r="7" fill="${MINT}" opacity=".22" class="mx-pulse"/>
        <circle cx="75" cy="6.5" r="3.4" fill="${MINT}"/>
        <circle cx="74" cy="5.4" r="1" fill="#eafff8" class="mx-antenna-glint"/>
      </g>
      <!-- the body: one continuous egg, no outline -->
      <path d="M75 16 C104 16 126 42 126 84 C126 120 104 146 75 146 C46 146 24 120 24 84 C24 42 46 16 75 16 Z"
        fill="url(#mxg-body)"/>
      <!-- top-light specular and a grounded base shade -->
      <ellipse cx="57" cy="34" rx="21" ry="12" fill="#ffffff" opacity=".32"/>
      <path d="M30 106 C38 134 58 146 75 146 C46 146 30 124 30 106 Z" fill="${BODY_DEEP}" opacity=".5"/>
      <!-- the visor: dark glass, where the whole face lives -->
      <rect x="36" y="45" width="78" height="52" rx="24" fill="url(#mxg-glass)"/>
      <rect x="36.8" y="45.8" width="76.4" height="50.4" rx="23.4" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="1.6"/>
      <!-- a faint reflection across the glass -->
      <path d="M44 52 q14 -6 30 -4" fill="none" stroke="#ffffff" stroke-opacity=".14" stroke-width="3.4" stroke-linecap="round"/>
      <!-- eyes: two soft light bars -->
      <g class="mx-eyes">
        <g class="mx-pupils">
          <rect x="53" y="57" width="11.5" height="22" rx="5.75" fill="url(#mxg-eye)"/>
          <rect x="85.5" y="57" width="11.5" height="22" rx="5.75" fill="url(#mxg-eye)"/>
          <circle cx="56.4" cy="61.4" r="1.7" fill="#ffffff"/>
          <circle cx="88.9" cy="61.4" r="1.7" fill="#ffffff"/>
        </g>
        <!-- excited: the bars give way to stars -->
        <g class="mx-alt mx-eye-stars">
          <path d="${star(58.8, 68, 8)}" fill="${LIGHT}"/>
          <path d="${star(91.2, 68, 8)}" fill="${LIGHT}"/>
        </g>
        <!-- lids: glass-coloured, dropped from the top to blink -->
        <rect x="51.5" y="55.5" width="14.5" height="25" rx="7" fill="${GLASS_TOP}" class="mx-lid"/>
        <rect x="84" y="55.5" width="14.5" height="25" rx="7" fill="${GLASS_TOP}" class="mx-lid"/>
      </g>
      <!-- brows: thin light strokes on the glass, one set per mood -->
      <g class="mx-brows-happy">
        <path d="M52 52.5 q6 -3.4 13 -2.2" fill="none" stroke="${LIGHT}" stroke-opacity=".75" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M85 50.3 q7 -1.2 13 2.2" fill="none" stroke="${LIGHT}" stroke-opacity=".75" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <!-- One brow pressed low, the other arched high: the classic puzzling
           face, and the asymmetry is the whole read. -->
      <g class="mx-alt mx-brows-thinking">
        <path d="M52 55.5 q6 .8 13 1" fill="none" stroke="${LIGHT}" stroke-opacity=".75" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M85 46 q7 -4.2 13 -1.4" fill="none" stroke="${LIGHT}" stroke-opacity=".75" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <!-- Concerned, NOT angry. The inner ends of the brows go UP; a brow whose
           inner end drops is a scowl, and a scanner that scowls at somebody
           whose score slipped is the whole failure mode this product exists to
           avoid. He is worried with you, never disappointed in you. -->
      <g class="mx-alt mx-brows-concerned">
        <path d="M52 54 q7 -3.4 13 -5" fill="none" stroke="${LIGHT}" stroke-opacity=".75" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M85 49 q6 1.6 13 5" fill="none" stroke="${LIGHT}" stroke-opacity=".75" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <!-- Sad: the concerned brows, further. Inner ends high, outer ends
           drooping — grief geometry, not anger. -->
      <g class="mx-alt mx-brows-sad">
        <path d="M52 57 q6 -7 13 -10" fill="none" stroke="${LIGHT}" stroke-opacity=".75" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M85 47 q7 3 13 10" fill="none" stroke="${LIGHT}" stroke-opacity=".75" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <!-- Mad: the one face concerned was explicitly built NOT to be — inner
           ends down. It exists for slapstick and for being knocked about,
           and is never pointed at a person's own numbers. -->
      <g class="mx-alt mx-brows-mad">
        <path d="M52 48 q7 3 13 8" fill="none" stroke="${LIGHT}" stroke-opacity=".8" stroke-width="2.6" stroke-linecap="round"/>
        <path d="M85 56 q6 -5 13 -8" fill="none" stroke="${LIGHT}" stroke-opacity=".8" stroke-width="2.6" stroke-linecap="round"/>
      </g>
      <!-- mouths, one per mood, minimal marks on the glass -->
      <g class="mx-mouth-open">
        <path d="M66 84.5 q9 7.5 18 0" fill="none" stroke="${LIGHT}" stroke-width="3" stroke-linecap="round"/>
      </g>
      <path class="mx-alt mx-mouth-flat" d="M67 87 q8 2 16 0" fill="none" stroke="${LIGHT}" stroke-width="3" stroke-linecap="round"/>
      <path class="mx-alt mx-mouth-down" d="M67 89.5 q8 -4.5 16 0" fill="none" stroke="${LIGHT}" stroke-width="3" stroke-linecap="round"/>
      <!-- the full frown, for sad -->
      <path class="mx-alt mx-mouth-frown" d="M66 91 q9 -8 18 0" fill="none" stroke="${LIGHT}" stroke-width="3" stroke-linecap="round"/>
      <!-- gritted, for mad: a tense line with teeth ticks -->
      <g class="mx-alt mx-mouth-grit">
        <path d="M66 88 q9 2 18 0" fill="none" stroke="${LIGHT}" stroke-width="3" stroke-linecap="round"/>
        <path d="M71 87.6 v2.4 M75 88.6 v2.4 M79 87.8 v2.4" fill="none" stroke="${GLASS_DEEP}" stroke-width="1.4" stroke-linecap="round"/>
      </g>
      <!-- The talking mouth: a small bar that opens and closes on a fast loop.
           The shape does not have to match the words, it only has to move with
           them. -->
      <g class="mx-alt mx-mouth-talk">
        <ellipse cx="75" cy="86.5" rx="7.5" ry="5.5" fill="${LIGHT}" class="mx-talk-shape"/>
      </g>
      <!-- Arms LAST, so they paint in front of the body. SVG has no z-index:
           drawn before the body, an arm raised to the sky swung behind the
           silhouette and the celebration read as armless. In front, the rest
           pose still works (the paddles sit on the body's edge) and the chin
           hand can actually touch the chin. -->
      <path class="mx-arm-rest" d="M34 92 C22 94 13 104 15 118 C16.5 127 26 129.5 31 122 C36 115 36 102 34 92 Z" fill="url(#mxg-limb)"/>
      <!-- thinking: the left arm comes up and the hand rests on the chin -->
      <g class="mx-alt mx-arm-chin">
        <path d="M38 118 C28 116 24 108 28 101 C31 96 38 95 43 98 L52 103 C56 106 56 112 52 115 Z" fill="url(#mxg-limb)"/>
        <ellipse cx="54" cy="99" rx="9.5" ry="8" fill="url(#mxg-limb)"/>
      </g>
      <!-- Waving arm. Drawn HANGING DOWN — the raise lives entirely in the
           animation, so every path back to rest is an arm coming down, never
           an arm left in the air. -->
      <g class="mx-arm${options.waving ? " waving" : ""}">
        <path d="M116 92 C128 94 137 104 135 118 C133.5 127 124 129.5 119 122 C114 115 114 102 116 92 Z" fill="url(#mxg-limb)"/>
      </g>
      <!-- Props for the idle acts (ui/maxIdle.ts). All hidden by default and
           shown one at a time by the act's class, so a character standing
           still costs nothing and the whole repertoire is one SVG rather than
           four sprites to keep in sync. -->
      <g class="mx-prop mx-prop-phone">
        <rect x="96" y="96" width="20" height="33" rx="4" fill="#141a24"/>
        <rect x="98.4" y="99" width="15.2" height="25" rx="2" fill="#4d7fe0"/>
        <circle cx="106" cy="126.4" r="1.5" fill="#5c6a7d"/>
      </g>
      <!-- Confusion: a question mark over his head, and the brow set does the
           rest via the mood class. -->
      <g class="mx-prop mx-prop-question">
        <path d="M104 30 q0 -9 8 -9 t8 8 q0 6 -7 8 v4" fill="none" stroke="${MINT}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="113" cy="49" r="2.6" fill="${MINT}"/>
      </g>
      <!-- The board. He is a hovering robot, so it sits under the shadow and
           he rides it without feet, which is exactly as silly as intended. -->
      <g class="mx-prop mx-prop-board">
        <rect x="43" y="146" width="64" height="7" rx="3.5" fill="#1d2a44"/>
        <circle cx="56" cy="155" r="4" fill="#8b93a4"/>
        <circle cx="94" cy="155" r="4" fill="#8b93a4"/>
      </g>
      <!-- Two small notes, for the dancing. -->
      <g class="mx-prop mx-prop-notes">
        <g class="mx-note mx-note-a">
          <ellipse cx="20" cy="52" rx="4" ry="3" fill="${MINT}"/>
          <path d="M24 52 V36" stroke="${MINT}" stroke-width="2.2" stroke-linecap="round"/>
        </g>
        <g class="mx-note mx-note-b">
          <ellipse cx="128" cy="44" rx="3.4" ry="2.6" fill="${MINT}"/>
          <path d="M131.4 44 V30" stroke="${MINT}" stroke-width="2" stroke-linecap="round"/>
        </g>
      </g>
      <!-- A spanner, for tinkering. He is a robot with an antenna and no
           visible fasteners, so there is nothing on him this could plausibly
           tighten, which is the joke. -->
      <g class="mx-prop mx-prop-spanner">
        <path d="M110 92 l14 14" stroke="#8b93a4" stroke-width="6" stroke-linecap="round"/>
        <path d="M106 84 a9 9 0 1 0 9 9 l-5 -5 -4 1 -1 -4 z" fill="#b7bfcd"/>
        <circle cx="126" cy="108" r="3.4" fill="#8b93a4"/>
      </g>
      <!-- A hand mirror, and the kiss that lands on it. The heart is separate
           so it can float off on its own timing while the mirror stays put. -->
      <g class="mx-prop mx-prop-mirror">
        <ellipse cx="116" cy="94" rx="12" ry="14" fill="#cfe6ff" stroke="#8b93a4" stroke-width="2.6"/>
        <ellipse cx="112.5" cy="89" rx="4" ry="5.5" fill="#ffffff" opacity=".7"/>
        <path d="M116 108 v13" stroke="#8b93a4" stroke-width="5" stroke-linecap="round"/>
        <path class="mx-kiss" d="M100 84 c0 -4 6 -4 6 0 c0 -4 6 -4 6 0 c0 5 -6 9 -6 9 s-6 -4 -6 -9 z" fill="#ff8fb1"/>
      </g>
      <!-- The floor he presses up from. Drawn rather than implied, because a
           hovering robot doing press-ups against nothing reads as a glitch. -->
      <g class="mx-prop mx-prop-floor">
        <rect x="36" y="150" width="78" height="4" rx="2" fill="#1d2a44" opacity=".55"/>
        <path class="mx-sweat" d="M110 62 c0 0 5 7 5 10 a5 5 0 0 1 -10 0 c0 -3 5 -10 5 -10 z" fill="#7fd7ff"/>
      </g>
      <!-- Thought bubble for the thinking act. Distinct from .mx-thought,
           which is the messenger-dots bubble the chat uses while a real reply
           is in flight — this one is a daydream, not a status. -->
      <g class="mx-prop mx-prop-idea">
        <circle cx="112" cy="44" r="11" fill="#ffffff" opacity=".92"/>
        <circle cx="124" cy="56" r="4.2" fill="#ffffff" opacity=".92"/>
        <circle cx="130" cy="64" r="2.4" fill="#ffffff" opacity=".92"/>
        <path d="M108 46 q4 -8 8 -3 t-4 6 v2" fill="none" stroke="#7b8598" stroke-width="2.4" stroke-linecap="round"/>
        <circle cx="112" cy="51.5" r="1.5" fill="#7b8598"/>
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
  // Not waving. The sticker mounts wherever it is placed, so `waving: true`
  // meant an arm went up every time one appeared on screen — a greeting nobody
  // triggered, which is the definition of the tic greet() caps at two. He
  // arrives at rest and gets on with the idle repertoire.
  return `<span class="max-sticker" aria-hidden="true">
    <svg viewBox="0 0 144 112" class="max-sticker-sparks">${sparks}</svg>
    ${maxCharacterMarkup()}
  </span>`;
}

// The loading spinner, which is Max rather than a ring.
//
// A rotating border is the one piece of an interface that says nothing about
// whose software you are waiting on. Max is drawn in code, so a loader made out
// of him costs a few kilobytes rather than a GIF, stays crisp at any size, and
// puts the character in front of people during the only moments the product has
// nothing else to show them.
//
// The cycle: he pops in, holds an expression, spins, and morphs out — then the
// next repeat comes back wearing a different face. The moods are stacked as
// separate copies with staggered animation delays rather than being swapped by
// a timer, so the whole thing is CSS and survives a busy main thread, which is
// exactly the condition a loader exists for.
//
// Under prefers-reduced-motion the CSS holds a single still Max instead. A
// spinner is the one place where "no animation at all" would be worse than a
// static mark, and a face that is simply there reads as patient rather than
// broken.
// Happy and excited only. A loader is not a status report: a worried or
// thinking face while you wait suggests something has gone wrong, or that the
// software is struggling, when neither is true. He is pleased to be here and
// pleased about what is coming, and nothing else.
//
// FOUR of them, and that number is load-bearing. The keyframes in style.css
// hand each face over at 25% of the cycle, which is 1/4 exactly; a fifth mood
// here without a matching keyframe edit would leave a gap of empty box between
// two of the faces. The check below fails the build's type pass rather than
// leaving that to be noticed on a slow connection.
const LOADER_MOODS = ["happy", "excited", "happy", "excited"] as const satisfies readonly MaxMood[];
const LOADER_FACES: 4 = LOADER_MOODS.length;

export function maxLoaderMarkup(label = "Loading"): string {
  const faces = LOADER_MOODS.map(
    (mood, i) =>
      `<span class="mx-load-face" style="--i:${i}; --n:${LOADER_FACES}">${maxCharacterMarkup({ mood })}</span>`,
  ).join("");
  return `<span class="mx-load" role="status" aria-live="polite" aria-label="${label}">${faces}</span>`;
}

// The ecstatic moment: jump, arm to the sky, a full spin, land. Triggered by
// code when something genuinely worth celebrating happens — a measured
// improvement, a finished streak — and self-cleaning, so surfaces can call it
// without owning any state.
export function celebrateMax(stage: HTMLElement | null): void {
  const svg = stage?.querySelector<SVGSVGElement>(".mx-svg");
  if (!svg) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  svg.classList.remove("celebrating");
  // Reflow, or re-adding the class in the same frame does nothing.
  void (svg as unknown as HTMLElement).offsetWidth;
  svg.classList.add("celebrating");
  window.setTimeout(() => svg.classList.remove("celebrating"), 1600);
}

// The interactions that cannot be keyframes, because they answer the person
// rather than the clock:
//
//   - the pupils follow the pointer (fine pointers only — on touch there is
//     no hover, and pupils snapping to old tap positions read as a glitch);
//   - poking him gets a happy hop and a wave. A character you can poke and
//     who reacts is the cheapest aliveness there is, and Duolingo has been
//     dining on it for a decade;
//   - on knockable stages, the poke instead SHOCKS him and tips him over, and
//     he stays down — he is a flying bot, he cannot right himself — until the
//     next tap, which flies him back upright. Knockable is opt-in per stage,
//     because on the surfaces where tapping him also opens the chat, a fall
//     would fight the navigation.
//
// Listeners hang off the stage element and self-disarm once it leaves the
// document, so a dismissed offer screen cannot leak a document-level handler.
export function wireMaxInteractions(
  stage: HTMLElement | null,
  options: { knockable?: boolean } = {},
): void {
  if (!stage) return;
  const svg = stage.querySelector<SVGSVGElement>(".mx-svg");
  if (!svg || (svg as unknown as { __mxWired?: boolean } & SVGSVGElement).__mxWired) return;
  (svg as unknown as { __mxWired?: boolean } & SVGSVGElement).__mxWired = true;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The idle repertoire, on every surface where he is big enough to be
  // watched. Not on a knockable stage — a robot lying on his side who breaks
  // into a dance undoes the joke — and not below about forty pixels, where he
  // is a face beside a paragraph and a skateboard would be three grey pixels
  // moving. Measured after a frame, because a stage mounted this tick has not
  // been laid out yet and reports zero.
  if (!options.knockable) {
    requestAnimationFrame(() => {
      if (!svg.isConnected) return;
      if (svg.getBoundingClientRect().width < 40) return;
      void import("./maxIdle.js").then((m) => {
        if (svg.isConnected) m.mountMaxIdle(stage);
      });
    });
  }

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

    if (options.knockable) {
      // Down? This tap is the rescue: he flies back upright.
      if (svg.classList.contains("mx-down")) {
        svg.classList.remove("mx-down");
        svg.classList.add("mx-rise");
        window.setTimeout(() => svg.classList.remove("mx-rise"), 700);
        return;
      }
      if (svg.classList.contains("mx-shock") || svg.classList.contains("mx-rise")) return;
      // Up? The tap shocks him — wide eyes, small o of a mouth — and then
      // tips him over. Two beats, not one: the shock is what makes the fall
      // read as a reaction rather than as a layout bug.
      svg.classList.add("mx-shock");
      window.setTimeout(() => {
        if (!svg.isConnected) return;
        svg.classList.remove("mx-shock");
        svg.classList.add("mx-down");
      }, 420);
      return;
    }

    const sticker = stage.querySelector(".max-sticker") ?? stage;
    for (const el of [svg, sticker]) {
      el.classList.remove("poked");
      // Reflow, or re-adding the class in the same frame does nothing.
      void (el as HTMLElement).offsetWidth;
      el.classList.add("poked");
    }
    greet(svg);
  });

  // Hovering him is the other way to say hello, and it used to be a CSS
  // `:hover` rule — which is what made the hand snap. A hover animation is
  // CANCELLED the moment the pointer leaves, and a cancelled transform jumps,
  // so leaving the box mid-wave threw his arm from shoulder height to his side
  // in a single frame. Driven from here the wave always finishes and the
  // keyframes bring the arm down themselves, whatever the pointer does.
  stage.addEventListener("pointerenter", (e) => {
    if (reduced || (e as PointerEvent).pointerType === "touch") return;
    greet(svg);
  });
}

// ---------------------------------------------------------------------------
// Reactions: Max responding to what just happened, not performing to himself.
//
// The idle repertoire is Max alone; a reaction is Max WITH you, and that
// difference is most of what "Duolingo-level liveliness" actually is. Duo is
// beloved because he answers the moment — right answer, wrong answer, streak —
// with a short, whole-body burst and then gets out of the way. So each
// reaction here is under two seconds, plays once, and restores whatever he was
// doing before.
//
//   cheer — two springy jumps with star eyes; a result worth celebrating just
//           landed. Borrows the excited face for exactly its own duration.
//   nod   — two small forward nods; "said my piece" at the end of a reply.
//   shake — a quick head shake; something went wrong, and he minds with you.
//
// Never queued and never looped: a reaction that fires while another runs
// replaces it, because reacting late is worse than not reacting.
// ---------------------------------------------------------------------------

export type MaxReaction = "cheer" | "nod" | "shake";

const REACTION_MS: Record<MaxReaction, number> = { cheer: 1600, nod: 900, shake: 800 };
const reactionTimers = new WeakMap<SVGSVGElement, number>();

export function reactMax(stage: HTMLElement | null, reaction: MaxReaction): void {
  const svg = stage?.querySelector<SVGSVGElement>(".mx-svg");
  if (!svg) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const pending = reactionTimers.get(svg);
  if (pending) window.clearTimeout(pending);
  svg.classList.remove("mx-react-cheer", "mx-react-nod", "mx-react-shake", "mx-react-face");
  // Reflow, or re-adding a class the same frame restarts nothing.
  void (svg as unknown as HTMLElement).offsetWidth;

  svg.classList.add(`mx-react-${reaction}`);
  // The cheer earns the star eyes; mx-react-face outranks the mood classes in
  // the stylesheet, so whatever mood the surface holds resumes untouched when
  // the class comes off — no bookkeeping of what he was feeling before.
  if (reaction === "cheer") svg.classList.add("mx-react-face");
  reactionTimers.set(
    svg,
    window.setTimeout(() => {
      svg.classList.remove(`mx-react-${reaction}`, "mx-react-face");
      reactionTimers.delete(svg);
    }, REACTION_MS[reaction]),
  );
}

/** How many times this drawing has waved. */
const WAVE_LIMIT = 2;
const waves = new WeakMap<SVGSVGElement, number>();

/**
 * Wave hello, at most twice per drawing.
 *
 * Twice is the number because it is what a person does: you wave when you
 * arrive and maybe once more when they look up. A character who waves on every
 * single hover for the rest of the session is not friendly, he is a tic — and
 * by the fourth time the reader has stopped seeing him at all, which is the
 * expensive failure. After the second he keeps his hand down and earns
 * attention with the idle repertoire instead (ui/maxIdle.ts).
 */
export function greet(svg: SVGSVGElement | null, opts: { big?: boolean } = {}): void {
  if (!svg) return;
  const arm = svg.querySelector<SVGGElement>(".mx-arm");
  if (!arm) return;
  // A big wave is a deliberate entrance, not a greeting, so it is exempt from
  // the count and from it: opening the chat should always get one.
  if (!opts.big) {
    const n = waves.get(svg) ?? 0;
    if (n >= WAVE_LIMIT) return;
    waves.set(svg, n + 1);
  }
  const cls = opts.big ? "waving-big" : "waving";
  // Already mid-wave: leave it alone rather than restarting from zero, which
  // is itself a snap.
  if (arm.classList.contains("waving") || arm.classList.contains("waving-big")) return;
  arm.classList.add(cls);
  const done = () => {
    arm.classList.remove("waving", "waving-big");
    arm.removeEventListener("animationend", done);
  };
  arm.addEventListener("animationend", done);
}
