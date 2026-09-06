# Mobile, account and creator-tools audit

Date: 7 September 2026.

## Scope and evidence

This pass combines source review, automated regression tests, authenticated
production UI checks, and a real locally generated report from the repository's
synthetic demo portrait. Responsive browser checks used 390 x 844 and
1440 x 900 viewports. They are not a physical-iPhone, mobile Safari, camera
hardware, thermal, battery or frame-rate benchmark.

No customer photographs were uploaded, no paid render was generated, no real
payment was charged and no customer password was changed during the audit.

## Fixes included

| Finding | Change | Verification |
| --- | --- | --- |
| Capture callbacks and expensive guide work could outlive their screen | Each camera instance owns its stream and animation callbacks; guide inference is capped; hidden/stalled cameras cancel countdowns | Lifecycle, countdown and frame-budget regression tests |
| Unnecessary decoded-image memory and repeated canvas allocation | Release the large decoded front bitmap after bounded ingestion; bound side intermediates; reuse report overlay buffers | Capture/report tests and source review |
| Hidden landing reels and warm-up failures wasted time | Pause reels behind dialogs/dashboard or offscreen; failed segmenter warm-up can retry | Visibility and retry tests |
| Mobile scrolling repeatedly measured geometry and used expensive blur | Observer-driven sticky elevation, owned listener cleanup, mobile blur removal | Generated front-only report scrolled through the footer at 390 x 844 |
| Deep-scroll category selection could hide its heading | Scroll to the rail's natural-flow anchor, not its current sticky position | Eyes category opened beneath the pinned photo and rail after deep scrolling |
| Measurement rows were not proper keyboard controls | Button semantics, focus feedback, Enter/Space and virtual-click handling; retain existing touch preview behavior | Keyboard and lifecycle tests |
| Side-analysis cancellation could leave a profile heading over front capture | Canceling the population chooser returns to the front/profile choice | Production issue reproduced; regression test added |
| Tutorial described the side photo as compulsory | Explain that side capture is optional | Copy regression test |
| Auth availability probes could remain pending during a slow response body | Bound fetch and body decoding to three seconds, retaining same-project fallback | Deadline, abort and fallback tests |
| Height/weight was still device-led on some paths | Server-backed dialog and Settings edit/clear; server `required` flag; migrate legacy local values once; retain offline cache | Body-profile, account-isolation and auth-wiring tests |
| Clearing body data could race an old device import | Insert-only migration and persistent cleared rows; no new database migration needed | Actual API handler/request-builder tests for both concurrent request orders |
| Body form could overflow short screens and imperial conversion could invent/drift values | Scrollable safe-area dialog, stable unit drafts, blank stays blank | Layout and unit-conversion tests |
| Streak work remained in an open PR | Reviewed, corrected and merged #259, including account-isolated state and own-account-only scan activity | Streak/API tests and successful deployment checks |
| Install and guest-return wiring was unfinished | Nonblocking device install offer, user-tap iOS instructions, deduplicated signup attempt/return events | Install and signup-return tests |
| Celebrity gallery displayed initials only | Add 122 bounded licensed reference thumbnails, lazy decoding/loading, initials fallback and accessible credits in each display context; withhold 3 sources needing review | License/thumbnail tests and actual loaded portrait/credits check at 390 pixels |

No scoring formulas or population norms were changed by these performance fixes.
Displayed celebrity reference photos are identification aids, not claims that the
stored measurements were calculated from that exact photograph.

Release regression suite: 1,463 tests, 1,436 passed, zero failed, 26
environment-gated skips and one existing todo. The skips are not represented as
completed live-provider tests. TypeScript, production build and the copy check
are required release gates as well.

## Live checks completed

- Google Auth Platform: production audience; TrueMax name/logo and policy links
  verified and published.
- Supabase: `auth.truemax.app` activated after its DNS, certificate and Google
  callback were prepared. Original and branded Auth settings both returned
  HTTP 200 with the public app key; Google/email enabled and signup enabled.
- Fresh production sign-out and Google sign-in: Google displayed TrueMax and
  used the branded callback, then returned to the authenticated account.
  Existing client connection URL and stable session-storage key were retained.
- Creator League inherited the owner session. Clips Library opened its library,
  and a demo clip's Use in TikTok action opened the composer. Brand Engine and
  Calibrate opened for the owner. Carousel and profile-analysis entry points
  fitted the 390-pixel viewport without horizontal page overflow.
- Generated front-only report: no empty side tile/toggle; photo and category
  rail remained pinned through the footer; category navigation and metric
  detail were exercised. Desktop report used the two-column layout.

Creator-tool checks are entry-point and UI checks. They do not certify paid
rendering, every export format, every billing tier or unauthorized-user access.

## Remaining verification and next plan

1. On a physical iPhone, repeat camera start/stop, background/foreground,
   permission denial, camera flip, countdown, a complete front-plus-side scan,
   five report/category cycles, and ten minutes of scrolling. Record device,
   iOS/browser version, dropped frames and thermal behavior before claiming an
   iOS speed improvement. Include Safari and an in-app social browser.
2. Run new-account email signup, verification delivery and password recovery
   using a dedicated test inbox. Existing-account Google login is verified;
   it does not establish that a particular friend's new signup will succeed.
3. Test Stripe with a deliberate owner-approved real purchase and confirm the
   webhook, entitlement, receipt and account return. No claim of 100 percent
   live payment success is made from this UI audit.
4. Measure production long tasks and bundle startup on a mid-range phone.
   Vite still reports large chunks and a mixed static/dynamic onboarding import.
   Split by measured startup cost next, without moving capture state across
   asynchronous boundaries blindly.
5. Expand side-landmark evaluation with labelled real profiles before changing
   point count, jaw location, norms or confidence thresholds. A competitor's
   score is not a correctness baseline, and this pass does not claim a new
   authenticated competitor audit.
6. Apple sign-in remains visibly unavailable until provider setup. Do not
   enable a button for an unconfigured provider.

The app has been substantially checked, not proven bug-free. This document
separates observed UI behavior, automated checks and remaining real-world tests.
