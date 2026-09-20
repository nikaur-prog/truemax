import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ANALYTICS_PAGES, analyticsAcquisition, analyticsEventFor, analyticsEventParameters,
  analyticsMeasurementId, analyticsPage, analyticsVitalParameters, readAnalyticsConsent,
} from "./analyticsPolicy.js";

test("analytics requires a valid public GA4 stream ID, never a token or arbitrary script URL", () => {
  assert.equal(analyticsMeasurementId("G-TEST123456"), "G-TEST123456");
  for (const id of [null, undefined, "", "G-123", " G-TEST123456", "G-TEST123456\n", "G-TEST123456&x=1", "https://example.com", "UA-1234", "G-test123456"]) assert.equal(analyticsMeasurementId(id), null);
});

test("only production public paths without private state are eligible", () => {
  for (const path of Object.keys(ANALYTICS_PAGES)) assert.equal(analyticsPage(`https://www.truemax.app${path}`), path);
  assert.equal(analyticsPage("https://truemax.app/?utm_source=tiktok&utm_content=private-text&ttclid=private-id"), "/");
  for (const url of [
    "http://127.0.0.1:4193/", "https://localhost/", "https://preview.vercel.app/", "http://truemax.app/", "https://truemax.app:444/",
    "https://www.truemax.app/league/tools#calibrate", "https://www.truemax.app/calib", "https://www.truemax.app/quick", "https://www.truemax.app/auth",
    "https://www.truemax.app/privacy", "https://www.truemax.app/analytics", "https://www.truemax.app/?preview=report", "https://www.truemax.app/?code=secret",
    "https://www.truemax.app/?name=private", "https://www.truemax.app/#access_token=secret", "https://www.truemax.app/measurements/someone-private",
    "https://user:secret@www.truemax.app/", "https://www.truemax.app/__proto__",
  ]) assert.equal(analyticsPage(url), null, url);
});

test("source classification never preserves a raw search, campaign, referrer path or click ID", () => {
  assert.deepEqual(analyticsAcquisition("https://www.truemax.app/face-score", "https://www.google.com/search?q=private-person"), { landing: "/face-score", source: "google", medium: "organic" });
  assert.deepEqual(analyticsAcquisition("https://www.truemax.app/?utm_source=tiktok&utm_medium=cpc&utm_content=private-id&ttclid=secret", ""), { landing: "/", source: "tiktok", medium: "paid" });
  assert.deepEqual(analyticsAcquisition("https://www.truemax.app/?utm_source=person@example.com", "https://private.example.com/account/123"), { landing: "/", source: "other", medium: "referral" });
  assert.equal(analyticsAcquisition("https://www.truemax.app/auth", "https://google.com"), null);
});

test("bridge rebuilds an exact allowlist instead of spreading events or acquisition records", () => {
  const raw = {
    kind: "truemax-analytics-event", event: "view_results", page: "/",
    acquisition: { landing: "/face-score", source: "google", medium: "organic", account: "private-account" },
    score: 6.7, photo: "data:private", page_location: "https://truemax.app/?email=private", user_id: "private-user",
  };
  const params = analyticsEventParameters(raw)!;
  assert.deepEqual(params, {
    page_location: "https://www.truemax.app/", page_title: "TrueMax facial analysis", page_referrer: "", page_category: "product",
    landing_page: "/face-score", acquisition_source: "google", acquisition_medium: "organic", campaign_source: "google", campaign_medium: "organic",
  });
  assert.doesNotMatch(JSON.stringify(params), /private|6\.7|account|user_id|photo/);
  for (const invalid of [{ ...raw, event: "purchase" }, { ...raw, event: "chat_private" }, { ...raw, page: "/?email=private" }, { ...raw, acquisition: { ...raw.acquisition, source: "person@example.com" } }]) assert.equal(analyticsEventParameters(invalid), null);
});

test("only generic product milestones map to GA, never private tools or fake purchases", () => {
  assert.equal(analyticsEventFor("scan-started"), "scan_start");
  assert.equal(analyticsEventFor("account-created"), "sign_up");
  assert.equal(analyticsEventFor("checkout-started"), "begin_checkout");
  assert.equal(analyticsEventFor("scan-front-done"), "scan_front_complete");
  for (const event of ["quick-scan-done", "max-chat-opened", "purchase", "checkout-success", "toString", "photo-private", "visit"]) assert.equal(analyticsEventFor(event), null);
});

