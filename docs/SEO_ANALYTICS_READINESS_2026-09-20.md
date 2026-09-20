# Optional SEO analytics readiness

Status: implemented locally, **not activated or deployed**. No Google property or measurement ID was created, no account settings were changed, and no real Google collection was used for verification. An empty `VITE_GA_MEASUREMENT_ID` leaves the entire optional integration inactive.

## What is implemented

- A small public-page entry preserves the existing first-touch campaign attribution from a guide to the app without adding internal UTMs. The pre-existing campaign-to-purchase path is separate from optional Google Analytics consent and is still described separately in Privacy.
- With a configured public measurement ID, public pages offer equally available Allow and Keep off choices. Settings and an Analytics preferences link can change the choice. No answer is not consent.
- No Google script, Google request, denied-mode ping, event replay or analytics landing storage before permission. Consent expires after 180 days. Missing, invalid, local, preview, OAuth, calibration, private and unknown routes stay inactive.
- Coarse consented source categories and the first public landing route survive same-tab guide-to-app navigation. Raw query strings, search terms, click IDs, campaign text and referrer paths do not enter Google payloads.
- Only allowlisted generic product milestones are mirrored. Photos, point coordinates, measurements, scores, names, emails, account IDs, chat, form values and arbitrary titles or URLs are not passed to Google.
- Revocation disables and removes the tag's frame, discards pending messages, clears this integration's accessible GA cookies and landing storage, and propagates through storage events to other tabs. Blocked cookie access cannot break the app. Failed consent writes cannot revive an older readable grant: a local denial remains authoritative until a new explicit choice is successfully stored.
- Field-performance collection is **not shipped or mounted**, even with a configured GA ID. A tested collector using pinned official `web-vitals` 6.2.2 remains unshipped groundwork. The current bridge can lose final exit measurements when pagehide removes the frame before visibility callbacks; collecting only the surviving subset would bias reporting. A source contract prevents either app entry from importing/mounting that collector. No current field-performance result or complete Core Web Vitals collection is claimed.

## Event boundaries

| Existing action | Optional GA event |
| --- | --- |
| Selected file, before decoding; accepted camera shutter, before burst | `scan_start` |
| Front/side completed or side skipped | `scan_front_complete`, `scan_side_complete`, `scan_side_skipped` |
| Results actually shown | `view_results` |
| New account created | `sign_up` |
| Plans/offer opened | `view_plans` |
| Checkout started | `begin_checkout` |
| Scan gate shown | `scan_gate_view` |
| Consented public document starts/restores | `page_view` |

Product milestones are deduplicated per event per document, not per unique person. Opening a camera preview is not a scan start. Private routes and activity before consent are intentionally missing, so this is a consented, partial funnel, not a complete census. Purchase success URLs do not emit purchase. Confirmed revenue attribution requires a separately reviewed, consent-aware server-confirmed adapter and transaction deduplication; it is not implemented here.

Browser limitation: if an old stored grant remains readable but every write and removal fails, the current document stays denied. It cannot promise persistence across a full reload or notify other tabs through blocked storage. Privacy states this limitation; normal writable-storage revoke and cross-tab behavior are verified separately.

The unshipped field collector projects only LCP/CLS/INP numeric values, deltas, ratings and validated random IDs, omitting DOM entries and URLs. It handles consent races and buffered pre-consent entries in tests, but that does not solve exit delivery. A follow-up must verify reliable delivery, retention, aggregation and disclosure before integrating it. There is deliberately no user-configurable enable flag for this known-incomplete collector.

## Activation checklist

1. The owner must create or select the correct GA4 property and web stream, confirm applicable processing terms and retention settings, and supply its public `G-...` measurement ID. No API secret belongs in Vite/client environment variables.
2. Disable all Enhanced Measurement automatic collection for the stream, including forms, site search and history-based page views. Keep Google Signals, advertising personalization, user-provided data collection, linked advertising exports and session replay off. The code also disables Signals and ad consent, but account settings require independent verification.
3. Review the updated Privacy disclosure and processor/data-retention arrangements before enabling the ID. Google receives a cookie identifier, network/browser information and consented events. This is not anonymous processing.
4. Verify the **effective deployed** `/analytics` headers: its narrowly scoped CSP must allow only the intended tag/collection endpoints and same-origin embedding. The app's other pages must still block Google scripts/collection and retain their existing security protections. The local fixture merges the intended header overrides; it does not prove the hosting platform's final header response.
5. Use a separate test stream and an intentionally consented test browser to inspect actual network payloads and DebugView. Confirm only manual, safelisted locations/titles/events; no automatic form, search, history or private-page events; no network before consent; correct revocation and cross-tab behavior. Mock tests cannot prove a future remote tag's behavior or account configuration.
6. Only after that check, configure the production measurement ID and deploy through the normal reviewed release process. Connect the verified Search Console property to the correct GA property with owner approval. Search Console and GA acquisition will not have identical totals.

The tag runs in a fixed, empty, noindex `/analytics` iframe so ordinary automatic inspection does not see the app's forms or photographs. This **same-origin iframe is not a security boundary** against malicious third-party code. Its fixed URL, manual payload projection, CSP and disabled automatic collection reduce accidental exposure; they do not justify treating third-party code as unable to access the parent. Do not activate while any checklist item is unresolved.

## Verification

- `npx tsx --test src/engine/analytics.test.ts src/engine/analyticsPolicy.test.ts src/engine/publicVitals.test.ts src/league/tiktokDashboardPolicy.test.ts` covers allowed routes and payloads, consent expiry, missing IDs, storage/cookie/DOM failures, failed revocation, the unshipped collector's observer lifecycle, its absent runtime hookup and CSP scope.
- `node tools/analytics-consent-smoke.mjs http://127.0.0.1:4193` runs actual public HTML and modules under a fully intercepted production-origin browser fixture. Every Google request is mocked; local source is forwarded only to the specified local Vite server and WebSockets are intercepted. It exercises mobile consent, guide-to-app first touch, actual permitted bridge events, revoke/re-grant, queued-load cancellation, private history navigation, cross-tab revocation, BFcache-style restore, organic category continuity and missing/local/private configuration.
- The fixture checks that private input/title/query strings never appear in mocked payloads and that public-page imports do not pull in auth, scoring, 3D or vision bundles. Whole-branch type/build/tests are a separate final release gate.

Relevant implementation: `src/engine/analyticsPolicy.ts`, `src/engine/analytics.ts`, `src/analytics-frame.ts`, `src/public-entry.ts`, `src/ui/analyticsConsent.ts`, `src/engine/publicVitals.ts`, `privacy.html` and the `/analytics` CSP in `vercel.json`.

Primary references: [GA4 configuration fields](https://developers.google.com/analytics/devguides/collection/ga4/reference/config), [Google consent implementation](https://developers.google.com/tag-platform/security/guides/consent), [Google privacy controls](https://developers.google.com/tag-platform/security/guides/privacy), [official web-vitals](https://github.com/GoogleChrome/web-vitals), [Vercel header configuration](https://vercel.com/docs/project-configuration/vercel-json).
