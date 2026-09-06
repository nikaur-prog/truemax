import { currentAccessToken } from "../engine/auth.js";
import {
  EMPTY_STREAK,
  bestLine,
  countStreakDay,
  dayLabel,
  fetchStreak,
  localDay,
  nextStreak,
  readStreak,
  streakLine,
} from "../engine/dailyStreak.js";
import type { StreakBalances, StreakReading, StreakReason, StreakState } from "../engine/dailyStreak.js";
import { scopedStorageKey } from "../engine/scanScope.js";

// ---------------------------------------------------------------------------
// The daily streak lamp, and the one place an action reports itself.
//
// One green lamp in the dashboard hero, brighter with the run. The person
// sees the day count and one line under it; the tiers exist only as CSS
// classes and the multiplier, never as words on screen. No heat imagery, no
// loss framing anywhere: a run that has ended is described by the best it
// kept, not by what went.
//
// The record of truth is the server (daily_streaks, points_events). This
// module keeps a small owner-scoped cache of the last snapshot so the lamp
// renders instantly and offline, and every render that can reach the server
// is corrected by it. recordStreakAction is the single entry point the rest
// of the UI calls when something that counts happens: a routine ticked, a
// check-in answered, a scan on the person's own account. It updates the
// lamp optimistically with the same arithmetic the database runs, then lets
// the server settle it. Signed out, it does nothing at all; a guest scan
// never reaches it.
// ---------------------------------------------------------------------------

interface CachedStreak {
  state: StreakState;
  balances: StreakBalances;
}

const CACHE_KEY = () => scopedStorageKey("truemax:dailyStreak");

function readCache(): CachedStreak | null {
  const key = CACHE_KEY();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStreak;
    if (!parsed || typeof parsed.state?.current !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cache: CachedStreak): void {
  const key = CACHE_KEY();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    /* the cache is a convenience; the server holds the record */
  }
}

/**
 * The lamp's markup, pure so a test can read it without a DOM.
 *
 * Off in Settings renders nothing: the switch hides the light and the
 * points without deleting the record. A person who has never counted a day
 * still sees the unlit lamp and the line naming what would count, because
 * that line is the whole explanation of the mechanic.
 */
export function lampMarkup(reading: StreakReading, balances: StreakBalances | null): string {
  if (!reading.enabled) return "";
  const points = (balances?.consistency ?? 0) + (balances?.progress ?? 0);
  const count = reading.days > 0 ? `<b class="daily-count">${dayLabel(reading.days)}</b>` : "";
  const kept = reading.days === 0 && reading.lapsed && reading.best > 0
    ? `<span class="daily-best">${bestLine(reading.best)}</span>`
    : "";
  return `<span class="daily-lamp glow-${reading.glow}" aria-hidden="true"></span>
    ${count}${kept}
    ${points > 0 ? `<span class="daily-pts">${points} pts</span>` : ""}
    <small class="daily-line">${streakLine(reading)}</small>`;
}

// Every mounted lamp, so an action anywhere updates the light everywhere.
const hosts = new Set<HTMLElement>();

function render(cache: CachedStreak | null): void {
  const reading = readStreak(cache?.state ?? EMPTY_STREAK, localDay());
  for (const host of [...hosts]) {
    if (!host.isConnected) {
      hosts.delete(host);
      continue;
    }
    // No cache and no server yet: leave the slot empty rather than showing a
    // zero to somebody who may not even be signed in.
    host.innerHTML = cache ? lampMarkup(reading, cache.balances) : "";
    host.classList.toggle("has-lamp", Boolean(cache) && reading.enabled);
  }
}

/**
 * Mount the lamp into a slot. Renders the cached snapshot immediately, then
 * fetches the server's and corrects. Safe to call with null.
 */
export function mountStreakLamp(host: HTMLElement | null): void {
  if (!host) return;
  hosts.add(host);
  render(readCache());
  void (async () => {
    const token = await currentAccessToken();
    if (!token) return;
    const snapshot = await fetchStreak(token);
    if (!snapshot) return;
    const cache = { state: snapshot.state, balances: snapshot.balances };
    writeCache(cache);
    render(cache);
  })();
}

// One server call per day per page load. The server is idempotent anyway;
// this just keeps a tick, a check-in and a scan in one session from sending
// three requests that two of which would answer counted=false.
const sentDays = new Set<string>();

/**
 * Something that counts happened: a routine ticked, a check-in answered, or
 * a scan on the person's own account. Callers guarantee the guest rule; a
 * guest scan must never reach this function.
 */
export function recordStreakAction(reason: StreakReason): void {
  const day = localDay();

  // Optimistic: the same arithmetic count_streak_day runs, on the cached
  // row, so the lamp brightens under the person's finger.
  const cached = readCache();
  if (cached) {
    const step = nextStreak(cached.state, day);
    if (step.counted) {
      const updated = { ...cached, state: step.state };
      writeCache(updated);
      render(updated);
    }
  }

  if (sentDays.has(day)) return;
  sentDays.add(day);
  void (async () => {
    try {
      const token = await currentAccessToken();
      if (!token) return;
      const result = await countStreakDay(token, reason, day);
      if (!result) return;
      const cache = { state: result.state, balances: result.balances };
      writeCache(cache);
      render(cache);
    } catch {
      /* the day is safe: the server counts it once whenever it next hears */
    }
  })();
}
