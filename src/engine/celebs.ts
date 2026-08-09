import { METRICS } from "./metrics.ts";
import type { RegionId, Report, ScoredMetric, Sex } from "./types.ts";

// Celebrity / reference measurement DB. Populated as a byproduct of scanning
// famous faces for content: run a scan, call window.__truemax.celebEntry("Name")
// in the console, and paste the JSON here. Matching is PER-METRIC (credibility
// rule: "closest to X on jaw", never a flattering overall resemblance).

export interface CelebEntry {
  name: string;
  sex: Sex;
  metrics: Record<string, number>; // metricId → raw value
}

// Seed entries measured by this engine from public official portraits.
// Replace/extend with real celebrity scans as content gets made.
export const CELEBS: CelebEntry[] = [
  {
    name: "B. Obama",
    sex: "male",
    metrics: {
      canthalTilt: 1.82, eyeAspectRatio: 0.228, eyeSeparationRatio: 0.4585,
      intercanthalEyeWidth: 1.345, browPosition: 0.2163, browTilt: -3.37,
      fwhr: 2.229, midfaceRatio: 1.071, cheekboneHeight: 0.167,
      jawCheekRatio: 0.8879, gonialProxy: 141.26, jawFrontalAngle: 95.52,
      chinHeightRatio: 0.696, philtrumChinRatio: 4.408, chinWidthRatio: 0.529,
      lowerFacePct: 55.44, noseMouthRatio: 0.62, noseIntercanthal: 1.326,
      nasalIndex: 0.914, lipRatio: 1.971, mouthIPD: 1.146,
      lipHeightLowerThird: 35.52, mouthCornerTilt: 12.55, topThirdEst: 20.08,
      middleLowerBalance: 0.804, fifthsEyeRatio: 0.1829, facialIndex: 1.284,
      mirrorDeviation: 3.99, canthalAsymmetry: 0.63, eyeMouthParallel: 1.12,
      midlineDeviation: 1.62,
    },
  },
  {
    name: "K. Harris",
    sex: "female",
    metrics: {
      canthalTilt: 8.49, eyeAspectRatio: 0.315, eyeSeparationRatio: 0.4682,
      intercanthalEyeWidth: 1.202, browPosition: 0.2909, browTilt: 3.52,
      fwhr: 2.048, midfaceRatio: 1.023, cheekboneHeight: 0.126,
      jawCheekRatio: 0.8989, gonialProxy: 139.95, jawFrontalAngle: 96.04,
      chinHeightRatio: 0.666, philtrumChinRatio: 3.758, chinWidthRatio: 0.477,
      lowerFacePct: 50.99, noseMouthRatio: 0.619, noseIntercanthal: 1.248,
      nasalIndex: 0.848, lipRatio: 1.865, mouthIPD: 1.044,
      lipHeightLowerThird: 38.11, mouthCornerTilt: 16.78, topThirdEst: 19.85,
      middleLowerBalance: 0.961, fifthsEyeRatio: 0.2018, facialIndex: 1.245,
      mirrorDeviation: 3.03, canthalAsymmetry: 0, eyeMouthParallel: 2.34,
      midlineDeviation: 2.05,
    },
  },
];

export interface CelebMatch {
  name: string;
  metricName: string;
  deltaSigma: number;
}

// For a region: find, per reference face of the same sex, the metric where
// the two faces measure closest (in σ), then rank references by that
// closeness. Only metrics where the user is at least average are eligible —
// flattering-but-true, per the credibility rule.
export function regionMatches(
  region: RegionId,
  userMetrics: ScoredMetric[],
  sex: Sex,
  limit = 3,
): CelebMatch[] {
  const pool = CELEBS.filter((c) => c.sex === sex);
  const eligible = userMetrics.filter(
    (m) => m.def.region === region && m.percentile >= 40,
  );
  if (!pool.length || !eligible.length) return [];

  const out: CelebMatch[] = [];
  for (const celeb of pool) {
    let best: CelebMatch | null = null;
    for (const m of eligible) {
      const cv = celeb.metrics[m.def.id];
      if (cv === undefined) continue;
      const d = Math.abs(m.value - cv) / m.def.dist[sex].sd;
      if (!best || d < best.deltaSigma) {
        best = { name: celeb.name, metricName: m.def.name, deltaSigma: Math.round(d * 100) / 100 };
      }
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.deltaSigma - b.deltaSigma).slice(0, limit);
}

// Console helper: turns the current report into a paste-ready DB entry.
export function toCelebEntry(report: Report, name: string): string {
  const metrics: Record<string, number> = {};
  for (const m of report.metrics) {
    metrics[m.def.id] = Math.round(m.value * 10 ** (m.def.decimals + 1)) / 10 ** (m.def.decimals + 1);
  }
  const ids = new Set(METRICS.map((d) => d.id));
  for (const k of Object.keys(metrics)) if (!ids.has(k)) delete metrics[k];
  return JSON.stringify({ name, sex: report.sex, metrics }, null, 2);
}
