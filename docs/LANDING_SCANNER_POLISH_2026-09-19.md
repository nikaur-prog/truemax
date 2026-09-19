# Landing scanner polish

Status: implemented in the local `codex/post-267-audit` worktree. Not committed, pushed, merged or deployed by this pass. Existing calibration and app work was preserved.

## Delivered

- Shared the actual photo cover/crop/zoom transform with feature-label placement. The old docked jaw anchor could miss its intended position by more than 20 pixels.
- Reduced simultaneous region callouts from three to two, with larger text and collision-aware placement.
- Replaced abbreviated four-column pillar labels with full names in a two-column layout.
- Added accessible demo controls. The subsequent homepage refinement removed replay and kept only a discreet 44-pixel pause/resume button for the looping animation. Camera mode hides it.
- Held the finished result longer; stopped the photo push-in before labels arrive; used gentler label and score transitions.
- Parked canvas animation during the finished-result hold instead of repainting an unchanged result continuously.
- Preserved hidden-tab/offscreen/panel-cover pausing and static reduced-motion output. Manually paused reels repaint correctly after resize without restarting.
- Preserved fonts, palette, synthetic-demo disclosure and existing score values. No calibration or scoring changes.

## Verification

The verification skill informed the rendered-flow checks and boundary-specific regression tests.

- Type checking: pass.
- Full test suite: 2,088 passed, 0 failed; 28 environment-gated skips and 1 existing todo.
- Production build: pass. Existing approximately 617 kB Max 3D runtime chunk warning remains.
- User-facing em-dash check and diff whitespace check: pass.
- 23 focused reel layout/runtime tests cover exact anchor transforms, all six demo faces at widths 240 to 430, cache invalidation, image decode boundaries, pause/replay, resize, reduced motion and timer cleanup.
- In-app browser visual checks: 1280 x 720 and 1440 x 900 desktop; 390 x 844 and 320 x 740 phone viewports. No horizontal overflow, 44 x 44 touch controls, readable full pillar names and working replay/pause.
- Local preview error log: no errors during the checked landing interactions.

These were browser viewport checks, not measurements on a physical iPhone or an end-to-end production API test. The preview is signed in. An attempted isolated first-visit check through the alternate localhost hostname was blocked by the browser client; it was not bypassed. The original calibration tab was left intact.

The follow-up controls, appearance, navigation and celebrity-reference changes are documented in [Homepage and reference refinements](HOMEPAGE_REFERENCE_REFINEMENTS_2026-09-19.md), including newer gate results.

## Policy and explanation pages

See [the separate internal policy review](LANDING_POLICY_REVIEW_2026-09-19.md). Public Terms, Privacy, robots directives and bot-enforcement settings were not changed. Those recommendations need a separate approved implementation and legal review, especially the actual collection/retention disclosures and scoped automated-access policy.
