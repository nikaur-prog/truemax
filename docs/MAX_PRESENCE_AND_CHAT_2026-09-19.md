# Max presence and chat review, 19 September 2026

## Release separation

The previously approved calibration/reference-selection work was published separately in [PR 270](https://github.com/nikaur-prog/truemax/pull/270). It merged as `4e1cf15f74e518419f7d355e1f7c86f5873e0b5f`. GitHub deployment `6536176689` succeeded, and the public League bundle reports `4e1cf15`.

Calibration is available at `https://www.truemax.app/league/tools#calibrate`. Save an in-progress review before refreshing. The release asks for the reference group after choosing the photo, clears abandoned new-person choices, supports changing the pending reference, and clarifies the nearby ear-notch and surface-hinge estimates. It does not fit new scoring norms or claim anatomical ground truth.

The Max work below is separate, local review work. It is not included in that production release.

## Implemented

- Original procedural 3D character retained. Mirror routine now holds the mirror forward, inspects the reflection, points with an index/raised-thumb gesture, winks and grins. The welcome wave bounces. Speaking has visible cartoon teeth/tongue and varied mouth cadence.
- One visible Coach visit selects one short opener. Name, own-scan availability and routine days come from the current owner's saved records. Routine day means days since a recorded start, not adherence or effectiveness. No invented product benefit or progress praise.
- Matching opener actions open a conversation. No unsolicited provider calls, repeating greeting carousel or automatic audio.
- Top-left speech bubble displays a short current excerpt. Full replies remain in the transcript. The chat uses its existing text drain as the only typing clock; the mouth follows that text cadence, not speech audio.
- Reduced motion, hidden tabs, native backgrounding and detached/account-switched panels stop decorative work. The existing single-renderer lifecycle is retained.
- Phone chat follows the visible viewport. At keyboard-sized heights, the decorative avatar and suggestion chips hide so Close, transcript and composer remain reachable.
- Empty/unavailable replies show an honest retry notice, refund undelivered server turns and are excluded from substantive server and local assistant history. Interrupted useful replies retain an interruption notice. Persistence errors cannot leave the HTTP stream hanging.
- Long unanswered history retains the newest question/correction. Missing quota headers no longer look like zero messages remaining.
- Persona rules allow natural small talk and require asking about missing routine/product details instead of inventing them.

## Live conversation finding

Two authenticated production prompts were tested: a brief casual greeting and a one-sentence question about front-photo versus side-profile jaw measurements. Both failed before delivering an answer.

Production runtime logs confirmed an upstream HTTP 400 insufficient-credit error. The API account used by TrueMax needs a credit top-up. No billing settings, credentials, provider or entitlement configuration were changed. No private logs, account identifiers or conversations were committed.

Cloud-assisted side landmark placement uses the same API account. The calibration UI remains usable with the local/fallback seed and manual correction, but restore credit before the full automatic-placement evaluation batch. Otherwise the batch evaluates fallback placement, not the intended cloud-assisted reader. Existing diagnostics record cloud-unavailable warnings and seed provenance.

Consequently, natural reply quality is **not yet live-verified**. Local fixtures and server lifecycle tests cover mechanics and failure recovery, but are not evidence that a live conversation is good. After credit is restored, test a new chat, follow-up continuity, a corrected goal, an unknown product/day, and a measurement question. Check streamed completion and saved history without changing the user's routine.

## Verification and review

- Full test suite: 2,187 passed, zero failed; 28 skipped and one existing todo.
- Typecheck and production build passed. Existing lazy 3D dependency chunk-size warning remains.
- 3D asset: 18,818 triangles, three materials, 1,148,388 bytes. Existing asset budget retained.
- Real 3D browser checks: desktop/phone, one renderer, quiet-state zero repaint, native background pause, reduced-motion fallback, and return to the underlying Coach after closing chat.
- Isolated presence checks: desktop, 390px, 320px dark and embedded observer fallback; owner boundaries, safe text, rotation, typing, actions and teardown.
- Chat and plan browser fixtures intercept Auth/API traffic and use real UI components. They do not perform real sign-in, product generation, database writes or live response-quality evaluation.
- Chat fixtures passed at 1440px, 390px and 320px: typed reply, full transcript versus short bubble, empty/service-error recovery, unknown allowance, owner safety and teardown. The plan flow passed on desktop/phone with history-loading draft retention, child-dialog Escape/focus and committed-not-started routine selection.
- Keyboard checks passed at 375 by 330 and 320 by 330. Close and composer remained visible, restoring height resumed one renderer, and the long bubble excerpt was not visually clipped.

For local visual review open `http://127.0.0.1:4189/?preview=max-coach`. Its response is explicitly scripted and makes no chat request. The gesture controls expose mirror, wave and speaking poses. Production reply testing must use the signed-in live app after the API credit issue is resolved.

Morph rollout, pricing, measurement formulas and scoring calibration were not changed by this Max work. No external image/video generation connector was needed for the existing procedural 3D rig.
