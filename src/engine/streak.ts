import type { StoredScan } from "./history.js";

// ---------------------------------------------------------------------------
// Weekly scan streaks.
//
// The unit is a WEEK, not a day, and that is a measurement decision rather than
// a product one. Two photographs of the same face land about 1.3 points apart —
// more than two different people do — so a daily streak would be rewarding
// people for collecting noise, and worse, showing them a number that jitters by
// more than any real change it could ever detect. Facial structure moves over
// weeks at the very fastest. A weekly cadence is the shortest one where a delta
// can mean anything at all.
//
// A week is counted from Monday, and the streak survives as long as there is a
// scan in each consecutive week up to the current one. Miss a week and it
// resets, but the current week is never counted as missed until it is over —
// somebody who scanned last Tuesday and is looking at this on Monday morning
// has not broken anything yet.
// ---------------------------------------------------------------------------

export interface Streak {
  // Consecutive weeks with at least one scan, counting back from the most
  // recent scan's week.
  weeks: number;
  // Whether that run is still live (this week or last week), or has lapsed.
  alive: boolean;
  // Days until the current week's window closes. Null when the streak is dead
  // or this week's scan is already in.
  daysLeft: number | null;
  // Already scanned in the current week.
  scannedThisWeek: boolean;
  total: number;
}

const DAY = 86400000;

// Monday-anchored week index. Using an integer week number rather than dates
// means "consecutive weeks" is subtraction, with no month or year edges.
function weekIndex(d: Date): number {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  // 1970-01-01 was a Thursday; shift so weeks break on Monday.
  return Math.floor((utc / DAY + 3) / 7);
}

export function computeStreak(scans: StoredScan[], now = new Date()): Streak {
  const total = scans.length;
  if (!total) {
    return { weeks: 0, alive: false, daysLeft: null, scannedThisWeek: false, total: 0 };
  }

  const thisWeek = weekIndex(now);
  const weeks = new Set<number>();
  for (const s of scans) {
    const d = new Date(s.date);
    if (!Number.isNaN(d.getTime())) weeks.add(weekIndex(d));
  }

  const scannedThisWeek = weeks.has(thisWeek);
  // Walk back from the most recent week that has a scan.
  const latest = Math.max(...weeks);
  let run = 0;
  for (let w = latest; weeks.has(w); w--) run++;

  // Alive if the run reaches this week or last week. Last week still counts,
  // because the current week is not over — nobody has missed it yet.
  const alive = latest >= thisWeek - 1;

  // Days remaining in the current week (Sunday end), when a scan is still owed.
  let daysLeft: number | null = null;
  if (alive && !scannedThisWeek) {
    const dow = (now.getDay() + 6) % 7; // 0 = Monday
    daysLeft = 7 - dow;
  }

  return { weeks: alive ? run : 0, alive, daysLeft, scannedThisWeek, total };
}
