// Isolated local calibration form/storage fixture. No auth, uploads or inference.
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launchChromium } from './launchChromium.mjs';

const origin = process.argv[2] ?? 'http://127.0.0.1:4189';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Use a local dev server.');
const quick = await readFile(new URL('../src/quick.ts', import.meta.url), 'utf8');
const extractedForm = quick.slice(quick.indexOf('function renderRatingStep('), quick.indexOf('function renderVerdictStep(')).match(/el\.calBody\.innerHTML = `([\s\S]*?)`;/)?.[1];
// This fixture owns a female report. Substitute only its known group label;
// new template expressions must still be reviewed instead of evaluated here.
const form = extractedForm?.replace('${r.sex === "female" ? "women" : "men"}', 'women')
  .replace('${calibrationRatingOptions(Boolean(pendingFront), Boolean(pendingSide))}', '<option value="front">Front only</option><option value="side">Side only</option><option value="combined" selected>Front + side</option><option value="external-overall">Another app\'s total</option>');
if (!form || form.includes('${')) throw new Error('Review fixture extraction before running this test.');
const artifacts = await mkdtemp(path.join(os.tmpdir(), 'truemax-calibration-reference-'));
const browser = await launchChromium({ headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const blocked = [];
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/')) {
        blocked.push(url.href); return route.abort();
      }
      if (url.pathname === '/calibration-reference-fixture') return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/quick.css"></head><body class="quick"><main class="q-wrap"><p style="padding:0 28px">LOCAL FORM FIXTURE · no account or scan</p>${form}</main></body></html>`,
      });
      return route.continue();
    });
    await page.goto(`${origin}/calibration-reference-fixture`);
    assert.match(await page.locator('.q-cal-rate').innerText(), /Reference group: women/);
    const reference = page.getByRole('textbox', { name: 'Reference ID (optional)' });
    await reference.fill('f01');
    assert.equal(await reference.evaluate(input => input.checkValidity()), true);
    await page.locator('#q-cal-label').fill('Mary Jane');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, `${width}-form.png`) });
    await reference.fill('name@example.com');
    assert.equal(await reference.evaluate(input => input.checkValidity()), false);
    const result = await page.evaluate(async () => {
      const scope = await import('/src/engine/scanScope.ts');
      const gate = await import('/src/engine/quickOwnerAccess.ts');
      const set = await import('/src/engine/calibrationSet.ts');
      scope.activateScanOwner('local-reference-fixture');
      const owner = { allowed: true, staff: true, owner: true, userId: 'local-reference-fixture' };
      const refresh = gate.quickOwnerScopeTransition('user:local-reference-fixture', scope.activeScanOwner());
      const report = { sex: 'female', overall: 5, metrics: [] };
      set.addRatedFace(report, null, 'self', 'Private alias', undefined, { referenceId: 'f01' });
      const exported = set.calibrationDiagnosticsJSON(set.loadCalibrationSet());
      const saved = JSON.parse(exported).faces[0];
      set.clearCalibrationSet();
      return { referenceId: saved.referenceId, rawId: refresh.userId, allowed: gate.canUseOwnerTools(owner, refresh.userId), changed: refresh.changed, privateLabelExported: exported.includes('Private alias') };
    });
    assert.deepEqual(result, { referenceId: 'f01', rawId: 'local-reference-fixture', allowed: true, changed: false, privateLabelExported: false });
    assert.equal(blocked.some(url => url.includes('/api/')), false, 'The fixture must not call an API.');
    await page.close();
  }
  console.log(`Calibration Reference ID form and local save/export verified at desktop/mobile widths. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
}
