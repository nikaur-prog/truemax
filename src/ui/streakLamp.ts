import { currentAccessToken, onAuthChange } from "../engine/auth.js";
import {
  EMPTY_STREAK,
  bestLine,
  countStreakDay,
  dayLabel,
  fetchStreak,
  localDay,
  readStreak,
  setStreakEnabled,
  streakLine,
} from "../engine/dailyStreak.js";
import type { StreakBalances, StreakReading, StreakReason } from "../engine/dailyStreak.js";
import { activeScanOwner } from "../engine/scanScope.js";
import { createDailyStreakStore, type StreakCache } from "../engine/dailyStreakStore.js";

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

const store = createDailyStreakStore({
  owner: activeScanOwner,
  token: currentAccessToken,
  storage: () => localStorage,
  now: () => new Date(),
  read: fetchStreak,
  count: countStreakDay,
  enable: setStreakEnabled,
  changed: (cache) => render(cache),
});

// One app-lifetime subscription, not one subscription per dashboard render.
// A late request can never write into a newly selected account's cache.
let watching = false;
function watch(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  onAuthChange(() => {
    render(store.cached());
    // Never invoke another Auth method synchronously inside its callback.
    queueMicrotask(() => { void store.refresh(); });
  });
  window.addEventListener("online", () => { void store.refresh(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      render(store.cached());
      void store.refresh();
    }
  });
}

export function refreshStreak(expectedUserId?: string): Promise<StreakCache | null> {
  watch();
  return store.refresh(expectedUserId);
}

export function updateStreakEnabled(enabled: boolean, userId: string): Promise<StreakCache | null> {
  watch();
  return store.setEnabled(enabled, userId);
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

function render(cache: StreakCache | null): void {
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
  render(store.cached());
  void refreshStreak();
}

/**
 * Something that counts happened: a routine ticked, a check-in answered, or
 * a scan on the person's own account. Callers guarantee the guest rule; a
 * guest scan must never reach this function.
 */
export function recordStreakAction(reason: StreakReason): void {
  watch();
  void store.record(reason, localDay());
}
