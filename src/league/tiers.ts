// The tier engine: recorded counts in, owed money out.
//
// This is the money math of the Creator League, so it lives alone, pure, and
// tested. The rules are exactly the deal in the outreach message:
//
//   - views and comments are COMBINED across all of a creator's approved
//     videos in a sprint — every post counts;
//   - a tier pays only when BOTH its view floor and its comment floor are met
//     (the comment floor is the bot filter);
//   - tiers do not stack: you are paid the highest tier you have reached,
//     not the sum of the rungs below it.
//
// Nothing in here reads the database. Callers hand it totals; how those
// totals were recorded (manual review now, platform APIs later) is not this
// file's business, which is also what makes the payout math auditable from
// one screen.

export interface Tier {
  views: number;
  comments: number;
  cents: number;
}

export interface Totals {
  views: number;
  comments: number;
}

/** The default ladder, in cents. Sprints may override per-month. */
export const DEFAULT_TIERS: readonly Tier[] = [
  { views: 100_000, comments: 50, cents: 25_000 },
  { views: 250_000, comments: 100, cents: 50_000 },
  { views: 500_000, comments: 200, cents: 100_000 },
  { views: 1_000_000, comments: 300, cents: 200_000 },
];

const byViews = (tiers: readonly Tier[]): Tier[] =>
  [...tiers].sort((a, b) => a.views - b.views);

/** The highest tier both floors satisfy, or null below the first rung. */
export function reachedTier(tiers: readonly Tier[], t: Totals): Tier | null {
  let best: Tier | null = null;
  for (const tier of byViews(tiers)) {
    if (t.views >= tier.views && t.comments >= tier.comments) best = tier;
  }
  return best;
}

/** What the totals have earned, in cents. */
export function earnedCents(tiers: readonly Tier[], t: Totals): number {
  return reachedTier(tiers, t)?.cents ?? 0;
}

/**
 * The next rung and how far along the shorter of the two floors is, for the
 * progress bar. Null once the top tier is reached — the bar has nothing left
 * to say and should not invent an eleventh rung.
 */
export function nextTier(
  tiers: readonly Tier[],
  t: Totals,
): { tier: Tier; progress: number } | null {
  for (const tier of byViews(tiers)) {
    if (t.views >= tier.views && t.comments >= tier.comments) continue;
    const viewP = Math.min(1, t.views / tier.views);
    const commentP = Math.min(1, t.comments / tier.comments);
    return { tier, progress: Math.min(viewP, commentP) };
  }
  return null;
}

/**
 * Sum the freshest snapshot of each submission into sprint totals.
 *
 * Latest-per-submission rather than max-per-submission: a platform can revise
 * counts DOWN (deleted comments, purged bot views), and paying on a number
 * the platform has since retracted is how a league loses its books.
 */
export function combineLatest(
  snapshots: Array<{ submissionId: string; at: number; views: number; comments: number }>,
): Totals {
  const latest = new Map<string, { at: number; views: number; comments: number }>();
  for (const s of snapshots) {
    const held = latest.get(s.submissionId);
    if (!held || s.at > held.at) latest.set(s.submissionId, s);
  }
  let views = 0;
  let comments = 0;
  for (const s of latest.values()) {
    views += s.views;
    comments += s.comments;
  }
  return { views, comments };
}

export function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}k`;
  return String(n);
}
