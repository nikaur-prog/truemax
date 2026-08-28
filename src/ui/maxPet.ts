import { maxCharacterMarkup, wireMaxInteractions } from "./maxCharacter.js";
import { isMaxChatOpen } from "./maxChat.js";
import type { MaxChatContext } from "../engine/maxContext.js";

// ---------------------------------------------------------------------------
// Max the pet.
//
// For accounts that HOLD the Max plan, the way into the chat is not a button —
// it is him, peeking out from the edge of the screen like he is playing
// hide-and-seek, which is the whole personality of the product in one detail.
// Tap him and he pops out; the chat opens with a greeting about the scan on
// screen.
//
// Deliberately only for plan holders and only for adults. For everybody else
// the results screen carries the CTA card instead — the person who has not
// bought needs the advertisement, the person who has needs the access.
// ---------------------------------------------------------------------------

let host: HTMLButtonElement | null = null;
let context: MaxChatContext | null = null;

// ---------------------------------------------------------------------------
// Whether he is welcome.
//
// A character who wanders around the edge of the screen is a personality to
// most people and an irritation to some, and the second group currently has no
// way to say so — which is how a charming detail turns into the reason somebody
// stops opening the app. It is one line of storage to let them decide.
//
// Hiding him never hides the FEATURE. He is one of three doors into the same
// chat: the Max tab and the ask box on the overview both stay exactly where
// they were. This setting is about a cartoon standing on their results, not
// about access to the thing they are paying for.
// ---------------------------------------------------------------------------
const HIDDEN_KEY = "truemax.petHidden";
const TIP_KEY = "truemax.petTipSeen";

export function isPetHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    // Storage unavailable: show him. The default has to be the product working
    // as designed, not a silent opt-out nobody chose.
    return false;
  }
}

/** Exported so the settings screen and Max himself can both call it. */
export function setPetHidden(hidden: boolean, chatContext?: MaxChatContext): void {
  try {
    localStorage.setItem(HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    /* storage disabled: the choice holds for this view and no longer */
  }
  if (hidden) {
    unmountMaxPet();
  } else if (chatContext ?? context) {
    mountMaxPet((chatContext ?? context)!);
  }
}

export function mountMaxPet(chatContext: MaxChatContext): void {
  context = chatContext;
  if (host || isPetHidden()) return;

  host = document.createElement("button");
  host.type = "button";
  // Unrevealed until armMaxPetReveal fires — covers the loose-spot case,
  // where he stands in open page space and the edge cannot hide him.
  host.className = "maxpet unrevealed";
  host.setAttribute("aria-label", "Coach Max");
  // Waving is opt-in, and this is the one place that earns it: he is arriving.
  // The CSS runs it twice and then leaves the arm down for good, so the
  // greeting is an event rather than the idle loop it used to be.
  host.innerHTML = maxCharacterMarkup({ mood: "happy", waving: true });
  document.body.appendChild(host);

  // His eyes follow the pointer, and TAPS are the fight club rather than a
  // chat opener: pushing him is the joke, and the chat keeps its two proper
  // doors (the ask box on the analysis and the Coach tab), both of which say
  // what they do. A character you can shove is worth more than a third
  // button.
  wireMaxInteractions(host, { fight: true });

  // Back to wherever he was left, on whichever side of the screen that was.
  const spot = loadSpot();
  if (spot) applySpot(host, spot);
  wireDrag(host);

  // He does NOT appear yet. Mounting used to peek him out on a timer, which
  // put a cartoon on the corner of the score while it was still being read.
  // He now waits for armMaxPetReveal() — the person opening a region tab —
  // plus ten seconds, so by the time he hauls himself out the first read is
  // genuinely over. See reveal() for the entrance itself.
}

/**
 * The results screen calls this when a region tab other than Coach Max's
 * read is opened — the honest signal that the first read is over and the
 * person is exploring. Ten seconds later, he makes his entrance. One-shot.
 */
export function armMaxPetReveal(): void {
  if (!host || revealed || revealTimer) return;
  revealTimer = window.setTimeout(reveal, 10_000);
}

let revealTimer: number | null = null;
let revealed = false;

function reveal(): void {
  revealTimer = null;
  if (!host || revealed) return;
  revealed = true;
  host.classList.remove("unrevealed");
  const spot = loadSpot();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced && (!spot || (spot.kind === "tucked" && spot.side === "right"))) {
    // The entrance: fingers over the edge first, an effort wobble, then the
    // haul out — landing in the familiar peek. Driven by one keyframe run;
    // the peek class takes over at its final pose so nothing jumps. A
    // fallback timer stands in for animationend in case the animation is
    // interrupted — a Max stuck invisible is the worst outcome available.
    host.classList.add("hauling");
    const settle = () => {
      host?.classList.remove("hauling");
      host?.classList.add("peeking");
    };
    host.addEventListener("animationend", settle, { once: true });
    window.setTimeout(settle, 2200);
  } else if (!spot || spot.kind === "tucked") {
    host.classList.add("peeking");
  }
  // The stay-or-hide question arrives with him, once ever — asking is only
  // considerate when he has just interrupted, which is exactly now.
  window.setTimeout(showPetTipOnce, 1900);
}

