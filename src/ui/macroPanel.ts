// ---------------------------------------------------------------------------
// The macro panel.
//
// NO FORM was the instruction, and it is the right one: a person who has paid
// for Max and just read their scan should not be handed six empty fields. So
// the panel runs the calculation and shows the answer, and everything on it is
// an adjustment to a number that is already there.
//
// The one exception is height and weight, which nothing collects yet. Those are
// asked once, in two fields, and remembered. Once a profile column exists the
// ask disappears and nothing else on this panel changes.
//
// Every number here comes from engine/macros.ts. Nothing is recomputed locally,
// because the whole reason that module exists is that Coach Max and this panel
// have to be reading the same day.
// ---------------------------------------------------------------------------

import { ACTIVITY, GOAL_LABEL, macroPlan, oldEnoughForMacros, proteinReferenceKg } from "../engine/macros.js";
import type { Activity, EnergyGoal, MacroPlan } from "../engine/macros.js";
import { isStale, readBody, writeBody } from "../engine/bodyProfile.js";
import type { StoredBody } from "../engine/bodyProfile.js";
import { ageOn } from "../engine/macros.js";
import type { Sex } from "../engine/types.js";

export interface MacroPanelCtx {
  sex: Sex;
  /** ISO date. The age gate reads this, never a typed age. */
  dateOfBirth: string | null;
  maxAccess: boolean;
  /** Diet advice muted in the goals quiz suppresses this like everything else. */
  dietAdvice: boolean;
}

/**
 * The panel's markup, or the reason there isn't one.
 *
 * Four states before the calculator is reached, and they are genuinely
 * different things rather than four ways of saying no:
 *
 *   muted        the person asked us to keep food out of it
 *   locked       Starter or free, so this is a thing to buy rather than a wall
 *   underage     the age gate, which never names a reason it does not have
 *   needsBody    we have the tier and the age and not the two measurements
 */
export function macroPanelHTML(ctx: MacroPanelCtx, now = new Date()): string {
  if (!ctx.dietAdvice) {
    return shell(
      `<p class="mac-note">You asked me to keep food recommendations out, so the calculator is off. Nothing else on your plan changes.</p>`,
    );
  }
  if (!ctx.maxAccess) {
    return shell(
      `<p class="mac-note">Your day, calculated from your own height, weight and training rather than from a table: resting energy, maintenance, and the protein, carbohydrate and fat that go with the direction you pick. Coach Max reads from the same figures. Part of Max.</p>`,
    );
  }
  if (!oldEnoughForMacros(ctx.dateOfBirth, now)) {
    // Deliberately does not say "you are too young", because on a missing date
    // of birth that would be a claim we cannot make. It says what is true: the
    // calculator is for adults and we do not have a date on file.
    return shell(
      `<p class="mac-note">The calculator is for adults only, and it works from your date of birth rather than a tick box. Add one in your account settings and it will appear here.</p>`,
    );
  }

  const body = readBody();
  if (!body) return shell(askHTML(), "mac-ask");
  const age = ctx.dateOfBirth ? ageOn(new Date(ctx.dateOfBirth), now) : 0;
  const plan = macroPlan({
    age,
    sex: ctx.sex,
    heightCm: body.heightCm,
    weightKg: body.weightKg,
    activity: body.activity,
    goal: body.goal,
    bodyFat: body.bodyFat,
  });
  return shell(planHTML(plan, body), isStale(body) ? "mac-stale" : "");
}

function shell(inner: string, cls = ""): string {
  return `<div class="panel mac ${cls}"><h4>YOUR DAY</h4>${inner}</div>`;
}

function askHTML(): string {
  return `<p class="mac-note">Two numbers and the calculator runs itself from here. They stay on this device and are never sent anywhere.</p>
  <div class="mac-fields">
    <label class="mac-field"><span>Height</span><input type="number" id="mac-h" inputmode="numeric" min="120" max="230" step="1" placeholder="cm"></label>
    <label class="mac-field"><span>Weight</span><input type="number" id="mac-w" inputmode="numeric" min="35" max="300" step="1" placeholder="kg"></label>
  </div>
  <p class="mac-err" id="mac-err" hidden></p>
  <button type="button" class="btn pri" id="mac-go">Work out my day</button>`;
}

