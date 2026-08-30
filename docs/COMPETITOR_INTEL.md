# Competitor intelligence: PSL and FaceIQ Labs

Gathered 30 August 2026 from public sources only: App Store listings, public
websites, a Similarweb traffic panel, a public Reddit thread, and a public
outlier search over TikTok and Instagram.

Nothing here is scraped, reverse-engineered or taken from anybody's private
systems, and nothing from it is copied into TrueMax. CLAUDE.md's rule stands:
no proprietary source, hidden APIs, datasets or scoring formulas from anyone
else. This is a record of what competitors say in public, what they charge, and
what their own users told them.

---

## PSL (getpsl.app, "PSL - Looksmax & Ascend", IQ Labs LLC)

### Traffic

| Month | Monthly visits |
| --- | --- |
| May 2026 | ~10K |
| Jun 2026 | ~80K |
| Jul 2026 | **148.9K** |

Bounce 36.34%, pages per visit 5.06, average visit 2m27s. That bounce rate and
page depth are not a curiosity-click pattern; people are going through the
thing.

### The App Store listing

- Name: "PSL - Looksmax & Ascend", subtitle "AI Face Scores & Routine"
- Age rating **13+**, category Health & Fitness, 215.8 MB, EN + 10 more
- "This app hasn't received enough ratings or reviews to display an overview"
- Last update 1 month ago, v1.1.2, "Minor bug fixes + accuracy improvements"
- App Privacy: "Data Not Linked to You" covering Purchases, User Content,
  Identifiers, Usage Data

Screenshot headlines, in order: See your attraction ratings · Ascend in 90 days
or less · Follow your looksmaxxing routine · Meet like-minded people · Generate
dating app photos that get matches.

Their score card shows **PSL 5 "High-Tier Normie"** beside **POTENTIAL 7
"Chad"**. Their routine screen shows a **1 Day Streak** and a **3/5** daily
ring. Their countdown reads **44 DAYS UNTIL YOU ASCEND**.

### Their claims, and what they cost

The listing states "**50% see results in week 1**" and "Become Top-Tier
Attractive in 90 days". It also states "80% of women match with only the top 20%
of men" as fact.

We cannot say either of those things. The first is a completion statistic about
a cohort we do not have. The second is a contested reading of one dating-app
dataset, presented as settled. TrueMax's Claims rule exists precisely to stop
this, and the gap is a positioning asset rather than a handicap: see below.

### Pricing

