# Calibration photos

Drop photos here for me to measure against. **The images themselves are
gitignored and must stay that way** — see the note at the bottom.

## Set A — reliability (`calib/front/`)

6 to 20 photographs of ONE person, all taken in a single sitting, with no real
change in between. The point is to vary the capture, not the face:

- different rooms and light sources — window, overhead, lamp, a couple with flash
- arm's length, then a bit further back
- small head-angle differences, the kind you would not notice yourself
- neutral expression every time, glasses and hats off

**What it settles.** The app currently says two photos of one face differ by
about 1.3 points. That figure comes from celebrity photographs spanning years of
real ageing, so some of that spread is genuine change and 1.3 is an *upper
bound* on capture noise. One person in one sitting has no real change in it at
all, so the spread across this set is pure measurement noise. If it comes in
lower — and it should — the rescan bands tighten and the app stops calling real
progress "noise".

## Set B — side profiles (`calib/side/`)

As many as you can manage, ~10 is plenty. This is the set that fixes the seed.

- full profile (one ear square to the lens), three-quarter, and a couple caught
  mid-turn
- plain wall, busy room, and at least one with a window or bright light behind
- include whatever framing has been going wrong

**What it settles.** Right now the thirteen points are checked against anatomy
that has to hold — nose ahead of ear, chin below mouth — which catches gross
failures and nothing subtle. With real profiles I can hand-label the true points
once and then measure the seed's error as a fraction of face height, per point.
That turns "the dots look off" into a number that either goes down or does not.

## File names

Anything readable. `front-01.jpg`, `side-window-03.jpg`. If a photo is a case
that broke, say so in the name — `side-BROKEN-hood.jpg` — and it goes straight
into the regression set.

## Why the images are gitignored

`.gitignore` excludes everything in here except this file. Face photographs in a
git repository are permanent: they survive branch deletion, they sit in every
clone, and they are one repo-visibility change away from being public. The whole
product promises that photos never leave the device, and committing a folder of
faces to prove the maths would be a strange way to keep that promise.

If a photo needs to travel, send the file directly rather than committing it.
