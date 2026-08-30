import type { Report, ScoredMetric } from "../engine/types.js";
import { distFor } from "../engine/metrics.js";
import { fmt, wasMeasured } from "./templates.js";

// ---------------------------------------------------------------------------
// The nutrition plan.
//
// A daily protocol derived from the scan's own soft-tissue signals. Food moves
// soft tissue, never bone, and this section says only what the measurements
// support: composition when the jaw and cheek numbers sit under their means,
// water retention when the ratio the lower face carries says so, periorbital
// puffiness when the aperture reads low. Every target is tied to the measured
// number it moves.
//
// Voice: plain scientific statement throughout. The one place this product
// speaks like a person in your corner is Coach Max's read; this is not it.
//
// It obeys the same two rules as every lever in the written plan:
//   - the diet advice channel wins over everything: someone who asked us to
//     keep food out of it gets a one-line acknowledgement, never a protocol
//     and never an upsell for one
//   - the paywall withholds the METHOD, not the measurement, and says plainly
//     that the protocol is part of Max rather than dressing the lock up as
//     anything else
// ---------------------------------------------------------------------------

const byId = (r: Report, id: string): ScoredMetric | undefined =>
  r.metrics.find((m) => m.def.id === id);

// Same bar the written plan uses for "worth working on": measured, and sitting
// meaningfully under the reference. A signal the scan did not produce is a
// card this section does not print.
const fired = (m: ScoredMetric | undefined): m is ScoredMetric =>
  Boolean(m && wasMeasured(m) && m.zEff < 0.4);

const mean = (m: ScoredMetric, sex: Report["sex"]): string =>
  `${distFor(m.def, sex).mean.toFixed(m.def.decimals)}${m.def.unit}`;

interface Target {
  name: string;
  amount: string;
  why: string;
}

// The always-on daily floor. These four are deliberately not personalised:
// they are the base under every signal card, and a protocol that changes its
// protein target because of a jaw measurement would be inventing precision
// the evidence does not carry.
const TARGETS: Target[] = [
  {
    name: "PROTEIN",
    amount: "1.6 g per kg of body weight daily",
    why: "Preserves lean mass while body fat falls. Facial definition follows total body composition.",
  },
  {
    name: "SODIUM",
    amount: "under 2,300 mg daily",
    why: "Sodium raises extracellular water retention. The lower face registers the change within days.",
  },
  {
    name: "ALCOHOL",
    amount: "none on weeknights",
    why: "Alcohol degrades sleep quality and increases facial water retention the following morning.",
  },
  {
    name: "WATER",
    amount: "about 35 ml per kg of body weight daily",
    why: "Chronic mild dehydration reads as reduced skin turgor and a duller surface.",
  },
];

export function nutritionPlanHTML(
  r: Report,
  opts: { dietAdvice: boolean; maxAccess: boolean; adult: boolean },
): string {
  if (!opts.dietAdvice) {
    return `<div class="panel nutri"><h4>NUTRITION</h4>
      <p class="nutri-note">Nutrition recommendations are switched off at your request. The measurements they would target are unchanged on their own tabs.</p></div>`;
  }

  if (!opts.maxAccess) {
    return `<div class="panel nutri"><h4>NUTRITION PLAN</h4>
      <p class="nutri-note">A daily protocol is written from this scan: targets for protein, sodium, alcohol and hydration, each tied to the measurement it moves. The measurements are yours either way. The protocol is part of Max.</p></div>`;
  }

  const gonial = byId(r, "gonialProxy");
  const cheek = byId(r, "cheekboneHeight");
  // The composition card is the only place on this panel that states an energy
  // figure, and an energy figure is 18+ everywhere else in the product. Found
  // in review: the macro calculator directly BELOW this panel runs a four-gate
  // check with the age read from a date of birth, and this panel sat above it
  // printing "a moderate deficit of 300 to 500 kcal per day" to anybody with
  // the Max tier, minors and unloaded profiles included. Building a careful
  // gate next to an ungated surface saying the same thing is worse than having
  // built neither, because the gate implies the surface is covered.
  //
  // Default false, same direction as adultUser and every other 18+ surface: an
  // age we could not read behaves like an age that is too young.
  const energyOk = opts.adult;
  const ratio = byId(r, "jawCheekRatio");
  const eye = byId(r, "eyeAspectRatio");

  const cards: string[] = [];
  if (fired(gonial) || fired(cheek)) {
    const m = fired(gonial) ? gonial : (cheek as ScoredMetric);
    // The measurement and the mechanism are stated either way. Only the number
    // is withheld, which is the same line the rest of the product draws: what
    // is measured is yours, what is prescribed has a gate.
    const how = energyOk
      ? `A moderate deficit of 300 to 500 kcal per day, with the protein target held, moves this number without costing lean mass.`
      : `Energy targets are part of the 18+ side of the plan, so this card stops at the measurement. The mechanism is the same either way: this number follows total body fat rather than anything done to the face directly.`;
    cards.push(`<div class="nutri-card"><b>BODY COMPOSITION</b>
      <p>${m.def.name} measures ${fmt(m)} against the ${r.sex} average of ${mean(m, r.sex)}. Submental and cheek fat sit on that path. Facial fat cannot be targeted directly; it falls with total body fat. ${how}</p></div>`);
  }
  if (fired(ratio)) {
    cards.push(`<div class="nutri-card"><b>WATER RETENTION</b>
      <p>The jaw to cheek ratio measures ${fmt(ratio)} against the ${r.sex} average of ${mean(ratio, r.sex)}. Retained water widens the lower face and narrows this ratio. Two weeks at the sodium and alcohol targets is enough for the change to register in this exact measurement.</p></div>`);
  }
  if (fired(eye)) {
    cards.push(`<div class="nutri-card"><b>PERIORBITAL</b>
      <p>Eye aperture measures ${fmt(eye)}. Periorbital puffiness reduces the measured aperture, and it responds to sodium intake and consistent sleep timing within weeks.</p></div>`);
  }
  // Skin runs on every plan: glycemic load is the one dietary lever with
  // controlled-trial support for surface quality, and it is not tied to any
  // single mesh measurement, so it prints whether or not a card fired.
  cards.push(`<div class="nutri-card"><b>SKIN</b>
    <p>High glycemic load diets are associated with acne severity in controlled trials. Whole food carbohydrate sources and stable meal timing are the lever. Omega 3 intake supports the skin barrier; the evidence is moderate, not dramatic.</p></div>`);

  return `<div class="panel nutri"><h4>NUTRITION PLAN</h4>
    <p class="nutri-note">Built from this scan's soft tissue signals. Food moves soft tissue, not bone.</p>
    <div class="nutri-targets">${TARGETS.map(
      (t) => `<div class="nutri-row"><span class="nutri-name">${t.name}</span><span class="nutri-amt">${t.amount}</span><span class="nutri-why">${t.why}</span></div>`,
    ).join("")}</div>
    ${cards.join("")}
    <p class="nutri-note nutri-disclaimer">General nutrition information derived from facial measurements. It is not medical advice and it does not know your health history. Kidney conditions, medications and pregnancy change what sodium and protein targets are safe; a physician or registered dietitian outranks this page.</p></div>`;
}
