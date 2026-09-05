// Print the funnel: the last fourteen UTC days of the counter, as the chain
// from a visit to a checkout with each step's share of the one before, and
// the step where the biggest share is lost. That last line is the number to
// read every morning.
//
// Reads public.funnel_events directly with the service credentials (from
// Vercel env, never committed). The table holds counts per event per day
// and nothing else, so there is nobody in it to see.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
//     npx tsx scripts/funnel-report.ts [--days 14] [--json]
import { REPORT_DAYS, formatFunnelReport, summariseFunnel, windowDays } from "../src/engine/funnelReport.js";
import type { FunnelRow } from "../src/engine/funnelReport.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (the truemax project).");
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const count = Math.max(1, Math.min(90, Number(arg("days")) || REPORT_DAYS));
const days = windowDays(count);

const response = await fetch(
  `${url.replace(/\/$/, "")}/rest/v1/funnel_events?select=day,event,count&day=gte.${days[0]}&day=lte.${days[days.length - 1]}&order=day.asc`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!response.ok) {
  console.error(`Read failed: HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}
const rows = ((await response.json()) as Array<{ day: string; event: string; count: number | string }>).map<FunnelRow>((r) => ({
  day: r.day,
  event: r.event,
  count: Number(r.count),
}));
const summary = summariseFunnel(rows, days);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(formatFunnelReport(summary));
}
