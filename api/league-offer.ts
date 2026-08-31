import { formulaFrom } from "../src/league/earnings.js";
import { getSupabaseAdmin, json, safeMessage } from "./_shared.js";

export async function GET(): Promise<Response> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await getSupabaseAdmin()
      .from("league_sprints")
      .select("id,name,pool_cents,currency,formula,starts_at,ends_at")
      .eq("status", "active")
      .lte("starts_at", now)
      .gte("ends_at", now)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        name: string;
        pool_cents: number;
        currency: string;
        formula: unknown;
        starts_at: string;
        ends_at: string;
      }>();
    if (error) throw new Error(error.message);
    const formula = formulaFrom(data?.formula);
    if (!data || !formula) return json({ offer: null });
    return json({
      offer: {
        id: data.id,
        name: data.name,
        poolCents: data.pool_cents,
        currency: data.currency,
        formula,
        startsAt: data.starts_at,
        endsAt: data.ends_at,
      },
    });
  } catch (error) {
    console.error("league-offer", safeMessage(error));
    return json({ offer: null });
  }
}
