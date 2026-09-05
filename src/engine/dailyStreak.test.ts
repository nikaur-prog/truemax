import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONSISTENCY_POINTS_PER_DAY,
  EMPTY_STREAK,
  GRACE_MAX,
  STREAK_MULTIPLIER_CAP,
  STREAK_TIERS,
  STREAK_WEEK_BONUS,
  bestLine,
  consistencyAward,
  dayAccepted,
  dayDiff,
  dayLabel,
  glowFor,
  isDayString,
  localDay,
  multiplierFor,
  nextStreak,
  readStreak,
  streakLine,
} from "./dailyStreak.js";
import type { StreakState } from "./dailyStreak.js";

const migration = readFileSync(new URL("../../supabase/migrations/20260904090000_daily_streak_and_points.sql", import.meta.url), "utf8");

function run(days: string[], start: StreakState = EMPTY_STREAK): StreakState {
  let state = start;
  for (const d of days) state = nextStreak(state, d).state;
  return state;
}

/** The calendar from a start, n days long. */
function calendar(from: string, n: number): string[] {
  const out: string[] = [];
  const t0 = Date.parse(`${from}T00:00:00Z`);
  for (let i = 0; i < n; i++) out.push(new Date(t0 + i * 86400000).toISOString().slice(0, 10));
  return out;
}

test("the tier table is ascending, starts at one day and caps at 1.5x", () => {
  for (let i = 1; i < STREAK_TIERS.length; i++) {
    assert.ok(STREAK_TIERS[i].from > STREAK_TIERS[i - 1].from);
    assert.ok(STREAK_TIERS[i].multiplier > STREAK_TIERS[i - 1].multiplier);
  }
  assert.equal(STREAK_TIERS[0].from, 1);
  assert.equal(STREAK_TIERS[STREAK_TIERS.length - 1].multiplier, STREAK_MULTIPLIER_CAP);
  assert.equal(multiplierFor(0), 1);
  assert.equal(multiplierFor(6), 1);
  assert.equal(multiplierFor(7), 1.1);
  assert.equal(multiplierFor(29), 1.2);
  assert.equal(multiplierFor(30), 1.35);
  assert.equal(multiplierFor(60), 1.5);
  assert.equal(multiplierFor(400), 1.5);
});

test("the SQL multiplier carries the same thresholds as the engine", () => {
  const rows = [...migration.matchAll(/when p_days >= (\d+) then (\d\.\d+)/g)].map((m) => ({ from: Number(m[1]), multiplier: Number(m[2]) }));
  const engine = STREAK_TIERS.filter((t) => t.multiplier > 1).map((t) => ({ from: t.from, multiplier: t.multiplier })).reverse();
  assert.deepEqual(rows, engine);
  assert.match(migration, /multiplier between 1\.00 and 1\.50/);
});

test("the glow is off at zero and brightens by tier; the person only ever sees the day count", () => {
  assert.equal(glowFor(0), "off");
  assert.equal(glowFor(1), "faint");
  assert.equal(glowFor(13), "steady");
  assert.equal(glowFor(14), "bright");
  assert.equal(glowFor(45), "bloom");
  assert.equal(glowFor(60), "full");
  assert.equal(dayLabel(1), "1 day");
  assert.equal(dayLabel(12), "12 days");
  assert.equal(bestLine(41), "Best: 41 days");
});

test("a first action starts the run at one and the same day counts once", () => {
  const first = nextStreak(EMPTY_STREAK, "2026-09-04");
  assert.equal(first.counted, true);
  assert.equal(first.state.current, 1);
  assert.equal(first.state.best, 1);
  const again = nextStreak(first.state, "2026-09-04");
  assert.equal(again.counted, false);
  assert.equal(again.state.current, 1);
  const earlier = nextStreak(first.state, "2026-09-03");
  assert.equal(earlier.counted, false);
});

test("seven consecutive days bank one grace day, held to two", () => {
  const week = run(calendar("2026-09-01", 7));
  assert.equal(week.current, 7);
  assert.equal(week.graceBanked, 1);
  const two = run(calendar("2026-09-01", 14));
  assert.equal(two.graceBanked, 2);
  const three = run(calendar("2026-09-01", 21));
  assert.equal(three.graceBanked, GRACE_MAX);
});

