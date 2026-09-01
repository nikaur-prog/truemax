# Height, weight, units, and BMI context for Max

Status: implementation-ready product and engineering plan. This document does
not change production behaviour.

## Outcome

Collect height and weight once during account onboarding, in the unit system the
person uses, so the Max plan can open with a useful nutrition estimate instead
of presenting two metric-only fields at the bottom of a finished report.

The measurements are optional for a free or Starter account. For a Max member,
they become required only when the member asks TrueMax to calculate macros or
craft a diet/body-composition plan. They must not block payment, scans, grooming,
skin, hair, posture, or conversation with Max: making unrelated paid features
conditional on health data would be coercive and would not improve those
features.

## What exists today

- `src/ui/onboardingFunnel.ts` collects account details across a six-step
  post-auth onboarding flow. Date of birth already provides the adult gate.
- `src/engine/onboarding.ts` saves that profile to `public.profiles` with
  owner-only RLS.
- `src/ui/macroPanel.ts` is the current fallback. It asks Max adults for height
  in centimetres and weight in kilograms only.
- `src/engine/bodyProfile.ts` stores height, weight, activity, and energy goal in
  account-scoped `localStorage`. It does not follow the member to another phone.
- `src/engine/macros.ts` already owns the deterministic macro calculation,
  plausibility bounds, Mifflin-St Jeor estimate, activity factors, maximum
  deficit/surplus, resting-energy floor, and the rule that no goal weight is
  generated.
- `src/ui/nutritionPlan.ts` currently reacts to soft-tissue measurements without
  knowing the member's entered height or weight.
- `api/_maxPersona.ts` explicitly tells Max that a scan cannot diagnose body fat
  or explain why a face looked fuller on one day. That rule stays.

The work is therefore a collection, persistence, and context change, not a new
calorie calculator.

## Experience

### Account onboarding

Add one step after `AGE & DISCOVERY` and before `YOUR OBJECTIVE`:

**BODY MEASUREMENTS**

> Optional for now. Max uses these only for adult nutrition and
> body-composition planning. They do not affect your face score.

The step contains:

1. A two-option segmented control: `Metric` / `Imperial`. Default from locale,
   but remember the person's explicit choice.
2. Metric fields: height in `cm`, weight in `kg`.
3. Imperial fields: height in `ft` + `in`, weight in `lb`.
4. One `Why we ask` disclosure and an unambiguous `Skip for now` action.
5. No BMI number or weight-category label during signup. Account creation is
   the wrong moment to grade somebody's body.

Both email and OAuth signups land in this same onboarding step. The lightweight
auth form remains lightweight; it should not become a health questionnaire
between a completed scan and its result.

### Max completion gate

When a Max adult opens `YOUR DAY`, selects a body-composition goal, or asks Max
to craft a diet plan without complete measurements, open a short completion
sheet in context:

> To calculate food targets, I need your current height and weight. You can
> change or delete them later. They never change your face score.

This sheet uses the member's saved unit preference. It also asks for activity
level because exact macros cannot be derived from BMI alone. Date of birth and
the scan's reference sex already exist; dietary preferences and quiet topics
continue to control what recommendations may be shown.

The member can dismiss the sheet and keep using every non-nutrition Max feature.
Once completed, re-render the existing macro panel immediately and make the same
deterministic figures available to Max.

### Editing and freshness

Add `Body measurements` to account settings with:

- unit-system preference;
- editable height and weight;
- `Last confirmed` date;
- `Delete measurements`;
- a 90-day weight-confirmation prompt, reusing the staleness rule already in
  `src/engine/bodyProfile.ts`.

Changing display units never changes stored values. Height need not be re-asked
when only weight is stale.

## Units and calculation

Store one canonical representation:

- `height_cm`
- `weight_kg`

Convert only at the input and display edges:

```text
cm = total_inches * 2.54
kg = pounds * 0.45359237
BMI = weight_kg / (height_cm / 100)^2
```

Round display values, not stored values. Imperial-to-metric-to-imperial edits
must round-trip without weight or height drifting.

For adults, use the standard bands as explanatory context:

- under 18.5: underweight
- 18.5 to under 25: healthy range
- 25 to under 30: overweight range
- 30 and above: obesity range

BMI is a screening measure, not body-fat percentage, a diagnosis, or a measure
of fat distribution. Do not store a second `bmi` field that can become stale;
derive it from the current canonical measurements.

The calorie and macro path continues through `macroPlan()` in
`src/engine/macros.ts`. Its Mifflin-St Jeor resting estimate uses weight, height,
age, and sex; activity is a separate input. The output remains an estimate to
calibrate against observed weight trend, never a promise and never a goal
weight.

## How BMI may inform Max

BMI is a weak context signal layered after the user's stated goal, not an input
to the face score and not a diagnosis inferred from a photo.

Max may introduce a healthy cutting direction only when all of these are true:

1. The member is an adult under the existing date-of-birth gate.
2. The member explicitly chose `Lean out` or asked for fat-loss help.
3. Diet advice is enabled and body composition is not a quiet topic.
4. Entered height and current weight are present and not stale.
5. BMI is at least 25, with an on-screen reminder that muscularity and fat
   distribution can make BMI an imperfect fit.
6. No safety response says that automated energy targets are inappropriate,
   including pregnancy, clinician-directed nutrition care, or a current/history
   of an eating disorder.

