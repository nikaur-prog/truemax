import type { AdviceChannel, Profile } from "./goals.ts";

// ---------------------------------------------------------------------------
// Recommendations.
//
// Five rules, all of them hard, all of them enforced by the shape of this file
// rather than by remembering to be careful:
//
// 1. NOTHING PRESCRIPTION-ONLY. No tretinoin, no bimatoprost lash serums, no
//    oral anything. These work, and naming them is exactly the unregulated
//    medical advice that gets an app pulled. The `otc` flag is not decoration:
//    an entry without it does not render.
//
// 2. NO SUPPLEMENTS OR PILLS, ever. Food is food; a capsule is a dose.
//
// 3. FOOD IS STATED AS FACT, NOT INSTRUCTION. "Oysters are the densest dietary
//    source of zinc" is a nutritional fact anyone can check. "You should eat
//    more zinc" is a prescription we are not qualified to write. The whole
//    difference between shippable and not lives in that sentence.
//
// 4. NO CALORIE OR WEIGHT TARGETS. Not anywhere, not for anyone, no exceptions.
//
// 5. EVIDENCE IS STATED HONESTLY, INCLUDING WHEN IT IS WEAK. Where something
//    popular does not work — brow growth oils — we say so. A recommendation
//    engine that only ever enthuses is an advertising engine.
//
// Everything here is gated on the consent the person gave in the quiz, and on
// the topics they asked us to leave alone.
// ---------------------------------------------------------------------------

export type Evidence = "strong" | "moderate" | "limited" | "none";

export interface Rec {
  id: string;
  goals: string[]; // goal ids from goals.ts this serves
  channel: AdviceChannel;
  title: string;
  // What it is, in one line
  what: string;
  // What the evidence actually supports — never overstated
  evidence: Evidence;
  detail: string;
  // Required for anything applied to the body. Prescription items are absent
  // from this file entirely; this asserts the remainder really is over-counter.
  otc?: boolean;
  caution?: string;
  // Dietary flags a profile can exclude on
  contains?: Array<"meat" | "fish" | "shellfish" | "dairy">;
}

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  strong: "Strong evidence",
  moderate: "Moderate evidence",
  limited: "Limited evidence",
  none: "No good evidence",
};

