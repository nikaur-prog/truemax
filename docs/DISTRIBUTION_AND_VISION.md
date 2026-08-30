# The vision, the content architecture, and the distribution engine

One document, because they are one thing. Written 30 August 2026 from the
competitor evidence in COMPETITOR_INTEL.md.

The argument in one paragraph: every app in this category sells a **verdict**,
and a verdict is a product you use once. Their own users say the verdict does not
reproduce, cannot show its working, and rates bone it then sells you exercises
for. TrueMax's differentiator is that it sells a **measurement you can repeat**,
and a repeated measurement is the only thing in the category that produces a
before and after with a date on it. That is simultaneously the product moat, the
retention mechanic, and the content format. They are not three problems.

---

## Part 1 — What the evidence actually says

Four failures recur across both competitors' own user threads. Each one is a
place TrueMax is already standing, and none of them is being said out loud yet.

**The score does not reproduce.** A FaceIQ user, unprompted, in public: *"I
tried it 3 times and I got 4.8, 5-something and 6.3."* PSL's own marketing
attacks exactly this: *"the score changes every time you rescan the same photo,
which tells you it's basically random."* Then PSL claims the opposite about
itself as a slogan, with no number behind it.

TrueMax is the only one of the three that has **measured its own noise**. Two
photographs of one unchanged person differ with an SD around 1.32 raw, about
0.53 after calibration, and `DISPLAY_NOISE` is set to 0.6 so the app refuses to
call anything smaller than that a change. That is a publishable fact and nobody
else in the category has one.

**The score cannot show its working.** *"how do we know that having an fWHR of
1.7 as a male means being a 5/10 for that particular aspect?"* TrueMax answers
this per metric already: the value, the population mean, the ideal band, the
percentile, and a reliability flag on anything too noisy to score. The Pillars
sheet and the measurement detail card exist for precisely this question.

**They score bone and then sell improvement on it.** The sharpest comment in
either thread: gonial angle, projection and canthal tilt do not move without
surgery, *"and its also exactly why nobody rescans, your bones are the same next
week."* TrueMax already enforces the opposite: `fixability` per metric, plans
ordered by what moves, `potential` recomputed from movable metrics alone, and
`goalEvidence.ts` refusing a progress line to anything that cannot move or
cannot be measured moving.

**Nobody has a reason to come back.** Their founder, in his own words: *"I built
in a lot of reasons to come back... but seems like most people don't care, they
just want their single report."* He built the features and could not make them
matter, because a report on your skull is finished the moment you read it.

---

## Part 2 — Where the product goes

The vision in one sentence: **stop being a rater, become the record.**

Not a repositioning exercise. The app is already built this way; what follows
makes the difference legible and gives the second scan a reason to exist.

### 2.1 The repeatability receipt (highest value, smallest build)

Every score should be able to show its own confidence. The engine knows the
noise floor; the UI mostly does not say so.

- A **"measured twice" badge** on any scan where a rescan agreed inside the
  noise floor. That is a claim no competitor can make.
- On the second scan, lead with the **delta and whether it clears the floor**,
  not the absolute number. `readDelta` already returns noise / tooSoon /
  worthNoting and the copy exists.
- A public **/accuracy page**: our reliability figures per metric, our noise
  floor, and the plain statement that a change under 0.6 is not reported as
  progress. Publishing the limitation is the marketing.

### 2.2 The streak, tied to the thing that moves

The one mechanic both competitors have and TrueMax does not. PSL shows a "1 Day
Streak" and a 3/5 daily ring; FaceIQ runs sprints and ranks.

The difference worth building: **their streak is a habit counter, ours should be
evidence.** A streak on TrueMax should link the days done to the measurement
that moved, so the reward for a 30-day run is a chart, not a number that resets.
This is the "self-progressing" moat stated as a feature.

Depends on the plan being a stored object. That is the single biggest unlock in
the codebase and it blocks: the diary, the goal-evidence UI, the streak, and
Max's ability to remember what he told you last week.

### 2.3 Max as the thing that remembers

Neither competitor has an adaptive coach; both have static protocols. Max's
advantage is not that he writes text, it is that he can read **your history**
and say "this is the third scan where the jaw has not moved, so the plan was
wrong, here is a different one."

That sentence is not currently possible, because the plan is not stored and Max
does not read the history. It is the highest-leverage Max change available.

### 2.4 Full body, later

Named because it is the obvious extension and because the same rules must
follow it: only measure what can move, only claim what reproduces. It does not
start until the face's own repeatability question (#54, #82) is closed.

### 2.5 What NOT to build

- **No tier vocabulary.** No "High-Tier Normie", no "Chadlite". Their own
  reviewers call it harsh and meme-y outside the niche, and the plain ladder is
  already pinned by tests.
- **No AI after-face.** The ceiling card uses the person's own photo, out of
  focus, and says so.
