import {
  CONSISTENCY_POINTS_PER_DAY,
  EMPTY_STREAK,
  STREAK_REASONS,
  STREAK_WEEK_BONUS,
  dayAccepted,
  readStreak,
} from "../src/engine/dailyStreak.js";
import type { StreakBalances, StreakReason, StreakState } from "../src/engine/dailyStreak.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// The daily streak, for the account.
//
// GET   the row, today's reading, and the two balances.
// POST  count a day. The client says which day it counted and why; the
//       server accepts the day only within one day of its own UTC date,
//       hands it to count_streak_day, and awards consistency points only
//       when the day was newly counted. The action kind is not part of the
//       ledger key: a routine and a scan on the same day are one day.
// PATCH the Settings switch. Off hides; the record keeps counting.
//
// A guest scan never reaches here: the client counts only on the person's
// own account, and there is no user id in the payload to count for.
// ---------------------------------------------------------------------------

interface StreakRow {
  current: number;
  best: number;
  last_counted_day: string | null;
  grace_banked: number;
  enabled: boolean;
}

interface BalanceRow {
  ledger: "consistency" | "progress";
  points: number | string;
}

interface CountedRow {
  counted: boolean;
  ended: boolean;
  weekLanded: boolean;
  current: number;
  best: number;
  graceBanked: number;
  lastCountedDay: string | null;
  enabled: boolean;
}

const utcToday = (): string => new Date().toISOString().slice(0, 10);

function stateOf(row: StreakRow | null): StreakState {
  if (!row) return EMPTY_STREAK;
  return {
    current: row.current,
    best: row.best,
    lastCountedDay: row.last_counted_day,
    graceBanked: row.grace_banked,
    enabled: row.enabled,
  };
}

async function snapshot(userId: string, today: string) {
  const admin = getSupabaseAdmin();
  const [row, balances] = await Promise.all([
    admin
      .from("daily_streaks")
      .select("current,best,last_counted_day,grace_banked,enabled")
      .eq("user_id", userId)
      .maybeSingle<StreakRow>(),
    admin.from("points_balances").select("ledger,points").eq("user_id", userId),
  ]);
  if (row.error) throw new Error(`Streak read failed: ${row.error.message}`);
  if (balances.error) throw new Error(`Balance read failed: ${balances.error.message}`);
  const state = stateOf(row.data);
  const sums: StreakBalances = { consistency: 0, progress: 0 };
  for (const b of (balances.data ?? []) as BalanceRow[]) {
    const n = typeof b.points === "number" ? b.points : Number(b.points);
    if (Number.isFinite(n) && (b.ledger === "consistency" || b.ledger === "progress")) sums[b.ledger] = n;
  }
  return { state, reading: readStreak(state, today), balances: sums, today };
}

export async function GET(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin streak reads are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    return json(await snapshot(user.id, utcToday()));
  } catch (error) {
    console.error("streak get", safeMessage(error));
    return json({ error: "Your streak could not be read just then." }, 500);
  }
}

/** The request, strictly: a real calendar day and a known reason. */
export function parseCountRequest(value: unknown, now: Date = new Date()): { day: string; reason: StreakReason } | { error: string } {
  if (!value || typeof value !== "object") return { error: "The request body is not a streak day." };
  const raw = value as Record<string, unknown>;
  const reason = STREAK_REASONS.find((r) => r === raw.reason);
  if (!reason) return { error: "Say what counted: a routine, a check-in or a scan." };
  if (typeof raw.day !== "string" || !dayAccepted(raw.day, now)) {
    return { error: "The day has to be today where you are." };
  }
  return { day: raw.day, reason };
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin streak writes are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    const parsed = parseCountRequest(await request.json().catch(() => null));
    if ("error" in parsed) return json({ error: parsed.error }, 400);

    const admin = getSupabaseAdmin();
    const counted = await admin.rpc("count_streak_day", { p_user_id: user.id, p_day: parsed.day });
    if (counted.error) throw new Error(`count_streak_day failed: ${counted.error.message}`);
    const result = counted.data as CountedRow;

    let awarded = 0;
    if (result.counted) {
      // The multiplier is read inside the function from the run as it now
      // stands, so the day that reaches a tier earns at that tier.
      const day = await admin.rpc("award_consistency", {
        p_user_id: user.id,
        p_reason: "day",
        p_day: parsed.day,
        p_base: CONSISTENCY_POINTS_PER_DAY,
      });
      if (day.error) throw new Error(`award_consistency failed: ${day.error.message}`);
      awarded += Number(day.data) || 0;
      if (result.weekLanded) {
        const week = await admin.rpc("award_consistency", {
          p_user_id: user.id,
          p_reason: "week",
          p_day: parsed.day,
          p_base: STREAK_WEEK_BONUS,
        });
        if (week.error) throw new Error(`award_consistency (week) failed: ${week.error.message}`);
        awarded += Number(week.data) || 0;
      }
      // Counts, not people: the funnel learns that a day was counted and
      // that a run ended, nothing about whose.
      await admin.rpc("bump_funnel_event", { p_event: "streak-day-counted" });
      if (result.ended) await admin.rpc("bump_funnel_event", { p_event: "streak-ended" });
    }

    const snap = await snapshot(user.id, utcToday());
    return json({ ...snap, counted: result.counted, ended: result.ended, weekLanded: result.weekLanded, awarded });
  } catch (error) {
    console.error("streak post", safeMessage(error));
    return json({ error: "Your day could not be counted just then." }, 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin streak writes are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
    if (!body || typeof body.enabled !== "boolean") return json({ error: "Say whether the streak is on or off." }, 400);
    const { error } = await getSupabaseAdmin()
      .from("daily_streaks")
      .upsert({ user_id: user.id, enabled: body.enabled, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return json(await snapshot(user.id, utcToday()));
  } catch (error) {
    console.error("streak patch", safeMessage(error));
    return json({ error: "Your streak setting could not be saved just then." }, 500);
  }
}
