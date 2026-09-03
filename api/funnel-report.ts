import { REPORT_DAYS, summariseFunnel, windowDays } from "../src/engine/funnelReport.js";
import type { FunnelRow } from "../src/engine/funnelReport.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// The funnel, read back. Staff only; everyone else sees a 404, as with the
// League and quick endpoints. Counts per event per UTC day over the last
// fourteen days, plus the chain and the biggest drop computed the same way
// scripts/funnel-report.ts computes them. No identity exists in the table
// to leak, but the shape of the traffic is still not public.
// ---------------------------------------------------------------------------

async function isStaff(userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle<{ user_id: string }>();
  return !error && data?.user_id === userId;
}

export async function GET(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Not found." }, 404);
  try {
    const user = await authenticatedUser(request);
    if (!user || !(await isStaff(user.id))) return json({ error: "Not found." }, 404);
    const days = windowDays(REPORT_DAYS);
    const { data, error } = await getSupabaseAdmin()
      .from("funnel_events")
      .select("day,event,count")
      .gte("day", days[0])
      .lte("day", days[days.length - 1]);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as Array<{ day: string; event: string; count: number | string }>).map<FunnelRow>((r) => ({
      day: r.day,
      event: r.event,
      count: Number(r.count),
    }));
    return json(summariseFunnel(rows, days));
  } catch (error) {
    console.error("funnel-report", safeMessage(error));
    return json({ error: "The report could not be read just then." }, 500);
  }
}
