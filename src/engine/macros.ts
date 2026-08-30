// ---------------------------------------------------------------------------
// The macro calculator.
//
// One calculation, in one place, because the requirement that made this a
// module rather than a component is that Coach Max reads from the SAME numbers
// the panel shows. Two implementations of a formula drift, and the first time
// Max says 2,340 over a card that says 2,180 the whole tier stops being
// believable.
//
// WHY THIS DOES NOT BREAK RULE 4 OF recommendations.ts
//
// That file forbids calorie and weight targets, with no exceptions, and it is
// right to: it is the ungated advice engine, seen by everybody who scans,
// including people we know nothing about. This is a different surface with
// different gates, and the rule's reason (an unasked-for calorie number put in
// front of an unknown person) does not reach it. What is enforced here instead:
//
//   1. Max tier only. Nobody meets this without having asked for it and paid.
//   2. Adults only. An eighteen-year-old floor, checked from date of birth, not
//      from a tick box.
//   3. A floor, not just a target. The output can never sit below basal
//      metabolic rate, and the deficit is capped. "Ridiculous targets" was the
//      owner's phrase and this is the part that enforces it.
//
// And a fourth that is a rule about what the output IS: this never states a
// goal weight. It answers "what does a day look like, in the direction you
// picked", never "get to X kg". A goal weight is the number that turns a
// composition tool into something that hurts people.
// ---------------------------------------------------------------------------

import type { Sex } from "./types.js";

/** The lowest age this is offered at, checked against date of birth. */
export const MIN_AGE = 18;

/**
 * How much below maintenance a deficit may ever go, as a share of maintenance.
 * Twenty percent is the conventional ceiling for a deficit somebody can eat
 * through without losing the training that makes it worth doing.
 */
export const MAX_DEFICIT = 0.2;

/** And the other side. A surplus larger than this is mostly fat gain. */
export const MAX_SURPLUS = 0.12;

/**
 * Protein, in grams per kilogram of body mass.
 *
 * 1.6 g/kg is where the meta-analytic evidence puts the point of diminishing
 * returns for resistance-trained adults. Higher figures circulate; they are not
 * better supported, and this is a number we have to be able to defend.
 *
 * WHICH body mass is the other half of that defence, and it is not always the
 * number on the scale. See proteinReferenceKg.
 */
export const PROTEIN_G_PER_KG = 1.6;

/**
 * The mass the per-kilogram targets are actually taken against.
 *
 * 1.6 g/kg is a recommendation made about people near a normal body
 * composition, where total mass and metabolically active mass are close
 * enough that the distinction does not matter. Applied to total mass at the
 * top of the accepted input range it stops describing anything: 250 kg at 60%
 * body fat came out as 400 g of protein and a 150 g fat floor, together more
 * energy than the day the same function had just calculated. The plan told
 * somebody to eat 2530 kcal and then listed 2950 kcal of food.
 *
 * Adipose tissue is not what the requirement scales with, so when body fat is
 * known this uses the standard adjusted body weight, lean mass plus a quarter
 * of the fat mass. That is a long-standing clinical convention rather than
 * anything invented here, and it lands the same 250 kg case on 220 g, which
 * is a number a dietitian would recognise.
 *
 * With body fat unknown there is nothing to adjust against and total mass
 * stands, which is what 1.6 g/kg means in the literature anyway.
 */
export function proteinReferenceKg(weightKg: number, bodyFat?: number): number {
  if (bodyFat === undefined) return weightKg;
  const lean = weightKg * (1 - bodyFat);
  // Rounded here rather than where it is printed, so the panel's explanation
  // and the panel's protein figure are the same arithmetic. A displayed 138kg
  // beside a target computed from 137.5kg is a figure that does not divide.
  return Math.round(lean + 0.25 * (weightKg - lean));
}

/**
 * Fat's floor, in grams per kilogram. Below roughly this, fat-soluble vitamin
 * absorption and endocrine function start to be affected, so it is a floor
 * rather than a preference and the carbohydrate figure yields to it.
 *
 * Taken against the same reference mass as protein, and for the same reason:
 * vitamin absorption and endocrine function do not scale with stored fat.
 */
export const FAT_FLOOR_G_PER_KG = 0.6;

/** Fat's default share of the day when the floor is not binding. */
const FAT_SHARE = 0.25;

export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

export type Activity = "sedentary" | "light" | "moderate" | "active" | "veryActive" | "extraActive";

/**
 * Activity multipliers, and the definitions they are attached to.
 *
 * The definitions matter more than the numbers: everybody thinks they are
 * "moderate". "Exercise" here means 15 to 30 minutes of elevated heart rate;
 * "intense" means 45 to 120 minutes; "very intense" means two hours or more.
 */
export const ACTIVITY: Record<Activity, { factor: number; label: string; detail: string }> = {
  sedentary: { factor: 1.2, label: "Sedentary", detail: "Little or no exercise, desk job" },
  light: { factor: 1.375, label: "Light", detail: "Exercise 1 to 3 days a week" },
  moderate: { factor: 1.465, label: "Moderate", detail: "Exercise 4 to 5 days a week" },
  active: { factor: 1.55, label: "Active", detail: "Daily exercise, or intense exercise 3 to 4 days a week" },
  veryActive: { factor: 1.725, label: "Very active", detail: "Intense exercise 6 to 7 days a week" },
  extraActive: { factor: 1.9, label: "Extra active", detail: "Very intense daily exercise, or a physical job" },
};

export type EnergyGoal = "lean" | "hold" | "build";

export const GOAL_LABEL: Record<EnergyGoal, string> = {
  lean: "Lean out",
  hold: "Hold steady",
  build: "Build",
};

