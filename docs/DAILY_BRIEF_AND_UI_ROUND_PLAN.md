# The daily brief, UI round U1, and the Codex handoff

Written 2 September 2026 against main at `26ac017` (#237 merged) with #238 (S1)
open. Three things the owner asked for in one message: whether Sandcastles can
read the market and say what to make, a daily "what to post today" recommender
built from the connectors already attached, and a plan for the four UI
improvements raised beyond the sweep. The Codex prompt is the last section.

Two probes were run while writing this, one YouTube outlier search and one
Instagram and TikTok outlier search on the niche, ten vidIQ credits in total.
Every number in section 1 comes from those two calls on 2 September; nothing
is invented.

## 0. The short answers

**Can Sandcastles analyse current market trends and say what to make?**
Within a tracked set of creators, yes: it flags a video that outperforms its
channel, and its pattern layer names the hook and format that did it. It is
not a general trend feed. It does not watch TikTok sounds, search interest or
anything outside the channels it is told to track. Everything it does at that
level, the vidIQ connector already does for us today, and vidIQ's Instagram
and TikTok search returns the hook, format, audio and audience per result
without a second product. The one thing Sandcastles adds, a persistent
pattern library that grows as more videos are tracked, is a table we can keep
ourselves. Sandcastles is paid only (Pro from $39 a month billed yearly, MCP
access from Pro), so by the owner's rule it is out. Section 1.7 says when it
would be worth revisiting.

**What "blowing up" is made of, in this niche, this month.** The two probes
say the same thing three ways:

1. A format is being seeded by competitor apps. Four of the six TikTok
   outliers are creators posting "Official ratings with @[app]" edits: a
   celebrity or character face, the app's score overlay, a beat, 13 to 37
   seconds. Multiples of 33x to 81x their own median (196K, 48K, 225K and
   1.1M views from accounts under 9K followers). The apps named were Mog
   Academy, Ascension App, MogU and PSL App. That is the clipper play from
   `DISTRIBUTION_AND_VISION.md` Phase 3, and it is running now, without us.
2. A contrarian claim in the first second, then a receipt. "Hairline doesn't
   matter bro" (225K, 33x). "PALE SKIN IS BETTER BRO" (1.3M, 26x). "A
   BEAUTIFUL woman doesn't look as good as the AVERAGE man" (465K, 36x). The
   claim is the hook; a measurement is the payoff. We are the only app in the
   set that can produce the receipt honestly.
3. Education that reads as a secret. "Finding your perfect hairstyle is
   surprisingly easy" argues facial thirds and jaw projection decide the cut,
   not face shape (607K, 56x, four minutes long). Facial thirds is a
   measurement the app already prints.

Consistency is the part the owner already knows. The rest is: copy the
format that is working this week, put our own measurement in the payoff slot,
post at the hour our own audience is awake, and check the next day whether it
moved. The brief below does exactly that, every morning, without anybody
opening five dashboards.

## 1. The daily brief

### 1.1 What lands in the inbox

One message at 07:00 New Zealand time, Monday to Sunday, in the owner's
Gmail (or Slack, one line to switch). Three recommendations, each with:

- **Format** and the evidence: the outlier videos it was lifted from, with
  views, multiple of the creator's median, length and hook line.
- **Our version**: the hook line, the beat script (five to eight beats, each
  with what is on screen and what is said or shown), the measurement that is
  the payoff, and which TrueMax asset produces it (The Cast rundown on
  `/quick`, the CTA series, a Coach Max clip, a screen recording of a scan).
- **Post slot**: the best hour for TikTok and for Instagram from Metricool's
  own-audience data, in Pacific/Auckland.
- **Title and caption**: three titles scored, one caption with the standing
  fine print ("Demo faces are AI-generated" when a synthetic face is used).
- **Sound**: for a TikTok direct post, three tracks from the commercial
  library that fit the pacing, with listen links, from the Higgsfield
  connector.
- **Effort**: minutes to produce, from the outlier metadata's own effort
  field and our asset list.

A fourth block, **yesterday**, reads Metricool for anything posted in the
last 48 hours, says how it did against the account's median, and names which
brief item it matched, if any.

A worked example from today's probe, to make the shape concrete:

> **1. Copy the format that is running: "Official ratings with @truemaxapp".**
> Four TikTok outliers this month (33x, 34x, 37x, 81x) are creators putting a
> competitor app's score overlay on a celebrity face over a beat. Ours: a
> 17-second Cast rundown of one celebrity from the saved-face library, the
> score card at beat four, the overall at beat six, "get yours in bio". Asset:
> `/quick` Cast tool, download the rundown MP4. Post: TikTok 21:00 NZT.
>
> **2. Contrarian claim, then the receipt: "Hairline doesn't matter bro".**
> 225K at 33x this month. Ours: the same sentence on screen for one second,
> then the front scan with the forehead ratio line drawn, then the number,
> then "here is what does". Asset: a screen recording of a demo scan with the
> measurement lines. Post: Instagram 19:00 NZT.
>
> **3. The secret that is a measurement: "Your face shape guide is wrong".**
> 607K at 56x, four minutes, education. Ours: 45 seconds, facial thirds on a
> demo face, three hairstyles, which one the thirds pick. Asset: Coach Max
> read plus the thirds overlay. Post: YouTube Shorts, best hour from vidIQ
> channel analytics.

### 1.2 Sources, all already attached

| source | what the brief takes from it | cost |
|---|---|---|
| vidIQ | YouTube outliers by keyword and by tracked competitor channels; Instagram and TikTok outlier search with hook, format, audio, audience and effort per result; trending Shorts by velocity; title scoring; transcript of one video when a beat script needs the actual wording; own channel analytics | 5 credits per discovery call, 10 per watch, 0 for balance, channels and title scoring |
| Metricool | best time to post per network from the brand's own audience; analytics on what was posted (views, reach, engagement); scheduled posts; creating a post for review | included in the plan already held (brand `tryreckonapp`, TikTok `truemaxapp`, Instagram `tryreckonapp`, timezone Pacific/Auckland) |
| Higgsfield | trending commercial-library tracks for TikTok direct post; virality predictor on a produced clip before it goes out; generation only when a brief item needs a new AI-actor clip | credits only on generation or prediction, none for the track list |
| the repo | the Cast and Cut tools on `/quick`, the CTA series and its outro, the rundown renderer, the saved-face library, the League montage, the fine-print rules in `CLAUDE.md` | none |
| Notion | the brief archive and the format table the learner reads (section 1.5) | none |
| Gmail or Slack | delivery | none |
| Claude Routines | the schedule: a fresh session each morning with exactly these connectors granted | one short session a day |

The vidIQ credit line is the real constraint. The connected plan holds 150
renewable credits a cycle (140 left today, reset 12 September). Two
discovery calls a day is 300 a month, double the allowance. So the brief is
credit-aware by design:

- One discovery call a day, rotated: Monday and Thursday Instagram and
  TikTok outliers, Tuesday and Friday YouTube outliers on the niche keyword
  set, Wednesday YouTube outliers on the tracked competitor channels,
  Saturday trending Shorts, Sunday no discovery, yesterday-block only plus
  the week's format table.
- A watch call (10 credits) only when a recommendation needs the exact
  wording of one video, capped at two a week.
- The brief prints the balance and stops discovery at 20 credits so the
  owner always has a manual search left.

That is roughly 110 credits a month at the base plan. If the owner later
wants two discovery calls a day plus daily watch, the next vidIQ tier is the
lever, not Sandcastles.

### 1.3 The pipeline

Runs inside one Claude session, as a saved workflow script the Routine
invokes, so every step is deterministic and every agent's output is
journalled.

1. **Gather.** The day's discovery call; Metricool best-time for TikTok and
   Instagram over the trailing 30 days; Metricool analytics for the last
   48 hours of posts; the format table from Notion; the repo's asset list
   (a small JSON the workflow reads, kept in `.claude/skills/daily-brief/`).
2. **Normalise.** Every result becomes one row: platform, creator size,
   views, multiple of median, length, hook text, hook visual, format
   template, audio mix, effort, audience fit. vidIQ's Instagram and TikTok
   search already returns these fields; the YouTube outlier feed returns
   title, views, breakout score and length, and the rest is filled by one
   reading agent from the title and thumbnail.
3. **Filter.** Drop anything the fine print cannot cover: a real person's
   face we do not have rights to, a procedure, a claim about a person's
   rarity, a verdict word off the plain ladder, anything that needs a
   supplement or a bottle. The filter is the same rule set the product
   already has in `CLAUDE.md`, written once as a checklist the agent applies.
4. **Score.** Multiple of median (the outlier strength) times recency times
   reproducibility with our assets times the format's own win-rate from the
   table (1.0 until the table has data). Effort divides it.
5. **Cluster.** Rows with the same format template merge; a cluster with two
   or more outliers on one platform is a pattern, one alone is a lead. vidIQ's
   own guidance says the same: two before calling it a pattern.
6. **Recommend three.** One "copy the format", one "iterate on our own best
   post of the month", one "trend" (a velocity result or a sound). Each is
   written by one agent from a template that forces the evidence block, the
   beat script, the asset and the slot. A checker agent then reads all three
   against the filter and the copy rules (no em dashes, plain register
   outside Coach Max, no rarity about a person) and rejects a draft rather
   than fixing it silently.
7. **Deliver.** Gmail draft or Slack message, and a Notion page in the brief
   database with the three items as rows.
8. **Log and learn.** Section 1.5.

### 1.4 The schedule

A Claude Routine (`create_trigger`) that spawns a fresh session at 19:00 UTC,
which is 07:00 NZST, with the prompt "run the daily brief" and the connector
grant limited to vidIQ, Metricool, Higgsfield, Notion and Gmail. The session
invokes the saved workflow. Nothing runs in the app, nothing runs on Vercel,
and no vendor key is stored anywhere: the connectors are the credentials, and
they are held by the owner's Claude account. This is the reason the brief is
built here rather than as an n8n flow: vidIQ has no public API to call from
n8n, and the connectors already do the work.

The owner can also run it on demand by saying "run the brief" in any session
with those connectors attached.

### 1.5 The loop that learns

Copying what does well only compounds if the copy is checked. Two Notion
databases:

- **Briefs**: one row per recommendation with date, format template, hook,
  platform, slot, asset, and a "used" tick the owner sets (or the workflow
  sets when a Metricool post matches the caption).
- **Formats**: one row per format template with times recommended, times
  used, median multiple of our own posts that used it, and last seen in the
  outlier feed. The score in step 4 reads this table. A format that has
  been used three times and never beaten the account's median gets a 0.5
  weight; one that beat it twice gets 1.5. Simple, visible, editable by hand.

The yesterday block is what fills the second table. Metricool gives the views
and engagement for each post; the workflow matches the post to a brief row by
caption, computes the multiple against the account's trailing median, and
writes it back.

### 1.6 Production hooks, optional, later

- **Post for review.** A brief item can be pushed to Metricool as a
  scheduled post for review with the caption and slot filled in, so the
  owner only attaches the video. `createScheduledPostForReview` is already
  in the connector.
- **Sound pick.** For a TikTok direct post, the brief's three tracks come
  from the commercial library; the owner picks one and it goes into the
  publish call the app already has.
- **Predict before posting.** Upload the produced clip and run the virality
  predictor; the brief's next-day block records the prediction next to the
  outcome, which is how we find out whether the predictor is worth its
  credits.
- **Generate.** Only when a recommendation is an AI-actor before-and-after
  and nothing in the CTA series fits. Costs Higgsfield credits and needs the
  on-screen AI-generated tag per `AI_ACTOR_CONTENT_STRATEGY.md`.

None of these ship in the first version. The first version is the message.

### 1.7 When Sandcastles would be worth it

If, after a month, the format table shows that the pattern extraction from
vidIQ's fields plus one reading agent is too coarse (formats that should
split are merged, or hooks are mislabelled), a product whose whole job is
that layer earns a trial. The signal to watch is the checker agent's
rejection rate and the owner's own "this is not the format" edits in the
Formats table. Until then it is a second bill for a table we can keep.

