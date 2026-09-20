# Search visibility and conversion measurement

Date: 20 September 2026. This document records the initial read-only production/source audit and proposed next build. The later owner-approved build and signed-in account inspection are recorded in [SEO_IMPLEMENTATION_2026-09-20.md](SEO_IMPLEMENTATION_2026-09-20.md). Statements below about missing analytics code and uninspected accounts describe the initial audit, not the later local implementation.

## Outcome

Grow qualified, non-branded organic visitors who complete a scan and choose to purchase. Search rankings, Google Analytics collection and conversion are different problems. A tracking installation does not itself improve rankings. Neither screenshots of search results nor autocomplete suggestions establish search volume, keyword difficulty or TrueMax's average position.

The supplied searches split into product-seeking intent (face rating AI/app, face analysis, face analyser) and educational intent (how attractive am I, how to become more attractive). The screenshots show app stores, tools, guides, forums and videos. That supports testing multiple useful formats, not assuming one homepage can win every intent. Results vary by place, device and user; no rank-one or traffic forecast is justified by this audit.

## What already works

Live public HTTP checks confirmed:

- Homepage, robots and sitemap return 200. The sitemap lists 11 public URLs.
- Homepage title: `Face Score and Facial Analysis App | TrueMax`, with description and canonical www URL.
- A Search Console verification meta tag exists. This is not proof of current ownership, sitemap submission, indexing or search performance.
- `/guides`, `/face-score`, `/improve-your-looks`, `/looksmaxxing-guide`, `/glow-up-guide`, `/methodology` and `/how-it-works` return readable HTML, distinct titles and their own canonical URLs. Article/collection/breadcrumb structured data is present where appropriate.
- The public guide architecture already exists. There is no need to create a duplicate blog merely to have a blog.

Source review also found static guide generation, dedicated guide styling, internal links, private-route noindex rules and SEO surface tests. These are useful foundations, not proof that Google has indexed or ranks every intended page.

## Biggest measurement gap

No GA4 implementation was found in the application source or inline live homepage. No authenticated Google Analytics or Search Console report was inspected. A Google verification token must not be mistaken for Google Analytics.

TrueMax has its own event counters. `src/engine/track.ts` submits an event name and deduplicates per page load; `api/_events.ts` increments a dated bucket. The report in `src/engine/funnelReport.ts` compares aggregate event counts. It is **not a person/session-linked conversion funnel**. It cannot currently explain which organic landing page produces paying customers.

Specific gaps:

1. Event buckets do not contain landing page, organic source or device dimensions.
2. The event allowlist ends at checkout start, not a verified purchase.
3. Campaign attribution is captured in app entry points, not the static guides. Bare root CTAs can lose campaign parameters from guide landings.
4. Organic visits do not normally have campaign tags. The attribution helper does not classify an untagged Google arrival as organic.
5. Current content security policy does not permit the Google tag script/network endpoints. Adding a snippet without reviewing CSP would not be a complete integration.
6. Current public privacy copy covers campaign attribution and optional purchase reporting, not a Google Analytics integration. Add consent controls and accurate disclosures before enabling a new processor.
7. No field Core Web Vitals collector was found in source. Existing laboratory checks do not establish real-user mobile performance.

Inspect real accounts before choosing whether to extend first-party analytics or add GA4. Do not add duplicate pageview trackers by default.

## Search-intent map

| Search family | Primary destination | Proposed improvement |
| --- | --- | --- |
| Face rating AI, face rating app, face analysis, face analyser/analyzer | Homepage | Clear product explanation next to the working scanner, honest sample output, what is included/free/paid, privacy and a direct scan action. Do not create a separate page for each spelling. |
| How attractive am I, how to tell how attractive I am, face rating scale | Existing `/face-score` | Answer what a photo-based score can and cannot tell someone; show a worked measurement and explain why tools disagree. Link to methodology and a clearly labelled scan CTA. |
| I want to become more attractive | Existing `/improve-your-looks` | A useful, prioritized grooming/style/routine guide, with evidence and realistic expectations. Link to a scan or plan as an optional next step. |
| Looksmaxxing and glow-up questions | Existing specific guides | Give each a distinct question and purpose; consolidate overlap rather than add interchangeable articles. |
| Gonial angle, canthal tilt, side-profile measurements | Future measurement guide cluster | Original diagrams, exact endpoints, worked examples and photo limitations. Publish only definitions we can explain reliably; do not expose private calibration photos or invent validated ideals. |