export interface BodyInput {
  /** Years. Derived from date of birth rather than asked for again. */
  age: number;
  sex: Sex;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: EnergyGoal;
  /**
   * Body fat as a fraction, if it is known. Present switches the resting
   * figure from Mifflin-St Jeor to Katch-McArdle, which is the more accurate
   * of the two once lean mass is known and the less accurate when it is
   * guessed. Never estimated from a photograph.
   */
  bodyFat?: number;
}

export interface MacroPlan {
  /** Resting energy, before any activity. Also the floor on the day. */
  bmr: number;
  /** Maintenance: resting energy times the activity factor. */
  maintenance: number;
  /** The day, after the goal is applied and the floor enforced. */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Which resting formula was used, so the panel can say. */
  basis: "mifflin" | "katch";
  /** True when the floor moved the answer, so the copy can say why. */
  floored: boolean;
}

/** Mifflin-St Jeor. The widely adopted resting estimate when lean mass is unknown. */
export function mifflinStJeor(input: Pick<BodyInput, "sex" | "heightCm" | "weightKg" | "age">): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return base + (input.sex === "male" ? 5 : -161);
}

/** Katch-McArdle. More accurate than Mifflin, but only once body fat is measured. */
export function katchMcArdle(weightKg: number, bodyFat: number): number {
  const lean = weightKg * (1 - bodyFat);
  return 370 + 21.6 * lean;
}

/**
 * Is this person old enough to be shown a calorie figure at all?
 *
 * Taken from date of birth rather than from a declared age, because the whole
 * point of the guard is that it is not a tick box. An absent or unparseable
 * date is a no: the honest failure of an age gate is to close.
 */
export function oldEnoughForMacros(dateOfBirth: string | null | undefined, today: Date): boolean {
  if (!dateOfBirth) return false;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;
  return ageOn(dob, today) >= MIN_AGE;
}

/** Whole years elapsed, birthday-aware. */
export function ageOn(dob: Date, today: Date): number {
  let years = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) years -= 1;
  return years;
}

/**
 * Plausibility bounds on what a person can type.
 *
 * Not a validator for its own sake: every one of these feeds a formula that
 * will happily return a number for a 30cm adult, and that number would be
 * presented with the same confidence as a real one.
 */
export function bodyInputIsUsable(input: Partial<BodyInput>): input is BodyInput {
  const { age, sex, heightCm, weightKg, activity, goal, bodyFat } = input;
  if (!sex || !activity || !goal) return false;
  if (!ACTIVITY[activity] || !GOAL_LABEL[goal]) return false;
  if (!finiteBetween(age, MIN_AGE, 100)) return false;
  if (!finiteBetween(heightCm, 120, 230)) return false;
  if (!finiteBetween(weightKg, 35, 300)) return false;
  if (bodyFat !== undefined && !finiteBetween(bodyFat, 0.03, 0.6)) return false;
  return true;
}

function finiteBetween(v: number | undefined, lo: number, hi: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
}

/**
 * The day, from the body.
 *
 * Order matters and is the guard: the goal is applied to maintenance, then the
 * result is raised back to resting energy if it fell below it. A large deficit
 * on a small person is exactly the case where an uncapped calculator returns
 * something nobody should eat, and it is the case this exists to catch.
 */
export function macroPlan(input: BodyInput): MacroPlan {
  const useKatch = input.bodyFat !== undefined;
  const bmr = useKatch ? katchMcArdle(input.weightKg, input.bodyFat!) : mifflinStJeor(input);
  const maintenance = bmr * ACTIVITY[input.activity].factor;

  const adjusted =
    input.goal === "lean"
      ? maintenance * (1 - MAX_DEFICIT)
      : input.goal === "build"
        ? maintenance * (1 + MAX_SURPLUS)
        : maintenance;

  // The floor. Eating under resting energy is not a faster version of a
  // deficit, it is the version that costs muscle and adherence, and it is what
  // "no ridiculous targets" means in code.
  const calories = Math.max(adjusted, bmr);
  const floored = calories > adjusted + 0.5;

  // Not returned on the plan, and that is deliberate: MacroPlan's shape is
  // what enforces "there is nowhere to put a goal weight", and a weight-shaped
  // field on it weakens a guard that exists for a good reason. The panel calls
  // proteinReferenceKg itself when it needs to explain the figure.
  const referenceKg = proteinReferenceKg(input.weightKg, input.bodyFat);
  const protein = referenceKg * PROTEIN_G_PER_KG;
  const fatFloor = referenceKg * FAT_FLOOR_G_PER_KG;
  const fat = Math.max(fatFloor, (calories * FAT_SHARE) / KCAL_PER_G.fat);
  const remainder = calories - protein * KCAL_PER_G.protein - fat * KCAL_PER_G.fat;
  const carbs = Math.max(0, remainder / KCAL_PER_G.carbs);

  // The two floors are floors, so the day cannot be smaller than they are.
  //
  // Clamping carbohydrate at zero and printing the original target anyway is
  // how the numbers came to disagree: the remainder went negative, the clamp
  // hid it, and the plan listed more food than the calorie line above it. The
  // reference mass makes that unreachable on any accepted input, and this
  // still stands behind it, because a calculator whose own figures contradict
  // each other is worse than one that says a slightly larger number.
  const floorKcal = protein * KCAL_PER_G.protein + fat * KCAL_PER_G.fat + carbs * KCAL_PER_G.carbs;
  const day = Math.max(calories, floorKcal);

  return {
    bmr: Math.round(bmr),
    maintenance: Math.round(maintenance),
    calories: Math.round(day),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    basis: useKatch ? "katch" : "mifflin",
    floored,
  };
}
