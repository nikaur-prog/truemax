// ---------------------------------------------------------------------------
// Reading the funnel counter back.
//
// The counter has existed since the first TikTok push and nothing read it.
// This module turns its rows into the one thing worth reading every
// morning: the chain from a visit to a checkout, with each step's share of
// the step before, and the step where the biggest share is lost. Pure, so
// the staff endpoint and the terminal script print the same numbers.
// ---------------------------------------------------------------------------

export interface FunnelRow {
  /** YYYY-MM-DD */
  day: string;
  event: string;
  count: number;
}

/** The main path, in order. Each step's share is of the one before it. */
export const FUNNEL_CHAIN: readonly string[] = [
  "visit",
  "scan-front-done",
  "scan-side-done",
  "results-shown",
  "account-created",
  "checkout-started",
];

/** The guest-recovery pair: the hotfix's effect as a number. */
export const SIGNUP_RETURN_PAIR: readonly [string, string] = ["signup-return-analysis", "signup-return-lost"];

export const REPORT_DAYS = 14;

export interface ChainStep {
  event: string;
  count: number;
  /** Share of the previous step, 0..1; null on the first step or when the previous is zero. */
  share: number | null;
}

export interface FunnelSummary {
  /** Inclusive, ascending. */
  days: string[];
  /** Per event, total across the window. */
  totals: Record<string, number>;
  /** Per event, per day. Missing days are zero. */
  byDay: Record<string, Record<string, number>>;
  chain: ChainStep[];
  /** The chain step that keeps the smallest share of the one before; null when nothing flows. */
  biggestDrop: ChainStep | null;
  signupReturn: { analysis: number; lost: number; recovered: number | null };
}

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The last N UTC days ending today, ascending. */
export function windowDays(count: number = REPORT_DAYS, now: Date = new Date()): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) days.push(dayString(new Date(end - i * 86400000)));
  return days;
}

export function buildChain(totals: Record<string, number>, chain: readonly string[] = FUNNEL_CHAIN): ChainStep[] {
  const steps: ChainStep[] = [];
  let previous: number | null = null;
  for (const event of chain) {
    const count = totals[event] ?? 0;
    const share = previous === null || previous === 0 ? null : count / previous;
    steps.push({ event, count, share });
    previous = count;
  }
  return steps;
}

export function biggestDrop(chain: ChainStep[]): ChainStep | null {
  let worst: ChainStep | null = null;
  for (const step of chain) {
    if (step.share === null) continue;
    if (!worst || step.share < (worst.share as number)) worst = step;
  }
  return worst;
}

export function summariseFunnel(rows: FunnelRow[], days: string[] = windowDays()): FunnelSummary {
  const inWindow = new Set(days);
  const totals: Record<string, number> = {};
  const byDay: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (!inWindow.has(row.day)) continue;
    const n = Number(row.count);
    if (!Number.isFinite(n)) continue;
    totals[row.event] = (totals[row.event] ?? 0) + n;
    byDay[row.event] ??= {};
    byDay[row.event][row.day] = (byDay[row.event][row.day] ?? 0) + n;
  }
  const chain = buildChain(totals);
  const analysis = totals[SIGNUP_RETURN_PAIR[0]] ?? 0;
  const lost = totals[SIGNUP_RETURN_PAIR[1]] ?? 0;
  return {
    days,
    totals,
    byDay,
    chain,
    biggestDrop: biggestDrop(chain),
    signupReturn: { analysis, lost, recovered: analysis + lost === 0 ? null : analysis / (analysis + lost) },
  };
}

// ---------------------------------------------------------------------------
// Text, for the terminal.
// ---------------------------------------------------------------------------

const pct = (share: number | null): string => (share === null ? "  n/a" : `${(share * 100).toFixed(0).padStart(4)}%`);

export function formatFunnelReport(summary: FunnelSummary): string {
  const lines: string[] = [];
  lines.push(`Funnel, ${summary.days[0]} to ${summary.days[summary.days.length - 1]} (UTC days)`);
  lines.push("");
  lines.push("step                  count   of previous");
  for (const step of summary.chain) {
    lines.push(`${step.event.padEnd(22)}${String(step.count).padStart(5)}   ${pct(step.share)}`);
  }
  if (summary.biggestDrop) {
    lines.push("");
    lines.push(`Biggest drop: ${summary.biggestDrop.event} keeps ${pct(summary.biggestDrop.share).trim()} of the step before.`);
  } else {
    lines.push("");
    lines.push("Nothing flowed through the chain in this window.");
  }
  const sr = summary.signupReturn;
  lines.push("");
  lines.push(
    sr.recovered === null
      ? "Guest signup return: no events yet."
      : `Guest signup return: ${sr.analysis} landed on their analysis, ${sr.lost} landed elsewhere (${(sr.recovered * 100).toFixed(0)}% recovered).`,
  );
  const others = Object.keys(summary.totals)
    .filter((e) => !FUNNEL_CHAIN.includes(e))
    .sort();
  if (others.length) {
    lines.push("");
    lines.push("other events          count");
    for (const event of others) lines.push(`${event.padEnd(22)}${String(summary.totals[event]).padStart(5)}`);
  }
  lines.push("");
  lines.push("per day               " + summary.days.map((d) => d.slice(5)).join(" "));
  for (const event of FUNNEL_CHAIN) {
    const cells = summary.days.map((d) => String(summary.byDay[event]?.[d] ?? 0).padStart(5));
    lines.push(`${event.padEnd(22)}${cells.join(" ")}`);
  }
  return lines.join("\n");
}
