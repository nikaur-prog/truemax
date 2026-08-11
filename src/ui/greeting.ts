import type { Streak } from "../engine/streak.ts";

// ---------------------------------------------------------------------------
// The dashboard's headline and its line underneath.
//
// Both rotate, but not randomly-for-the-sake-of-it: the pool is filtered by what
// is actually true right now, so a streak line only appears when there is a
// streak and a "welcome back" only when there is something to come back to.
// A greeting that congratulates a run you do not have is worse than no greeting.
//
// Rotation is seeded by the day, not by Math.random(), so the page does not
// reshuffle its own headline every time you navigate back to it within a
// session. It changes when the day changes, which is the rate a person would
// call "sometimes different" rather than "flickering".
// ---------------------------------------------------------------------------

export interface GreetingCtx {
  name: string | null;
  streak: Streak;
}

function pick<T>(pool: T[], salt: number): T {
  const day = Math.floor(Date.now() / 86400000);
  return pool[(day + salt) % pool.length];
}

export function headline(ctx: GreetingCtx): string {
  const { name, streak } = ctx;
  const who = name ? `, ${name}` : "";
  const pool: string[] = [];

  if (streak.alive && streak.weeks >= 4) {
    pool.push(`${streak.weeks} weeks straight${who}.`);
    pool.push(`You have been on a roll${who}.`);
    pool.push(`Still going${who}.`);
  } else if (streak.alive && streak.weeks >= 2) {
    pool.push(`${streak.weeks} weeks running${who}.`);
    pool.push(`Hitting your goals${who}?`);
    pool.push(`Welcome back${who}.`);
  } else if (streak.total > 0) {
    pool.push(`Welcome back${who}.`);
    pool.push(`Good to see you${who}.`);
    pool.push(`Hitting your goals${who}?`);
  } else {
    pool.push(name ? `Welcome, ${name}.` : "Welcome.");
    pool.push("Let's get your first scan.");
  }
  return pick(pool, 0);
}

export function subline(ctx: GreetingCtx): string {
  const { streak } = ctx;

  // When there is something concrete and useful to say, say that instead of a
  // sentiment. A person owed a scan this week wants to know it.
  if (streak.alive && streak.weeks >= 1 && !streak.scannedThisWeek && streak.daysLeft != null) {
    return streak.daysLeft <= 2
      ? `${streak.daysLeft} day${streak.daysLeft === 1 ? "" : "s"} left to keep your ${streak.weeks}-week streak.`
      : `Scan this week to keep your ${streak.weeks}-week streak going.`;
  }
  if (streak.scannedThisWeek && streak.weeks >= 2) {
    return `This week is in. ${streak.weeks} weeks without missing one.`;
  }

  return pick(
    [
      "Measure your face, watch it over time, and see exactly where you land.",
      "The number moves slowly. That is what makes a move worth reading.",
      "Two photos of the same face differ by about 1.3 points, so watch the trend, not the reading.",
      "Bone structure is the part you cannot change. Nearly everything else, you can.",
      "Measured, not guessed. Every number here comes with the maths behind it.",
      "Consistency beats intensity. One scan a week for a year beats seven this month.",
    ],
    1,
  );
}
