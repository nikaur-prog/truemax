import { SKIN_CONCERN_CATALOG } from "./skinConcernCatalog.js";

// ---------------------------------------------------------------------------
// What the BEFORE shot shows, and what the AFTER clears.
//
// THE RULE THIS WHOLE FILE EXISTS TO ENFORCE: a glow-up does not change your
// skull. Skin, grooming, body fat and sleep change. Bone does not.
//
// The generator used to take a free-text box, and the box was the problem. It
// invited "softer jawline", "weak chin", "narrow face" — descriptions of
// structure — and the model duly produced two people with different bone
// structure and called it a before and after. Every viewer sees that instantly
// even when they cannot say why, and it is also simply a lie about what any
// protocol can do.
//
// So the flaws are a fixed list of things that are genuinely reversible, each
// carrying the exact phrasing for both halves of the pair: what to ADD to the
// before, and what to CLEAR in the after. The identity is held by the pixels
// (the after is an edit of the before, see api/ai-image.ts), and this file
// holds the only thing allowed to differ between them.
//
// WHAT IS DELIBERATELY ABSENT, and each exclusion is load-bearing:
//
//   Structure.  No jaw width, no chin projection, no cheekbones, no facial
//               thirds. Those are the measurements the product SCORES, and a
//               demo implying a routine moves them would contradict the report
//               it is advertising.
//   Scars.      They fade; they do not clear. Showing one gone in an after
//               promises something no protocol delivers.
//   Lighting.   No "bad lighting" or "better camera" flaw, and this is the
//               important one. A before shot in flat light next to an after in
//               good light is the single most common lie in glow-up content:
//               nothing about the person changed. Both halves are pinned to the
//               same framing, background and light in the prompt itself.
//
// The `concern` field ties a flaw to the catalogue the PRODUCT already reasons
// about, so a generated before carries something the plan can genuinely speak
// to. That is what stops this being decoration bolted onto the side of a
// measurement product.
// ---------------------------------------------------------------------------

export interface FaceFlaw {
  id: string;
  /** The chip, as the operator reads it. */
  label: string;
  /** Added to the BEFORE prompt. Present tense, describing the photograph. */
  add: string;
  /** Named in the AFTER edit. Always a removal, never a description of a face. */
  clear: string;
  /**
   * The SKIN_CONCERN_CATALOG id this maps to, where one exists.
   *
   * Not every flaw has one: grooming and sleep are real and reversible and are
   * nobody's dermatological concern. Where it IS set, the plan the video shows
   * can be the real plan for the thing on screen.
   */
  concern?: string;
}

