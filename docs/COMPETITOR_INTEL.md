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

## PSL's second launch post, and the actual growth mechanic

Same founder, r/GenAiApps, same day-ish. **215 comments against the first
post's 43.** The difference is the mechanic, and it is worth studying closely.

Title: *"[iOS] [Limited Time FREE] The PSL app that shows you the actual data
behind your score, not just a random number | **LooksMax AI / Umax
Alternative**"*. Flair: Giveaway.

Four things are doing work in that title alone: the bracket tags the sub
expects, FREE as the hook, the wedge stated plainly, and **two competitor names
appended for search**. People search "Umax alternative"; that post is what they
find.

The body is a direct attack on the incumbents:

> "They give you a score out of 100 with nothing behind it. No measurements. No
> explanation of how they got there. And then 'tips' so generic they apply to
> literally everyone like 'improve your skin', 'get more sleep', 'stay
> hydrated.' Cool. That's not analysis, that's a fortune cookie. **Worse, the
> score changes every time you rescan the same photo, which tells you it's
> basically random.**"

And the offer:

> "Consider this limited free access to something other apps in this space
> charge $3.99–4.99/week for :)"
>
> "**For free access, comment 'PSL' and I'll share the next steps.**"
>
> "PS: Would really appreciate an App Store review if you like it (Download
> from the App Store under your own Apple ID first, or the review option won't
> unlock.)"

That is the whole engine in three lines. Free codes are traded for **comments**,
which is the ranking signal Reddit rewards, and each commenter gets a DM and an
**App Store review** ask. The founder replied "DM'ed you!" over and over. 215
comments is a front-page post in that subreddit and it cost him promo codes.

**Note what they claim and cannot prove:** "Calibrated and consistent scoring,
rescan and you get the same read, because it's measuring, not rolling dice."
TrueMax has actually measured its own repeatability and can put a number on it.
They assert it as a slogan.

---

## FaceIQ Labs

### What their own users say

r/truerateddiscussions, *"Is FaceIQ rating accurate?"*, 16 upvotes, 30
comments. The OP posts his own FaceIQ result: **OVERALL 5.41 (Top 46%), FRONT
6.33 (Top 69%), SIDE 3.94 (Bottom 21%)** over a harmony-score density curve.

Treat a rating subreddit with the scepticism it deserves. But the same
complaints recur from different people, and several are structural rather than
matters of taste:

**1. It only measures harmony.** The top comment: *"This tool only rates
harmony. It doesn't take other important factors into account such as features,
dimorphism and angularity."* Another: *"Just measures harmony bro, I get like
6.1/10 harmony but my other categories are what bring my score down to like a
4.75."* Users disagree about whether dimorphism was added later.

**2. It does not reproduce, and users noticed.** The OP, unprompted: *"I tried
it 3 times and I got 4.8, 5-something and 6.3, which is a huge difference
according to the percentiles."* A 1.5-point swing on one face. This is the same
failure PSL's marketing copy attacks them for, and it is the single most
attackable thing about the category.

**3. Nobody can see how a measurement becomes a score.** The most careful
commenter: *"It's great at figuring out deviations from ideal, but how do we
know that having an fWHR of 1.7 as a male means being a 5/10 for that particular
aspect?"* Same person tested plain AI-generated faces and got 5 to 7, and tested
people rated 8ish elsewhere and got 6 to 7: the scale is compressed and
unanchored.

**4. Weighting is opaque and probably flat.** *"Are some features weighted
higher than others or are they just averaged out normally?"* The OP: *"I think
they are all considered equal (not sure tho) but they definitely shouldn't be."*

**5. The side profile reads as absurd.** *"you don't have a bottom 27% side
profile. That's absurd."* Multiple people report a very low side and a strong
front on the same face.

**6. The paywall is read as manipulative.** *"I figured it was giving me way too
good of a score at first and then it practically taunted me with bad scores that
were locked behind the paywall as a way to reel me in into buying it."*