### 1.8 Build order

| step | what | size |
|---|---|---|
| B1 | The skill (`.claude/skills/daily-brief/SKILL.md`: the checklist, the templates, the asset list) and the workflow script (`.claude/workflows/daily-brief.js`). Run once by hand; the owner reads the first brief and edits the templates. | M |
| B2 | The two Notion databases and the write-back at the end of the run. | S |
| B3 | The Routine at 07:00 NZST with the connector grant. Delivery to Gmail. | S |
| B4 | The yesterday block and the Formats write-back (section 1.5). | M |
| B5 | Post-for-review and sound pick (section 1.6). | S |

B1 is the deliverable that answers "is this useful". If the owner reads three
briefs and posts from none of them, stop at B1.

### 1.9 Definition of done

- A brief arrives at 07:00 NZST with three items, each carrying the
  evidence, the beat script, the asset, the slot and the caption.
- Nothing in a brief contradicts `CLAUDE.md`: no em dashes, no rarity
  about a person, no verdict word off the ladder, no real face without
  rights, no procedure, no bottle.
- vidIQ spend is printed in every brief and never exceeds the rotation.
- After two weeks the Formats table has at least one row with a measured
  multiple, and the score in step 4 reads it.

## 2. UI round U1: the four items beyond the sweep

These came out of building S1 and are not in the sweep's PR list. They are
one PR, after S6 and before S2, because three of the four touch files S1
already changed and the fourth belongs with S3's dashboard rows.

