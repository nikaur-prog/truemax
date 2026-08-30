# TrueMax SEO rollout checklist

Updated: 31 August 2026

This checklist begins after the SEO foundation branch has passed review and
merged to `main`. Ranking is not guaranteed. The goal is to make the right
pages discoverable, measure what searchers actually want and improve from real
Search Console data.

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

## 2. Create the Google Search Console property

1. In Google Search Console, create a Domain property for `truemax.app`.
2. Copy the TXT verification value Google provides.
3. Add it to the domain's DNS without removing existing TXT records.
4. Wait for DNS propagation, then complete verification.
5. Submit `https://www.truemax.app/sitemap.xml` under Sitemaps.
6. Inspect the homepage, guide hub, face-score page and methodology page.
7. Request indexing only after Google's live test sees the merged metadata.

A Domain property covers the apex, `www` and every protocol. The DNS step is an
owner action because the value is unique and changing DNS affects the live
domain.

## 3. Establish measurement

- Record the deployment date and the indexed-page count.
- In Search Console, review Pages, Search results and Core Web Vitals weekly.
- Separate branded queries containing TrueMax from non-branded queries.
- Compare query, page, country and device rather than relying on one average
  position.
- Connect organic visits to the existing privacy-safe funnel events. Never add
  a face measurement, photograph identifier, email address or name to analytics.
- Enable field performance measurement only after confirming the exact data it
  collects matches the privacy policy.

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

The next three useful assets should be based on real TrueMax work:

1. A labelled measurement map showing what major landmarks and constructions
   mean in plain language.
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
