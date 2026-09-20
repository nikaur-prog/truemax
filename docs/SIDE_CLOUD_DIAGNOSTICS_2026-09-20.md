# Side-cloud availability: calibration follow-up

## What the completed placement pilot establishes

All 21 exported review rows (20 unique references and one retained duplicate)
record `cloud-unavailable`. Their saved local seeds meet the client cloud-seed
input checks: thirteen finite in-frame points and sufficient nose-to-ear spread.
Invalid saved seed coordinates therefore do not explain the universal fallback.

The old client reduced authentication, preparation, HTTP, provider, validation
and timeout failures to `null`. No precise historical cause can be reconstructed
from these exports. Do not relabel them as credit failures or successful cloud
observations.

[The earlier live review](MAX_PRESENCE_AND_CHAT_2026-09-19.md) documented an
upstream insufficient-credit error on the shared API account. That is a relevant
operational lead, not a fresh balance check or proof for each pilot capture.
No currently authenticated deployment-log connector or CLI was available during
this follow-up, and no live photo inference was attempted.

## Local implementation

- The endpoint now returns an allowlisted cause code alongside its existing
  generic error message. It distinguishes provider credits, configuration,
  authentication, rate limits and allowance-service failures.
- Crop failures retain their classified cause when the final unavailable error
  would otherwise hide it. Provider messages are not returned in these codes or
  copied into capture diagnostics.
- Client preparation, encoding, HTTP, network, response-validation and deadline
  failures have distinct codes. Legacy server responses retain HTTP fallbacks.
- Admin diagnostics prospectively record `side.diagnostics.cloudAttempt` with
  the attempt status and, for an unavailable attempt, its cause. The historical
  `cloud-unavailable` warning remains for compatibility. Disabled device-only
  placement and cancellation remain distinct from failure.
- Snapshot/export tests establish that the new diagnostic survives saving and
  export without later mutation.

Consent, authentication, upload scope, daily allowances, refund behavior,
five-second deadline, point-fusion policy and landmark formulas are unchanged.
All thirteen coordinates, confidences and point-evidence entries are still
required before a cloud result can be used; inherited seed points still do not
count as independent observations.

## Verification and remaining work

The focused provider, client, deadline, capture and export suite passed 82 tests;
TypeScript passed. These are synthetic tests, not proof that the live provider is
available. No credentials, billing settings, environment variables, database
rows or production configuration were changed. Nothing was deployed.

Before a fresh cloud-assisted accuracy benchmark, verify the shared API account
has usable credit/configuration, deploy the diagnostic improvements, and run one
consented synthetic smoke capture. Confirm `cloudAttempt.status` is `success`
and inspect per-point provenance. Only then run a bounded evaluation; do not ask
the owner to repeat the already completed manual-annotation collection.
