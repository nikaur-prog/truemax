import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY,
  MAX_DEFICIT,
  MIN_AGE,
  PROTEIN_G_PER_KG,
  ageOn,
  bodyInputIsUsable,
  katchMcArdle,
  macroPlan,
  proteinReferenceKg,
  mifflinStJeor,
  oldEnoughForMacros,
} from "./macros.js";
import type { BodyInput } from "./macros.js";

const BASE: BodyInput = {
  age: 28,
  sex: "male",
  heightCm: 178,
  weightKg: 78,
  activity: "moderate",
  goal: "hold",
};

// ---------------------------------------------------------------------------
// The formulas, against figures anyone can check by hand.
// ---------------------------------------------------------------------------

test("Mifflin-St Jeor matches the published formula in both directions", () => {
  // 10w + 6.25h - 5a, then +5 for men and -161 for women.
  assert.equal(mifflinStJeor(BASE), 10 * 78 + 6.25 * 178 - 5 * 28 + 5);
  assert.equal(mifflinStJeor({ ...BASE, sex: "female" }), 10 * 78 + 6.25 * 178 - 5 * 28 - 161);
  // And the two differ by exactly the constant, never by anything else.
  assert.equal(mifflinStJeor(BASE) - mifflinStJeor({ ...BASE, sex: "female" }), 166);
});

test("Katch-McArdle is driven by lean mass, not by body mass", () => {
  // 370 + 21.6 x lean. Two people of the same weight and different body fat
  // must not get the same resting figure, which is the entire reason the second
  // formula exists.
  assert.equal(katchMcArdle(80, 0.2), 370 + 21.6 * 64);
  assert.notEqual(katchMcArdle(80, 0.1), katchMcArdle(80, 0.3));
});

test("body fat switches the basis, and its absence does not", () => {
  assert.equal(macroPlan(BASE).basis, "mifflin");
  assert.equal(macroPlan({ ...BASE, bodyFat: 0.18 }).basis, "katch");
});

test("maintenance is resting energy times the activity factor, nothing else", () => {
  // Against the UNROUNDED resting figure. The plan rounds once, at the end;
  // multiplying an already-rounded BMR is a different number, which is why the
  // rounding happens where it does.
  const raw = mifflinStJeor(BASE);
  for (const key of Object.keys(ACTIVITY) as Array<keyof typeof ACTIVITY>) {
    const plan = macroPlan({ ...BASE, activity: key });
    assert.equal(plan.maintenance, Math.round(raw * ACTIVITY[key].factor), key);
  }
});

test("a heavier activity level never returns a smaller day", () => {
  const order = ["sedentary", "light", "moderate", "active", "veryActive", "extraActive"] as const;
  const cals = order.map((a) => macroPlan({ ...BASE, activity: a }).calories);
  assert.deepEqual(cals, [...cals].sort((x, y) => x - y));
});

// ---------------------------------------------------------------------------
// The guards. These are the reason the module exists in this shape.
// ---------------------------------------------------------------------------

test("the day is never below resting energy, whatever the goal", () => {
  // The load-bearing one. An uncapped deficit on a small, sedentary person is
  // exactly where a calculator returns a number nobody should eat, and it does
  // it with the same confidence as every other number on the screen.
  const small: BodyInput = {
    age: 62,
    sex: "female",
    heightCm: 152,
    weightKg: 46,
    activity: "sedentary",
    goal: "lean",
  };
  for (const input of [small, BASE, { ...BASE, goal: "lean" as const }]) {
    const plan = macroPlan(input);
    assert.ok(plan.calories >= plan.bmr, `${plan.calories} < BMR ${plan.bmr}`);
  }
});

test("the deficit is capped, so 'lean' cannot be made arbitrarily harsh", () => {
  const plan = macroPlan({ ...BASE, goal: "lean" });
  const hold = macroPlan(BASE);
  const cut = 1 - plan.calories / hold.maintenance;
  assert.ok(cut <= MAX_DEFICIT + 0.001, `cut of ${(cut * 100).toFixed(1)}%`);
});

test("the surplus is capped too", () => {
  const build = macroPlan({ ...BASE, goal: "build" });
  const hold = macroPlan(BASE);
  assert.ok(build.calories > hold.calories, "build should exceed hold");
  assert.ok(build.calories / hold.maintenance <= 1.2, "surplus is not mostly fat gain");
});

