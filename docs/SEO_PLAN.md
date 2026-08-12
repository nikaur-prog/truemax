# TrueMax SEO plan

Status: Ready for implementation

Prepared: 12 August 2026

Primary domain: `https://www.truemax.app/`

## Outcome

Make TrueMax discoverable for high-intent face-analysis searches while keeping `/` scan-first. The homepage should still open directly on the face-scanning experience; search context, trust content, and crawlable navigation can sit beneath it and on a small set of supporting pages.

The first goal is not “publish lots of articles.” It is to establish one canonical brand, make the product crawlable, explain why it is trustworthy, and measure whether organic visitors start a scan and sign up.

## Current baseline

Audit performed against the production domain and the current repository on 12 August 2026.

| Area | Finding | Impact | Priority |
| --- | --- | --- | --- |
| Indexing | A `site:truemax.app` search returned no indexed TrueMax pages | Google may not yet know or trust the site | P0 |
| Production | Production is on an older `main` commit; the newer auth, billing, and route work is in preview branches | Search engines and users do not see the intended release | P0 |
| Sitemap | `/sitemap.xml` returns 404 | Google has no submitted canonical URL inventory | P0 |
| Robots | `/robots.txt` returns 404 | No sitemap discovery or explicit crawler policy | P0 |
| Canonicalization | No canonical tag; `/index.html` serves a duplicate copy of `/` | Duplicate URL signals are split | P0 |
| Search snippets | Only a title is present; there is no meta description | Weak and uncontrolled search snippet | P0 |
| Sharing | No Open Graph or Twitter metadata | Shared links have no designed preview | P1 |
| Entity markup | No `WebSite` or `Organization` structured data | Harder to disambiguate the TrueMax brand | P1 |
| App markup | No verified `SoftwareApplication` markup | App details cannot qualify for supported app presentation | P1 |
| Site structure | The root app is the only indexable page and has no crawlable footer/navigation | No internal-link graph or supporting search coverage | P0 |
| Page language | “Looks are no longer subjective” is provocative but does not describe the product or user outcome to searchers | Poor query match and avoidable trust/safety risk | P1 |
| Measurement | Vercel Web Analytics is not enabled; Search Console ownership is not yet evidenced | No SEO baseline or conversion feedback loop | P0 |
| Performance | The browser is asked to fetch a 3.6 MB face-landmark model; field Core Web Vitals are unknown | Potential competition with initial rendering on mobile | P1 |
| Brand identity | Search surfaced a “TrueMax App” App Store listing; ownership has not been verified | Could be an important entity link or a brand collision | P0 owner check |

The non-`www` host already redirects to `www`, which is correct. Auth and internal tools should remain `noindex`; they should never appear in the sitemap.

## What to keep—and reject—from the transcript

The transcript has the right strategic instinct but turns an unverified leak interpretation into overly absolute rules.

- Keep: word count is not a quality target, mass AI content is a liability, useful first-hand material is stronger than rephrased commodity content, and a real brand should earn genuine mentions.
- Reject: “backlinks do not matter.” Google still documents link analysis and PageRank as part of its core ranking systems. The objective is not link volume; it is relevant editorial links and citations earned by useful work.
- Reject: optimizing directly for a supposed leaked `siteQuality` formula. There is no dependable public recipe for it.
- Translate “brand searches” into a real program: consistent naming, recognizable product visuals, app-store alignment, creator/customer discovery, original research, and accurate external coverage.
- Do not create a Google Business Profile unless TrueMax genuinely serves customers at an eligible physical or service-area business. TrueMax is primarily an online product, so local-SEO tactics from the transcript are not the launch priority.

## Search positioning

### One-sentence product positioning

**TrueMax analyzes facial proportions, symmetry, and front-and-side structure on your device, then turns the results into a personalized plan to help you look and feel more confident.**

This is clearer and more defensible than promising an objective verdict on attractiveness. “Glow up” can remain campaign language, but the durable site language should lead with analysis, privacy, personalization, and confidence.

### Primary intent

Target one core topic first:

- `face analysis app`
- `AI face analysis`
- `facial analysis online`
- `face symmetry analysis`
- `facial proportions analysis`
- `jawline analysis`
- `glow up app`

Do not create one page for every slight wording variation. Group phrases by user intent and let one genuinely useful page answer each intent.

