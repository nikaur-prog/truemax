# Search content and analytics implementation

Date: 20 September 2026. Status: local implementation and verification; not a deployment, indexing guarantee or live analytics activation. Existing calibration and measurement-review work on this branch is preserved.

## Search targeting

The homepage remains scan-first and owns product intent: AI face rating, face-rating app and facial analysis. Its title, descriptions, visible explanation and social metadata now agree. All anonymous rotating headlines retain the actual product topic after client rendering; signed-in personal greetings are unchanged.

The existing guides cover distinct questions rather than duplicate keyword landing pages:

- `/face-score`: what a score means, how attractive am I, why tools disagree, and a worked ratio example.
- `/improve-your-looks`: choosing practical, reversible presentation changes.
- `/looksmaxxing-guide`: checking claims and separating definitions from promised outcomes.
- `/glow-up-guide`: a manageable eight-week planning and review process.
- `/how-it-works` and `/about`: product access, processing choices, measurement coverage and truthful editorial limits.

New static, public pages:

- `/measurements`: measurement library and distinction between points, raw values, reference fit and scores.
- `/measurements/gonial-angle`: jaw corner, surface hinge estimate and chin-bottom construction, with an original diagram.
- `/measurements/canthal-tilt`: inner/outer eye corners, roll correction, pitch limitations and worked arithmetic.
- `/measurements/side-profile-analysis`: thirteen landmarks, shared dependencies, normalization and photo limits.

Each new page has meaningful HTML without JavaScript, a self-canonical URL, original accessible SVG diagrams, contextual internal links, a scan CTA and appropriate article/collection/breadcrumb structured data. Canonical aliases redirect and all fifteen public search pages are listed in the sitemap. The analytics bridge and private tools remain noindex and outside that sitemap.

No competitor text, proprietary formulas, fake reviews, expert credentials, ranking promises or native app-store availability were added. The catalogue size is distinguished from usable measurements for an individual photograph. Optional cloud processing is not described as on-device. Free overall access is not presented as a free complete report.

## Analytics and performance boundary

The lightweight public entry does not import authentication, face detection, scoring or the full app. Optional GA4 remains off without a valid build-time public stream ID. It is limited to eligible production public URLs and explicit browser consent; local previews, admin/calibration tools, private routes and unknown URL state are excluded.

The bridge reconstructs a small event vocabulary with fixed public page names, coarse acquisition categories and public landing paths. It never accepts photo data, image hashes, landmarks, measurements, scores, account identifiers, chat, raw form fields, document titles or arbitrary URLs. Google advertising features and automatic enhanced measurement are not part of the intended configuration. Consent is separate from the existing first-party aggregate counters and separately disclosed campaign-to-checkout attribution.

The tag runs in an empty fixed-URL frame so automatic document observations are not observations of app forms. This same-origin frame is **not** a security boundary against a compromised script. Its configuration and account-side automatic measurement settings require review before activation. Revocation removes the frame and clears integration-owned GA cookies and coarse landing context; it cannot erase reports already received by Google.

Core Web Vitals collection is **deferred and disconnected from production startup**, including when a Google measurement ID is configured. A tested adapter for the locally bundled, pinned official library is retained as groundwork, but review found that immediate analytics-frame teardown can discard final exit measurements. Collecting only earlier updates could produce a biased field summary. Reliable exit delivery needs its own lifecycle verification before this collector is enabled. Do not describe the prepared adapter as live speed reporting or use laboratory checks as population field-performance evidence.

The implemented funnel covers public visits and product steps. **Confirmed purchase/revenue reporting in GA4 is not implemented or activated by this change.** Do not invent purchases from a success URL or mistake the existing dated event counters for a user-linked revenue funnel. Integrating confirmed payments requires a separate consent and deduplication design after the actual property is selected; existing billing behaviour is unchanged.

## Account inspection and activation checklist

Read-only inspection through the owner's Chrome confirmed an accessible TrueMax Search Console property and an already successful sitemap submission. The private baseline records indexed/discovered URLs and the small available search sample. No demonstrated robots/canonical/HTTP block explains the outstanding discovered-not-indexed pages. A private baseline is not committed to the public repository.

The active Google Analytics account showed the onboarding screen, not an existing property. This does not rule out a property in another account. No property, account, DNS record, stream, terms acceptance or production environment variable was changed.

Before live activation:

1. Owner selects an existing GA4 web stream or creates one and accepts its terms personally. Never paste passwords or private keys into a task.
2. Review automatic/enhanced measurement, Google Signals, advertising links, data retention and privacy disclosures. Keep unsupported automatic collection disabled.
3. Set the **public** `VITE_GA_MEASUREMENT_ID` for the intended deployment only. An empty example value is deliberate, not a broken setup.
4. Deploy the reviewed code, then verify actual production headers, consent denial/revocation, one-time events, safe payloads and acquisition continuity in the chosen property's test tools. Do not count test purchases as revenue.
5. Link the correct Search Console property if the owner authorizes it. Query/page reports do not provide individual search-query-to-purchase attribution.
6. After deploying the new pages, inspect representative clean URLs with Search Console's live test. The sitemap is already submitted; repeated submission or requesting indexing does not guarantee inclusion.
7. Review by landing page, country and device after a useful observation period. Show denominators. Do not interpret the early small sample as a ranking or conversion win.

The precise Google configuration, event boundaries and mocked privacy checks are recorded in [analytics readiness](SEO_ANALYTICS_READINESS_2026-09-20.md). Optional Google usage reporting, future performance collection and server-confirmed revenue are separate capabilities, not one completed integration.

## Verification

- Whole-branch automated suite: 2,244 passed, zero failed, 28 skipped and one existing todo (2,273 total).
- Type checking and production build passed. The existing deferred 3D runtime still produces the large-chunk advisory; this is not a claim that the entire app's performance work is finished.
- The four new pages were checked at desktop, 390px and 320px widths with and without JavaScript. At 320px, diagrams use short letter markers and readable HTML legends; desktop retains detailed diagram labels. No horizontal overflow was found.
- Chrome verified the updated rotating homepage headline and an actual homepage-to-measurement-guide link.
- The intercepted analytics browser fixture passed with twelve mocked events, no real Google collection, no private payload leakage and no download of the deferred performance collector. It checks consent, blocked preference storage with visible warnings, revocation, cross-tab changes, queued-load cancellation, private navigation and coarse acquisition continuity.
- User-facing punctuation checks and `git diff --check` passed.
- The private calibration diagnostic export retained its original checksum. Search Console observations and assisted-placement notes remain ignored local files, outside the public repository.

These checks do not establish production indexing, field performance, live Google reporting, payment attribution or scoring accuracy. Production header and consent checks remain required after deployment and before analytics activation.

## Calibration is a separate workstream

Chrome upload, reference selection and pointer editing were tested with one additional synthetic profile without saving it. The original two calibration records remained unchanged. An assistant can propose visible landmarks, but its own coordinates are not independent human validation, and a hidden jaw joint cannot be localized anatomically from one surface photograph.

The remaining eighteen paired identities are a useful engineering pilot. Correct the visible side points, retain anonymous IDs, leave optional ratings blank rather than guess, and export all capture diagnostics. Keep automatic and reviewed points separate and reserve held-out identities before fitting. Matching external totals is a different task from landmark localization.

The full-side score ceiling is already reproducible independently of those additional reviews. It is a scoring-model issue, not something more saved points can automatically repair. See [calibration score scope](CALIBRATION_SCORE_SCOPE_2026-09-20.md). No scoring formula or detector was retuned as part of the SEO build.
