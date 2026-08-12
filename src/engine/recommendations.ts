import { declaredSkin, skinAnswered } from "./goals.ts";
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

export type RecGroup = "topical" | "food" | "habit" | "professional";

export interface Rec {
  id: string;
  group: RecGroup;
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
  // Self-declared skin concerns this addresses (ids from SKIN_CONCERNS).
  // Absent means it is worth showing to anyone who picked skin as a goal —
  // sunscreen and "go see someone" are not contingent on a complaint.
  concerns?: string[];
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
    group: "topical",
    goals: ["skin"],
    channel: "grooming",
    title: "Daily sunscreen",
    what: "Broad-spectrum SPF 30+, every day, regardless of weather",
    evidence: "strong",
    detail:
      "The best-evidenced thing on this entire page, and the cheapest. Randomised trials show daily sunscreen measurably slows photoageing: the texture and pigment changes people later try to reverse.",
    otc: true,
  },
  {
    id: "adapalene",
    concerns: ["acne"],
    group: "topical",
    goals: ["skin"],
    channel: "grooming",
    title: "Adapalene 0.1%",
    what: "A retinoid gel, sold over the counter in some countries",
    evidence: "strong",
    detail:
      "The best-evidenced non-prescription active for acne, and it improves texture over months rather than days. Expect irritation for the first few weeks.",
    otc: true,
    caution:
      "Over the counter in the US; pharmacist-only or prescription in the UK, EU, Australia and New Zealand, so ask a pharmacist what's available where you are. Retinoids are not for use in pregnancy.",
  },
  {
    id: "azelaic",
    concerns: ["redness", "marks", "acne", "pigmentation"],
    group: "topical",
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
    concerns: ["acne", "pores"],
    group: "topical",
    goals: ["skin"],
    channel: "grooming",
    title: "Salicylic acid 2%",
    what: "An over-the-counter exfoliant that works inside the pore",
    evidence: "moderate",
    detail: "Oil-soluble, so it reaches into blocked pores rather than just the surface. Best for congestion and blackheads.",
    otc: true,
  },
  {
    id: "benzoyl-peroxide",
    concerns: ["acne"],
    group: "topical",
    goals: ["skin"],
    channel: "grooming",
    title: "Benzoyl peroxide 2.5%",
    what: "A lower-strength OTC starting point for inflamed spots",
    evidence: "strong",
    detail:
      "Lower strengths can work with less irritation. Start slowly, follow the product label and give a mild breakout routine six to eight weeks before judging it.",
    otc: true,
    caution: "It can irritate skin and bleach towels, bedding and clothing. Stop and seek help for swelling or blistering.",
  },
  {
    id: "niacinamide",
    concerns: ["redness", "dryness"],
    group: "topical",
    goals: ["skin"],
    channel: "grooming",
    title: "Niacinamide 4–5%",
    what: "A cosmetic ingredient for barrier support",
    evidence: "limited",
    detail:
      "Modest but real effects on redness and barrier function. Not a headline act, but it pairs well with the actives above rather than replacing them.",
    otc: true,
  },
  {
    id: "derm",
    group: "professional",
    goals: ["skin"],
    channel: "grooming",
    title: "See a pharmacist or dermatologist",
    what: "For anything persistent, painful, or spreading",
    evidence: "strong",
    detail:
      "TrueMax measures how evenly your face reflects light. It cannot tell acne from eczema from rosacea, and those need different treatment. A person who can actually look at your skin is worth more than any product on this list.",
  },
  {
    id: "emollient",
    concerns: ["dryness"],
    group: "topical",
    goals: ["skin"],
    channel: "grooming",
    title: "A plain fragrance-free moisturiser",
    what: "Applied while the skin is still damp, twice a day",
    evidence: "strong",
    detail:
      "Unglamorous and very well evidenced: regular emollient use is the first-line treatment for dry and eczema-prone skin in every clinical guideline that covers it. Fragrance is the usual culprit when a product stings, and the cheap tub often outperforms the expensive one.",
    otc: true,
    caution:
      "If skin is cracked, weeping or painful, that is past what a moisturiser fixes, so see a pharmacist or doctor.",
  },
  {
    id: "gentle-cleanse",
    concerns: ["dryness", "redness", "scaling", "oiliness", "lips"],
    group: "habit",
    goals: ["skin"],
    channel: "grooming",
    title: "Stop stripping it",
    what: "Lukewarm water, one mild cleanser, nothing abrasive",
    evidence: "moderate",
    detail:
      "Reactive and persistently red skin is very often over-treated skin. Scrubs, hot water, astringent toners and stacking three actives at once all damage the barrier, and the damage looks like the problem people are treating. Cutting back is free and reverses in weeks.",
  },
  {
    id: "razor-technique",
    concerns: ["razorbumps"],
    group: "habit",
    goals: ["skin"],
    channel: "grooming",
    title: "Give the hair room to grow out",
    what: "Pause close shaving when possible, or shave with the direction of growth",
    evidence: "moderate",
    detail:
      "Soften the hair first, use a moisturising shaving cream, avoid stretching the skin and never pluck a hair from inside a bump. Persistent, painful or pus-filled bumps need a clinician because folliculitis can look similar.",
  },
  {
    id: "milia-professional",
    concerns: ["milia"],
    group: "professional",
    goals: ["skin"],
    channel: "grooming",
    title: "Identify the bump before removing it",
    what: "A dermatologist can distinguish milia from look-alikes and extract it safely when appropriate",
    evidence: "strong",
    detail:
      "Do not lance or squeeze a firm facial bump at home, particularly around the eyes. The scanner cannot confirm that a pale bump is milia.",
  },
  {
    id: "silicone-scar",
    concerns: ["scarring"],
    group: "topical",
    goals: ["skin"],
    channel: "grooming",
    title: "Silicone for a raised healing scar",
    what: "Silicone gel or sheets—not for indented acne scars",
    evidence: "moderate",
    detail:
      "Silicone may help a raised healing scar. Indented, tethered or keloid-like scars need classification first because the useful procedures are different.",
    otc: true,
  },
  {
    id: "redness-triggers",
    concerns: ["redness"],
    group: "habit",
    goals: ["skin"],
    channel: "grooming",
    title: "Find your flushing triggers",
    what: "Heat, alcohol, spice and sun are the common four",
    evidence: "moderate",
    detail:
      "Persistent facial flushing is strongly trigger-driven, and the triggers are individual. A fortnight of noting what preceded a flare identifies them better than any product does. Sun is the one that shows up for nearly everyone, which is another reason sunscreen sits at the top of this list.",
    caution:
      "Persistent central-face redness with visible vessels or bumps is a diagnosis someone needs to make in person, and the effective treatments for it are prescription-only. Worth a doctor's appointment rather than a shopping list.",
  },
  {
    id: "undereye-truth",
    concerns: ["undereye"],
    group: "habit",
    goals: ["skin", "eyes", "debloat"],
    channel: "grooming",
    title: "What actually moves dark circles",
    what: "Mostly nothing you can buy",
    evidence: "none",
    detail:
      "Under-eye shadow is usually structural, either thin skin over a tear-trough hollow or vessels showing through, and no over-the-counter cream changes either. What does move is the puffiness component: sleep timing, sodium and alcohol, within days. This is also the one skin number the scan reports, because it is the only one that repeats reliably between photos.",
    caution:
      "Caffeine gels, vitamin K creams and cooling rollers reduce puffiness for an hour or two. That is a real effect and a different claim from fixing the shadow.",
  },

  // ---- food ---------------------------------------------------------------
  {
    id: "zinc-food",
    group: "food",
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
    group: "food",
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
    group: "food",
    goals: ["skin"],
    channel: "diet",
    title: "Vitamin C in food",
    what: "Kiwifruit, capsicum, citrus and berries",
    evidence: "moderate",
    detail:
      "Collagen synthesis depends on vitamin C, which is a required cofactor rather than an optional booster. Ordinary dietary amounts cover it; there is nothing to buy.",
  },
  {
    id: "omega3",
    group: "food",
    goals: ["skin", "debloat"],
    channel: "diet",
    title: "Omega-3 in food",
    what: "Oily fish: salmon, sardines, mackerel",
    evidence: "moderate",
    detail: "Associated with lower inflammatory markers. Walnuts, flaxseed and chia are the plant-based equivalents.",
    contains: ["fish"],
  },
  {
    id: "sodium",
    group: "food",
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
    group: "food",
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
    group: "topical",
    goals: ["teeth"],
    channel: "grooming",
    title: "Fluoride toothpaste",
    what: "The single best-evidenced intervention in dentistry",
    evidence: "strong",
    detail: "Spit, don't rinse. Rinsing washes away the fluoride you just applied. Costs nothing and outperforms everything else here.",
    otc: true,
  },
  {
    id: "cheese",
    group: "food",
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
    group: "topical",
    goals: ["teeth"],
    channel: "grooming",
    title: "Peroxide whitening strips",
    what: "Over-the-counter strips do work on surface staining",
    evidence: "moderate",
    detail: "Effective on staining from coffee, tea and wine. They do nothing for intrinsic tooth colour or for crowns and fillings.",
    otc: true,
    caution:
      "Permitted peroxide concentration differs by country: the EU caps over-the-counter strength well below the US. Sensitivity is common and reverses when you stop.",
  },
  {
    id: "dentist",
    group: "professional",
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
    group: "habit",
    goals: ["grooming", "eyes"],
    channel: "grooming",
    title: "Brow shaping",
    what: "Shaping the underside lifts the measured brow-to-eye gap",
    evidence: "strong",
    detail:
      "This one is not a claim about biology. It directly changes a number on your report, because brow position is measured from the brow's lower edge. The fastest-moving metric you have.",
  },
  {
    id: "brow-tint",
    group: "topical",
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
    group: "topical",
    goals: ["grooming", "eyes"],
    channel: "grooming",
    title: "Brow and lash growth oils",
    what: "Castor, argan and emu oil are widely recommended",
    evidence: "none",
    detail:
      "There is essentially no clinical evidence that any of these grow hair. They condition what is already there, which can make brows look fuller. That is a real effect and a different claim. We would rather tell you that than sell you the story.",
    caution:
      "The lash serums that do grow lashes contain prostaglandin analogues, are prescription-only, and can permanently darken the iris. TrueMax will not recommend them.",
  },

  // ---- habits -------------------------------------------------------------
  {
    id: "sleep",
    group: "habit",
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
    group: "habit",
    goals: ["muscle", "bodyfat"],
    channel: "lifestyle",
    title: "Resistance training",
    what: "Neck, traps and shoulders change how the jaw reads",
    evidence: "strong",
    detail:
      "Not measured here, because a face mesh stops at the jaw. But the frame beneath a face changes how it is perceived, and it is one of the few things on this list fully within your control.",
  },
  {
    id: "posture",
    group: "habit",
    goals: ["symmetry"],
    channel: "lifestyle",
    title: "Posture and chewing balance",
    what: "Both measurably affect facial symmetry over months",
    evidence: "limited",
    detail:
      "Habitual one-sided chewing and forward head posture are associated with asymmetry over long periods. Slow, and worth doing anyway for reasons that have nothing to do with your face.",
  },

  // ---- eating pattern -----------------------------------------------------
  {
    id: "wholefood",
    group: "food",
    goals: ["bodyfat", "skin", "debloat"],
    channel: "diet",
    title: "Whole foods over ultra-processed",
    what: "The best-evidenced dietary change there is for eating less without trying",
    evidence: "strong",
    detail:
      "In a controlled trial where both diets were matched for calories, sugar, fat, fibre and protein and people ate as much as they liked, the ultra-processed version led to roughly 500 more calories a day, without anyone noticing. This is not about any single ingredient. It is that processed food is easier to overeat.",
  },
  {
    id: "complex-carbs",
    group: "food",
    goals: ["bodyfat"],
    channel: "diet",
    title: "Slower carbohydrates",
    what: "Oats, legumes, potatoes, intact grains and fruit over refined flour and sugar",
    evidence: "moderate",
    detail:
      "Slower-digesting carbohydrates are more filling per calorie and flatten the blood-sugar swing that makes you hungry again an hour later. Maltodextrin and refined flour sit at the opposite end, near the top of the glycaemic scale, and are in almost everything processed.",
  },
  {
    id: "water",
    group: "food",
    goals: ["bodyfat", "debloat"],
    channel: "diet",
    title: "Water, particularly before meals",
    what: "Modestly reduces how much is eaten at that meal",
    evidence: "moderate",
    detail:
      "Small but real in trials, and free. It also helps the other direction: mild dehydration drives sodium retention, which is the puffiness the scan actually measures.",
  },
  {
    id: "fat-quality",
    group: "food",
    goals: ["bodyfat", "skin"],
    channel: "diet",
    title: "Where your fat comes from",
    what: "Olive oil, nuts, oily fish, avocado, dairy",
    evidence: "moderate",
    detail:
      "Whole-food fat sources come with fibre, protein and micronutrients attached. That is the defensible version of the advice: the case for whole foods is strong and does not depend on any particular oil being harmful.",
  },
  {
    id: "seed-oils",
    group: "food",
    goals: ["bodyfat", "skin"],
    channel: "diet",
    title: "On seed oils specifically",
    what: "The popular claim is that they are the problem. The evidence does not support it",
    evidence: "none",
    detail:
      "Controlled trials and meta-analyses do not show seed oils causing harm; replacing saturated fat with them is generally associated with lower cardiovascular risk. What IS well evidenced is the ultra-processed food they usually arrive in. Cutting those gets you the outcome people credit to cutting seed oils, and it is the version that survives scrutiny.",
  },
  {
    id: "glycaemic-skin",
    concerns: ["acne"],
    group: "food",
    goals: ["skin"],
    channel: "diet",
    title: "Sugar load and skin congestion",
    what: "High-glycaemic diets are associated with more congestion",
    evidence: "limited",
    detail:
      "Observational, with a modest effect size, so treat it as a nudge rather than a rule. It points the same direction as everything else here: less refined flour and sugar, more whole food.",
  },

  // ---- hair ---------------------------------------------------------------
  {
    id: "minoxidil",
    group: "topical",
    goals: ["hair"],
    channel: "grooming",
    title: "Minoxidil 5%",
    what: "Topical, over the counter in most countries, and it works",
    evidence: "strong",
    detail:
      "The best-evidenced non-prescription option for pattern hair thinning, for both men and women. It takes four to six months before anything is visible, and there is often a shedding phase early on that makes people quit right before it starts working.",
    otc: true,
    caution:
      "Gains reverse if you stop, so it is an ongoing commitment rather than a course. Formulations and recommended strength differ for women. Not for use in pregnancy. Ask a pharmacist.",
  },
  {
    id: "keto-shampoo",
    group: "topical",
    goals: ["hair"],
    channel: "grooming",
    title: "Ketoconazole 1% shampoo",
    what: "An over-the-counter antifungal shampoo",
    evidence: "limited",
    detail:
      "Some evidence as an adjunct for scalp health and shedding. Cheap and low-risk, but a supporting act rather than a treatment.",
    otc: true,
  },
  {
    id: "hair-damage",
    group: "habit",
    goals: ["hair"],
    channel: "grooming",
    title: "Heat and tension",
    what: "Tight styles and high heat cause avoidable loss",
    evidence: "strong",
    detail:
      "Traction alopecia from persistently tight styles is one of the few kinds of hair loss that is genuinely preventable, and heat damage causes breakage that reads as thinning. Costs nothing to stop.",
  },
  {
    id: "hair-colour",
    group: "topical",
    goals: ["hair", "grooming"],
    channel: "grooming",
    title: "Colour",
    what: "Cosmetic, immediate, no medical claim attached",
    evidence: "moderate",
    detail:
      "Darker colour reads as more density at the same hair count, the same way brow tinting does. Bleaching does the reverse and damages the shaft.",
    otc: true,
    caution: "Patch test 48 hours ahead. Dye reactions are the common problem, and they can be severe.",
  },
  {
    id: "hair-doctor",
    group: "professional",
    goals: ["hair"],
    channel: "grooming",
    title: "Get shedding investigated",
    what: "For sudden or patchy loss rather than gradual thinning",
    evidence: "strong",
    detail:
      "Causes range from thyroid to iron to autoimmune to genetics, and they are treated completely differently. A blood test settles in a week what guessing will not settle at all. Low ferritin in particular is common, easily missed, and fixable.",
  },

  // ---- texture and marks --------------------------------------------------
  {
    id: "silicone",
    concerns: ["scarring"],
    group: "topical",
    goals: ["skin"],
    channel: "grooming",
    title: "Silicone gel or sheets",
    what: "For raised or thickened scars",
    evidence: "moderate",
    detail:
      "The best-evidenced over-the-counter option for raised scarring, and the one dermatologists reach for first. It needs months of daily use, and it does nothing for indented scars.",
    otc: true,
  },
  {
    id: "scar-sun",
    concerns: ["scarring", "marks", "pigmentation"],
    group: "habit",
    goals: ["skin"],
    channel: "grooming",
    title: "Keep marks out of the sun",
    what: "Sun exposure darkens healing skin semi-permanently",
    evidence: "strong",
    detail:
      "New scars and post-spot marks pigment far more readily than surrounding skin. Covering them for the first several months is the difference between a mark that fades and one that stays.",
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

  // Concern filtering only engages once someone has actually answered the skin
  // question. Filtering on an unanswered question would silently drop most of
  // the skin section for anyone who skipped it, which is the opposite of what
  // an optional question should do.
  const concerns = new Set(declaredSkin(profile));
  const filterConcerns = skinAnswered(profile);

  return RECS.filter((r) => {
    // Only what serves a goal they picked
    if (!r.goals.some((g) => profile.goals.includes(g))) return false;
    if (r.goals.every((g) => quietGoals.has(g))) return false;
    // Consent for this kind of advice
    if (!profile.advice[r.channel]) return false;
    // Dietary exclusions
    if (r.contains?.some((c) => exclude.has(c))) return false;
    // Declared skin concerns. A card with no `concerns` is unconditional.
    if (filterConcerns && r.concerns && !r.concerns.some((c) => concerns.has(c))) return false;
    return true;
  });
}
