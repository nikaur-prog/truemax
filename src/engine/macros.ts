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
 */
export const PROTEIN_G_PER_KG = 1.6;

/**
 * Fat's floor, in grams per kilogram. Below roughly this, fat-soluble vitamin
 * absorption and endocrine function start to be affected, so it is a floor
 * rather than a preference and the carbohydrate figure yields to it.
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

  const protein = input.weightKg * PROTEIN_G_PER_KG;
  const fatFloor = input.weightKg * FAT_FLOOR_G_PER_KG;
  const fat = Math.max(fatFloor, (calories * FAT_SHARE) / KCAL_PER_G.fat);
  const remainder = calories - protein * KCAL_PER_G.protein - fat * KCAL_PER_G.fat;
  const carbs = Math.max(0, remainder / KCAL_PER_G.carbs);

  return {
    bmr: Math.round(bmr),
    maintenance: Math.round(maintenance),
    calories: Math.round(calories),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    basis: useKatch ? "katch" : "mifflin",
    floored,
  };
}
