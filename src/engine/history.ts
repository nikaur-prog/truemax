import type { RegionId, Report, Sex } from "./types.ts";

// Device-local scan history (localStorage) — powers week-over-week deltas
// with no accounts and no backend. One previous scan per sex is kept.

export interface StoredScan {
  date: string; // ISO
  sex: Sex;
  overall: number;
  regions: Partial<Record<RegionId, number>>;
}

export interface ScanDelta {
  daysAgo: number;
  overall: number; // signed score delta vs previous scan
  regions: Array<{ region: RegionId; delta: number }>;
}

const KEY = (sex: Sex) => `truemax:lastScan:${sex}`;

export function compareAndStore(report: Report): ScanDelta | null {
  let prev: StoredScan | null = null;
  try {
    const rawPrev = localStorage.getItem(KEY(report.sex));
    if (rawPrev) prev = JSON.parse(rawPrev) as StoredScan;
  } catch {
    prev = null;
  }

  const current: StoredScan = {
    date: new Date().toISOString(),
    sex: report.sex,
    overall: report.overall,
    regions: Object.fromEntries(report.regions.map((r) => [r.region, r.score])),
  };
  try {
    localStorage.setItem(KEY(report.sex), JSON.stringify(current));
  } catch {
    /* storage unavailable (private mode) — deltas just won't show */
  }

  if (!prev) return null;
  const daysAgo = Math.max(
    0,
    Math.round((Date.now() - new Date(prev.date).getTime()) / 86400000),
  );
  return {
    daysAgo,
    overall: Math.round((report.overall - prev.overall) * 10) / 10,
    regions: report.regions
      .filter((r) => prev.regions[r.region] !== undefined)
      .map((r) => ({
        region: r.region,
        delta: Math.round((r.score - (prev.regions[r.region] as number)) * 10) / 10,
      })),
  };
}
