// Production rating/verdict functions in an isolated local UI/storage fixture.
// No accounts, real photographs, inference, API requests or model fitting.
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import { launchChromium } from './launchChromium.mjs';

const origin = process.argv[2] ?? 'http://127.0.0.1:4193';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Use a local dev server.');
const source = await readFile(new URL('../src/quick.ts', import.meta.url), 'utf8');
const start = source.indexOf('function renderRatingStep(');
const end = source.indexOf('function gapOf(', start);
if (start < 0 || end < start) throw new Error('Review calibration fixture extraction.');
const productionFunctions = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const script = `
import { calibrationVerdictSnapshot } from '/src/ui/calibrationVerdict.ts';
import { CALIBRATION_TARGET_LABELS, calibrationRatingOptions, calibrationScoreComparison, calibrationScoreViewLabel, isCalibrationRatingTarget } from '/src/engine/calibrationComparison.ts';
import { addRatedFace, calibrationReferenceId, loadCalibrationSet, calibrationDiagnosticsJSON, corpusJSON, clearCalibrationSet } from '/src/engine/calibrationSet.ts';
import { snapshotCalibrationDiagnostics } from '/src/engine/calibrationDiagnostics.ts';
import { activateScanOwner } from '/src/engine/scanScope.ts';
import { scoreFrontMeasurements, analyzeSide, mergeReports } from '/src/engine/scoring.ts';
import { METRICS, distFor } from '/src/engine/metrics.ts';
import { calibrationFileReference, suggestedCalibrationReference, CalibrationCaptureReviewRequired } from '/src/engine/calibrationCaptureGuard.ts';
activateScanOwner('local-comparison-fixture');
const __BUILD__ = 'local-comparison-fixture';
const el = { calStep: document.querySelector('#step'), calBody: document.querySelector('#body') };
const toAvatarThumb = () => undefined;
const resetSexAsk = () => {};
const renderFaceSlots = () => {};
const renderCalibrationSet = () => {};
const copyDiagnostics = async () => true;
const hasSideOverlay = () => false;
const downloadQuickVideo = async () => { throw new Error('No export in this fixture'); };
let pendingFront, pendingSide, pendingFrontShot, pendingFrontLandmarks, pendingSidePhoto, pendingSidePoints, pendingFrontImageSource, pendingSideCapture, pendingFrontFileReference, pendingSideFileReference;
const profile = {
trichion:{x:300,y:100},glabella:{x:330,y:190},nasion:{x:325,y:210},pronasale:{x:395,y:265},subnasale:{x:355,y:295},
labialeSuperius:{x:360,y:320},labialeInferius:{x:358,y:345},pogonion:{x:350,y:390},menton:{x:335,y:410},
gonion:{x:215,y:360},condylion:{x:205,y:250},cervicale:{x:240,y:430},tragion:{x:200,y:240}
};
function clearPending() { pendingFront = pendingSide = pendingFrontShot = pendingFrontLandmarks = pendingSidePhoto = pendingSidePoints = pendingSideCapture = null; pendingFrontFileReference = pendingSideFileReference = pendingFrontImageSource = undefined; }
${productionFunctions}
window.startComparisonFixture = (frontOnly = false, options = {}) => {
if (!options.keepSaved) clearCalibrationSet();
pendingFront = scoreFrontMeasurements(Object.fromEntries(METRICS.map(m => [m.id, distFor(m,'female').mean])), 'female');
pendingFront.overall = 6.7; pendingFront.overallZ = 1.4;
pendingSide = frontOnly ? null : analyzeSide(profile, 1, 'female');
if (pendingSide) { pendingSide.overall = 4.2; pendingSide.overallZ = -0.7; }
pendingFrontShot = document.createElement('canvas'); pendingFrontShot.width = pendingFrontShot.height = 500;
pendingFrontLandmarks = [{x:0.5,y:0.5,z:0,visibility:1}];
pendingSidePhoto = frontOnly ? null : pendingFrontShot;
pendingSidePoints = frontOnly ? null : structuredClone(profile);
const source = key => ({schemaVersion:1,originalFileSha256:key.repeat(64),reviewPixelsSha256:key.repeat(64),width:500,height:500,pixelFormat:'rgba8',orientation:'review-image-as-displayed'});
pendingFrontImageSource = source('a');
pendingSideCapture = frontOnly ? null : {width:500,height:500,faceDir:1,automaticPoints:structuredClone(profile),finalPoints:structuredClone(profile),seedMethod:'mesh',operatorVerified:true,imageSource:source('b')};
pendingFrontFileReference = options.pilotFiles ? calibrationFileReference('f01-front.png') : undefined;
pendingSideFileReference = options.pilotFiles && !frontOnly ? calibrationFileReference('w1-side.png') : undefined;
window.expectedCombined = pendingSide ? mergeReports(pendingFront,pendingSide).overall : undefined;
renderRatingStep(pendingFront);
};
window.readComparisonFixture = () => ({ faces: loadCalibrationSet(), diagnostics: JSON.parse(calibrationDiagnosticsJSON(loadCalibrationSet())), corpus: JSON.parse(corpusJSON(loadCalibrationSet())) });
window.startComparisonFixture();
`;
const artifacts = await mkdtemp(path.join(os.tmpdir(), 'truemax-comparison-'));
const browser = await launchChromium({ headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
      if (url.pathname === '/calibration-comparison-fixture') return route.fulfill({ contentType: 'text/html', body:
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/quick.css"><body class="quick"><main class="q-wrap"><p id="step"></p><div id="body"></div></main><script type="module" src="/comparison-fixture.js"></script>' });
      if (url.pathname === '/comparison-fixture.js') return route.fulfill({ contentType: 'text/javascript', body: script });
      return route.continue();
    });
    await page.goto(origin + '/calibration-comparison-fixture');
    await page.locator('#q-cal-target').waitFor();
    assert.equal(await page.locator('#q-cal-target').inputValue(), 'combined');
    await page.locator('#q-cal-num').fill('6.2');
    await page.locator('#q-cal-reference').fill('f01');
    await page.locator('#q-cal-external').check();
    assert.equal(await page.locator('#q-cal-target').inputValue(), 'external-overall');
    await page.locator('#q-cal-save').click();
    await page.locator('.q-cal-verdict').waitFor();
    const saved = await page.evaluate(() => ({ ...window.readComparisonFixture(), expected: window.expectedCombined }));
    assert.equal(saved.faces[0].scored, 6.7);
    assert.equal(saved.faces[0].ratingTarget, 'external-overall');
    assert.equal(saved.faces[0].ratedBy, 'external');
    assert.equal(saved.faces[0].captureScores.combined, saved.expected);
    assert.equal(saved.diagnostics.faces[0].captureScores.side, 4.2);
    assert.equal(saved.diagnostics.faces[0].diagnostics.side.operatorVerified, true);
    assert.deepEqual(saved.corpus.faces, []);
    assert.equal(await page.locator('.q-cal-pair > div:last-child b').innerText(), saved.expected.toFixed(1));
    assert.match(await page.locator('.q-cal-verdict').innerText(), /Context only/);
    assert.doesNotMatch(await page.locator('.q-cal-verdict').innerText(), /agrees with you/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, width + '-verdict.png') });
    await page.evaluate(() => window.startComparisonFixture(true));
    assert.equal(await page.locator('#q-cal-target').inputValue(), 'front');
    await page.locator('#q-cal-num').fill('5.8');
    await page.locator('#q-cal-reference').fill('f02');
    await page.locator('#q-cal-save').click();
    const front = await page.evaluate(() => window.readComparisonFixture());
    assert.equal(front.faces[0].ratingTarget, 'front');
    assert.deepEqual(front.faces[0].captureScores, { front: 6.7 });
    assert.equal(front.corpus.faces.length, 1);

    // Optional rating still saves a fully fingerprinted, reviewed capture.
    await page.evaluate(() => window.startComparisonFixture(false, { pilotFiles: true }));
    assert.equal(await page.locator('#q-cal-reference').inputValue(), 'f01');
    await page.locator('#q-cal-save').click();
    await page.locator('.q-cal-verdict').waitFor();
    const original = await page.evaluate(() => window.readComparisonFixture().faces[0]);
    assert.equal(original.rating, null);
    assert.equal(original.diagnostics.side.operatorVerified, true);
    assert.equal(original.diagnostics.side.imageSource.originalFileSha256.length, 64);

    // Reusing the same images never overwrites or silently adds another row.
    await page.evaluate(() => window.startComparisonFixture(false, { keepSaved: true, pilotFiles: true }));
    await page.locator('#q-cal-save').click();
    await page.locator('#q-cal-capture-warning').waitFor({ state: 'visible' });
    assert.match(await page.locator('#q-cal-capture-warning-list').innerText(), /saved row/);
    assert.equal((await page.evaluate(() => window.readComparisonFixture().faces)).length, 1);
    await page.locator('#q-cal-capture-confirm').check();
    await page.locator('#q-cal-reference').fill('f02');
    assert.equal(await page.locator('#q-cal-capture-confirm').isChecked(), false);
    await page.locator('#q-cal-save').click();
    assert.match(await page.locator('#q-cal-capture-warning-list').innerText(), /differs from the Reference ID/);
    assert.equal((await page.evaluate(() => window.readComparisonFixture().faces)).length, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, width + '-capture-warning.png'), fullPage: true });
    await page.locator('#q-cal-capture-confirm').check();
    await page.locator('#q-cal-save').click();
    await page.locator('.q-cal-verdict').waitFor();
    const repeated = await page.evaluate(() => window.readComparisonFixture());
    assert.equal(repeated.faces.length, 2);
    assert.deepEqual(repeated.faces[0], original);
    assert.equal(repeated.faces[1].rating, null);
    assert.ok(repeated.faces[1].captureReview.acknowledgedWarnings.includes('photo-reused:w1'));
    assert.deepEqual(repeated.diagnostics.faces[1].captureReview, repeated.faces[1].captureReview);
    assert.deepEqual(repeated.corpus.faces, []);
    await page.evaluate(() => window.startComparisonFixture(false, { keepSaved: true, pilotFiles: true }));
    assert.equal(await page.locator('#q-cal-capture-confirm').isChecked(), false, 'new captures cannot inherit exception consent');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Production calibration rating/verdict handlers, view scope, blank-save/export, duplicate preservation, explicit exception consent and desktop/mobile layout verified. Screenshots: ' + artifacts);
} finally { await browser.close(); }
