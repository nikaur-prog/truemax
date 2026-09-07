# SEO, speed and layout review

Date: 7 September 2026. Baseline: main `5eb4f87` (PR #263).

## Outcome and scope

The implementation prioritizes a reliable first scan, a clearer responsive report, trustworthy public information and a round, expressive Max prototype that retains the original character's face.

The code changes cover the five implementation areas below. No production account, billing price, database schema, scoring norm or consent record was changed. Max remains development-only pending visual approval and a physical-phone performance check.

Evidence comprises live public HTTP checks, source and built-asset inspection, a local desktop front-only scan using the bundled demo photograph, and short-phone landing-page inspection. This is not a physical iPhone benchmark, a full paid-account regression, an accuracy study or proof of Google indexing. The local report preview deliberately bypasses its signup wall for visual testing; it does not verify signup recovery.

## Max design correction and animation build

The earlier captures in `.preview-out/max-examples/` show the rejected design and are not the current proposal. The replacement retains the original blue body, dark visor, pupil-less light bars, brows, curved smile, navy flippers and mint antenna. It has a fully rounded body, not a shallow extrusion.

The development workbench supports twelve distinct states: idle, listening, thinking, speaking, celebrate, quiet, wave, shocked, angry, mirror, skate and guitar. Speaking has separate opening-mouth geometry. The optional browser-voice demonstration plays a fixed phrase with the speaking motion; it is not a production voice service or phoneme-perfect lip sync.

Waiting in idle or thinking can trigger a five-second routine after 5 to 10 active seconds. Listening and speaking interrupt it. Quiet settles into a still expression. Hidden, offscreen, reduced-motion and data-saving behavior is preserved. No mascot renderer is added to the first-scan dependency graph.

The local export workbench offers five actual runtime captures:

- `max-idle-listen-think.mp4`: idle, listening and thinking.
- `max-speak-celebrate-listen.mp4`: speaking motion, celebration and listening.
- `max-views-and-quiet.mp4`: front, three-quarter, side and back, including quiet mode.
- `max-wave-shock-angry.mp4`: waving, surprise and playful frustration.
- `max-mirror-skate-guitar.mp4`: three five-second prop routines.

Exports are silent, labelled 12 to 15-second videos at 576 by 576. They copy the real WebGL drawing buffer, never the SVG fallback. Recording frame rate does not establish runtime performance, heat or battery use on phones.

## Baseline findings and implementation scope

The observations and baseline numbers below explain the original build order. The implementation record at the end distinguishes completed code and browser checks from external acceptance gates.

### 1. First-scan reliability and a usable first screen

**Confirmed mobile layout issue:** at a 375 by 667 viewport the landing scan buttons begin around y=623 and end around y=692. They are partly below the initial viewport. The large demo portrait consumes space needed by the primary action. A desktop paste/drag instruction also appears in the compact layout.

**Source risk:** the optional head-covering check is awaited by `src/main.ts:2070`; initialization at `src/engine/headCovering.ts:168` has no deadline. Errors are caught, but an unresolved load can hold up the scan. Its local model is 16,371,837 bytes, compared with the essential face model at 3,758,596 bytes. Both currently warm on capture intent (`src/main.ts:1033`). This is an identified failure path, not a reproduced production timeout in this pass.

Build:

- Bound the portrait by available viewport height, tighten the heading-to-demo gap and keep both scan actions fully visible on short screens. Preserve readable text and touch target sizes.
- Make paste/drag hints appropriate to pointer and input capabilities. Keep short privacy reassurance near the actions; put the longer explanation behind a clear disclosure.
- Add an initialization deadline for the optional check and an explicit unavailable diagnostic. Ignore results from abandoned scans. Do not suppress a genuine positive covering result.
- Test essential-model-first scheduling on constrained connections. A Promise deadline cannot interrupt synchronous segmentation itself; time that stage separately before choosing worker or scheduling changes.

Acceptance: scan controls fit at 375 by 667 and 390 by 844; essential analysis proceeds when optional loading never resolves; positive covering rejection, retry and cancellation still work; no late result changes another scan.

### 2. Smaller startup and cheaper demo animation

The previously built entry plus five initial module preloads total about 1,215.50 kB raw / 368.62 kB gzip. Shared app CSS is about 240.52 kB raw / 48.14 kB gzip. These are asset-size measurements, not total cold-page transfer or measured load times. Evidence: `dist/index.html:81`, `src/main.ts:34`, `src/ui/results.ts:28` and the PR #263 build log.

The landing demo eagerly requests six portraits, totalling 164,748 bytes. The first is only 28,158 bytes. Its visible loop still redraws the image and callouts every animation frame, reads layout repeatedly and lacks a reduced-motion branch. Hidden/covered pausing was already fixed. Evidence: `src/ui/demoReel.ts:119`, `:135`, `:402`, `:527`.

Build:

- Keep a small landing/auth/recovery shell. Load capture, report, coaching, morph and export functionality when needed, with prewarming on genuine intent.
- Retain safe auth and stale-chunk recovery. Smaller bundles must not reintroduce broken login transitions.
- Load the first demo portrait, then decode one ahead. Cache geometry and callout layout per photo and size; avoid changing unchanged DOM values.
- Offer a static finished example for reduced motion. Preserve high-DPI output rather than gaining speed by blurring text.
- Extract route-specific styling. Keep the 3D prototype off the landing and capture paths.

Acceptance: compare initial dependency graphs and cold/warm scan timings before and after; no blank demo image during a swap; reduced-motion mode stops decorative looping; no extra network work from hidden route modules.

### 3. Consistent phone, tablet and desktop report layout

**Confirmed source inconsistency:** compact sticky behavior starts at 850px (`src/ui/reportNavigation.ts:61`, `src/style.css:6145`), but the single-column report and non-wrapping mobile tab rail start at 760px (`src/style.css:1983`, `:704`). The 761 to 850px band mixes two layout modes. A requested 800px browser override did not take effect in this inspection, so that exact visual case remains an implementation-time test, not a verified screenshot.

Desktop inspection at 1440px shows the photo, measurement card and comparison card competing for width, with Plan wrapping onto another navigation row. The 38% photo column and 1.35:1 inner split leave roughly 278px for inner measurement content at a 1024px viewport, calculated from current CSS (`src/style.css:457`, `:1239`).

Build:

- Use one compact-report breakpoint across CSS and JavaScript. Test 760, 761, 800, 850 and 851px.
- Keep the photo and facial tabs pinned together throughout the report. Target the user's existing combined footprint of roughly one-third to two-fifths of the phone viewport, including compact chrome; keep explanatory badges out of that permanent area.
- Give desktop measurements the main reading column. At smaller desktop widths, place celebrity references in a clearly labelled expandable secondary area. Retain side-by-side references on wide screens.
- Give Plan a deliberate consistent position instead of an accidental wrapped row.
- Show one overall score, with a concise front/side breakdown only when both exist. Avoid duplicated score cards.
- For each phone measurement: name, measured value, score and range first; then one plain-language implication. Put extended methodology and population detail behind expansion. Preserve units, caveats and the distinction between a measured value and its score.
- Use restrained, short opacity/transform transitions for feedback. Avoid whole-page blur animations, oversized glows and layout-changing hover effects. Respect reduced motion.

Acceptance: permanently visible photo plus tabs at the report bottom; no horizontal overflow; no clipped modal actions; keyboard, pointer and touch details all work; measurements have comfortable reading width without reducing font size.

### 4. Fix SEO trust and route robustness

Live checks found `/guides/`, `/face-score/`, `/methodology/`, `/privacy/` and `/auth/` returning 404 while their no-slash counterparts work. Add permanent redirects for known routes while preserving real 404s for unknown URLs (`vercel.json:16`).

The live methodology and face-score pages still categorically say front photos are never uploaded (`methodology.html:88`, `face-score.html:94`). The homepage correctly explains the optional Goal preview upload (`index.html:249`). Align the public promises with the actual consented behavior and make optional side capture clear everywhere. Privacy edits must preserve the applicable provider-retention disclosure.

Acceptance: test canonical, slash, `.html`, apex and www variants; no redirect loops; no broad homepage fallback; public privacy promises match each feature's actual upload and retention behavior.

### 5. Build useful searchable pages and stronger evidence

Already working: all seven sitemap pages returned 200; their titles, H1s and www canonicals are present; robots and sitemap work; tested apex/HTTP and `.html` redirects are permanent; guides are static HTML; app-only areas carry noindex; structured data, breadcrumbs and contextual links exist.

Next:

- Add transparent Pricing, How it works, About, and illustrated photo-taking help pages. They are not currently published at the proposed routes. These answer different questions, so each needs distinct useful content.
- Improve Methodology with actual cited reference samples, a measurement map, a worked calculation, sample limitations and real repeatability results when available. Do not invent reviewer credentials, benchmarks or clinical validation.
- Support existing measurement guides with original annotated diagrams and clear explanations of what a photograph cannot establish. Link them naturally from the relevant product screens.
- Give guides their own small stylesheet. They currently download the full app CSS. The live CSS measured 240,538 decoded bytes and approximately 49,666 compressed bytes.
- Evaluate immutable caching for fingerprinted assets, which currently return `max-age=0, must-revalidate`. Keep HTML and recovery behavior appropriately fresh.
- Use Search Console query, indexing and click-through evidence to prioritize later content. This review did not access Search Console, so it cannot claim current rankings or indexing coverage.

This direction follows Google's emphasis on original, well-sourced, useful content, not mass-produced keyword variants: [Google's helpful-content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

## Verification and release gates

1. Establish comparable cold and warm runs on a real iPhone and desktop, using the same consented local test photos. Record capture intent, essential model ready, optional check, analysis finished and first usable report.
2. Test guest front-only, guest front+side, retake, skip at placement review, manual correction, signup return, stale deployment, offline retry and cancelled work.
3. Test layout at 375x667, 390x844, the breakpoint boundary widths, 1024px and 1440px. Include keyboard opening, browser chrome and long text on a physical phone.
4. Use field data to judge LCP, INP and CLS. Asset reductions and desktop recording FPS are not substitutes for field responsiveness. [Google's Core Web Vitals guidance](https://developers.google.com/search/docs/appearance/core-web-vitals).
5. Before any push: `npx tsc --noEmit`, `npm test`, `npm run build`, `node scripts/emdash.mjs`, plus the route and browser checks relevant to the change.

Suggested sequence: first-scan reliability and short-phone layout; startup/demo performance; responsive report polish; SEO route/privacy corrections and helpful pages; then approved 3D integration. Do not delay the first-scan improvements behind mascot design work.

## Implementation record

Implemented on the review branch:

- Lazy report/dashboard loading with pending-state replay, failed-load retry and account-generation guards; essential capture loading precedes bounded optional head-covering initialization. Fixed a report-load retry hidden by the scanning class and made it single-flight.
- Demo first-image plus one-ahead decoding, cached drawing geometry, unchanged-value DOM updates and static reduced-motion output.
- One responsive report breakpoint, fixed-position Plan action, expandable secondary explanations/comparisons, immediate score markers, and plain-language measurement summaries. Contain-fit photo zoom now accounts for letterboxing instead of using a source-image pivot as a full-element pivot.
- Credentials-first signup with email and password only. Configured Google remains an alternative; unavailable Apple is hidden. Name and date of birth remain in the post-account quiz. An optional metric/imperial body step follows a freshly saved adult profile; minors and unavailable age checks never receive it. The paid-Max requirement still comes from the server.
- Late session discovery in the signup wall now uses the authenticated scan-recovery callback. Removed an unbound name-metadata mirror that could apply one person's quiz names to another account after an identity switch. Canonical profile names are explicitly owner-bound and cleared on account change.
- Four new public pages, illustrated photo help, cited methodology examples, route normalization, consistent privacy copy, an 11-page sitemap and a dedicated static-page stylesheet. No invented accuracy or indexing results.
- Original-identity round Max asset with twelve clips, active-time idle routines, speaking-mouth geometry, speech-level hook, local voice demonstration, export cancellation and lifecycle cleanup. Development-only, not promoted into the production Coach.

### Measured build and browser checks

- Entry plus its five initial module preloads: 919,955 bytes raw / 285,794 bytes gzip, versus 1,215,500 / 368,620 at baseline. Approximately 24% raw and 22% compressed reduction; not a measured phone speedup. An existing large optional chunk warning remains.
- Built public-page stylesheet: 9,298 bytes raw / 2,601 gzip. Public articles no longer load the full app stylesheet.
- At 375 by 667, both landing scan actions fit in the first viewport, ending around y=597. At 390 by 844, the compact report chrome, photo and facial rail end around y=338, about 40% of the viewport, and remain pinned at the report bottom.
- Checked report boundaries at 760, 761, 800, 850 and 851px, plus 1024 and 1440px. No horizontal document overflow in those checks. At 1024px the measurement reading column is about 613px; wide-screen references receive their own secondary column.
- CUA browser run used the bundled demo photo, skipped the side, and reached a real local front-only report. Public About/Pricing/How it works/Photo help/Methodology pages were inspected at desktop and short-phone widths.
- Signup inspected at desktop and 375 by 667: only two inputs, both 16px and 52px tall; primary action visible at y=406 to 453; Google available after the provider check; no raw body fieldset. Optional body preview converts 180cm/75kg to imperial and back without losing the metric draft. Under-18 preview has no body fields. These DEV previews perform no account creation or profile write.
- All twelve Max clips verified in tests; five labelled runtime videos captured locally. The browser voice demo completed and returned to idle. Actual physical-device thermals, battery and animation approval remain open.
- `npx tsc --noEmit`, `npm test`, `npm run build`, `node scripts/emdash.mjs` and `git diff --check` pass. Test run: 1,699 tests, 1,672 passed, zero failures, 26 environment-gated skips and one existing todo.

### Not claimed complete

Physical iPhone performance and keyboard/browser-chrome behavior; production signup/confirmation/password-reset inbox round trips; live purchase/webhook/entitlement verification; Search Console indexing; a new real-photo placement benchmark; morph identity/feasibility validation; and production use of the new Max character.

The morph job contract still needs early durable job identity/idempotency review so a connection lost before receiving a job ID cannot cause a duplicate paid render. That server change is outside this UI release.

The additional calibration request is planned separately in [FaceIQ comparison and calibration](FACEIQ_COMPARISON_AND_CALIBRATION_PLAN_2026-09-07.md), with source findings in [the side-placement evaluation audit](SIDE_PLACEMENT_EVALUATION_PLAN_2026-09-07.md). No credit-consuming competitor scans, provider replacement, scoring fits or private face collection were performed for those documents.