test("when the floor bites, the plan says so rather than hiding it", () => {
  // A person whose capped deficit still lands under resting energy gets the
  // floor, and the flag is what lets the panel explain the number instead of
  // printing one that does not match the goal they picked.
  const plan = macroPlan({
    age: 70,
    sex: "female",
    heightCm: 150,
    weightKg: 44,
    activity: "sedentary",
    goal: "lean",
  });
  assert.equal(plan.calories, plan.bmr);
  assert.equal(plan.floored, true);
  // And a plan that was not floored does not claim to have been.
  assert.equal(macroPlan(BASE).floored, false);
});

test("the age gate reads a date of birth, never a declared age", () => {
  const today = new Date("2026-08-30T00:00:00Z");
  assert.equal(oldEnoughForMacros("1990-01-01", today), true);
  assert.equal(oldEnoughForMacros("2010-01-01", today), false);
  // The day before an eighteenth birthday is still not eighteen.
  assert.equal(oldEnoughForMacros("2008-08-31", today), false);
  assert.equal(oldEnoughForMacros("2008-08-30", today), true);
});

test("an absent or unreadable date of birth closes the gate", () => {
  // The honest failure of an age gate is to close. A missing date used to mean
  // "we do not know", and "we do not know" must not resolve to "go ahead".
  const today = new Date("2026-08-30T00:00:00Z");
  for (const dob of [null, undefined, "", "not a date", "0000-00-00"]) {
    assert.equal(oldEnoughForMacros(dob, today), false, String(dob));
  }
});

test("ageOn counts whole years, birthday-aware", () => {
  assert.equal(ageOn(new Date("2000-06-15"), new Date("2026-06-14")), 25);
  assert.equal(ageOn(new Date("2000-06-15"), new Date("2026-06-15")), 26);
});

test("implausible bodies are refused rather than answered", () => {
  // Every one of these feeds a formula that returns a number regardless, and
  // the number would be presented with the same confidence as a real one.
  assert.ok(bodyInputIsUsable(BASE));
  const bad: Array<Partial<BodyInput>> = [
    { ...BASE, heightCm: 30 },
    { ...BASE, heightCm: 400 },
    { ...BASE, weightKg: 4 },
    { ...BASE, weightKg: 900 },
    { ...BASE, age: 12 },
    { ...BASE, age: Number.NaN },
    { ...BASE, bodyFat: 0.95 },
    { ...BASE, bodyFat: -0.1 },
    { ...BASE, activity: "brisk" as never },
    { ...BASE, goal: "shred" as never },
  ];
  for (const b of bad) assert.equal(bodyInputIsUsable(b), false, JSON.stringify(b));
});

test("nobody under the minimum age passes the input check either", () => {
  // Two gates, both closed, because they fail for different reasons: one reads
  // a stored date of birth and one reads what is in front of the calculator.
  assert.equal(bodyInputIsUsable({ ...BASE, age: MIN_AGE - 1 }), false);
  assert.equal(bodyInputIsUsable({ ...BASE, age: MIN_AGE }), true);
});

// ---------------------------------------------------------------------------
// The macros themselves.
// ---------------------------------------------------------------------------

test("the macros add back up to the calories they were split from", () => {
  for (const goal of ["lean", "hold", "build"] as const) {
    const p = macroPlan({ ...BASE, goal });
    const sum = p.protein * 4 + p.carbs * 4 + p.fat * 9;
    // Within rounding of four whole-gram figures.
    assert.ok(Math.abs(sum - p.calories) <= 12, `${goal}: ${sum} vs ${p.calories}`);
  }
});

test("protein is set from body mass, not from a share of the day", () => {
  // A share-of-calories split gives a dieting person less protein exactly when
  // they need more of it. Tied to the body instead, it does not move with the
  // goal.
  const lean = macroPlan({ ...BASE, goal: "lean" });
  const build = macroPlan({ ...BASE, goal: "build" });
  assert.equal(lean.protein, build.protein);
  assert.equal(lean.protein, Math.round(BASE.weightKg * PROTEIN_G_PER_KG));
});