- **No claim we cannot support.** Not "50% see results in week 1", not "80% of
  women match with the top 20% of men", not "1 in N".
- **No proxy guide.** See Part 4.

---

## Part 3 — The content architecture

**The product capabilities and the content formats are the same list.** Every
format below is a screen recording of something the app already does, which is
why this is buildable by one person posting daily rather than a production
operation.

| Funnel | Format | The screen it films | Status |
| --- | --- | --- | --- |
| Top | Before/after, short | Scan → glow-up | Built |
| Top | Before/after, long | Before photos → scan → Max's suggestions → after | Built |
| Top/Mid | Celebrity read | Quick page on a known face | Built |
| Mid/Bottom | The attractive face that scores a 7.4 | Full report with the reason | Built |
| **Mid** | **"I scanned the same face twice"** | Two scans, delta under the noise floor | **Needs 2.1** |
| **Mid** | **"Here is where the number came from"** | Pillar sheet → measurement detail → ideal band | Built, never filmed |
| **Bottom** | **"Day 30"** | The history chart | **Needs 2.2** |

The two rows in bold are the ones no competitor can film. That is the entire
argument for the content lane, and it says the same thing the product does.

**The hook that is ours alone:** *"Every one of these apps gives you a different
number every time you scan. Watch."* Then scan the same face three times on a
competitor, then three times on TrueMax. It is a demonstration, not a claim,
and their own users have already made the accusation for us in public.

**A rule for the lane:** the app must be on screen. A 174-follower account got
87.9K views by pointing a rating app at a face; the creator is not the content.

---

## Part 4 — The distribution engine

### Phase 0 — Now. Ship it.

Codex over the branch, fix what it finds, merge. Nothing below matters against
a broken build, and every phase multiplies whatever the product does on first
contact.

### Phase 1 — Volume from the two accounts we control

The owner's account and Adrian's. Target one video a day each, minimum, both
posted to **TikTok and Instagram** — PSL's rule, and it is right: the same edit
earns twice because the platforms count separately.

Set up before the first post, because retro-fitting is wasted reach:

- Bio line and link on both accounts.
- The **branded overlay**, shown full-screen and alone for ≥1.5s inside the
  first 15 seconds. PSL mandates this of their creators and it is the whole
  attribution mechanism. We have the assets; make the rule now so the league
  inherits it later.
- The tag in the **first line** of the description, visible without "more".

Measure: which of the seven formats survives. Ten posts per format before
judging one.

### Phase 2 — Reddit and forums, for feedback and for the first users

PSL ran this twice and the second one worked five times better. Their pattern,
adapted:

**What transfers:** bracket tags the sub expects · the wedge in the title ·
**competitor names appended for search** ("Umax alternative" is a query people
type) · a body that names the incumbents' specific failure · solo-dev framing ·
a genuine ask for criticism.

**What is better for us:** they had to give away App Store promo codes.
**TrueMax runs in a browser and the first scan is already free.** No download,
no code, no DM. That removes the entire friction step their post existed to
solve, and it means the CTA is a link rather than a comment-and-wait.

**What we are not copying:** the App Store review ask attached to a free code.
Apple's guidelines prohibit incentivised reviews, and we do not need it.

Subreddits: r/GenAiApps, r/iosapps and equivalents for web, r/SideProject,
r/truerateddiscussions and the rating communities, and the looksmaxxing forums.
Read each sub's self-promotion rule first; PSL's posts were flaired to comply.

The honest headline for us is not "free". It is: *"Every rating app gives you a
different number each time. I measured how much mine drifts and I'll show you
the figure."* That post is unattackable, because the number is real, and it
directly seeds the mid-funnel content lane.

### Phase 3 — Clippers, before the Discord

The league exists and pays; what it lacks is people. Do not build a community
and wait. Go where clippers already are:

- **Clipify** is where FaceIQ rents its programme, and its Discord already has
  1.22K creators being paid to clip a direct competitor.
- The general clipping Discords and Whop communities where these creators
  gather for whoever is paying this month.
- **Direct DMs** to the accounts in the outlier table: they have already proved
  they will point a rating app at a face, and they are currently doing it for
  PSL, areumlabs and ascendr.

The pitch writes itself from the tier data we now hold: a stated rate, a
transparent tier, and an Offers page that prints every floor and names the exact
gap when someone falls short. Their programmes reject with no reason; ours
cannot.

### Phase 4 — The Discord and the sprints, once cash flow allows

Only when there is money to fund a pool, because a sprint that runs dry is worse
than no sprint. Both competitors run fixed budgets that end when the money does,
and say so up front.

Channel structure, from theirs: tutorial · announcements · sprints ·
competitions · submissions · payouts · questions · suggestions · bug-report.

**Two integrity rules, decided now rather than under pressure:**

