import type { Streak } from "../engine/streak.ts";
import { QUOTES } from "./quotes.ts";

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

// A counter that advances once per visit to the dashboard, so coming back gives
// you a different headline and a different quote rather than the same pair all
// day. Kept in sessionStorage so it survives a reload without persisting
// forever, and read once per open rather than per render — otherwise the two
// lines would land out of step with each other.
let visit = 0;
export function nextVisit(): void {
  try {
    const n = Number(sessionStorage.getItem("truemax:visit") ?? "0") + 1;
    sessionStorage.setItem("truemax:visit", String(n));
    visit = n;
  } catch {
    visit++;
  }
}

function pick<T>(pool: T[], salt: number): T {
  // The salt differs per slot so the headline and the quote do not advance in
  // lockstep and pair up identically every cycle.
  return pool[(visit * 7 + salt) % pool.length];
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

  // Otherwise alternate between what the product does and something worth
  // reading. The quotes carry their attribution because an unattributed quote
  // is a wall poster, and because half the famous ones are misattributed.
  const own = [
    "Measure your face, watch it over time, and see exactly where you land.",
    "The number moves slowly. That is what makes a move worth reading.",
    "Two photos of the same face differ by about 1.3 points, so watch the trend, not the reading.",
    "Bone structure is the part you cannot change. Nearly everything else, you can.",
    "Measured, not guessed. Every number here comes with the maths behind it.",
    "Consistency beats intensity. One scan a week for a year beats seven this month.",
  ];
  if (visit % 2 === 0) return pick(own, 1);
  const q = pick(QUOTES, 3);
  return `“${q.text}” — ${q.who}`;
}