test("fat never falls under its floor, and carbohydrate yields to it", () => {
  // Small, sedentary, cutting: the case where a percentage split puts fat under
  // what endocrine function needs.
  const p = macroPlan({ age: 55, sex: "female", heightCm: 155, weightKg: 50, activity: "sedentary", goal: "lean" });
  assert.ok(p.fat >= Math.round(50 * 0.6) - 1, `fat ${p.fat}g under the floor`);
  assert.ok(p.carbs >= 0, "carbohydrate went negative");
});

test("no output is a weight, a goal weight, or a rate of loss", () => {
  // The rule about what this IS. A goal weight is the number that turns a
  // composition tool into something that hurts people, so the shape of the
  // result is the enforcement: there is nowhere to put one.
  const p = macroPlan({ ...BASE, goal: "lean" });
  assert.deepEqual(
    Object.keys(p).sort(),
    ["basis", "bmr", "calories", "carbs", "fat", "floored", "maintenance", "protein"],
  );
});

test("every figure returned is a whole number", () => {
  // It is printed next to food. "2183.4082 kcal" claims a precision that a
  // population regression on height and weight does not have.
  const p = macroPlan({ ...BASE, bodyFat: 0.17, goal: "build" });
  for (const [k, v] of Object.entries(p)) {
    if (typeof v !== "number") continue;
    assert.equal(v, Math.round(v), `${k} = ${v}`);
  }
});

// ---------------------------------------------------------------------------
// The numbers on the card have to add up to the number above them.
// ---------------------------------------------------------------------------

const HEAVY = {
  age: 30,
  sex: "male",
  heightCm: 180,
  activity: "sedentary",
  goal: "lean",
} as const;

test("the macros never total more energy than the day they are printed under", () => {
  // Swept across the whole accepted input range rather than spot-checked. The
  // failure was at one corner of it - 250kg at 60% body fat printed 2530 kcal
  // and then listed 2950 kcal of food - and a corner is exactly what a couple
  // of hand-picked cases miss.
  for (let weightKg = 35; weightKg <= 300; weightKg += 5) {
    for (const bodyFat of [undefined, 0.03, 0.15, 0.3, 0.45, 0.6]) {
      for (const goal of ["lean", "hold", "build"] as const) {
        const plan = macroPlan({ ...HEAVY, goal, weightKg, ...(bodyFat === undefined ? {} : { bodyFat }) });
        const sum = plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
        assert.ok(
          sum <= plan.calories,
          `${weightKg}kg at ${bodyFat}: ${Math.round(sum)} kcal of macros under a ${plan.calories} kcal day`,
        );
      }
    }
  }
});

test("the accepted rounding regression cannot print more food than the day", () => {
  const input: BodyInput = {
    age: 20,
    sex: "male",
    heightCm: 213,
    weightKg: 283,
    activity: "light",
    goal: "lean",
    bodyFat: 0.41,
  };
  assert.equal(bodyInputIsUsable(input), true);
  const plan = macroPlan(input);
  const sum = plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
  assert.ok(sum <= plan.calories, `${sum} kcal of macros under a ${plan.calories} kcal day`);
});

test("protein is taken against lean tissue rather than scale weight", () => {
  // 400 g of protein is not a recommendation anybody makes. The adjustment is
  // what stops the per-kilogram rule being applied where it stops meaning
  // anything.
  assert.equal(proteinReferenceKg(250, 0.6), 138);
  assert.equal(macroPlan({ ...HEAVY, weightKg: 250, bodyFat: 0.6 }).protein, 221);
});

test("with no body fat reading there is nothing to adjust and scale weight stands", () => {
  assert.equal(proteinReferenceKg(80, undefined), 80);
  assert.equal(macroPlan({ ...HEAVY, weightKg: 80 }).protein, 128);
});

test("an impossible calendar date is not silently rolled forward into an age", () => {
  // new Date("2008-02-30") is 2 March 2008 and new Date("2010-04-31") is
  // 1 May 2010. Days out is nothing until the day it matters, and the day it
  // matters is somebody's eighteenth birthday.
  const dayBefore = new Date("2026-03-01T00:00:00Z");
  assert.equal(oldEnoughForMacros("2008-02-30", dayBefore), false);
  assert.equal(oldEnoughForMacros("2010-04-31", new Date("2028-05-01T00:00:00Z")), false);
  // The real date either side of it still answers normally.
  assert.equal(oldEnoughForMacros("2008-02-28", dayBefore), true);
});