export const RECS: Rec[] = [
  // ---- skin ---------------------------------------------------------------
  {
    id: "spf",
    goals: ["skin"],
    channel: "grooming",
    title: "Daily sunscreen",
    what: "Broad-spectrum SPF 30+, every day, regardless of weather",
    evidence: "strong",
    detail:
      "The best-evidenced thing on this entire page, and the cheapest. Randomised trials show daily sunscreen measurably slows photoageing — the texture and pigment changes people later try to reverse.",
    otc: true,
  },
  {
    id: "adapalene",
    goals: ["skin"],
    channel: "grooming",
    title: "Adapalene 0.1%",
    what: "A retinoid gel, sold over the counter in some countries",
    evidence: "strong",
    detail:
      "The best-evidenced non-prescription active for acne, and it improves texture over months rather than days. Expect irritation for the first few weeks.",
    otc: true,
    caution:
      "Over the counter in the US; pharmacist-only or prescription in the UK, EU, Australia and New Zealand — ask a pharmacist what's available where you are. Retinoids are not for use in pregnancy.",
  },
  {
    id: "azelaic",
    goals: ["skin"],
    channel: "grooming",
    title: "Azelaic acid 10%",
    what: "An over-the-counter acid for redness and post-spot marks",
    evidence: "moderate",
    detail:
      "Gentler than a retinoid and works on both redness and the brown marks left behind after a breakout. Often the better first step if your skin reacts badly to things.",
    otc: true,
    caution: "Higher strengths (15–20%) are prescription in most countries.",
  },
  {
    id: "salicylic",
    goals: ["skin"],
    channel: "grooming",
    title: "Salicylic acid 2%",
    what: "An over-the-counter exfoliant that works inside the pore",
    evidence: "moderate",
    detail: "Oil-soluble, so it reaches into blocked pores rather than just the surface. Best for congestion and blackheads.",
    otc: true,
  },
  {
    id: "niacinamide",
    goals: ["skin"],
    channel: "grooming",
    title: "Niacinamide 4–5%",
    what: "A cosmetic ingredient for barrier support",
    evidence: "limited",
    detail:
      "Modest but real effects on redness and barrier function. Not a headline act — it pairs well with the actives above rather than replacing them.",
    otc: true,
  },
  {
    id: "derm",
    goals: ["skin"],
    channel: "grooming",
    title: "See a pharmacist or dermatologist",
    what: "For anything persistent, painful, or spreading",
    evidence: "strong",
    detail:
      "TrueMax measures how evenly your face reflects light. It cannot tell acne from eczema from rosacea, and those need different treatment — a person who can actually look at your skin is worth more than any product on this list.",
  },

  // ---- food ---------------------------------------------------------------
  {
    id: "zinc-food",
    goals: ["skin"],
    channel: "diet",
    title: "Zinc in food",
    what: "Oysters are the densest dietary source there is",
    evidence: "moderate",
    detail:
      "Zinc is used in wound healing and skin repair, and oysters contain several times more per serve than anything else. Beef and pumpkin seeds are the next tier.",
    contains: ["shellfish"],
  },
  {
    id: "zinc-veg",
    goals: ["skin"],
    channel: "diet",
    title: "Zinc without seafood",
    what: "Pumpkin seeds, chickpeas, lentils and cashews",
    evidence: "moderate",
    detail:
      "Plant sources are less absorbable than shellfish, so the same intake goes further from a wider spread of them across the day.",
  },
  {
    id: "vitc",
    goals: ["skin"],
    channel: "diet",
    title: "Vitamin C in food",
    what: "Kiwifruit, capsicum, citrus and berries",
    evidence: "moderate",
    detail:
      "Collagen synthesis depends on vitamin C — it is a required cofactor, not an optional booster. Ordinary dietary amounts cover it; there is nothing to buy.",
  },
  {
    id: "omega3",
    goals: ["skin", "debloat"],
    channel: "diet",
    title: "Omega-3 in food",
    what: "Oily fish — salmon, sardines, mackerel",
    evidence: "moderate",
    detail: "Associated with lower inflammatory markers. Walnuts, flaxseed and chia are the plant-based equivalents.",
    contains: ["fish"],
  },
  {
    id: "sodium",
    goals: ["debloat", "bodyfat"],
    channel: "diet",
    title: "Sodium and alcohol",
    what: "Both cause measurable facial water retention",
    evidence: "moderate",
    detail:
      "This is the fastest-moving thing on your report. Puffiness around the eyes and jaw responds within days, and it shows up directly in eye aperture and the jaw-to-cheek ratio.",
  },
  {
    id: "protein",
    goals: ["muscle", "bodyfat"],
    channel: "diet",
    title: "Protein at every meal",
    what: "Spread across the day rather than concentrated in one meal",
    evidence: "strong",
    detail:
      "Muscle protein synthesis responds to per-meal protein rather than daily totals. Eggs, dairy, fish, meat, legumes and tofu all count.",
  },

  // ---- teeth --------------------------------------------------------------
  {
    id: "fluoride",
    goals: ["teeth"],
    channel: "grooming",
    title: "Fluoride toothpaste",
    what: "The single best-evidenced intervention in dentistry",
    evidence: "strong",
    detail: "Spit, don't rinse — rinsing washes away the fluoride you just applied. Costs nothing and outperforms everything else here.",
    otc: true,
  },
  {
    id: "cheese",
    goals: ["teeth"],
    channel: "diet",
    title: "Cheese after a meal",
    what: "Raises plaque pH back toward neutral",
    evidence: "moderate",
    detail:
      "Casein, calcium and phosphate buffer the acid that follows eating. A genuinely evidenced trick, and pleasant. Use pasteurised cheese.",
    contains: ["dairy"],
  },
  {
    id: "whitening",
    goals: ["teeth"],
    channel: "grooming",
    title: "Peroxide whitening strips",
    what: "Over-the-counter strips do work on surface staining",
    evidence: "moderate",
    detail: "Effective on staining from coffee, tea and wine. They do nothing for intrinsic tooth colour or for crowns and fillings.",
    otc: true,
    caution:
      "Permitted peroxide concentration differs by country — the EU caps over-the-counter strength well below the US. Sensitivity is common and reverses when you stop.",
  },
  {
    id: "dentist",
    goals: ["teeth"],
    channel: "grooming",
    title: "See a dentist about alignment",
    what: "For crowding, spacing or bite",
    evidence: "strong",
    detail: "Nothing you buy over a counter moves a tooth. Alignment is the one thing here that genuinely requires a professional.",
  },

  // ---- brows, lashes, grooming -------------------------------------------
  {
    id: "brow-shape",
    goals: ["grooming", "eyes"],
    channel: "grooming",
    title: "Brow shaping",
    what: "Shaping the underside lifts the measured brow-to-eye gap",
    evidence: "strong",
    detail:
      "This one is not a claim about biology — it directly changes a number on your report, because brow position is measured from the brow's lower edge. The fastest-moving metric you have.",
  },
  {
    id: "brow-tint",
    goals: ["grooming", "eyes"],
    channel: "grooming",
    title: "Brow tinting",
    what: "Darkening reads as density without changing hair count",
    evidence: "moderate",
    detail: "Cosmetic and immediate. Salon or at-home kits both work; patch test first, because dye reactions are the common problem.",
    otc: true,
  },
  {
    id: "brow-oils",
    goals: ["grooming", "eyes"],
    channel: "grooming",
    title: "Brow and lash growth oils",
    what: "Castor, argan and emu oil are widely recommended",
    evidence: "none",
    detail:
      "There is essentially no clinical evidence that any of these grow hair. They condition what is already there, which can make brows look fuller — that is a real effect and a different claim. We would rather tell you that than sell you the story.",
    caution:
      "The lash serums that do grow lashes contain prostaglandin analogues, are prescription-only, and can permanently darken the iris. TrueMax will not recommend them.",
  },

  // ---- habits -------------------------------------------------------------
  {
    id: "sleep",
    goals: ["debloat", "eyes", "skin"],
    channel: "lifestyle",
    title: "Consistent sleep timing",
    what: "Regularity matters as much as duration",
    evidence: "strong",
    detail:
      "Periorbital fluid is the most photograph-visible thing about short sleep, and it shows up in the measured eye aperture. Going to bed at the same time beats sleeping longer at random.",
  },
  {
    id: "resistance",
    goals: ["muscle", "bodyfat"],
    channel: "lifestyle",
    title: "Resistance training",
    what: "Neck, traps and shoulders change how the jaw reads",
    evidence: "strong",
    detail:
      "Not measured here — a face mesh stops at the jaw. But the frame beneath a face changes how it is perceived, and it is one of the few things on this list fully within your control.",
  },
  {
    id: "posture",
    goals: ["symmetry"],
    channel: "lifestyle",
    title: "Posture and chewing balance",
    what: "Both measurably affect facial symmetry over months",
    evidence: "limited",
    detail:
      "Habitual one-sided chewing and forward head posture are associated with asymmetry over long periods. Slow, and worth doing anyway for reasons that have nothing to do with your face.",
  },
];

// Filter to what this person actually agreed to see.
export function recsFor(profile: Profile, quietGoals: Set<string> = new Set()): Rec[] {
  const exclude = new Set<string>();
  if (profile.diet?.includes("vegetarian")) {
    exclude.add("meat");
    exclude.add("fish");
    exclude.add("shellfish");
  }
  if (profile.diet?.includes("vegan")) {
    exclude.add("meat");
    exclude.add("fish");
    exclude.add("shellfish");
    exclude.add("dairy");
  }
  if (profile.diet?.includes("dairy-free")) exclude.add("dairy");
  if (profile.diet?.includes("no-shellfish")) exclude.add("shellfish");

  return RECS.filter((r) => {
    // Only what serves a goal they picked
    if (!r.goals.some((g) => profile.goals.includes(g))) return false;
    if (r.goals.every((g) => quietGoals.has(g))) return false;
    // Consent for this kind of advice
    if (!profile.advice[r.channel]) return false;
    // Dietary exclusions
    if (r.contains?.some((c) => exclude.has(c))) return false;
    return true;
  });
}
