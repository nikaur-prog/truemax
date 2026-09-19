import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationPreviewApi, calibrationPreviewPage } from './calibration-preview.mjs';

test('preview serves the actual help and static pages, not the scanner fallback', () => {
  assert.equal(calibrationPreviewPage('/help/take-a-good-face-scan'), '/photo-help.html');
  assert.equal(calibrationPreviewPage('/help/take-a-good-face-scan/'), '/photo-help.html');
  assert.equal(calibrationPreviewPage('/how-it-works'), '/how-it-works.html');
  assert.equal(calibrationPreviewPage('/league/tools'), '/quick.html');
  assert.equal(calibrationPreviewPage('/privacy'), '/privacy.html');
  assert.equal(calibrationPreviewPage('/api/quick-access'), null);
  assert.equal(calibrationPreviewPage('/tutorial/front-good.jpg'), null);
  assert.equal(calibrationPreviewPage('/'), null);
});

const origin = 'http://127.0.0.1:4189';
test('calibration preview rejects signed-out, cross-origin and unrelated API calls without upstream access', async () => {
  const fetcher = () => { throw new Error('Must not call upstream'); };
  for (const [url, options, status] of [
    ['/api/quick-access', {}, 401],
    ['/api/quick-access', { headers: { origin: 'https://untrusted.example', authorization: 'Bearer example' } }, 403],
    ['/api/quick-access', { method: 'POST' }, 503],
    ['/api/side-landmarks', { method: 'POST' }, 503],
    ['/api/quick-access?redirect=bad', {}, 503],
  ]) {
    assert.equal((await calibrationPreviewApi(new Request(origin + url, options), { origin, fetcher })).status, status);
  }
});
test('only forwards bearer to fixed read-only endpoint, preserving denied grants and no-store', async () => {
  const fetcher = async (url, init) => {
    assert.equal(url, 'https://www.truemax.app/api/quick-access');
    assert.equal(init.method, 'GET');
    assert.deepEqual(init.headers, { authorization: 'Bearer example', accept: 'application/json' });
    assert.equal(init.redirect, 'error');
    return Response.json({ allowed: false }, { status: 404 });
  };
  const response = await calibrationPreviewApi(new Request(origin + '/api/quick-access', {
    headers: { authorization: 'Bearer example', cookie: 'must-not-forward=true', origin },
  }), { origin, fetcher });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { allowed: false });
});
test('an unreachable or non-JSON upstream fails closed', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => new Response('<html>error</html>')]) {
    const response = await calibrationPreviewApi(new Request(origin + '/api/quick-access', { headers: { authorization: 'Bearer example' } }), { origin, fetcher });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).allowed, false);
  }
});
