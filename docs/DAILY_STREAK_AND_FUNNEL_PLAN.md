# Daily streak, points, the funnel, and the home screen: plan of record

Written 3 September 2026 from the owner's asks and the discussion around
them. Section 9 records what has shipped. The owner reads this, changes what needs
changing, and then the build order in section 7 runs.

## 1. What was asked, and the three changes made to it

The owner's ask: a daily streak shown as a green light that gets brighter
the more days a person keeps it, with a points booster for holding it. Not
flames.

Three changes, each with its reason, each overridable:

1. **A day counts on a plan action, not on opening the app.** A login
   streak pays for opening an app about your face every day, which is the
   one habit this product should not manufacture, and it pays for nothing
   that moves a number. So the day is counted by the smallest real action:
   ticking a routine you are running, a protocol check-in, or a scan.
   Opening the app still shows the light and says the one thing that would
   count today.
2. **The multiplier touches consistency points only, and is capped.** The
   Goal preview plan keeps two ledgers apart: consistency and verified
   progress. Multiplying verified progress would pay a long-streak holder
   more for the same measured change and empty the progress ledger of
   meaning. The cap keeps a 200-day holder from out-earning everyone at
   everything.
3. **One banked grace day, two at most.** A streak that zeroes on a single
   miss is where the compulsion lives.

## 2. What exists

| thing | where | what it says |
|---|---|---|
| A weekly scan streak | `src/engine/streak.ts`, chip in `src/ui/dashboard.ts`, line in `src/ui/greeting.ts` | Deliberately weekly: "a daily streak would be rewarding people for collecting noise". That reasoning is about scans and stays true. The daily streak counts actions, not scans, so the two coexist. |
| Protocols with check-ins | `src/engine/protocol.ts`, `src/ui/protocolCard.ts` | Check-ins are at least six days apart. There is no daily action in the product today; section 3 adds one. |
| No points anywhere | | `CONSISTENCY_POINTS_PER_WEEK` and `VERIFIED_PROGRESS_POINTS` are constants in the catalogue; no ledger, no table. |
| The funnel counter | `api/_events.ts`, `src/engine/funnelEvents.ts`, `funnel_events` migrations | Counts only, no identity, an allowlist of names. Twenty-five events from `visit` to `checkout-started`. Nothing reads it back except a staff probe. |
| A web app manifest | `public/site.webmanifest` | `display: standalone`, icons present. No install prompt anywhere. |
| The one age rule | `src/engine/age.ts`, `api/_maxAccess.ts` | Unknown age behaves as a minor. |

## 3. The daily streak

### 3a. The day

A calendar day in the person's local time. The client sends the day it
counted (`YYYY-MM-DD`); the server accepts it only within one day of its own
UTC date, so a clock cannot be walked forward. The row stores the day
string, never a timestamp with a timezone to argue about.

### 3b. What counts

One of these, once per day, on the person's own account (a guest scan never
counts, as with everything else a guest does):

- **A routine ticked.** New. Every running protocol gets one tap a day, "Did
  it today", on its card. This is the daily action the product lacks, and
  the ledger of ticks is also what lets the protocol's judge day read
  adherence from the record instead of a memory.
- **A protocol check-in** answered.
- **A scan** taken.

Opening the app counts nothing. The light shows, the day count shows, and
under it one line: "Nothing counted yet today. Tick a routine, or scan."

### 3c. Grace

Every seven consecutive counted days bank one grace day, held to a maximum
of two. A missed day spends one automatically and the run continues. With
none to spend, the run ends: the light goes out, the count returns to zero,
the best run is kept and shown once as "Best: 41 days" and never as a loss.
No copy anywhere says lose, break, or don't miss.

### 3d. The light

Green, one lamp, brighter with the run. Tiers exist for the CSS and for the
multiplier; the person sees only the day count.

| days | glow | multiplier |
|---|---|---|
| 1 to 6 | faint | 1.0x |
| 7 to 13 | steady | 1.1x |
| 14 to 29 | bright | 1.2x |
| 30 to 59 | brighter, soft bloom | 1.35x |
| 60 and up | full | 1.5x, the cap |