export const FACE_FLAWS: readonly FaceFlaw[] = [
  {
    id: "inflamed-spots",
    label: "Inflamed spots",
    add: "scattered small inflamed red spots across the cheeks, chin and jawline",
    clear: "the inflamed spots",
    concern: "inflamed-spot-pattern",
  },
  {
    id: "congested-pores",
    label: "Congested pores",
    add: "visibly congested pores and blackheads across the nose and chin",
    clear: "the congested pores and blackheads",
    concern: "comedonal-pattern",
  },
  {
    id: "post-blemish-marks",
    label: "Post-blemish marks",
    add: "flat brown and pink marks where old spots have healed, across the cheeks",
    clear: "the leftover marks from old spots, evening the tone",
  },
  {
    id: "redness",
    label: "Redness and flushing",
    add: "persistent redness across the cheeks and nose",
    clear: "the redness, calming the skin to an even tone",
  },
  {
    id: "dry-flaky",
    label: "Dry, flaky texture",
    add: "dry flaking patches and rough texture around the nose, brows and mouth",
    clear: "the dryness and flaking, leaving smooth hydrated skin",
  },
  {
    id: "oily-shine",
    label: "Oily shine",
    add: "heavy oily shine across the forehead, nose and chin",
    clear: "the excess shine, leaving a natural matte finish",
  },
  {
    id: "dull-tone",
    label: "Dull, uneven tone",
    add: "dull sallow skin with uneven patchy tone",
    clear: "the dullness, leaving bright even skin",
  },
  {
    id: "sun-damage",
    label: "Sun damage",
    add: "sun-damaged skin with uneven brown pigmentation and freckled patches across the cheeks and forehead",
    clear: "the uneven pigmentation, evening the skin tone",
  },
  {
    id: "dark-circles",
    label: "Dark circles",
    add: "dark shadowed circles under both eyes",
    clear: "the dark circles under the eyes",
  },
  {
    id: "poor-sleep",
    label: "Poor sleep",
    add: "a sleep-deprived look: heavy upper eyelids, dull reddened whites of the eyes",
    clear: "the sleep-deprived look, leaving open rested eyes and clear whites",
  },
  {
    id: "puffiness",
    label: "Puffiness",
    add: "a puffy, water-retained look through the under-eyes and lower face",
    clear: "the puffiness and water retention",
  },
  {
    id: "soft-jawline",
    label: "Soft jawline (body fat)",
    // FAT, NOT BONE, and the wording carries the whole distinction. A layer of
    // facial fat over a jaw is genuinely reversible; the jaw underneath is the
    // same jaw in both shots and must be.
    add: "a soft layer of facial fat blurring the jawline and under the chin",
    clear: "the softness over the jaw, so the same underlying jawline reads clearly. Do not reshape the bone",
  },
  {
    id: "razor-bumps",
    label: "Razor bumps",
    add: "razor bumps and shaving irritation along the neck and jawline",
    clear: "the razor bumps and shaving irritation",
  },
  {
    id: "patchy-stubble",
    label: "Patchy stubble",
    add: "uneven patchy stubble growing at different lengths",
    clear: "the patchiness, leaving neatly groomed even stubble",
  },
  {
    id: "unkempt-brows",
    label: "Unkempt brows",
    add: "untidy overgrown eyebrows with stray hairs",
    clear: "the stray hairs, leaving tidy natural brows",
  },
  {
    id: "chapped-lips",
    label: "Chapped lips",
    add: "dry cracked chapped lips",
    clear: "the chapping, leaving smooth lips",
  },
  {
    id: "grown-out-hair",
    label: "Grown-out hair",
    // Not skin at all, and probably the highest-impact reversible thing in any
    // real before and after. Omitting it because the module is named for the
    // face would be a filing decision beating an editorial one.
    add: "a grown-out shapeless haircut, flat and unstyled",
    clear: "the shapeless grow-out, leaving a sharp fresh cut styled to suit the face",
  },
];

/**
 * The flaws named by these ids, in CATALOG order rather than the order they
 * arrived in.
 *
 * Catalog order because the prompt reads better with skin before grooming, and
 * because two operators picking the same chips in a different sequence should
 * get the same prompt: a generator whose output depends on tap order is one
 * nobody can reproduce a look with.
 *
 * Unknown ids are dropped rather than passed through. This is the same rule the
 * attribution allowlist follows and for the same reason: the client is not
 * trusted, and the worst a crafted body may achieve is fewer flaws than asked
 * for, never arbitrary text in a prompt we pay to run.
 */
export function flawsFromIds(ids: readonly unknown[]): FaceFlaw[] {
  const wanted = new Set(ids.filter((id): id is string => typeof id === "string"));
  return FACE_FLAWS.filter((f) => wanted.has(f.id));
}

/** The concern ids a generated face would carry, for the plan the video shows. */
export function concernsFor(flaws: readonly FaceFlaw[]): string[] {
  return [...new Set(flaws.flatMap((f) => (f.concern ? [f.concern] : [])))];
}

/** Every concern this catalog references actually exists. Guarded by a test. */
export function unknownConcernIds(): string[] {
  const known = new Set(SKIN_CONCERN_CATALOG.map((c) => c.id));
  return FACE_FLAWS.flatMap((f) => (f.concern && !known.has(f.concern) ? [f.concern] : []));
}