| item | what | where | acceptance | size |
|---|---|---|---|---|
| U1.1 | The chat composer becomes a growing textarea. One line to four, Enter sends, Shift+Enter breaks, the 600-character cap and the busy state stay. On a phone the keyboard no longer hides half a question. | `src/ui/maxChat.ts:123` (the `<input>`), `src/style.css` `.maxchat-composer` rules | A 300-character question shows entirely before it is sent; Enter still submits; `maxChat` tests pass; reduced motion unaffected | S |
| U1.2 | The region read stops typing itself out. `typewrite` is replaced on the region tabs by a fade-in of the finished paragraph, 200 ms, none under reduced motion. The greeting in the chat keeps its typing (it is speech; the read is a paragraph under a photograph). | `src/ui/results.ts:2332`, `src/ui/typewriter.ts:14` | Switching tabs shows the full read within one frame plus the fade; the `#tw` element still receives the text for existing tests; no other `typewrite` caller changes | S |
| U1.3 | Reopened chats name the scan they were about. The first message of a dashboard or post-analysis chat sends the scan date it was opened with; the server stores it on the conversation; the history row prints "Scan 14 Aug · Coach · 2 Sep". | `api/max-chat.ts` (store on first message), `api/max-conversations.ts:30,50` (select), a migration adding `scan_date date null` to the conversations table, `src/ui/maxChat.ts` (send it), `src/ui/maxTab.ts:260` (print it), `src/engine/maxConversations.ts:3` (the summary type) | A chat opened from S1's dashboard context lists with its scan date; old rows without one print as today; RLS unchanged because the column is on a row the owner already reads | S |
| U1.4 | Scans from before the current score version wear a small mark on the dashboard and in the Coach tab's own-scan pick. The mark reads "Earlier scoring" and its tooltip says such scans are not compared or read by Max. Rides in S3, which is already rebuilding the scan rows. | `src/ui/dashboard.ts:606`, `src/engine/history.ts:99` (`isCurrentScore`) | A row with `scoreVersion` below `CURRENT_SCORE_VERSION` shows the mark; the trend line and Max's context exclude it exactly as today | S |

