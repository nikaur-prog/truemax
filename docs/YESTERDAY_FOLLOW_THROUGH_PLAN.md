# TrueMax follow-through plan

Updated: 2 September 2026

This is the execution order for the product feedback from 1–2 September. The
Higgsfield CTA remake is deliberately paused. It is not a release dependency
and should not compete with account, scan, results, or Coach Max reliability.

## 1. Stabilise the current analysis experience

Status: implemented on `main`; retain as release-regression coverage.

- Recover front and side photographs after iOS background/resume instead of
  leaving a black canvas with only landmarks.
- Keep archived-scan thumbnails visible and reopen their stored report.
- Make **View the full analysis** remove the dashboard layer before mounting
  the archived report.
- Keep one side **Profile** tab, with the intended profile icon and content;
  do not expose a duplicate Overview/Profile pair.
- Keep Max's thinking pose in the idle rotation, but clear the forced thinking
  state when generation finishes, fails, times out, or the panel closes.
- On phones, keep the analysis photograph large enough to recognise the whole
  face. Compact the shell header first; when the category rail reaches the top,
  keep only that rail sticky. Restore the full shell only at the top.
- Region selection may restore a larger face view, but must not jump the page
  or cover the category rail.

Release gate: front and side pass foreground/background recovery on a real
iPhone; no black canvas, detached landmarks, scroll jump, or permanently
thinking Max pose.

## 2. Repair Coach Max access and continuity

Status: implemented in the current branch; database migration and production
verification required before release.

- When the browser projection says Free/Starter, an explicit attempt to talk
  to Max reconciles the authenticated account with Stripe and re-reads access.
  It must never send a real subscriber back through Checkout.
- Keep the server boundary authoritative: only an active/trialling Max account
  or staff account can generate or read Max conversations.
- Store account-owned conversation text, source, title, and timestamps. Do not
  store photographs, landmarks, or full scan payloads in the conversation
  schema.
- List post-analysis and Coach-tab conversations together in the Coach tab.
  Reopening one restores the transcript and continues the same thread.
- Generate a concise title from the first real request. Do not create empty
  conversations when someone merely opens the panel.
- Persist explicit plan actions such as `add X to my current plan` and
  `X isn't working for me`. Ordinary questions never silently mutate memory.
- Let progress answers use saved plan states and actual scan movement only;
  Max must state what is missing rather than inventing progress.

Release gate: two-account isolation test, free/Starter 402 test, under-18
checkout test, active-Max stale-projection recovery test, conversation reopen,
post-analysis handoff, duplicate-request safety, migration check, and an
authenticated production smoke test.

## 3. Body measurements and adult nutrition context

Status: planned in [HEIGHT_WEIGHT_BMI_MAX_PLAN.md](./HEIGHT_WEIGHT_BMI_MAX_PLAN.md).

- Add optional height, weight, and Metric/Imperial choice to post-auth account
  onboarding; store canonical centimetres/kilograms in a private owner row.
- Missing measurements never block scanning, results, grooming, skin, hair,
  posture, or general Max chat.
- For an adult Max member, require current height, weight, activity, and goal
  only when calculating calories/macros or crafting a body-composition plan.
- Derive BMI at read time. Treat it as a screening/context signal, never as a
  face score, body-fat measurement, diagnosis, or proof that BMI caused facial
  puffiness.
- Under-18 and missing-age accounts fail closed for calorie, cutting, bulking,
  body-fat, and weight coaching.

Release order: private schema and repository; conversion/boundary tests;
optional onboarding; settings/edit/delete; nutrition completion sheet; then
flagged Max context.

## 4. Premium interaction polish

Status: existing mobile hierarchy is implemented; shared motion system remains
incremental polish.

- Use 140–200 ms navigation and 220–300 ms panel transitions.
- Animate opacity and transform only in the frequent paths; reserve layout
  changes before animation to prevent jumping.
- Cross-fade registered photographs rather than remounting to black.
- Keep one moving tab indicator, short six-to-ten-pixel panel travel, stable
  score widths, and a capped row stagger.
- Desktop can use a persistent two-column canvas; phone uses a compact shell,
  sticky category rail, and one primary action.
- Every transition has a `prefers-reduced-motion` equivalent and must remain
  smooth on a mid-range phone.

Avoid permanent blur, large parallax, bouncy springs, long intro sequences, and
animation that delays access to measurements. Premium should feel immediate,
not theatrical.

## 5. Natural goal preview

Status: future, consented phase; specification in
[NATURAL_GOAL_PREVIEW_PLAN.md](./NATURAL_GOAL_PREVIEW_PLAN.md).

- Selected goals produce one labelled synthetic visual direction, not a
  forecast or dated promise.
- Preserve bone geometry, identity, ethnicity, age, and sex traits. Limit
  changes to naturally attainable presentation such as styling, grooming,
  posture, lighting, cosmetic skin presentation, and an adult-selected modest
  body-composition direction.
- Max may propose goal chips but cannot silently add goals or send a photograph
  to a provider. The first render needs explicit cloud-processing consent and
  disclosed retention/deletion controls.
- Validate identity and landmark preservation on synthetic/internal faces
  before any member cohort.

## 6. Growth and operations after product reliability

- Keep the SEO foundation deployed, then complete the owner-only Search
  Console/DNS steps in [SEO_ROLLOUT_CHECKLIST.md](./SEO_ROLLOUT_CHECKLIST.md).
- Move TikTok League OAuth to production only after production redirect URIs,
  credentials, privacy disclosures, state/PKCE checks, and a real connect/
  disconnect smoke test pass.
- Return to CTA footage after the product flow is stable. Use real screen
  capture for the final tap/link-in-bio shot; generated footage should not fake
  an interface interaction.

## Merge order

1. Max access, full-analysis handoff, private conversation/memory migration.
2. Full automated test and production build.
3. Apply the database migration before or atomically with the web deployment.
4. Authenticated Max production smoke test and archived-report smoke test.
5. Record deployment/rollback commit, then begin body-profile phase behind
   flags.