**7. Price resistance is loud.** *"Did you pay 50 dollars for that analysis?"*
and *"I'm gonna build a face scan app because this ones mad expensive."*

**8. Celebrity results discredit it.** *"Just look at how they rate models and
celebrities. It's ridiculous. There are leading actors that are rated lower than
mark zuckerberg lol."*

### Their creator programme runs on Clipify

FaceIQ does not run their own portal. They rent one: **clipify.app**, a
third-party clipping platform, plus a Discord ("Clipify", 1.22K creators) with
channels for tutorial, announcements, updates, sprints, competitions, support,
clips, chat, payouts, questions, suggestions, bug-report and giveaways.

Their Clipify nav is Overview · Sprints · Submit · Submissions · Ranks · Money ·
Tools · Support · Profile. **That is TrueMax's league nav almost verbatim.** We
built the same thing independently; theirs is rented, ours is owned.

Live sprints observed:

| Sprint | Budget used | Submissions |
| --- | --- | --- |
| FaceIQ Labs Face Analysis | $315 / $4,000 (8%) | 13 earning · 2 pending · 11 approved · **16 rejected** |
| FaceIQ Clips | $20 / $2,000 (1%) | 22 earning · 1 pending · 10 approved · 4 rejected |

Note the rejection rate on the first: 16 rejected against 11 approved. Their
sprints run on the Clipify pattern of a fixed budget that "ends when the budget
runs out", with stacking milestones (an observed example: $30 at 20k, $75 at
150k, $150 at 500k, $250 at 1M against a $3,000 budget). They have run $10,000
and $5,000 sprints and a $2,000 song competition.

### What their announcements reveal

- **July 12: they were being cheated.** *"there has been a surge in viewbotters
  and people trying to cheat our system... Regions have been moved from your
  account to every single video. Now you have to declare, per video, which
  region it is in."* They rejected every pending payout and made everyone
  re-verify.
- **July 8:** a second app, **AuraPal** ("helps you rate and improve your
  pictures"), with its own $5,000 sprint. They are running a portfolio.
- **July 5:** a "CTA Polisher" tool, because creator CTAs were *"too ai sloppy"*.
- **May 7:** *"It looks like TikTok is banning videos, accounts within the
  space."* A platform risk that applies to us identically.

**The design lesson, and it is a live one for our own league:** FaceIQ verified
audience geography at the ACCOUNT level and got viewbotted, so they moved to
PER-VIDEO verification. TrueMax's new audience tiers are account-level. That is
the right place to start and the wrong place to finish, and #148 records it.

### Meanwhile, PSL publishes a guide to faking it

PSL's Discord carries a section titled **"HOW TO GET US VIEWERS ⚠️ USE AT YOUR
OWN RISK, COULD LEAD TO BANNING/SHADOWBANNING OF ACCOUNT"** with two methods,
the second requiring a phone you can factory-reset and **a US residential proxy
at $4/month**.

They gate payouts on a 20% Tier-1 audience and then tell creators how to
manufacture one. We are not doing that, and it is worth being explicit about
why: it is platform fraud, it poisons the tier signal the payout depends on,
and it is the exact behaviour that forced FaceIQ into per-video verification.

### The rest of PSL's creator rules, worth copying

Their programme is tighter than ours and most of it is free to adopt:

- Post the **same video to both TikTok and Instagram** — counted separately, so
  the same work earns twice.
- **Minimum one video a day.** Their stated top earners post 6 to 12 a day
  across multiple accounts for $5k–$10k a month.
- A required **bio line and link**.
- A required **branded overlay**, shown full-screen, alone, for at least 1.5
  seconds, within the first 15 seconds.
- The **tag must be in the first line of the description** so it is visible
  without pressing "more".
- English only. Named banned niches (anime, cartoons, sports, animals).
- Tier-1 share must be **maintained** after acceptance, checked monthly.
- **30 days to submit; views lock at submission.** Submit when you are happy.
- Payouts monthly, timed to when Apple pays them.

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