export function unmountMaxPet(): void {
  if (revealTimer) window.clearTimeout(revealTimer);
  revealTimer = null;
  revealed = false;
  host?.remove();
  host = null;
  context = null;
}

// ---------------------------------------------------------------------------
// Picking him up.
//
// He starts tucked into the right edge because that is where a thumb is, and
// that is exactly why he cannot STAY there: on a phone he sits over the right
// half of the results column, which is where the numbers are. Rather than
// pick a side and be wrong for the left-handed half of the world, he moves.
//
// Two resting states, and the difference is the whole feel of it:
//
//   tucked  — hooked into the left or right edge at whatever height you left
//             him, still doing the half-out peek. This is home.
//   loose   — standing anywhere on the screen, full-bodied, no peek.
//
// Drop him near an edge and he hooks back in; drop him in open space and he
// stays. Nothing is modal and nothing is a setting: the gesture is the whole
// interface.
//
// Kept in this module rather than as a generic drag helper because the tuck
// rule is specific to him — it is the difference between a character with a
// hiding place and a floating button somebody can lose behind the fold.
// ---------------------------------------------------------------------------

type Spot =
  | { kind: "tucked"; side: "left" | "right"; y: number }
  | { kind: "loose"; x: number; y: number };

const SPOT_KEY = "truemax.maxSpot";

// How close to an edge counts as tucking him back in. Generous, because the
// gesture people actually make is a shove toward the side rather than a
// careful landing, and a near miss that leaves him floating reads as the tuck
// being broken rather than as their aim being off.
const DOCK_ZONE = 76;

// Movement that separates a drag from a tap. Below this he opens the chat, so
// a slightly shaky press still does what it looks like it does.
const DRAG_SLOP = 6;

function loadSpot(): Spot | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SPOT_KEY) ?? "null") as Spot | null;
    if (raw?.kind === "tucked" && (raw.side === "left" || raw.side === "right")) return raw;
    if (raw?.kind === "loose" && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return raw;
  } catch {
    /* unparseable or storage disabled: he goes back to his default corner */
  }
  return null;
}

function saveSpot(spot: Spot): void {
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(spot));
  } catch {
    /* storage disabled: he still moves, he just forgets between visits */
  }
}

// Clamped on the way OUT rather than on the way in, because the window he was
// left in is not the window he is being restored into: a phone rotated to
// landscape, or a desktop window dragged narrow, would otherwise restore him
// off-screen with no way to get him back.
function applySpot(el: HTMLButtonElement, spot: Spot): void {
  const maxY = Math.max(0, window.innerHeight - el.offsetHeight - 8);
  const y = Math.min(Math.max(8, spot.y), maxY);

  el.style.top = `${y}px`;
  el.style.bottom = "auto";

  if (spot.kind === "tucked") {
    el.classList.remove("loose");
    el.classList.toggle("left", spot.side === "left");
    el.style.left = spot.side === "left" ? "0px" : "auto";
    el.style.right = spot.side === "left" ? "auto" : "0px";
    return;
  }

  const maxX = Math.max(0, window.innerWidth - el.offsetWidth - 8);
  el.classList.add("loose");
  el.classList.remove("left");
  el.style.left = `${Math.min(Math.max(8, spot.x), maxX)}px`;
  el.style.right = "auto";
}