Validation for U1 is the same four gates as every sweep PR, plus a phone
pass on the chat composer with the keyboard up, which is the case U1.1 exists
for.

## 3. Coordination with the plan Codex is writing

The owner is constructing a separate plan with Codex from a phone
run-through: the front capture's double countdown, the "Preparing analysis"
stall, the sticky report photograph on a phone, the clickable overall, front
and side on desktop, the side-placement loop with an AI second pass, the
consented photo-and-points send-through for calibration, and height and
weight at sign-up feeding a diet calculator. That plan is Codex's, and this
document does not duplicate it. Three things it should know from this side:

1. **#238 touches the same side-flow code.** The placement dialogs in
   `src/ui/sideFlow.ts` (the fine print on both questions, the review row
   under the dialogs, `confirmPlacement` now returning whether the scan went
   through) changed in S1. Any side-flow reordering should start from #238's
   head or from main after it merges, not from `26ac017`.
2. **How the side points are placed today, since the owner asked.** No
   AI reads the profile. The eight points on the face outline come from
   the MediaPipe face mesh where it is confident; the five behind the face
   (jaw corner, ear, hinge, neck) come from the segmentation silhouette plus
   a population template fitted to 56 labelled synthetic profiles, then the
   owner's own prior when the scan is the owner's. That is why those five
   drift and the other eight do not. A vision-model second pass on "No, they
   look off" is feasible and cheap at the point of refusal (one image, a
   request for thirteen named points as normalised coordinates, a plausibility
   check through the same `classifySidePlacement` the seed already passes
   through), and it changes the dialog order exactly as the owner describes.
   It also sends the photograph off the device, which the current flow never
   does before consent, so the consent question moves in front of the
   rescan rather than after it. The build plan's section 2.2 already
   designs the durable record that the calibration send-through needs.
3. **The report header on a phone** (sticky photograph, the FRONT arrow
   removed) lives in `src/ui/results.ts` near the region tabs, the same
   region U1.2 touches. U1.2 is a one-line swap and will rebase cleanly under
   a header rebuild; the header work should go first.

Height and weight and the diet calculator are task #147 in the standing list
(macro calculator, Max-crafted diet and workout) and `HEIGHT_WEIGHT_BMI_MAX_PLAN.md`
already scopes the sign-up question, the unit toggle and the paid gate.
Nothing of it is built. If Codex plans it, that document is the starting
point, and the Coach tab's plan renderer from M2 is where the calculator's
output lands.

