import { CONSISTENCY_POINTS_PER_WEEK } from "./goalCatalogue.js";

// ---------------------------------------------------------------------------
// The daily streak, on the device side.
//
// The record of truth is the daily_streaks row and the count_streak_day
// function in the database; this module is the same arithmetic in
// TypeScript so a card can render the next state the instant a routine is
// ticked, before the server answers, and so the tier table has one home the
// SQL is tested against.
//
// What the mechanic is, in one paragraph. A day is counted by an action (a
// routine ticked, a check-in answered, a scan taken), never by opening the
// app. Consecutive counted days make a run. Every seven of them bank one
// grace day, two at most; a missed day spends one and the run continues.
// With none to spend the run ends: the light goes out, the count returns to
// zero, and the best run is kept and shown once. The light is one green
// lamp that gets brighter with the run; the person sees the day count and
// nothing else. The multiplier touches consistency points only and is
// capped at 1.5x.
//
// Copy rule: no loss framing anywhere in this module. A run that has ended
// is described by what was kept, never by what went.
// ---------------------------------------------------------------------------

export type StreakGlow = "off" | "faint" | "steady" | "bright" | "bloom" | "full";

export interface StreakTier {
  /** First day count in the tier. */
  from: number;
  glow: Exclude<StreakGlow, "off">;
  multiplier: number;
}

/** Ascending. The SQL function streak_multiplier carries the same numbers. */
export const STREAK_TIERS: readonly StreakTier[] = [
  { from: 1, glow: "faint", multiplier: 1.0 },
  { from: 7, glow: "steady", multiplier: 1.1 },
  { from: 14, glow: "bright", multiplier: 1.2 },
  { from: 30, glow: "bloom", multiplier: 1.35 },
  { from: 60, glow: "full", multiplier: 1.5 },
];

export const STREAK_MULTIPLIER_CAP = 1.5;
export const GRACE_MAX = 2;
export const GRACE_EVERY_DAYS = 7;

/** Base consistency points for one counted day, before the multiplier. */
export const CONSISTENCY_POINTS_PER_DAY = 2;
/** The bonus when seven consecutive days land, from the catalogue's tier-1 week. */
export const STREAK_WEEK_BONUS = CONSISTENCY_POINTS_PER_WEEK[1];

export type StreakReason = "routine" | "checkin" | "scan";
export const STREAK_REASONS: readonly StreakReason[] = ["routine", "checkin", "scan"];

/** What the server holds. Mirrors the daily_streaks row. */
export interface StreakState {
  current: number;
  best: number;
  /** YYYY-MM-DD, or null before the first counted day. */
  lastCountedDay: string | null;
  graceBanked: number;
  /**
   * The counted day on which banked grace covered a gap, or null.
   *
   * Kept so the mechanic can explain itself once, on the day it acted. Grace
   * used to be silent, which meant nobody knew it existed until a run ended
   * without one and the ending read as arbitrary.
   */
  graceSpentOn: string | null;
  enabled: boolean;
}

export const EMPTY_STREAK: StreakState = { current: 0, best: 0, lastCountedDay: null, graceBanked: 0, graceSpentOn: null, enabled: true };

function tierFor(days: number): StreakTier | null {
  let tier: StreakTier | null = null;
  for (const t of STREAK_TIERS) if (days >= t.from) tier = t;
  return tier;
}

export function multiplierFor(days: number): number {
  return Math.min(STREAK_MULTIPLIER_CAP, tierFor(Math.max(0, Math.floor(days)))?.multiplier ?? 1);
}

export function glowFor(days: number): StreakGlow {
  return tierFor(Math.max(0, Math.floor(days)))?.glow ?? "off";
}