The label is the number: "12 days". No tier names on screen. No flames, no
fire, no "hot".

### 3e. Points

Two ledgers on the server, so they survive a device and cannot be typed
into a browser console:

- **Consistency**, earned by counted days (a base amount per counted day,
  the week bonus from the catalogue when seven land), multiplied by the
  streak tier at the moment of the award. This is the only ledger the
  multiplier touches.
- **Verified progress**, earned once per goal when the catalogue's
  completion rule is met by the follow-up read, never by a scan alone,
  never multiplied, never scaled by the size of a change.

Every award is an append-only event keyed on (user, reason, day), so a day
is counted once however many devices tap it. Balances are the sum.

### 3f. Minors and opt-out

Under 18 sees the same light and earns the same consistency points; there
is nothing in the mechanic that changes with age except that
body-composition goals do not exist for them, as already decided. The
streak has an off switch in Settings for anyone who finds it a pressure,
and turning it off hides the light and the points without deleting the
record. No push notification is tied to the streak in this cycle.

## 4. The pieces, and who builds them

**Claude, server and engine:**

- Migration `daily_streak` (user, current, best, last counted day, grace
  banked) and `points_balances` plus `points_events` (append-only, RLS
  read-own, service-only writes), with RPCs `count_streak_day(user, day,
  reason)` that is idempotent per day, spends grace, updates the run and
  returns the new state, and `award_consistency(user, reason, day, base)`
  that reads the tier and writes the multiplied event in one statement.
- `POST /api/streak` (origin, sign-in, the day check, the RPCs; returns
  state and the award) and `GET /api/streak`.
- `src/engine/dailyStreak.ts`: the tier table, the multiplier, the glow
  class from a count, the local day string, grace arithmetic mirrored for
  an optimistic render, the "nothing counted yet" line. Pure, tested.
- The routine tick on the protocol record (`ticks: string[]` of day
  strings) and the read that turns ticks into adherence for the judge.

**Codex, front end:**

- The lamp in the dashboard hero beside the weekly chip, the day count, the
  "nothing counted yet today" line, the points line.
- "Did it today" on running protocol cards, wired to the tick and to
  `POST /api/streak`.
- The Settings switch.
- The install prompt and the iOS sheet in section 6.

## 5. The funnel, so the next decision is read from a number

The counter exists and nobody reads it. Two additions and a reader.

**Events to add** (`src/engine/funnelEvents.ts`, called from the flow):

- `signup-return-analysis`: a guest who signed up at the wall landed on
  their analysis.
- `signup-return-lost`: the same person landed anywhere else. The pair is
  the guest-recovery bug as a number, before and after the hotfix.
- `install-prompt-shown`, `install-accepted`, `launch-standalone` (the app
  opened from a home screen icon, read from `display-mode: standalone`).
- `streak-day-counted` and `streak-ended`, so the streak's effect on
  return visits can be read.

**The reader:** `GET /api/funnel-report`, staff only, returning the last
fourteen days per event, and `scripts/funnel-report.ts` printing the chain
visit, scan-front-done, scan-side-done, results-shown, account-created,
checkout-started with each step's share of the one before. The number the
owner reads every morning is the step with the biggest drop.

## 6. Home screen first, the store after

The manifest already declares standalone. What is missing is the ask.

- On Chrome and Android: capture `beforeinstallprompt`, and after a signed-in
  person's `results-shown`, offer it once: "Add TrueMax to your home screen
  to keep your streak and rescan in a tap." Count shown and accepted.
- On iOS Safari, where no prompt exists: one dismissible sheet at the same
  moment showing Share, then Add to Home Screen. Count shown.
- Read `launch-standalone` for thirty days against return visits.

The store decision is reviewed after those thirty days, against its costs,
which are not small for this product: Apple's in-app purchase requirement
and cut on digital subscriptions, which means a second billing path beside
Stripe reconciling into one entitlements table; review risk on an
appearance-scoring product with an AI face render and minors in the
audience; and a native capture flow. If home screen installs do not lift
the return rate, the store would not have either.

