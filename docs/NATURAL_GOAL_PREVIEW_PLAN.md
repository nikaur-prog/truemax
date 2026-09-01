# Natural Goal Preview

## Product promise

Show one plausible visual direction for the goals a person explicitly chooses, then connect every visible change to a plan they can act on. This is not a prediction, medical simulation, attractiveness score, or promise that the person will reach the rendered result.

The user-facing name should be **Goal preview** or **Natural potential preview**. The permanent caption is: **“A synthetic visual direction based on your selected goals, not a forecast.”**

## What may change

- Hairstyle and styling, without claiming new hair growth.
- Facial-hair and eyebrow grooming.
- Cosmetic presentation of skin texture and tone, without diagnosing or promising treatment of a condition.
- Posture, expression, wardrobe, lighting and camera presentation.
- A modest leaner or less-puffy presentation for adults who explicitly choose that goal. Never infer a body-fat target.
- A warmer complexion only when the person explicitly chooses it. Recommendations must remain sun-safe and must not recommend UV exposure.

## What must not change

- Bone geometry, facial measurements, ethnicity, age or sex traits.
- Eye, nose, lip, chin or jaw shape.
- Medical conditions or scars the person did not ask to represent cosmetically.
- Anything framed as surgery, a procedure, a guaranteed result or a dated forecast.
- Body-composition visualization for an under-18 user.

## Core interaction

1. The person adds goals directly, or Max proposes a short group of goal chips.
2. A Max proposal is never written silently. Each chip has an explicit **Add goal** action, followed by one confirmation for the group.
3. Before the first render, TrueMax explains that the selected front photograph will be sent to a generation provider and names the retention/deletion policy. This is a new cloud-processing consent, separate from landmark-feedback consent.
4. The preview appears as a current/goal comparison with a draggable divider. The goal side always carries the synthetic-preview label.
5. A **What changed** drawer lists only the selected goals and links each one to its plan card.
6. Changing the goal set marks the preview stale. Regeneration is deliberate, debounced and cost-gated; it does not run once per toggle.

## Responsive experience

### Phone

- Open as a full-height sheet from the Plan surface.
- Keep the face comparison in the upper third and the selected-goal chips directly below it.
- The comparison divider responds one-to-one with the thumb; no spring while dragging.
- On release, the divider settles over 160–200 ms. Goal chips use a 140 ms press and selection transition.
- Scrolling the explanation pins one compact **Current / Goal preview** switch, not a second copy of the photograph.

### Desktop

- Use a two-column composition: persistent comparison on the left, goal recipe and plan cards on the right.
- Hovering a goal card temporarily highlights the affected presentation layer; clicking locks it.
- Cross-fade current and preview over 220–280 ms with a two-pixel registration hold so the face does not appear to jump.
- Do not use parallax, elastic page motion or long blur transitions. They compete with facial comparison and increase compositing cost.

## Premium motion language

- **Navigation:** 140–200 ms; opacity and transform only.
- **Panel changes:** 220–300 ms; six to ten pixels of travel, shorter on phones.
- **Photo changes:** 170–240 ms cross-fade with identical crop and registration.
- **Score updates:** roll only the changed digits; keep the scale fixed.
- **Generated preview arrival:** a single soft light pass, then stillness. Never loop the morph.
- Respect `prefers-reduced-motion` and replace every spatial move with an instant state change or short opacity change.

## Data contract

The preview belongs to a versioned recipe rather than the existing on-device `ProfileV1` record.

```ts
interface GoalPreviewSpec {
  sourceScanId: string;
  goalIds: string[];
  styleChoices: Record<string, string>;
  recipeVersion: string;
  consentVersion: string;
  generatedAt?: string;
  artifactRef?: string;
  status: "draft" | "generating" | "ready" | "stale" | "failed";
}
```

The server converts goal IDs to bounded transformation parameters. It never accepts free-form instructions that can reshape anatomy. Source and generated media should be encrypted, short-lived at the provider, deleted on revocation, and excluded from model training and advertising.

## Max integration

Max may explain trade-offs, propose goal chips and assemble the corresponding plan. Max may not silently mutate goals, generate a preview without consent, or describe the image as what the person “will” look like. The existing rule that model prose cannot directly write profile state remains in force.

## Delivery sequence

1. Ship the goal-recipe model, explicit confirmation and audit events without image generation.
2. Add provider evaluation using synthetic/internal faces; verify identity and geometry preservation with landmarks before showing any output.
3. Add opt-in cloud consent, retention controls and a staff-only preview route.
4. Release current/goal comparison to a small adult cohort with regeneration limits and feedback.
5. Connect accepted goals to Max plan cards and weekly tracking. Weekly tracking compares scans; it does not claim the generated face is the destination reached.

## Release gates

- Landmark displacement outside the permitted presentation mask fails closed.
- Every preview is visibly labelled in the image and surrounding UI.
- Revocation removes both source-provider artifacts and the stored preview reference.
- Failed or slow generation returns to the current photograph and plan; it never blocks the report.
- Generation cost, latency, regeneration rate, save rate and plan-start rate are measured separately.
- A human review confirms the experience on small iPhone, large iPhone, tablet and desktop breakpoints.
