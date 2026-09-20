# TrueMax SEO rollout checklist

Updated: 20 September 2026

This checklist begins after the SEO foundation branch has passed review and
merged to `main`. Ranking is not guaranteed. The goal is to make the right
pages discoverable, measure what searchers actually want and improve from real
Search Console data.

The initial foundation is live. The expanded content, diagrams and optional
analytics consent controls are local changes awaiting a reviewed release. Custom
field-performance collection remains deferred pending reliable exit delivery. See
[the current implementation record](SEO_IMPLEMENTATION_2026-09-20.md) for what is
built, verified and still awaiting account activation.

## 1. Deploy and verify production

- Confirm `https://www.truemax.app/` is running the merged commit.
- Confirm `/index.html` permanently redirects to `/`.
- Confirm `/robots.txt` and `/sitemap.xml` return `200`.
- Open every sitemap URL on desktop and mobile.
- Confirm every page has the expected title, description, canonical URL and one
  H1.
- Confirm `/auth`, `/quick`, `/calib` and `/league` retain their `noindex`
  directive and are absent from the sitemap.
- Recheck that scan start, sign-up and checkout still work from the homepage.

## 2. Use the verified Search Console property

The owner already has an accessible URL-prefix property for
`https://www.truemax.app/`. Its sitemap submission is successful. Do not create
a duplicate property or change DNS merely to repeat the original setup plan.

1. After deployment, inspect the homepage, guide hub, face-score page,
   methodology and representative new measurement pages.
2. Use the live test to verify the deployed content and retrieval eligibility.
   Check the indexed URL-inspection report for Google's selected canonical when
   available; a live test does not establish actual indexing or canonical choice.
3. Request indexing only after the new release is visible, if appropriate.
   Requests and successful sitemap submission do not guarantee indexing.
4. Record exclusions without assuming a discovered-but-not-indexed URL is
   blocked by robots. The current HTTP/source checks found no such block.

A Domain property is optional broader reporting coverage, not a prerequisite to
use the existing property. Any later DNS change needs its own exact target and
owner-approved verification value.

## 3. Establish measurement

- Record the deployment date and the indexed-page count.
- In Search Console, review Pages, Search results and Core Web Vitals weekly.
- Separate branded queries containing TrueMax from non-branded queries.
- Compare query, page, country and device rather than relying on one average
  position.
- Connect organic visits to the existing privacy-safe funnel events. Never add
  a face measurement, photograph identifier, email address or name to analytics.
- Optional GA4 usage reporting stays off until an owner-selected web stream is
  configured and each browser grants analytics consent. The active account
  inspection showed Analytics onboarding, not an existing property.
- The prepared field-performance collector is not connected to production
  startup, even with GA configured. Resolve and verify final-exit delivery, then
  review its data against the privacy policy before enabling it. Do not use a
  biased subset of visits as a complete Core Web Vitals report.
- Confirmed GA4 purchase/revenue reporting still needs a separate payment-event
  integration. A checkout-start event is not a completed purchase.

## 4. Improve from evidence

- Rewrite titles when a page earns impressions but a weak click-through rate.
- Expand a page when Search Console shows a relevant question it does not yet
  answer.
- Consolidate pages that compete for the same intent.
- Create a new page only when it has a distinct reader question and original
  TrueMax knowledge.
- Review every scientific, privacy and product claim when the implementation
  changes.

Do not create pages for misspellings or minor wording variants. The face-score,
appearance, looksmaxxing and glow-up pages already cover the related natural
language queries.

## 5. Earn authority

Useful assets should be based on real TrueMax work:

1. A labelled measurement map showing what major landmarks and constructions
   mean in plain language. The new local measurement library now provides four
   original explanatory diagrams; deploy and review them before outreach.
2. A repeatability report showing how camera distance, lighting and pose affect
   a rescan, including failures and uncertainty.
3. An on-device data-flow diagram showing what stays in the browser and what
   reaches Supabase, Stripe and optional processors.

Use those assets in creator and editorial outreach. Seek accurate, relevant
mentions and ordinary editorial links. Do not buy links, reviews, traffic or
manufactured forum posts.

## 6. Thirty-day review

After at least 30 days, record:

- pages discovered, crawled and indexed;
- non-branded impressions and clicks by page;
- search click-through rate;
- organic scan-start, sign-up and paid-conversion rates;
- mobile Core Web Vitals when enough field data exists;
- queries that deserve a better answer;
- content with no visibility that should be improved or consolidated.

Use that review to plan the next release. Do not set a rank-one target before a
real search baseline exists.