## 4. The prompt for Codex

Paste as written.

```
You are reviewing and, where the owner asks, extending TrueMax (nikaur-prog/truemax).
Claude is building the following in parallel. Read this so you do not duplicate it and
so your own plan starts from the right base.

BUILT AND MERGED
- #230 Coach Max defect fixes (poke wears off, one loader drawing, sleep off-screen, no
  idle under 88 px, gaze wrapper).
- #232 docs/BUILD_PLAN_DETECTORS_CALIBRATION_AND_SWEEP.md, the plan for the detectors,
  the calibration loop and the sweep as PRs S1 to S6, M1 to M4, D1 to D3, C1 and C2.
- #237 D1 and D2: src/engine/softTissue.ts (lower-face width ratio, held out of the
  score, indicative flag, delta against the last scan) and src/engine/skinPatterns.ts
  (spots, redness, uneven tone, labelled trial, behind ?skin=1).

OPEN
- #238 S1 "Promises" on branch claude/truemax-v1-scaffold-exje8g: Coach tab chats built
  from the latest stored scan (src/engine/maxContext.ts contextFromStoredScan); the
  30-a-day chat allowance printed and shown under the composer with a reset time in the
  reader's clock (src/engine/maxAllowance.ts, api/max-chat.ts X-Max-Resets-At); the two
  "in every 100" sentences removed from src/ui/templates.ts with a source test; the side
  review row and rings no longer mounted under the placement dialogs and the section
  inert until a branch hands it back (src/ui/sideFlow.ts, confirmPlacement now returns
  boolean); both dialogs' fine print corrected; retakeFront in src/main.ts keeps the
  scan's answers. Please review it. Your prior review found a wrong line citation and an
  overclaim about mesh points 234/454; the same standard applies here.

NEXT, CLAUDE
- The daily brief: a scheduled Claude Routine that runs a saved workflow
  (.claude/workflows/daily-brief.js, .claude/skills/daily-brief/SKILL.md) using the vidIQ,
  Metricool, Higgsfield, Notion and Gmail connectors, and emails three content
  recommendations at 07:00 NZST with evidence, beat script, asset, slot and caption. It
  lives under .claude/ and touches no app code. Spec: docs/DAILY_BRIEF_AND_UI_ROUND_PLAN.md
  section 1.
- UI round U1, one PR after S6: chat composer as a growing textarea (src/ui/maxChat.ts);
  region read fades in instead of typing (src/ui/results.ts:2332); reopened chats name
  their scan (a scan_date column on the conversations table, sent on the first message,
  printed in src/ui/maxTab.ts); an "Earlier scoring" mark on pre-version scan rows (rides
  in S3). Spec: section 2 of the same document.
- Then S6, S2, S3, S4, S5, M1 to M4, C1, C2 in the build plan's order.

YOURS, PER THE OWNER
- The phone run-through plan: front capture double countdown, "Preparing analysis"
  stall, sticky report photograph and the FRONT arrow on a phone, clickable overall,
  front and side on desktop, the side-placement AI second pass and the consented
  photo-and-points send-through, height and weight at sign-up and the diet calculator.
  Start from main after #238 merges (or from its head) because it changed
  src/ui/sideFlow.ts around the placement dialogs and src/main.ts around the front
  retake. docs/BUILD_PLAN_DETECTORS_CALIBRATION_AND_SWEEP.md section 2.2 already
  designs the durable calibration record; docs/HEIGHT_WEIGHT_BMI_MAX_PLAN.md scopes the
  sign-up question and the paid gate. Extend those rather than writing second versions.

STANDING RULES (CLAUDE.md, not negotiable)
- No em dashes in user-facing copy. node scripts/emdash.mjs must pass.
- Only Coach Max's read is coach-toned; every other surface is plain.
- A rarity is never stated about a person. The scale note's ladder is the one exception.
- The verdict ladder is fixed and no verdict word names a real person.
- Ethnicity is never inferred from a photograph.
- No cross-user data from any endpoint except the league leaderboard RPC.
- The repo is public: no real-face photographs outside the listed exceptions.
- Secrets stay in Vercel environment variables. Never a model identifier in any pushed
  artifact.
- Validate before pushing: npx tsc --noEmit, npm test, npm run build, node
  scripts/emdash.mjs.
- One PR per cycle, squash-merged, dev branch reset from origin/main.

WHAT TO SEND BACK
- Review comments on #238 as a GitHub review, file and line, with the failure case.
- Your plan for the run-through items as a document under docs/, with file and line
  citations that resolve on the base you name, and a list of any file both plans touch.
```
