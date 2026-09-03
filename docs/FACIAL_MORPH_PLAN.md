# The Goal Preview: plan of record

Written 3 September 2026 from the owner's brief, Codex's audit and feature
plan, and a map of the codebase. Two earlier documents already hold parts of
this and they stand: `NATURAL_GOAL_PREVIEW_PLAN.md` (the promise, what may
and must not change, the motion language, the release gates) and section
3.7 of `PREMIUM_REVIEW_AND_MAX_PLAN.md` (the measurement contract, the
render, the re-measurement, the rejection path, the teaser, the consent
boundary). This document is the build plan on top of them: what ships, in
what order, who builds which part, what each part is made of, and the
rules that bind every part.

The user-facing name is **Goal preview**. Internally the feature is the
morph. The permanent caption on every rendered image is the owner's:
"A synthetic visual direction based on your selected goals, not a forecast."

## 1. The experience, as the owner described it

1. After the first scan, Coach Max offers to craft the plan.
2. The person sees two previews, each a front and a side:
   **Your selected plan**, with only the goals they chose applied, and
   **Max's complete vision**, with every applicable non-surgical goal from
   the catalogue applied. The second is the reason to keep going; the first
   is the thing they are doing.
3. Every goal is a card: a regional current-versus-possible strip, the
   expected time range, the measurements it is allowed to move, the target
   movement in bars, a confidence, and the completion standard, which is a
   measurement rule, never a look.
4. Adding or removing a goal marks the preview stale and recomposes it on a
   deliberate, debounced, cost-gated regeneration.
5. Every rescan updates progress against the original target, which stays
   fixed. The tracker compares scans to scans. The preview is never the
   destination the tracker reports.
6. Points are two ledgers kept apart: consistency (routines done, logs kept,
   standardised scans taken) and verified progress (a measurement moved past
   capture noise and stayed moved). Neither pays out more for a more extreme
   physical change.

## 2. What already exists, and what is missing

| exists | where |
|---|---|
| The goal vocabulary, eleven ids, seven measurable | `src/engine/goals.ts` |
| Which measurements can honestly evidence a goal | `src/engine/goalEvidence.ts` (`evidenceFor`, `canShowProgress`) |
| Per-metric movability without surgery | `fixability` on every metric, `Report.potential` |
| Per-metric repeatability and the reliability floor | `src/engine/reliability.ts`, `RELIABLE_MIN 0.15` |
| The progress read that says whether a number moved | `src/engine/followUp.ts` (`NOISE 0.6`, 14-day minimum, 56 days to call a stall) |
| The commitment clock with weekly check-ins | `src/engine/protocol.ts`, `src/ui/protocolCard.ts` |
| Height, weight, activity, body goal, body fat, saved on device | `truemax.body` (`StoredBody`), read by the macro panel |
| The calorie surface, Max tier, 18 by date of birth, floored at BMR | `src/engine/macros.ts`, `nutritionPlan.ts` |
| The one adult gate, client and server | `src/engine/age.ts`, `api/_maxAccess.ts` |
| A per-render reserve, finalize, refund meter | `claim_tts_render` with meters `league`, `voice`, `studio` |
| Per-day claim and release allowances | `max_chat_usage`, `side_landmark_usage` |
| Private bucket, expiry, delete trigger, cleanup queue, daily cron, revoke RPC, pseudonymous consent audit | the side-feedback loop (`20260812034506`, `20260819100000`, `api/cleanup-side-correction-feedback.ts`) |
| A provider render behind a single function, with upload, polling, bounded download and a deadline | `api/carousel-slide.ts` (Higgsfield), `api/ai-image.ts` (OpenAI) |
| The consent dialog pattern, one per data purpose, never merged | `askCloudPlacementConsent`, `askSideFeedbackConsent` |
| The preview data contract | `GoalPreviewSpec` in `NATURAL_GOAL_PREVIEW_PLAN.md` |

What is missing: the catalogue that turns a goal into bounded effects; the
consent, storage, job route, quota and deletion for the two photographs
leaving the device; the target engine that turns effects into a per-person
contract; the re-measurement validator; the plan cards and previews; Max's
proposal flow; the beta.

Two corrections to Codex's audit. Height and weight collection exists on
device with a metric-only store; what is missing is the imperial entry and
the diet-feature gate, not the collection. And the side-scan results copy
saying the points were hand-placed is correct until the fusion in
`SIDE_LANDMARKS_AI_FIRST.md` section 3 ships; it is not a defect.

## 3. Build order: seven contained PRs

