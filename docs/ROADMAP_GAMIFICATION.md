# Parked roadmap: gamification, social, and the long game

Owner's ideas, recorded so they are not lost. Nothing in this file is being
built yet. The order of operations the owner set: **get the product right
first, then the gamification layer, then the social layer.** These are months
out, on purpose.

## The thesis

The retention engine is plans and goals with visible progress. You establish
goals, the app builds the way to complete them, and completing them — or even
making honest progress toward them — earns rewards. The product becomes
"almost like another social media app, but dedicated purely to
self-improvement." Max and the goals system get wired together tightly enough
that the coach, the plan, and the rewards all speak with one voice.

## Layer 1: the persistent plan and graduation (first slice of gamification)

- The Plan tab shows the CURRENT plan when one exists. Goals barely change
  week to week; the product is consistency, not novelty. Fresh suggestions
  only for new users, after a visible drastic change, or after a sustained
  measured trend on the metrics behind the goal.
- **Graduation**: when a goal's metrics have not just improved but held ideal
  long enough that it is no longer a goal, the goal graduates — confetti,
  congratulations, and it leaves the plan. Validation bar: at least three
  weeks of measurements sitting in the ideal range. Requires a compact
  per-metric reading log (history today stores region scores only).

## Layer 2: the validator suite (its own tab, gamified)

- For someone who believes they have hit a facial goal: Max "takes them to
  the room" — a staged in-app environment (background change, serious tone;
  pure theatre, deliberately). They take a set of photos at prescribed
  angles, and the scanner judges whether a real change was made.
- Change confirmed: confetti congratulations, points, rewards into the level
  system. (Once social exists: the level-up is visible to others.)
- No change found: Max says so straight, but eggs them on — progress is being
  made, keep going. Never a shrug, never a lie.

## Layer 3: points, evidence, and the diary

- Points and rewards for completing goals AND for honest progress toward
  them.
- **Photo evidence** as both proof and motivator: photo of the product they
  bought, meals they cooked, the gym they showed up to. Evidence validates
  adherence to Max (the check-in ladder stops depending purely on
  self-report, which people game "because it feels good to say yes"), and
  earns points.
- **Personal diary / progress tracker tab**: the evidence photos plus Max's
  constructed notes and the person's own notes, per day or week, to look back
  on. Optional sharing of individual photos once social exists — proving it
  to yourself first, to Max second, to others last and only by choice.
- Owner's read: this may be the most addictive part of the app — visible
  progress plus the points and level system. Also flagged by the owner as a
  big, complex build that needs in-depth planning before a line is written.

## Layer 4: social

- Sharing, visible level-ups, social proof around real progress. Everything
  above feeds it; none of it depends on it.

## Later still: full-body analysis

- Full-body analysis as a product surface, restricted to 18+ only.

## Standing constraints that survive into every layer

- No cross-user data leakage; evidence photos and diary stay local/private
  until the person explicitly shares a specific item.
- Rewards must never pay for dishonesty: points for evidence, not for
  self-report; the validator says "no change" when there is no change.
- All existing measurement-honesty rules (no unsupported rarity claims, no
  unreliable metrics surfaced) apply unchanged to validator verdicts.