### Differentiators to repeat consistently

- Front and side views, not a single generic selfie score.
- 478 facial landmarks and defined measurements.
- Photos processed on the user’s device.
- Proportions, symmetry, feature balance, and actionable next steps.
- Transparent methodology, reliability limits, and user-controlled side landmarks.
- Analysis as guidance—not a medical diagnosis or a verdict on personal worth.

Every numerical or privacy claim must match the actual production implementation. If a claim changes, update the visible copy and structured data together.

## Indexable site architecture

Keep the current product route behavior and add a compact, crawlable marketing layer.

| URL | Search job | Required content | Initial title |
| --- | --- | --- | --- |
| `/` | Brand + primary product intent; starts the scan immediately | Descriptive H1/lede near the scanner, how it works, privacy proof, key capabilities, FAQ, footer links | `Private Face Analysis & Personalized Plan | TrueMax` |
| `/how-it-works` | Explain the product and convert cautious users | Front/side flow, 478 landmarks, device processing, output examples, limitations, CTA | `How TrueMax Face Analysis Works` |
| `/face-analysis` | Own the category query without doorway-page spam | What is measured, what results mean, symmetry/proportion sections, example output, CTA | `Face Analysis: Proportions, Symmetry & Structure | TrueMax` |
| `/methodology` | Establish evidence and trust | Measurement definitions, reference populations, weighting, repeatability, manual side verification, known limitations | `TrueMax Methodology: How Facial Measurements Are Calculated` |
| `/privacy` | Answer the highest-risk objection | Exact photo/data flow, retention, account data, processors, deletion, contact | `TrueMax Privacy: How Your Face Scan and Data Are Handled` |
| `/pricing` | Capture commercial intent | Current plans from `docs/BILLING_CATALOG.md`, trial rules, scans, age eligibility, cancellation, FAQ | `TrueMax Pricing and Plans` |
| `/help/take-a-good-face-scan` | Support users and attract instructional intent | Lighting, angle, expression, camera distance, front/side examples, common errors | `How to Take an Accurate Face Scan | TrueMax` |
| `/about` | Explain the real organization behind the product | Founder/team, purpose, contact, editorial/review process, safety principles | `About TrueMax` |

Add more pages only when Search Console data or genuine original material justifies them. A metric glossary can be added later if each definition has enough substance to help a reader.

### Homepage copy structure

The scanner remains first. Add the following without inserting an interstitial or forcing a marketing-page detour:

1. A descriptive heading or visible lede: “Private face analysis from your front and side photos.”
2. One short proof line: “Measure facial proportions, symmetry, and structure using 478 landmarks. Photos stay on your device by default.”
3. The existing scan controls.
4. Below the main experience: How it works, What you receive, Privacy, Methodology, and FAQs.
5. A real `<footer>` with crawlable `<a href>` links to the supporting pages.

The existing brand button can keep its signed-out/member visual behavior, but it must not be the only way to navigate. Search engines and keyboard users need ordinary links.

## Technical SEO implementation backlog

### P0 — required before requesting indexing

- Add a production-only self-referencing canonical to each indexable page, using `https://www.truemax.app/...`.
- Permanently redirect `/index.html` to `/` in `vercel.json`.
- Add a unique title and meta description to every indexable page.
- Create `/robots.txt` with the sitemap location. Do not block a page in robots if Google needs to crawl it to see `noindex`.
- Create `/sitemap.xml` containing only canonical, public, indexable URLs with absolute `www` URLs.
- Preserve `noindex, nofollow, noarchive` for `/auth`, `/quick`, `/calib`, future account/dashboard routes, previews, and user-specific results.
- Ensure every public content page returns `200`; removed pages should return a real `404` or `410`, not a soft 404.
- Add crawlable HTML navigation and contextual internal links. Do not rely on buttons, click handlers, or fragment URLs for page discovery.
- Promote the intended application branch to production before submission, then repeat the status-code and metadata audit.
- Verify a Google Search Console **Domain property** for `truemax.app`, submit the sitemap, inspect `/`, and request indexing only after the production checks pass.

Suggested `robots.txt`:

```text
User-agent: *
Allow: /

Sitemap: https://www.truemax.app/sitemap.xml
```

### P1 — search presentation, entity, and performance