## 7. Build order

1. Codex's production hotfix PR first, as already planned: guest scan
   recovery, the leave guard on signup, the countdown, the sticky mobile
   report. The streak is pointless while a phone user cannot reach their
   analysis.
2. Claude: the funnel events, the report endpoint and script, so the
   hotfix's effect is read from the pair in section 5.
3. Claude: the streak and points migration, RPCs, endpoints, engine, the
   routine tick on the protocol record.
4. Codex: the lamp, the daily tick, the points line, the Settings switch,
   the install prompt and the iOS sheet.
5. Thirty days of numbers, then the store decision.

## 8. The rules that bind every part

- A day is counted by an action, never by a visit.
- The multiplier touches consistency points only, capped at 1.5x.
- Verified progress is never multiplied and never scaled by the size of a
  change.
- A guest scan counts for nothing.
- No loss framing anywhere: no lose, break, or don't miss.
- The streak can be switched off and the record survives the switch.
- Points live on the server and move only through service-role functions.
- The funnel counts and never identifies.
- No em dashes in user-facing copy.

## 9. What shipped, and what is left

Built 4 September 2026, Claude's share of sections 3, 4 and 5. The three
changes in section 1 stood.

**Server and engine, shipped:**

- `supabase/migrations/20260904090000_daily_streak_and_points.sql`:
  `daily_streaks` (current, best, last counted day, grace banked, the
  Settings switch), `points_events` (append-only; nobody holds update or
  delete, the service role included), the `points_balances` view, and the
  functions `streak_multiplier`, `count_streak_day`, `award_consistency` and
  `award_progress`, all service-only. Apply it in the SQL editor before the
  route is used.
- `api/streak.ts`: GET (row, today's reading, both balances), POST (count a
  day; the day must be within one day of the server's UTC date; the count
  and the awards are one database transaction inside `count_streak_day`,
  paying only when the day was newly counted; funnel bumps for
  `streak-day-counted` and `streak-ended`), PATCH (the Settings switch).
- Verified progress pays once per goal, ever: a partial unique index on
  (user, reason) where the ledger is progress, with the goal id as the
  reason.
- The funnel chain's side stage is two branches, side done or side skipped,
  so a front-only completion (PR #257) is a person who went on, not a
  drop-off.
- `src/engine/dailyStreak.ts`: the tier table the SQL is tested against,
  the multiplier and glow from a count, the local day string, the same grace
  arithmetic as the function for an optimistic render (`nextStreak`), the
  reading that applies a gap before the next action (`readStreak`), the
  copy, and `fetchStreak`, `countStreakDay`, `setStreakEnabled`.
- The routine tick on the protocol record: `Protocol.ticks`, `tickProtocol`,
  `tickedOn`, `adherenceFromTicks`, and the judge reads the record before
  the check-in answers.
- The funnel: seven new event names, `src/engine/funnelReport.ts`, the
  staff-only `GET /api/funnel-report` (404 to everyone else), and
  `scripts/funnel-report.ts`, which prints the chain and the biggest drop
  from the service credentials. `src/engine/standalone.ts` reads a
  home-screen launch.

**Front end, Codex (section 4):**

- The lamp beside the weekly chip: `glowFor(reading.days)` is the CSS class,
  `dayLabel(reading.days)` the label, `streakLine(reading)` the line under
  it, `bestLine(reading.best)` shown once when `reading.lapsed`.
- "Did it today" on running protocol cards: `tickProtocol(p, localDay())`,
  write the protocols, then `countStreakDay(token, "routine")`. A check-in
  answered calls it with `"checkin"`, a scan on the person's own account
  with `"scan"`. Never for a guest scan.
- The points line from `snapshot.balances`.
- The Settings switch through `setStreakEnabled`. Off hides the lamp and
  the points; the record keeps counting.
- The install prompt and the iOS sheet, with `track("install-prompt-shown")`,
  `track("install-accepted")`, and `track("launch-standalone")` on load when
  `isStandaloneLaunch()`.
- `track("signup-return-analysis")` or `track("signup-return-lost")` where a
  guest who signed up at the wall lands.