function planHTML(plan: MacroPlan, body: StoredBody): string {
  const basis = plan.basis === "katch" ? "Katch-McArdle, from your lean mass" : "Mifflin-St Jeor";
  // The same call macroPlan makes. Read rather than returned on the plan
  // because MacroPlan's shape is what enforces that there is nowhere to put a
  // goal weight, and that guard is worth more than the convenience.
  const referenceKg = proteinReferenceKg(body.weightKg, body.bodyFat);
  return `<div class="mac-head">
    <b class="mac-kcal">${plan.calories.toLocaleString()}</b><span class="mac-kcal-u">kcal a day</span>
  </div>
  <div class="mac-macros">
    ${macroCell("PROTEIN", plan.protein)}
    ${macroCell("CARBS", plan.carbs)}
    ${macroCell("FAT", plan.fat)}
  </div>
  <div class="mac-bars">
    <div class="mac-bar"><span>Resting</span><b>${plan.bmr.toLocaleString()}</b></div>
    <div class="mac-bar"><span>Maintenance</span><b>${plan.maintenance.toLocaleString()}</b></div>
  </div>
  ${
    plan.floored
      ? `<p class="mac-floor">This is your resting figure, not the deficit you picked. A cut that lands under resting energy costs muscle and adherence rather than working faster, so the calculator will not write one.</p>`
      : ""
  }
  <div class="mac-adjust">
    <label class="mac-sel"><span>GOAL</span>
      <select id="mac-goal">${(Object.keys(GOAL_LABEL) as EnergyGoal[])
        .map((g) => `<option value="${g}"${g === body.goal ? " selected" : ""}>${GOAL_LABEL[g]}</option>`)
        .join("")}</select></label>
    <label class="mac-sel"><span>ACTIVITY</span>
      <select id="mac-activity">${(Object.keys(ACTIVITY) as Activity[])
        .map(
          (a) =>
            `<option value="${a}"${a === body.activity ? " selected" : ""}>${ACTIVITY[a].label}</option>`,
        )
        .join("")}</select></label>
  </div>
  <p class="mac-activity-def">${ACTIVITY[body.activity].label} means ${lowerFirst(ACTIVITY[body.activity].detail)}. A session counts as exercise at 15 to 30 minutes of raised heart rate, and as intense at 45 to 120. Almost everybody picks one level too high.</p>
  <p class="mac-basis">${body.heightCm}cm, ${body.weightKg}kg. Resting energy by ${basis}, then your activity factor.${
    // Said out loud whenever the two numbers differ, because otherwise the
    // protein figure does not divide by the weight printed beside it and the
    // panel looks like it has made an arithmetic mistake.
    referenceKg !== body.weightKg
      ? ` Protein and fat are set against ${referenceKg}kg rather than your scale weight: the requirement follows lean tissue, not stored fat.`
      : ""
  } <button type="button" class="linkish" id="mac-edit">Change height or weight</button></p>
  <p class="mac-note mac-disclaimer">A population formula, not a measurement of you: it is a starting point to adjust from over a few weeks, not a rule. It does not know your health history, and a physician or registered dietitian outranks this panel. No goal weight is set here and none should be.</p>`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function macroCell(label: string, grams: number): string {
  return `<div class="mac-macro"><b>${grams}<i>g</i></b><span>${label}</span></div>`;
}

/**
 * Wire the panel up. Re-renders in place on every change, because the panel IS
 * the calculation and a stale number beside a changed control is the one thing
 * it cannot do.
 */
export function wireMacroPanel(host: HTMLElement, ctx: MacroPanelCtx, now = new Date()): void {
  const rerender = () => {
    const fresh = document.createElement("div");
    fresh.innerHTML = macroPanelHTML(ctx, now);
    const next = fresh.firstElementChild as HTMLElement | null;
    if (!next) return;
    host.replaceWith(next);
    wireMacroPanel(next, ctx, now);
  };

  const go = host.querySelector<HTMLButtonElement>("#mac-go");
  if (go) {
    go.onclick = () => {
      const h = Number(host.querySelector<HTMLInputElement>("#mac-h")?.value);
      const w = Number(host.querySelector<HTMLInputElement>("#mac-w")?.value);
      const err = host.querySelector<HTMLElement>("#mac-err");
      // writeBody applies the calculator's own plausibility bounds, so the
      // check and the storage cannot disagree about what a usable body is.
      if (!writeBody({ heightCm: h, weightKg: w, activity: "moderate", goal: "hold" })) {
        if (err) {
          err.textContent = "Height in centimetres and weight in kilograms, both of a real adult.";
          err.hidden = false;
        }
        return;
      }
      rerender();
    };
  }

  const body = readBody();
  const goal = host.querySelector<HTMLSelectElement>("#mac-goal");
  const activity = host.querySelector<HTMLSelectElement>("#mac-activity");
  if (body && goal && activity) {
    const save = () => {
      writeBody({
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        bodyFat: body.bodyFat,
        goal: goal.value as EnergyGoal,
        activity: activity.value as Activity,
      });
      rerender();
    };
    goal.onchange = save;
    activity.onchange = save;
  }

  const edit = host.querySelector<HTMLButtonElement>("#mac-edit");
  if (edit && body) {
    edit.onclick = () => {
      // Re-ask rather than clear: an unusable pair leaves the stored one alone,
      // so a mistyped weight cannot lose a height that was already right.
      const nextH = window.prompt("Height in centimetres", String(body.heightCm));
      if (nextH === null) return;
      const nextW = window.prompt("Weight in kilograms", String(body.weightKg));
      if (nextW === null) return;
      writeBody({
        heightCm: Number(nextH),
        weightKg: Number(nextW),
        bodyFat: body.bodyFat,
        goal: body.goal,
        activity: body.activity,
      });
      rerender();
    };
  }
}