function wireDrag(el: HTMLButtonElement): void {
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let dragging = false;

  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const box = el.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    originX = box.left;
    originY = box.top;
    dragging = false;
    el.setPointerCapture(event.pointerId);
  });

  el.addEventListener("pointermove", (event) => {
    if (!el.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) < DRAG_SLOP) return;

    if (!dragging) {
      dragging = true;
      // The peek pose is a transform, and a transform fights absolute
      // positioning: he would drift by half his own width the moment he was
      // picked up. Dragging strips the pose and gives it back on release.
      el.classList.add("dragging");
    }
    // Follows the finger exactly, with no transition — a lerp here reads as
    // lag, not as smoothing, because the reference point is the finger itself.
    el.style.left = `${originX + dx}px`;
    el.style.right = "auto";
    el.style.top = `${originY + dy}px`;
    el.style.bottom = "auto";
  });

  const settle = (event: PointerEvent) => {
    if (!el.hasPointerCapture(event.pointerId)) return;
    el.releasePointerCapture(event.pointerId);
    if (!dragging) return;
    el.classList.remove("dragging");

    const box = el.getBoundingClientRect();
    const nearLeft = box.left <= DOCK_ZONE;
    const nearRight = window.innerWidth - box.right <= DOCK_ZONE;

    // Ties go to the closer edge, which only matters on a window narrow enough
    // for both zones to overlap — a phone held in portrait, i.e. most of them.
    const spot: Spot =
      nearLeft || nearRight
        ? {
            kind: "tucked",
            side:
              nearLeft && nearRight
                ? box.left <= window.innerWidth - box.right
                  ? "left"
                  : "right"
                : nearLeft
                  ? "left"
                  : "right",
            y: box.top,
          }
        : { kind: "loose", x: box.left, y: box.top };

    applySpot(el, spot);
    saveSpot(spot);
    // Flagged here rather than in a second pointerup listener: this one runs
    // first and clears `dragging`, so anything downstream reading that flag
    // would always see false and let the click through.
    el.classList.add("just-dragged");
    window.setTimeout(() => el.classList.remove("just-dragged"), 0);
    dragging = false;
  };

  el.addEventListener("pointerup", settle);
  el.addEventListener("pointercancel", settle);

  // A drag that ends on him must not also open the chat. Capture phase so this
  // runs before the click handler that mounts with him.
  el.addEventListener(
    "click",
    (event) => {
      if (!el.classList.contains("just-dragged")) return;
      event.stopImmediatePropagation();
      event.preventDefault();
    },
    true,
  );
  // He should not be left hanging off a resized window.
  window.addEventListener("resize", () => {
    const spot = loadSpot();
    if (spot) applySpot(el, spot);
  });
}

// The one time he mentions that he can be asked to leave.
//
// Shown once, and late — several seconds after he arrives, so it reads as an
// aside rather than as the app opening with an apology for its own character.
// He offers it himself, in his own voice, because "you may turn this off" from
// the interface is an admission and "want me to get out of the way?" from him
// is just a considerate housemate.
//
// Both answers are equally easy to give. A dismissal that only offers the
// polite option is not offering anything.
function showPetTipOnce(): void {
  try {
    if (localStorage.getItem(TIP_KEY) === "1") return;
  } catch {
    // Cannot remember whether it has been shown, so do not show it. Repeating
    // this every single visit would be exactly the nag it is meant to prevent.
    return;
  }

  // Called from reveal(), which is itself gated on the person having moved
  // past Coach Max's read and ten further seconds — the "first read is over"
  // signal this function used to infer from scrolling. By the time he has
  // hauled himself out, asking is exactly on time.
  show();

  function show(): void {
    if (!host || isMaxChatOpen()) return;
    const tip = document.createElement("div");
    tip.className = "maxpet-tip";
    tip.setAttribute("role", "status");
    tip.innerHTML = `<p>Want me out of the way? I'll still be in the Coach tab.</p>
      <div class="maxpet-tip-actions">
        <button type="button" data-pet-tip="hide">Hide Max</button>
        <button type="button" data-pet-tip="keep" class="on">Keep him</button>
      </div>`;
    document.body.appendChild(tip);
    // Positioned against the pet's own corner so it never covers him — he is
    // the subject of the sentence and hiding him behind it would be absurd.
    const box = host.getBoundingClientRect();
    const nearLeft = box.left + box.width / 2 < window.innerWidth / 2;
    tip.style.bottom = `${Math.max(12, window.innerHeight - box.top + 10)}px`;
    if (nearLeft) tip.style.left = `${Math.max(12, box.left)}px`;
    else tip.style.right = `${Math.max(12, window.innerWidth - box.right)}px`;

    const done = (hide: boolean) => {
      try {
        localStorage.setItem(TIP_KEY, "1");
      } catch {
        /* asked and answered for this view only */
      }
      window.clearTimeout(fade);
      window.removeEventListener("scroll", walkAway);
      tip.remove();
      if (hide) setPetHidden(true);
    };
    tip.querySelector('[data-pet-tip="hide"]')?.addEventListener("click", () => done(true));
    tip.querySelector('[data-pet-tip="keep"]')?.addEventListener("click", () => done(false));

    // A question left hanging becomes furniture standing on the metric rows.
    // Ignoring it IS an answer — no thanks, leave things as they are — so it
    // withdraws on its own: after a while, or the moment the person scrolls
    // on past it. Either way it counts as asked; the same choice stays in
    // settings, where a nag-free second chance belongs.
    const askedAt = window.scrollY;
    const fade = window.setTimeout(() => done(false), 12000);
    const walkAway = () => {
      if (Math.abs(window.scrollY - askedAt) > 220) done(false);
    };
    window.addEventListener("scroll", walkAway, { passive: true });
  }
}