Max must not automatically recommend a deficit to somebody in the healthy BMI
range, and it must not generate a deficit at BMI below 18.5. Under-18 accounts
remain excluded from cutting, bulking, calorie, body-fat, and weight coaching.

Allowed language:

> Your entered BMI is above the standard adult healthy range. If leaning out is
> already your goal, a moderate nutrition plan may also change facial fullness
> over time. The scan cannot tell whether body fat caused today's reading.

Disallowed language:

> Your BMI made your face puffy, so you need to cut.

Facial-adiposity studies support an association between BMI and some perceived
or measured facial characteristics, but effects vary across samples and do not
identify the cause of an individual's photo. BMI must therefore never override
the existing `api/_maxPersona.ts` rule that sleep, hydration, sodium, diet, and
body fat are possible inputs to discuss rather than facts diagnosed by a scan.

## Data model and privacy

Use a dedicated private table rather than widening the general onboarding row:

```sql
create table public.body_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  height_cm numeric(5,2),
  weight_kg numeric(6,2),
  preferred_units text not null default 'metric'
    check (preferred_units in ('metric', 'imperial')),
  activity text,
  energy_goal text,
  weight_confirmed_at timestamptz,
  consent_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

The migration must add plausible-value checks equivalent to
`bodyInputIsUsable()`, enable RLS, and create owner-only select/insert/update/
delete policies using `(select auth.uid()) = user_id`. Anonymous access is
revoked. Deletion is deliberately allowed for this table even though deletion
is not allowed on the general profile.

Raw height, weight, and BMI do not belong in analytics, logs, Stripe metadata,
auth `user_metadata`, URLs, or error messages. The Max API should read the row
for the authenticated user, derive the minimum context it needs, and label it
as self-entered. Prefer passing the deterministic macro result plus BMI band and
staleness over putting raw measurements into the generative prompt.

The current browser record should migrate only after an explicit sync notice:
read the scoped `truemax.body` value, validate it, upsert it for the signed-in
owner, then remove the local record after the server copy is confirmed. Offline
edits queue and retry like onboarding answers rather than silently disappearing.

## Engineering sequence

1. Add `body_profiles`, checks, grants, RLS, and a two-user isolation test.
2. Add a shared `BodyProfile` repository for load, save, delete, offline queue,
   and the one-time local-storage migration.
3. Add unit conversion helpers and boundary/round-trip tests.
4. Extend the onboarding funnel with the optional body-measurements step and
   update resume, validation, preview, keyboard, and mobile tests.
5. Replace `macroPanel.ts`'s metric-only fallback with the Max completion sheet;
   continue to call the existing macro engine.
6. Add the account-settings editor and delete flow.
7. Let `api/max-chat.ts` fetch sanitized, current body context server-side and
   extend `_maxPersona.ts` with the allowed/disallowed BMI language above.
8. Make `nutritionPlan.ts` combine three independent facts: the photo's
   soft-tissue observation, the member's selected goal, and self-entered body
   context. None may pretend to prove either of the others.
9. Add accessibility, privacy, telemetry, and end-to-end tests before rollout.

## Required tests and release gates

- Metric and imperial paths produce the same canonical values and BMI.
- Exact BMI boundaries (18.5, 25, and 30) classify deterministically.
- Optional signup can finish with no body data.
- Starter and free members are never blocked by the missing fields.
- Max nutrition cannot calculate without valid height, weight, activity, and an
  adult date of birth; all other Max surfaces remain usable.
- Under-18 and missing-age accounts fail closed for calorie/weight guidance.
- Low-BMI and safety-response paths never generate a deficit.
- Quiet-topic and diet-advice settings always win.
- Max never attributes a facial reading to BMI as a fact and never generates a
  target weight.
- One account cannot read, update, or delete another account's body profile.
- Delete removes the server row, local cache, queued writes, and prompt context.
- Raw measurements never appear in product analytics or server logs.
- Voice, screen-reader labels, mobile numeric keyboards, and both unit systems
  pass a real-device flow.

Ship in three flags: `body_profile_collection`, `max_body_gate`, then
`bmi_context_for_max`. Collection and unit support should stabilize before BMI
changes Max's language. Review anonymized event counts only (shown, skipped,
completed, deleted, stale-confirmed); never record the numbers entered.

## Evidence notes

- CDC describes BMI as a screening measure that must be considered with other
  health factors, not as a diagnosis:
  https://www.cdc.gov/bmi/adult-calculator/bmi-categories.html
- WHO uses the adult formula and conventional thresholds from age 18:
  https://www.who.int/news-room/fact-sheets/detail/obesity-and-overweight
- The NIH Body Weight Planner requires weight, sex, age, height, and physical
  activity; height and weight alone cannot produce a personalized energy plan:
  https://www.niddk.nih.gov/bwp
- Mifflin et al. derived the resting-energy equation from measured calorimetry
  in 498 adults:
  https://pubmed.ncbi.nlm.nih.gov/2305711/
- Coetzee et al. found that perceived facial adiposity related to health and
  body measures, while later multi-sample work found large variation in the
  strength of face-ratio/BMI relationships. That is evidence for cautious
  context, not causal attribution:
  https://journals.sagepub.com/doi/10.1068/p6423
  https://pmc.ncbi.nlm.nih.gov/articles/PMC4603950/