test("a missed day spends a grace day and the run continues", () => {
  const week = run(calendar("2026-09-01", 7));
  const skipped = nextStreak(week, "2026-09-09");
  assert.equal(skipped.counted, true);
  assert.equal(skipped.ended, false);
  assert.equal(skipped.state.current, 8);
  assert.equal(skipped.state.graceBanked, 0);
});

test("with no grace to spend the run ends, a new one starts at one, and the best is kept", () => {
  const five = run(calendar("2026-09-01", 5));
  assert.equal(five.graceBanked, 0);
  const after = nextStreak(five, "2026-09-07");
  assert.equal(after.counted, true);
  assert.equal(after.ended, true);
  assert.equal(after.state.current, 1);
  assert.equal(after.state.best, 5);
});

test("two missed days need two banked grace days", () => {
  const twoWeeks = run(calendar("2026-09-01", 14));
  assert.equal(twoWeeks.graceBanked, 2);
  const step = nextStreak(twoWeeks, "2026-09-17");
  assert.equal(step.ended, false);
  assert.equal(step.state.current, 15);
  assert.equal(step.state.graceBanked, 0);
  const week = run(calendar("2026-09-01", 7));
  const tooMany = nextStreak(week, "2026-09-10");
  assert.equal(tooMany.ended, true);
  assert.equal(tooMany.state.current, 1);
});

test("the reading applies the gap before the next action, so a lapsed run shows zero and its best", () => {
  const five = run(calendar("2026-09-01", 5));
  assert.equal(readStreak(five, "2026-09-05").days, 5);
  assert.equal(readStreak(five, "2026-09-05").countedToday, true);
  assert.equal(readStreak(five, "2026-09-06").days, 5);
  assert.equal(readStreak(five, "2026-09-06").countedToday, false);
  const lapsed = readStreak(five, "2026-09-07");
  assert.equal(lapsed.days, 0);
  assert.equal(lapsed.lapsed, true);
  assert.equal(lapsed.best, 5);
  assert.equal(lapsed.glow, "off");
  const week = run(calendar("2026-09-01", 7));
  assert.equal(readStreak(week, "2026-09-09").days, 7, "one grace day covers one missed day");
  assert.equal(readStreak(week, "2026-09-10").days, 0);
});

test("the week that lands earns its bonus at the tier it reached", () => {
  const six = run(calendar("2026-09-01", 6));
  const seventh = nextStreak(six, "2026-09-07");
  assert.equal(seventh.weekLanded, true);
  assert.equal(consistencyAward(seventh.state.current, CONSISTENCY_POINTS_PER_DAY), Math.round(CONSISTENCY_POINTS_PER_DAY * 1.1));
  assert.equal(consistencyAward(7, STREAK_WEEK_BONUS), 11);
  assert.equal(consistencyAward(60, 10), 15);
});

test("day strings are real calendar days and the server window is one day either side of UTC", () => {
  assert.equal(isDayString("2026-09-04"), true);
  assert.equal(isDayString("2026-02-30"), false);
  assert.equal(isDayString("2026-9-4"), false);
  assert.equal(dayDiff("2026-09-01", "2026-09-04"), 3);
  const now = new Date("2026-09-04T12:00:00Z");
  assert.equal(dayAccepted("2026-09-04", now), true);
  assert.equal(dayAccepted("2026-09-05", now), true);
  assert.equal(dayAccepted("2026-09-03", now), true);
  assert.equal(dayAccepted("2026-09-06", now), false);
  assert.equal(dayAccepted("2026-09-02", now), false);
  assert.match(localDay(new Date(2026, 8, 4, 23, 30)), /^2026-09-04$/);
});

test("the copy names what was kept and never what went", () => {
  const source = readFileSync(new URL("./dailyStreak.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\blose\b|\blost\b|\bbroke|\bbreak\b|don't miss|\bfire\b|\bflame|\bhot\b/i);
  assert.doesNotMatch(source, /—/);
  const lapsed = readStreak(run(calendar("2026-09-01", 3)), "2026-09-09");
  assert.equal(streakLine(lapsed), "Nothing counted yet today. Tick a routine, or scan.");
  assert.equal(streakLine(readStreak(run(["2026-09-09"]), "2026-09-09")), "Today is counted.");
});