The homepage owns product intent; `/face-score` owns explanation. Keep internal links and headings consistent with that distinction. A separate `/face-analysis` page should not be built solely as another doorway to the same scanner. Add it only if query evidence and substantial different content justify it.

Do not advertise a free full report if the actual flow is paywalled. Do not claim native App Store availability until a real listing exists. Keep public pricing, privacy disclosures and structured data consistent with the live product. Qualify blanket on-device claims where an optional feature uses cloud processing, and distinguish 43 available measurement definitions from the measurements actually usable and scored in a particular scan.

## Recommended implementation order

### 1. Finish scoring/report correctness before growth claims

The paired pilot exposed a full-side score ceiling and inconsistent comparison scopes. Fix and version that model before promoting improved accuracy. Publishing a polished methodology page is not a substitute for validation. The model's limitations can still be explained honestly now.

### 2. Establish search and conversion baselines

Inspect the owner's Search Console and GA4 properties while signed in. Record indexed canonical URLs, query/page impressions and clicks, country/device, exclusions and available field performance. Link the appropriate properties if authorized. The link supports query reports and landing-page comparisons; it does **not** produce a reliable individual search-query-to-purchase trail. [Google's integration documentation](https://support.google.com/analytics/answer/10737381?hl=en).

Define and verify a consent-aware journey: public page viewed, scan started, usable front result, optional side completed, signup completed, checkout started, verified purchase. Mark business outcomes as key events rather than every button click. Verify purchase only after the payment system confirms it, with deduplication and no test purchases in production statistics. Preserve existing billing behavior.

Use bounded source/campaign codes for creator links, preserve legitimate attribution from guide to app and exclude admin/calibration/test activity. Never put names, emails, images, image hashes, landmarks, scores, skin observations or chat text into analytics. Sanitize URL parameters, page titles and error categories; avoid broad form/session recording. Google's policy prohibits PII and specifically calls out URLs and user-entered fields. [Google Analytics privacy guidance](https://support.google.com/analytics/answer/6366371?hl=en).

Acceptance: known synthetic test journeys produce the intended events once, consent rejection prevents disallowed tracking, no sensitive fields leave the app, and organic landing-page outcomes can be inspected without conflating event totals with unique users.

### 3. Improve existing pages and mobile performance

Edit one page per intent: useful opening answer, descriptive title/H1, unique examples, clear next action, relevant internal links and accurate authorship/review details. Do not invent expert credentials, user reviews, before/after outcomes or star ratings.

Measure mobile loading, interaction and layout stability. Keep decorative/3D work out of the initial critical path; test the actual scan experience rather than chasing a laboratory score alone. Google recommends good Core Web Vitals, but they are not a guarantee of high rankings. [Core Web Vitals guidance](https://developers.google.com/search/docs/appearance/core-web-vitals).

Acceptance: public content works without login, all intended URLs/canonicals/schema remain valid, private records stay protected/noindex, scan/checkout paths still work, and improvements have measured rather than assumed performance outcomes.

### 4. Build original assets that deserve references

Start with a measurement map, a repeat-photo demonstration and a concise explanation of why jaw angle is different from visible jaw definition. Use original or properly licensed visuals and disclose synthetic demonstrations. A pilot report must say what was tested and must not generalize 20 synthetic identities into a population benchmark.

Each approved topic can become a guide, a short educational video, a carousel and creator talking points. Editorial review of scientific claims is necessary even if assembly is repeatable. Publish original tutorials on appropriate video channels and link to the relevant guide, not always the homepage. Seek real editorial coverage and genuine creator demonstrations; qualify paid links. Avoid mass AI pages, fake forum promotion and purchased ranking links. [Google helpful-content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content), [spam policies](https://developers.google.com/search/docs/essentials/spam-policies).

### 5. Iterate from outcomes

Use a 28-day baseline and comparisons by page, country and device. Prioritize pages that already earn relevant impressions but few clicks, or clicks without scan completion. Track non-branded organic clicks, completed scans, signup/purchase rates, verified revenue and capture failure rates. Record releases so changes are interpretable. With small samples, show denominators and avoid declaring a winner prematurely.

No special AI-search schema or mass machine-targeted text is needed. Google says normal search fundamentals remain relevant for its AI features. [AI features and websites](https://developers.google.com/search/docs/appearance/ai-features).

## Owner input for the next pass

Open Search Console and Google Analytics signed in, or provide their exported performance reports. No password or private key should be pasted. Existing account state should be inspected before creating properties or changing DNS. Confirm primary target markets when prioritizing search data; English-language international demand is only the initial planning assumption.

Nothing in this plan promises the highest position. Google explicitly says there is no automatic method to rank first. [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).