test("web vitals project only finite numeric metrics and the pinned random ID shape", () => {
  const message = { kind: "truemax-analytics-vital", page: "/", acquisition: { landing: "/", source: "direct", medium: "direct" },
    vital: { name: "INP", value: 100, delta: -20, rating: "good", id: "v6-1789850000000-1234567890123", entries: [{ url: "private-photo" }] } };
  const clean = analyticsVitalParameters(message)!;
  assert.equal(clean.metric_delta, -20); assert.equal(clean.metric_value, 100);
  assert.doesNotMatch(JSON.stringify(clean), /entries|private-photo/);
  for (const change of [{ name: "photo" }, { value: NaN }, { value: -1 }, { delta: Infinity }, { id: message.vital.id + "\n" }, { id: "account-123" }, { rating: "private" }]) {
    assert.equal(analyticsVitalParameters({ ...message, vital: { ...message.vital, ...change } }), null);
  }
});

test("scan-start hooks cover chosen files and the accepted camera shutter, not camera preview", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const open = main.slice(main.indexOf("async function openCamera"), main.indexOf("async function closeCamera"));
  assert.doesNotMatch(open, /trackAnalytics\("scan-started"\)/);
  const shutter = main.slice(main.indexOf('const token = beginScan("camera")'), main.indexOf('const burst = await captureBurst(cam)'));
  assert.match(shutter, /if \(!token\)[\s\S]*return;[\s\S]*trackAnalytics\("scan-started"\)/);
  const upload = main.slice(main.indexOf("async function handleFile"), main.indexOf("async function handleFile") + 1100);
  assert.match(upload, /if \(expectedGeneration !== scanGeneration\) return;[\s\S]*trackAnalytics\("scan-started"\)[\s\S]*await ensureEngine/);
});

test("consent is explicit, versioned, finite and expires; malformed storage fails closed", () => {
  const now = 100000000;
  assert.equal(readAnalyticsConsent(JSON.stringify({ version: 1, allowed: true, at: now - 1 }), now), true);
  assert.equal(readAnalyticsConsent(JSON.stringify({ version: 1, allowed: false, at: now }), now), false);
  for (const raw of [null, "", "no", "{}", JSON.stringify({ version: 1, allowed: "true", at: now }), JSON.stringify({ version: 0, allowed: true, at: now }), JSON.stringify({ version: 1, allowed: true, at: now + 1 }), JSON.stringify({ version: 1, allowed: true, at: now - 181 * 86400000 })]) assert.equal(readAnalyticsConsent(raw, now), null);
});

test("Google tag domains are restricted to the empty analytics frame; private tools stay untracked", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const global = config.headers.find((item: { source: string }) => item.source === "/(.*)");
  const frame = config.headers.find((item: { source: string }) => item.source === "/analytics");
  const policy = (entry: { headers: Array<{ key: string; value: string }> }) => entry.headers.find(item => item.key === "Content-Security-Policy")!.value;
  assert.doesNotMatch(policy(global), /googletagmanager|google-analytics/);
  assert.match(policy(global), /frame-src 'self'/);
  assert.match(policy(frame), /script-src 'self' https:\/\/www\.googletagmanager\.com/);
  assert.match(policy(frame), /frame-ancestors 'self'/);
  assert.match(readFileSync(new URL("../../analytics.html", import.meta.url), "utf8"), /noindex, nofollow, noarchive/);
  assert.doesNotMatch(readFileSync(new URL("../../public/sitemap.xml", import.meta.url), "utf8"), /\/analytics/);
});

test("public entry imports no auth, scanner, engine data or third-party tracker", () => {
  const source = readFileSync(new URL("../public-entry.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:auth|scoring|vision|history|photoStore|sideFlow|main)[^"']*["']/);
  assert.match(source, /captureAttribution\(\)/);
  assert.match(source, /mountPublicAnalyticsChoice/);
});

test("the prepared field-vitals collector is not shipped or mounted by either application entry", () => {
  for (const file of ["../public-entry.ts", "../main.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /import[^;]*publicVitals|mountPublicVitals\s*\(/);
  }
});

test("both public and Settings choices disclose failed persistence rather than claiming a saved choice", () => {
  const ui = readFileSync(new URL("../ui/analyticsConsent.ts", import.meta.url), "utf8");
  assert.match(ui, /Analytics is off for this page, but the choice may not survive a reload or reach other tabs/);
  const [setting, publicChoice] = ui.split("export function mountPublicAnalyticsChoice");
  for (const section of [setting, publicChoice]) assert.match(section, /controller\.persistenceFailed\(\).*PREFERENCE_WARNING/);
  assert.match(publicChoice, /if \(controller\.persistenceFailed\(\)\) opened = true/);
});
