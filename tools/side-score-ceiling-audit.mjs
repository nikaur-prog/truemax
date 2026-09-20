// Read-only audit of the current side scorer, using ideal-valued synthetic
// measurement vectors rather than photographs. These vectors need not be
// jointly achievable by a face; they establish an upper bound, not accuracy.
import assert from 'node:assert/strict';
import { launchChromium } from './launchChromium.mjs';

const origin = process.argv[2] ?? 'http://127.0.0.1:4193';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Use a local dev server.');
const browser = await launchChromium({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
    if (url.pathname === '/side-ceiling-audit') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Local score-only audit</p>' });
    if (url.pathname === '/src/engine/scoring.ts') {
      // Expose existing private functions only in this isolated browser.
      // The production source and exports are not modified.
      const response = await route.fetch();
      return route.fulfill({ response, body: (await response.text()) + '\nexport { scoreMetric as auditMetric, buildReport as auditBuild };' });
    }
    return route.continue();
  });
  await page.goto(origin + '/side-ceiling-audit');
  const result = await page.evaluate(async () => {
    const scoring = await import('/src/engine/scoring.ts');
    const { SIDE_METRICS } = await import('/src/engine/sideMetrics.ts');
    const { distFor, directionFor } = await import('/src/engine/metrics.ts');
    const { AGG_NORM } = await import('/src/engine/aggNorm.ts');
    return ['male', 'female'].map(sex => {
      const best = SIDE_METRICS.map(def => scoring.auditMetric(def, distFor(def, sex).ideal ?? distFor(def, sex).mean, sex));
      const report = scoring.auditBuild(best, sex, undefined, undefined, scoring.SIDE_AGG_PREFIX);
      const gridExceedsIdeal = SIDE_METRICS.some((def, index) => {
        const { mean, sd } = distFor(def, sex);
        return Array.from({ length: 161 }, (_, step) => mean + sd * (step / 20 - 4))
          .some(value => {
            const sample = scoring.auditMetric(def, value, sex);
            return !sample.implausible && sample.zEff > best[index].zEff + 1e-9;
          });
      });
      return {
        sex,
        allBand: SIDE_METRICS.every(def => directionFor(def, sex) === 'band'),
        sideNormKeys: Object.keys(AGG_NORM[sex]).filter(key => key.startsWith('side:')),
        allMetricsPresent: best.every(metric => !metric.implausible),
        upperBound: report.overall,
        upperBoundZ: report.overallZ,
        rawAggregate: report.zScores['side:overall'],
        gridExceedsIdeal,
        atIdeals: best.map(metric => ({ id: metric.def.id, value: metric.value, score: metric.score, zEff: metric.zEff, conformance: metric.conformance })),
      };
    });
  });
  for (const group of result) {
    assert.equal(group.allBand, true, 'Review upper-bound method if directional side metrics are introduced.');
    assert.equal(group.allMetricsPresent, true);
    assert.equal(group.gridExceedsIdeal, false);
    assert.ok(group.atIdeals.every(metric => metric.conformance === 1));
  }
  console.log(JSON.stringify({ purpose: 'theoretical-full-metric-ceiling-not-population-validation', groups: result }, null, 2));
} finally { await browser.close(); }