At launch (3 months ago, per the founder's own post): Single report **$6.99**
one-time · Weekly **$4.99** · Monthly **$12.99**. The paywall led with Monthly,
then Weekly, then Single Report.

### The creator programme

A portal at getpsl.app/portal with Dashboard, Submit Video, My Videos,
Leaderboard, Offers, Settings. Payout rails: USDC on Solana, bank, PayPal,
Cash App. A monthly submission deadline with a live countdown. Verified vs
Unverified earnings as two separate headline figures.

Accounts are placed in an earning tier **by audience geography**, verified by a
screen recording the creator submits and an admin reviews:

| | BASIC | ELITE |
| --- | --- | --- |
| Gate | 20% Tier-1 audience | 40% **USA** audience |
| Volume | 10k+ views / 28d | 500k+ views / 28d, 5+ videos |
| Payouts (stacking) | +$20 @ 40k · +$30 @ 500k · +$50 @ 1M | +$20 @ 40k · +$30 @ 100k · +$100 @ 500k · +$150 @ 1M |
| Cap | $100 / video | $300 / video |

Their Tier-1 list: US, CA, GB, AU, DE, FR, NL, SE, DK, CH, NZ, PL, IT.

Their onboarding also warns that **TikTok silently reuses the first connected
account unless you fully sign out** — a support-ticket lesson worth having for
free.

This is the mechanism TrueMax's league was missing, and it is now built
(`src/league/audience.ts`, migration `20260830030000`). We kept our continuous
RPM formula rather than copying their stacking cliffs, and every rate
multiplier ships at 1.0 so nobody's existing deal moves.

---

## The founder's own launch post

r/iosapps, 3 months ago, u/Aurelian_Syndicate: *"I built a face rating app that
doesn't completely suck (but i could use some honest feedback)"*. Flaired
**Vibe Coded**. 43 comments.

### Their stated wedge

> "For the most part, face rating apps have you submit a single front-facing
> selfie and give you a score. This is completely missing the fact that your
> side profile is the other half of the equation. Projection, gonial angle,
> profile chin, profile nose. Just scoring based off the front is a huge miss."

**They picked the same wedge TrueMax did.** Both apps require front and side.
This is no longer a differentiator and must stop being described as one.

### What their own users told them, and why it matters to us

The thread is more valuable than the app. Four findings:

**1. The one-off report is what sells, not the subscription.** In the founder's
own words:

> "On the pricing, early activity has been overwhelmingly the single report
> purchases. I built in a lot of reasons to come back (daily customized to do
> exercises based on latest scan, 2 scans a day, 50+ exercise library, progress
> tracking, softmaxxing recommendations tailored to their face, etc..) but
> **seems like most people don't care, they just want their single report.**"

He then asked the thread whether to scrap the monthly option and lead with the
single report. **TrueMax leads with the subscription and has a $2.99 one-off
voiced analysis buried on the results screen.** That ordering is worth
revisiting against this evidence. It is the single most actionable line in the
entire document.

**2. Scoring bone and then selling improvement on top of it is the structural
flaw.** From u/Albert_Irons, and it is the sharpest thing anybody said:

> "the stuff youre scoring, gonial angle, projection, canthal tilt, thats bone,
> it doesnt move without surgery. so scoring it and then selling 'ascend' on top
> is always gonna feel a little off to people, and its also exactly why nobody
> rescans, your bones are the same next week."
>
> "but heres the thing, the parts that actually DO change are the parts you
> already built. skin, body fat, grooming... that stuff genuinely improves in
> weeks and its a way bigger market than the looksmaxxing crowd, **women want it
> too**. id flip the whole positioning: **stop being a psl rater and become a
> glow up progress coach.**"

TrueMax is already built this way and should say so louder. Every metric
carries a `fixability`; the plan is ordered by what is movable; `potential` is
recomputed from the fixable metrics alone; and `goalEvidence.ts` refuses to
attach a progress line to a measurement that cannot move or cannot be measured
moving. The thing a competitor's users are asking them to become is the thing
this codebase already enforces in tests.

**3. Privacy is the top-cited blocker.** The only developer-flaired commenter
led with it:

> "Since this is face analysis, I'd want privacy to be extremely clear upfront:
> are photos stored, processed on-device, deleted after analysis, used for
> training, etc. That would probably be one of the biggest blockers for people
> trying it."

PSL answers this with an onboarding slide. TrueMax answers it with the
architecture: the mesh runs on the device, photos stay on the device by
default, and the account exists to carry a membership rather than to collect
faces. That is a stronger answer and it is currently under-sold.

**4. The tier vocabulary repels the wider audience.** Same commenter:

> "the 'score/tier' language may be fun for the target audience, but it can also
> feel harsh or meme-y to a wider App Store audience. The 'focus areas' angle
> feels stronger to me because it gives people something actionable instead of
> just judging them."

PSL's ladder is "High-Tier Normie", "Chadlite", "Chad", "MTN", "HTN". TrueMax's
is: needs work / needs improving / below average / okay / alright / decent /
good / very good / top of the scale. That decision is already pinned by tests
in `analysisMode.test.ts` and this is the outside evidence for it.

**5. General audiences are hostile to the category.** Top comments included
"This is dystopian" (9), "Horrible idea. Yikes.", "Not only is this a bad idea
but you used so much AI", and "Broke: rate my face / Woke: rate my personality".
This is a general iOS-developer subreddit, not the ICP, but it is what the app
meets outside its niche and what an App Store reviewer is likely to feel. The
plain, factual, measurement-first register is the defence.

### Incidental

Their marketing screenshots were made with appscreens.com plus Canva, with
ChatGPT for the pop-out effects. Compute cost was raised as a threat to margin;
the founder said he "figured it out", which given a 215MB binary suggests
on-device inference.

---

## FaceIQ Labs

Held open. What is known so far:

- Named directly in TikTok captions that are pulling seven-figure view counts
  (@saulmogman, 1.3M views on "Analysis at FaceIQ Labs")
- Roughly 1.1M monthly visits by the owner's own earlier reading
- Positioned toward an audience considering surgery, which is a narrower TAM
  than TrueMax's
- Their line craft and loading screen are the visual benchmark that step 16 of
  the seventeen was measured against

**Still to gather:** pricing and paywall order, whether they have a creator
programme, their privacy posture, their App Store listing and age rating, and
whether their scoring surfaces reliability at all.

---

## What this changes for TrueMax

Ranked by size of the bet.

1. **Revisit the paywall order.** A competitor with 148.9K monthly visits found
   the one-off report outsells every subscription tier and asked a public forum
   whether to lead with it. Our $2.99 voiced analysis is the equivalent product
   and it is not the lead offering. This is a pricing experiment, not a rewrite.
2. **Sell the thing they were told to become.** "Stop being a rater and become
   a glow-up progress coach" is advice given to a competitor that TrueMax
   already implements. Lead with what moves, and with the second scan.
3. **Sell the privacy architecture.** It is the top-cited blocker in the
   category and we have the better answer by construction rather than by
   promise.
4. **Stop calling front-plus-side a differentiator.** They have it too.
5. **The claims gap is an asset.** They say "50% see results in week 1" and we
   cannot. The honest position is the harder sell and the defensible one, and
   it is what survives an App Store review and a journalist.