- Add Open Graph and Twitter cards with an original 1200×630 TrueMax image.
- Add a favicon set, Apple touch icon, and web app manifest with consistent brand colors and names.
- Add homepage JSON-LD for `WebSite` and `Organization`, including the canonical URL, logo, and verified `sameAs` profiles.
- Add `SoftwareApplication` markup only when the visible page contains the same app/pricing information and the required offer/review eligibility is genuinely satisfied. Never invent ratings or reviews.
- Validate markup with Google’s Rich Results Test and the Schema Markup Validator; structured data can improve eligibility, not guarantee a result.
- Establish a performance baseline using Vercel Speed Insights and Search Console field data. Target the “good” Core Web Vitals thresholds at the 75th percentile: LCP at or below 2.5 seconds, INP at or below 200 ms, and CLS at or below 0.1.
- Test whether preloading the 3.6 MB face-landmark model delays the initial scan UI on slower mobile connections. Load it after critical UI where possible while retaining a fast scan start.
- Compress and explicitly size all content images; use responsive formats and avoid using celebrity/demo photos as the main brand preview.

### P2 — ongoing refinements

- Add breadcrumbs and `BreadcrumbList` markup once the site has enough hierarchy to need it.
- Add video only when TrueMax has a useful scan tutorial; provide a transcript and thumbnail.
- Implement change-driven sitemap generation if the content surface grows beyond a small static list.
- Evaluate localized pages only after the English pages have demand and a real translation/review process. Do not auto-generate thin country pages.

## Content and trust standard

TrueMax deals with faces, confidence, and potentially minors. Its strongest SEO advantage can be unusually clear, responsible explanations.

Every page must:

- Have a named purpose and a primary reader question.
- Contain first-hand product knowledge, original diagrams/screenshots, or methodology—not a rewritten search result.
- Be reviewed by a person who understands the measurement system.
- State uncertainty and limitations where they matter.
- Avoid medical claims, diagnosis, guaranteed transformations, and language that treats a score as personal value.
- Avoid manipulating insecurities, especially in material accessible to under-18 users.
- Cite primary research for scientific claims and update or remove claims that cannot be supported.
- Show a reviewed/updated date when freshness matters.
- Use AI to assist drafting or organization only; never publish a large set of unreviewed pages.

### First three original assets

1. **The TrueMax measurement map:** an annotated, plain-language view of the major landmarks and what each measurement means.
2. **Photo repeatability report:** anonymized tests showing how lighting, angle, expression, and side-point placement change a result, including failure cases.
3. **On-device privacy explainer:** a visual of what stays in the browser, what account information reaches Supabase, and what billing information Stripe receives.

These assets can support the site, creator outreach, app-store listings, and genuine editorial citations. Do not publish population findings until sampling, consent, anonymization, and statistical review are adequate.

## Brand and authority plan

### Entity consistency

- Use **TrueMax** consistently—not TRUE MAX, True Max, or UMax—except for the intentional two-color logo treatment.
- Align the one-sentence description, logo, URL, and screenshots across the site, Apple App Store, Google Play, and verified social accounts.
- Verify whether the discovered App Store listing named “TrueMax App” belongs to this product. If it does, link both directions and align metadata. If not, assess the naming/trademark and user-confusion risk before investing heavily in branded acquisition.
- Add only real, maintained social profiles to `sameAs` structured data.

### Earned discovery

- Give creators and journalists a verifiable product story: front-and-side analysis, on-device processing, reliability testing, and transparent limits.
- Offer the measurement map and repeatability report as referenceable resources.
- Seek reviews from relevant grooming, style, photography, men’s/women’s self-improvement, and privacy-focused creators whose audiences match the product.
- Ask for editorial accuracy and a normal link when TrueMax is genuinely discussed; never buy bulk links, directory packages, private-blog-network placements, or fake reviews.
- Turn real user questions into product FAQs and help pages. Do not manufacture forum conversations or branded searches.

## Measurement setup

### Search Console: source of truth for organic search

Track weekly:

- Indexed canonical pages and indexing exclusions.
- Branded vs non-branded impressions and clicks.
- Query/page/country/device combinations.
- Search click-through rate by page and average position as context, not as a standalone success metric.
- Core Web Vitals and mobile usability.

### Vercel Web Analytics: on-site behavior

