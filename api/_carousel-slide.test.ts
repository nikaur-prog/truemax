import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./carousel-slide.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/20260830120000_studio_render_meter.sql", import.meta.url),
  "utf8",
);

test("carousel generation is authenticated, origin checked and grant gated", () => {
  assert.match(route, /requestOrigin\(request\)/);
  assert.match(route, /authenticatedUser\(request\)/);
  assert.match(route, /creator\?\.status !== "approved" \|\| creator\.pillar_grants\?\.studio !== true/);
  assert.match(route, /return json\(\{ error: "Not found\." \}, 404\)/);
});

test("a carousel slide claims exactly one Studio slot before provider work", () => {
  assert.equal((route.match(/claimTtsRender\(user\.id, "studio"\)/g) ?? []).length, 1);
  const claim = route.indexOf('claimTtsRender(user.id, "studio")');
  const upload = route.indexOf("uploader.uploadImage");
  const generate = route.indexOf("client.subscribe");
  assert.ok(claim > -1 && upload > -1 && generate > -1);
  assert.ok(claim < upload && claim < generate, "the quota must be reserved before either provider call");
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /meter in \('league', 'studio'\) and status = 'reserved'/);
});

test("failed delivery refunds but delivered work is finalized", () => {
  const download = route.indexOf("await downloadGenerated");
  const normalize = route.indexOf("await responseJpeg");
  const finalize = route.indexOf("await finalizeTtsRender");
  const response = route.indexOf("return json({ image:");
  assert.ok(download > -1 && normalize > download && finalize > normalize && response > finalize);
  assert.match(route, /\} finally \{[\s\S]*?refundTtsRender\(reservation, claimant\)\.catch\(/);
  assert.match(route, /reservation = null;\s*await finalizeTtsRender/);
});

test("remote outputs are DNS pinned and bounded before decoding", () => {
  assert.match(route, /lookup\(hostname, \{ all: true, verbatim: true \}\)/);
  assert.match(route, /addresses\.some\(\(\{ address \}\) => !safeRemoteAddress\(address\)\)/);
  assert.match(route, /hostname: pinned\.address/);
  assert.match(route, /redirects <= 3/);
  assert.match(route, /total > MAX_PROVIDER_BYTES/);
  assert.equal((route.match(/limitInputPixels: MAX_INPUT_PIXELS/g) ?? []).length, 2);
});

test("the JSON response stays beneath the function response ceiling", () => {
  assert.match(route, /const MAX_RESPONSE_JPEG_BYTES = 3 \* 1024 \* 1024/);
  assert.match(route, /jpeg\.length <= MAX_RESPONSE_JPEG_BYTES/);
  assert.match(route, /data:image\/jpeg;base64/);
});