/** Points for one award at a given run length. Same rounding as the SQL. */
export function consistencyAward(days: number, base: number): number {
  return Math.round(base * multiplierFor(days));
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day where the person is, as the server expects it. */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isDayString(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** Whole days from a to b, on the calendar, sign included. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * The server accepts a day only within one day of its own UTC date, so a
 * clock cannot be walked forward. One day either side covers every time
 * zone on earth at every hour.
 */
export function dayAccepted(day: string, now: Date = new Date()): boolean {
  if (!isDayString(day)) return false;
  const utcToday = now.toISOString().slice(0, 10);
  return Math.abs(dayDiff(utcToday, day)) <= 1;
}

export interface StreakStep {
  state: StreakState;
  counted: boolean;
  /** Banked days spent covering the gap, so the lamp can say grace acted. */
  graceSpent: number;
  /** A previous run ended on this action and a new one began at one. */
  ended: boolean;
  /** The count reached a multiple of seven on this action. */
  weekLanded: boolean;
}

/** The same rule as count_streak_day, for the optimistic render. */
export function nextStreak(state: StreakState, day: string): StreakStep {
  const s = { ...state };
  let counted = false;
  let ended = false;
  let graceSpent = 0;
  if (s.lastCountedDay === null) {
    s.current = 1;
    counted = true;
  } else if (dayDiff(s.lastCountedDay, day) > 0) {
    const missed = dayDiff(s.lastCountedDay, day) - 1;
    if (missed <= s.graceBanked) {
      graceSpent = missed;
      s.graceBanked -= missed;
      s.current += 1;
    } else {
      ended = s.current > 0;
      s.current = 1;
      s.graceBanked = 0;
    }
    counted = true;
  }
  let weekLanded = false;
  if (counted) {
    s.lastCountedDay = day;
    if (graceSpent > 0) s.graceSpentOn = day;
    if (s.current % GRACE_EVERY_DAYS === 0) {
      s.graceBanked = Math.min(GRACE_MAX, s.graceBanked + 1);
      weekLanded = true;
    }
    s.best = Math.max(s.best, s.current);
  }
  return { state: s, counted, ended, weekLanded, graceSpent };
}

export interface StreakReading {
  /** The run as it stands today: zero once the grace could not cover the gap. */
  days: number;
  best: number;
  /** The run has ended and nothing has been counted since. */
  lapsed: boolean;
  countedToday: boolean;
  /** Banked grace covered a gap on today's counted day. */
  graceCovered: boolean;
  glow: StreakGlow;
  multiplier: number;
  graceBanked: number;
  enabled: boolean;
}

/**
 * What to show on a given day. The row only changes on an action, so a run
 * whose gap has outgrown its grace still holds its old count until the next
 * action; the reading is where that gap is applied.
 */
export function readStreak(state: StreakState, today: string): StreakReading {
  const countedToday = state.lastCountedDay === today;
  let days = state.current;
  let lapsed = false;
  if (state.lastCountedDay !== null && days > 0) {
    const missed = Math.max(0, dayDiff(state.lastCountedDay, today) - 1);
    if (missed > state.graceBanked) {
      days = 0;
      lapsed = true;
    }
  }
  return {
    days,
    best: state.best,
    lapsed,
    countedToday,
    // Only on the day grace acted, and only while that day is still today.
    graceCovered: countedToday && state.graceSpentOn === today,
    glow: glowFor(days),
    multiplier: multiplierFor(days),
    graceBanked: state.graceBanked,
    enabled: state.enabled,
  };
}

// ---------------------------------------------------------------------------
// Copy. Plain, and never about what went.
// ---------------------------------------------------------------------------

export function dayLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function bestLine(best: number): string {
  return `Best: ${dayLabel(best)}`;
}

export const NOTHING_COUNTED_LINE = "Nothing counted yet today. Tick a routine, or scan.";
export const COUNTED_TODAY_LINE = "Today is counted.";
/**
 * Said once, on the day banked grace covered a gap.
 *
 * States what happened and what is still true. It does not scold the gap or
 * warn about the next one: a mechanic that exists to take the pressure off
 * should not be delivered as a threat.
 */
export const GRACE_COVERED_LINE = "Today is counted. A missed day was covered by a banked day, so the run carries on.";

export function streakLine(reading: StreakReading): string {
  if (reading.graceCovered) return GRACE_COVERED_LINE;
  if (reading.countedToday) return COUNTED_TODAY_LINE;
  return NOTHING_COUNTED_LINE;
}

// ---------------------------------------------------------------------------
// The server. GET reads, POST counts, PATCH is the Settings switch.
// ---------------------------------------------------------------------------

export interface StreakBalances {
  consistency: number;
  progress: number;
}

export interface StreakSnapshot {
  state: StreakState;
  reading: StreakReading;
  balances: StreakBalances;
  /** The server's idea of the day the reading was taken on. */
  today: string;
}

export interface StreakCountResult extends StreakSnapshot {
  counted: boolean;
  ended: boolean;
  weekLanded: boolean;
  /** Banked days the server spent covering the gap. */
  graceSpent: number;
  /** Consistency points written by this call, after the multiplier. */
  awarded: number;
}

type Fetcher = typeof fetch;

async function call<T>(token: string, method: string, body: unknown, fetcher: Fetcher): Promise<T | null> {
  try {
    const response = await fetcher("/api/streak", {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function fetchStreak(token: string, fetcher: Fetcher = fetch): Promise<StreakSnapshot | null> {
  return call<StreakSnapshot>(token, "GET", undefined, fetcher);
}

export function countStreakDay(
  token: string,
  reason: StreakReason,
  day: string = localDay(),
  fetcher: Fetcher = fetch,
): Promise<StreakCountResult | null> {
  return call<StreakCountResult>(token, "POST", { day, reason }, fetcher);
}

export function setStreakEnabled(token: string, enabled: boolean, fetcher: Fetcher = fetch): Promise<StreakSnapshot | null> {
  return call<StreakSnapshot>(token, "PATCH", { enabled }, fetcher);
}