1. **Move to per-video audience verification before scale, not after.** FaceIQ
   verified at the account level, got viewbotted, rejected every pending payout
   and forced everyone to re-verify. Our tiers are account-level today. #148
   tracks the move.
2. **We will never publish a guide to faking audience geography.** PSL does:
   residential proxies, a factory-reset phone, "use at your own risk". It is
   platform fraud, it poisons the exact signal their payouts depend on, and it
   is what forced their competitor into per-video checks. Being the programme
   that does not do this is worth more than the creators it costs us.

---

---

## Part 5 — The economics, and what we do not know

### What they probably make

Fermi estimates from public traffic. Not financials, and the error bars are
large enough that the band matters more than the midpoint.

**PSL.** 148.9K web visits in July, but they are App Store only, so the website
is a funnel rather than the product. Web to install maybe 15 to 35%; install to
paying maybe 2 to 6% for a hard-paywalled utility. That implies roughly 1,500
payers a month from web alone at a blended ~$8, so about **$12K gross**. TikTok
almost certainly drives more installs than the website does, which could put the
real figure several times higher.

Band: **$10K to $50K a month gross**, most likely the lower half.

The counter-signal that argues for the low end: their App Store page reads *"This
app hasn't received enough ratings or reviews to display an overview."* Thousands
of paying customers over three months would have produced ratings. Caveat on the
caveat: that screenshot was taken from a New Zealand storefront and they are
US-focused, so it may be a regional artefact rather than a global one.

**FaceIQ.** Roughly 1.1M monthly visits, about 7x PSL, running for longer, and
now operating two apps (FaceIQ plus AuraPal). Naive scaling gives $70K to $350K.

But their live Clipify sprints show **$315 of a $4,000 budget used (8%) and $20
of $2,000 (1%)**. For a programme that has been running sprints since May, that
is a slow burn, and it argues against the top of the range. $315 across 11
approved videos is about $29 a video.

Band: **$50K to $200K a month gross.**

### The number that actually matters

Theirs is a curiosity. Ours is the plan. At $7.99 and $11.99, **1,000 paying
subscribers is roughly $10K MRR**, and that is the figure to reason about. It is
also, at a 2 to 4% conversion, about 25,000 to 50,000 people who complete a
scan, which at the observed content rates is a few dozen videos that land rather
than a few thousand.

### What we do not know, and how to find out

Ranked by how much the answer would change the plan.

1. **Their actual revenue.** App Store rank history and review velocity, or an
   Appfigures/Sensor Tower estimate. Cheap, and it converts a wide band into a
   narrow one.
2. **Whether the one-off report really outsells subscriptions for us too.** They
   told us it does for them. We can test it in a week by reordering our own
   paywall, and we should, because it is a pricing change rather than a build.
3. **FaceIQ's pricing and paywall order.** Not yet gathered. A user in their own
   thread mentions "$50 for that analysis", which if accurate is a very
   different model from PSL's $6.99.
4. **Where the creators actually are.** Clipify's Discord is one confirmed pool
   of 1.22K. Are there others, and what do they get paid elsewhere?
5. **Our own conversion.** Currently unknown because there is no traffic. Every
   estimate above is a competitor's number standing in for ours, and the first
   real week of Phase 1 replaces all of it.

### The integrity line, decided in advance

Most of what these companies do is not cheating. Paying creators per view,
posting six to twelve times a day, cross-posting to both platforms, putting a
competitor's name in a Reddit title, giving away free access: that is all just
doing the work, harder than most people are willing to.

Three things are over the line, and they are worth naming so the decision is
already made when the temptation arrives:

- **Teaching audience fraud.** PSL's Discord carries a guide to manufacturing a
  Tier-1 audience with a residential proxy and a factory-resettable phone. It
  defrauds the platforms and it defrauds their own payout criteria.
- **Claims the data cannot carry.** "50% see results in week 1" describes a
  cohort. "80% of women match with only the top 20% of men" is a contested
  reading of one dataset stated as fact.
- **Incentivised App Store reviews.** Asking for a review in the same breath as
  handing over a free code is against Apple's guidelines.

The useful observation: **none of that is what is growing them.** The proxy
guide is about creators extracting more from PSL, not about PSL acquiring users.
The claims are decoration on a funnel that works because of volume. What is
growing them is posting a great deal and paying other people to post as well,
and both of those are available to anyone willing to do them.

The one place honesty genuinely costs us is ad copy: they can write "50% see
results in week 1" and we cannot. That is a real disadvantage, accepted
deliberately, and the compensation is that everything we do say survives
scrutiny from a journalist, an App Store reviewer, or a user who rescans.

## The one-line version

They sell a verdict on your skull and cannot reproduce it. We sell a
measurement that reproduces, and the record of it changing is the product, the
reason to come back, and the content, all at once.