| PR | what | owner | depends on |
|---|---|---|---|
| 1 | The production defects from the audit: placeholder celebrity faces, past-due billing wording, profile modal close controls, bundle size | Codex | nothing |
| 2 | Imperial and metric entry for height and weight, the diet-feature gate, the side-flow screens in `SIDE_LANDMARKS_AI_FIRST.md` section 3c | Codex | nothing |
| 3 | The goal-effect catalogue, versioned, with evidence bands and the points rules | Claude | nothing (this cycle) |
| 4 | Consent, private storage, the preview job route, the render quota, deletion and retention | Claude | 3 |
| 5 | The target engine (catalogue plus a person's report into a contract) and the front-and-side consistency validator | Codex | 3 |
| 6 | Plan cards, the selected-plan preview, Max's complete vision, the What-changed drawer, staleness and regeneration | Codex | 4, 5 |
| 7 | The 18-plus Max beta: cohort flag, generation, save and plan-start rates measured separately, target calibration from repeat scans | both | 6 |

Codex keeps: the target-vector engine, generated-image validation, the Max
interaction flow, and the front end. Claude keeps: migrations, the retention
workflow, the provider job API, the evidence catalogue. Nobody changes the
measurement or report code in the same cycle as the other.

## 4. The catalogue (PR 3)

`src/engine/goalCatalogue.ts`, version `catalogue-1`. One entry per goal id
in `GOALS`, and the entry is the only thing the target engine, the plan
cards and the render prompt may read about a goal. It never accepts free
text.

Each entry carries:

- `measures`: the metric ids this goal is allowed to move, filtered at load
  time through `canShowProgress` so a measurement that does not reproduce or
  cannot move without surgery is never promised. A goal that ends up with
  none is reported as such ("not measured by the scan"), never padded.
- `layers`: the presentation layers the render may touch for this goal, from
  the owner's may-change list: `hair`, `facialHair`, `brows`, `skinSurface`,
  `leanerPresentation`, `posture`, `expression`, `lighting`, `wardrobe`. A
  layer not listed is forbidden for that goal. `leanerPresentation` is adult
  only and only on an explicit choice.
- `movement`: the conservative range of movement, as a fraction of the
  metric's `fixability` times the person's gap to their band, capped per
  goal. The render is asked for the low end; the tracker celebrates from the
  low end.
- `weeks`: the typical time range to a visible change, as a low and high
  figure, and the evidence grade behind it.
- `evidence`: `A` (consistent controlled evidence), `B` (observational or
  mechanistic with agreement), `C` (practitioner consensus), `none`. The
  grade sets the wording: an A goal may say "usually"; a C goal says "some
  people find".
- `confounders`: the things that make the measurement move for a reason
  other than the goal (water, lighting, expression, growth in a minor).
- `combinesWith` and `excludes`: goal pairs that reinforce and pairs that
  should not be rendered together.
- `completion`: the rule that says a goal is done: the named measurement
  moved by at least its minimum meaningful delta, beyond capture noise, and
  held in two of the next three standardised scans.
- `points`: consistency points per completed week, and the flat verified
  progress award. Consistency scales mildly with the goal's effort tier
  (the slow goals earn more for showing up, not for changing more); verified
  progress is the same flat figure for every goal, by design.
- `minors`: whether a goal is offered under 18 at all, and whether its
  layers are (body composition is never rendered for a minor; skin and
  grooming goals are).

The entry for `skin` deliberately has no measurement: the scan does not
measure skin geometry, redness and chroma reproduce at 0.00, and a concern
is self-declared, never inferred. Its layer is `skinSurface`, its progress
is a photo-standardised self-comparison, and its points are consistency
only until a reproducible measure exists. Codex's warning stands: no scalar
like "azelaic intensity 4" enters the catalogue; intervention specifics stay
in the recommendation engine with its five rules.

## 5. Consent, storage, job route, quota, deletion (PR 4)

### 5a. Consent

A new consent, `goal-preview-v1`, asked before the first render and
remembered on the server as a consent event, never merged with the
cloud-pass consent or the feedback consent. The dialog names the provider,
says what is sent (the front and side photographs from this scan and the
bounded contract, nothing else), states the provider's retention under its
commercial terms and links it, says TrueMax keeps only the rendered
previews and for how long, says the previews are excluded from training and
advertising, says adults only and never for a guest's scan, and says how to
revoke. Revocation is a button in Settings that deletes every stored preview
and records a `revoked` event.

The published promises this contradicts are amended in the same PR, in one
commit, before the route can be called: `index.html` line 248, `privacy.html`
lines 35 to 37, 60, 99 to 100 and the processors list, `terms.html` lines
121 to 124, `delete-account.html` lines 85 to 86, and the App Store review
notes. The wording keeps the default true ("Your photos stay on your phone
unless you choose a Goal preview, which sends them once") and the privacy
page names the provider. The in-app notice before a material change takes
effect (`privacy.html` 317 to 322) is honoured by the consent dialog itself.

### 5b. Storage and retention

Source photographs are never stored by TrueMax: they are forwarded to the
provider in memory and dropped, exactly as the side pass does. What is
stored is the rendered output, in a new private bucket `goal-previews` at
`{user_id}/{preview_id}/front.jpg` and `side.jpg`, JPEG only, with no
storage policies (service role only) and no signed URLs ever issued: the
route reads the object and returns it inline, under the 4.5 MB response
cap, the way every image route does today.

Table `goal_previews`: `id`, `user_id`, `scan_id`, `spec` (the
`GoalPreviewSpec` with its `contract`), `catalogue_version`,
`consent_version`, `status` (`generating`, `ready`, `rejected`, `failed`,
`revoked`), `provider`, `provider_job_ref`, `front_path`, `side_path`,
`validation` (the client's re-measurement verdict, posted back), `created_at`,
`expires_at` (thirty days by default), `kept_until` (a saved preview keeps
for a year), `deleted_at`. RLS on; the owner can read their own rows'
metadata; all writes are service role.

Retention: a BEFORE DELETE trigger queues both storage paths into
`goal_preview_storage_cleanup`; the existing daily cron gains a second
handler, `api/cleanup-goal-previews.ts`, that removes expired previews'
objects and rows, drains the queue, and purges consent events past their
retain-until. Account deletion cascades from `auth.users` and the trigger
covers the objects. A pseudonymous `goal_preview_consent_events` table
(no user id, 365 days) records granted, revoked, expired and deleted.

### 5c. The job route

`api/goal-preview.ts`, three methods.

`POST` creates and renders. Gates in the standing order: origin, signed in,
`maxAccessForUser` (which returns the age, refuses non-Max with 402 and a
missing profile with 409), adult only (403 with the same sentence checkout
uses), a granted and unrevoked consent event for `goal-preview-v1` (403,
"Choose Goal preview in Settings first"), then the atomic claim on the daily
allowance (`claim_goal_preview_render`, three a day, released only when the
provider produced nothing), then the render meter reservation on the
existing ledger with a new meter `preview`. The body is multipart: `front`
and `side` JPEGs under two megabytes each, `spec` as JSON. The route
validates the spec against the catalogue version it was built from, refuses
any spec that names a layer the catalogue does not allow for its goals,
prepares both images in memory, calls the provider behind the interface,
stores the outputs, marks the row ready and returns the preview id and both
images inline. It runs synchronously inside a 300-second function with a
250-second budget, the same shape as `api/ai-image.ts`, because the platform
has no background worker and the carousel route has shown the shape holds.

`GET ?id=` returns a stored preview inline for its owner, or 404.

`DELETE ?id=` revokes one preview: row marked revoked, objects removed via
the queue, a `deleted` consent event, and the provider's artefact deleted
where its API allows it.

The provider interface, `api/_previewProvider.ts`: `render(input) ->
{ front, side, providerRef }` where the input is the two prepared JPEGs and
the contract's bounded, non-anatomical instruction set, generated from the
catalogue's layers and never from typed text. The first implementation is
Higgsfield, reusing the carousel's client, upload and polling; the fallback
is the OpenAI edit endpoint already wired in `api/ai-image.ts`. The prompt
carries the identity and non-inference clauses the carousel prompt already
carries: no age, sex, or ethnicity inference, no bone change, no procedure.

### 5d. What the client re-measures

The rendered front and side come back to the device and go through the same
landmarker, side placement and metrics as the originals. The validator
(PR 5, Codex) checks the contract both ways and posts its verdict to the
row. A render that fails is never shown; the route stores it as `rejected`
so the regeneration limit still counts it.

## 6. The target engine and validator (PR 5, Codex)

The engine takes the person's report, their chosen goal ids and the
catalogue, and writes the contract: for each allowed measurement, a target
band from the current value toward the person's own band, sized by the
catalogue's movement fraction and capped, with every other measurement at
tolerance zero. It estimates the required movement as a range, never a
point, and never from a face alone: body-composition targets require the
device body record, and under 18 they do not exist.

The validator re-measures both rendered views and rejects when identity
similarity falls below the threshold, an unselected region moved beyond
noise, hairstyle, expression or lighting changed without a layer allowing
it, the front and side imply different anatomy, or a targeted measurement
did not land inside its band. The threshold for "moved" is the metric's
capture noise from `reliability.ts`, not a chosen number.

## 7. Plan cards, previews and Max (PR 6, Codex)

The cards read the catalogue and the contract and nothing else. Max may
propose goal chips and explain trade-offs; a proposal is never written
silently, every chip has an explicit Add action, and one confirmation
covers the group. Max may not describe the preview as what the person will
look like. The rule that model prose never writes profile state stands.

## 8. Points

Two ledgers, on the server so they survive a device: `consistency_points`
and `progress_points`, each a per-user balance plus an append-only event
table keyed on (user, goal, week) so a week cannot be counted twice.
Consistency is earned by the protocol clock (a check-in kept, a
standardised scan taken); verified progress is awarded once per goal when
the completion rule in the catalogue is met, by the follow-up read, and
never by a rescan alone. No award reads the size of a physical change. No
award exists for a guest scan. Under 18, body-composition goals earn no
points at all because they are not offered.

## 9. The beta (PR 7)

Max tier, 18 by date of birth, a cohort flag in `profiles`, three renders a
day, regeneration debounced, generation cost, latency, regeneration rate,
save rate and plan-start rate measured separately, and a human review on
small iPhone, large iPhone, tablet and desktop. The catalogue's movement
fractions and week ranges are recalibrated from repeat scans at the end of
the beta, as `catalogue-2`, with the change recorded in this document.

## 9a. What shipped in the first cycle (3 September 2026)

| piece | file | state |
|---|---|---|
| The catalogue | `src/engine/goalCatalogue.ts` | built, `catalogue-1`, with `specAllowed` as the gate the route uses; evidence grades are for review before the beta |
| Consent, previews, usage, cleanup queue, bucket, RPCs | `supabase/migrations/20260903120000_goal_previews.sql` | written, **not applied**; apply in the Supabase SQL editor before the route is called |
| The provider interface | `api/_previewProvider.ts` | built; Higgsfield when `HF_CREDENTIALS` and `HIGGSFIELD_PREVIEW_ENDPOINT` are set, else the OpenAI edit endpoint when `OPENAI_API_KEY` is set, else the route answers 503 |
| The route | `api/goal-preview.ts` | built: `POST` render, `GET` fetch, `PATCH` verdict or keep, `DELETE` revoke; three renders a day; caption in the pixels; two images bounded together under the response cap |
| The consent route | `api/goal-preview-consent.ts` | built: `GET` state, `PUT` grant (refuses a stale wording), `DELETE` revoke (every preview deleted, objects removed, trail written); the shared version string lives in `src/engine/goalPreviewConsent.ts` |
| The sweep | `api/cleanup-goal-previews.ts` and the cron in `vercel.json` | built, daily at 03:30 UTC with `CRON_SECRET`; also marks a render killed mid-flight as failed after fifteen minutes |
| Tests | `api/_goal-preview.test.ts`, `src/engine/goalCatalogue.test.ts` | gate order, no signed URLs, caption, spec parsing, instructions, provider selection, migration and cron pins |

Not yet in this cycle, and required before any person can call the route:
the consent dialog and Settings section calling the consent route (Codex,
PR 6), the published-promise amendments in section 5a (Claude, with the
consent dialog's PR), and a render meter on the shared ledger if the daily
allowance proves too coarse. Nothing calls the consent route's `PUT` until
the dialog ships, so the render route refuses everyone today by
construction.

**A retention fact the consent copy must carry.** The Higgsfield path
uploads the two prepared photographs to the provider to reference them,
and the installed client offers no call to delete an upload. The upload
references are stored on the preview row so a deletion can be made the day
the provider exposes one. Until then the release gate "revocation removes
provider artefacts" is met for TrueMax's own storage and not for the
provider's, and the dialog says so in the provider's own words with a link,
as the cloud-pass consent does. The OpenAI path sends the bytes in the
request and stores no reference.

## 10. The rules that bind every part

- Bone geometry, facial measurements, ethnicity, age and sex traits, and
  eye, nose, lip, chin and jaw shape never change in a render, and the
  validator fails closed when they do.
- Ethnicity is never inferred from a photograph and never reaches a prompt.
- No preview for a guest's scan, ever. No body-composition render for a
  minor, ever.
- A rarity is never stated about a person; no verdict word names a real
  person; the verdict ladder is the only ladder.
- Only Coach Max is coach-toned. Every card is plain and factual, and the
  caption is permanent.
- No cross-user data from any endpoint.
- Source photographs are never stored by TrueMax. Rendered previews expire.
  Revocation deletes.
- No em dashes in user-facing copy.