Web Analytics is currently disabled for the project. Enable it and add the supported production tracking package before relying on Vercel reports. Vercel pageview analytics is available across plans; custom events depend on the team plan, so confirm the plan before implementing the funnel list below.

Recommended funnel events:

- `scan_started`
- `front_scan_completed`
- `side_scan_completed`
- `signup_prompt_viewed`
- `signup_completed`
- `analysis_viewed`
- `checkout_started` with plan—not price or personal data—as event metadata
- `subscription_started`

Never send face measurements, names, email addresses, health information, or photo identifiers as analytics event properties.

### 90-day targets

These are operational targets, not ranking guarantees:

- All intended public pages discovered, canonicalized, and indexed or given a documented reason for exclusion.
- Zero duplicate-homepage and soft-404 issues.
- Good Core Web Vitals for all metrics when enough field data exists.
- A measurable baseline of branded and non-branded impressions.
- Organic scan-start, sign-up, and paid-conversion rates visible end to end.
- At least three genuinely useful original assets and five relevant independent mentions/reviews in progress or published.

Do not set “rank #1” or traffic-volume targets until 30–60 days of Search Console demand data exists.

## 90-day execution sequence

### Week 1 — make the site indexable

- Merge/promote the intended product release to production.
- Implement canonical tags, redirect, robots, sitemap, metadata, and `noindex` rules.
- Add the scan-first homepage lede and crawlable footer.
- Create and verify the Search Console Domain property.
- Enable Vercel Web Analytics and Speed Insights; add privacy-safe funnel events if the Vercel plan supports them.
- Verify production with curl, a browser crawl, Rich Results Test, and URL Inspection.

### Weeks 2–3 — build the trust surface

- Publish `/how-it-works`, `/methodology`, `/privacy`, `/pricing`, and `/about`.
- Add WebSite/Organization markup and branded share assets.
- Align app-store and social identity after resolving the App Store ownership question.
- Create the measurement map and on-device data-flow visual.

### Weeks 4–6 — cover the core category

- Publish `/face-analysis` and the scan-quality guide.
- Add real product screenshots, examples, citations, and internal links.
- Review query data weekly and improve titles/snippets where impressions exist but clicks lag.
- Run repeatability tests and prepare the report; do not overstate the conclusions.

### Weeks 7–12 — earn authority and iterate

- Publish the reviewed repeatability report.
- Conduct targeted creator/editor outreach using the original assets.
- Improve pages from Search Console evidence; consolidate overlapping pages instead of multiplying them.
- Review organic funnel conversion alongside ranking data and fix the largest drop-off.
- Perform a monthly technical crawl and quarterly content/claim review.

## Definition of done for the first SEO release

- The intended production commit is live on both canonical host checks.
- `/index.html` redirects permanently to `/`.
- `/robots.txt` and `/sitemap.xml` return `200` and contain correct production URLs.
- Every sitemap URL returns `200`, has one self-canonical, a unique title/description, one clear H1, and crawlable internal links.
- Non-public routes are absent from the sitemap and return `noindex`.
- Homepage WebSite/Organization structured data validates without critical errors.
- Search Console Domain ownership is verified and the sitemap is submitted.
- Vercel Analytics receives production pageviews and, when plan-supported, the privacy-safe funnel events.
- Mobile interaction, scan start, auth gating, and checkout still work after the SEO layer is added.
- A baseline report records indexed pages, queries, Core Web Vitals, and organic funnel conversion.

## Owner actions Codex cannot safely invent

1. Verify `truemax.app` as a Domain property in Google Search Console by adding the provided DNS TXT record.
2. Confirm whether the App Store listing titled “TrueMax App” is yours and provide its final country-neutral listing URL.
3. Approve the final founder/about details, public support contact, privacy claims, and any scientific citations.
4. Decide which branch/PR is the production release; production is currently behind the latest preview work.
5. Supply or approve the official square logo and 1200×630 social image.

## Primary references

- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Guidance about generative AI content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)
- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [AI features and your website](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google ranking systems guide](https://developers.google.com/search/docs/appearance/ranking-systems-guide)
- [Link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- [Site-name structured data](https://developers.google.com/search/docs/appearance/site-names)
- [Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization)
- [Software application structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [Vercel Web Analytics](https://vercel.com/docs/analytics)
