import test from "node:test";
import assert from "node:assert/strict";
import { attributionMetadata, clickIdFrom, reportPurchase } from "./_attribution.js";

// The client sends this, so it is hostile input until proven otherwise. It ends
// up in Stripe metadata that a human reads in a dashboard, and the worst a
// crafted body may achieve is a wrong row in a revenue report.

test("a normal attribution becomes Stripe metadata keys", () => {
  const meta = attributionMetadata({
    source: "tiktok",
    medium: "cpc",
    campaign: "aug",
    content: "hook-3",
    ttclid: "ABC",
    at: "2026-08-30T00:00:00.000Z",
  });
  assert.equal(meta.attr_src, "tiktok");
  assert.equal(meta.attr_cnt, "hook-3");
  assert.equal(meta.attr_ttclid, "ABC");
  assert.equal(meta.attr_at, "2026-08-30T00:00:00.000Z");
});

test("unknown keys are dropped, not forwarded", () => {
  // Stripe caps metadata at 50 keys. A body that could add its own would let
  // anyone push a real key out of a Session.
  const meta = attributionMetadata({
    source: "tiktok",
    supabase_user_id: "someone-else",
    purpose: "scan_credit",
    evil: "x",
  });
  assert.deepEqual(Object.keys(meta), ["attr_src"]);
});

test("non-strings are dropped rather than coerced", () => {
  const meta = attributionMetadata({ source: 42, medium: null, campaign: {}, content: ["a"] });
  assert.deepEqual(meta, {});
});

test("values are capped and control characters stripped", () => {
  const meta = attributionMetadata({
    campaign: "x".repeat(1000),
    content: "a\nb\u0000c",
  });
  assert.equal(meta.attr_cmp.length, 190, "well inside Stripe's 500-character limit");
  assert.equal(meta.attr_cnt, "abc");
});

test("nonsense input yields an empty object the caller can spread", () => {
  assert.deepEqual(attributionMetadata(null), {});
  assert.deepEqual(attributionMetadata("tiktok"), {});
  assert.deepEqual(attributionMetadata(undefined), {});
  assert.deepEqual(attributionMetadata(123), {});
});

test("the click id comes back out of metadata", () => {
  assert.deepEqual(clickIdFrom({ attr_ttclid: "ABC", attr_ttp: "P" }), { ttclid: "ABC", ttp: "P" });
  assert.deepEqual(clickIdFrom({}), { ttclid: undefined, ttp: undefined });
  assert.deepEqual(clickIdFrom(null), { ttclid: undefined, ttp: undefined });
});

// The conversion report is optional infrastructure. Unconfigured it must do
// nothing, silently, so this ships before the ad account exists.
test("reporting is a no-op until it is configured", async () => {
  const pixel = process.env.TIKTOK_PIXEL_ID;
  const token = process.env.TIKTOK_EVENTS_TOKEN;
  delete process.env.TIKTOK_PIXEL_ID;
  delete process.env.TIKTOK_EVENTS_TOKEN;
  try {
    const result = await reportPurchase({
      eventId: "evt_1",
      ttclid: "ABC",
      valueMinor: 299,
      currency: "usd",
    });
    assert.equal(result, "skipped");
  } finally {
    if (pixel) process.env.TIKTOK_PIXEL_ID = pixel;
    if (token) process.env.TIKTOK_EVENTS_TOKEN = token;
  }
});

test("a sale with no click identifier is not reported", async () => {
  // Nothing to match it to, so the call would spend a round trip to report an
  // unattributable purchase. Checked even when credentials exist.
  process.env.TIKTOK_PIXEL_ID = "test-pixel";
  process.env.TIKTOK_EVENTS_TOKEN = "test-token";
  try {
    const result = await reportPurchase({ eventId: "evt_2", valueMinor: 299, currency: "usd" });
    assert.equal(result, "skipped");
  } finally {
    delete process.env.TIKTOK_PIXEL_ID;
    delete process.env.TIKTOK_EVENTS_TOKEN;
  }
});

test("a network failure is swallowed, never thrown", async () => {
  // This runs after a payment has already been taken and fulfilled. A third
  // party having a bad afternoon must not be able to fail a paid scan.
  process.env.TIKTOK_PIXEL_ID = "test-pixel";
  process.env.TIKTOK_EVENTS_TOKEN = "test-token";
  const realFetch = globalThis.fetch;
  const realError = console.error;
  globalThis.fetch = () => Promise.reject(new Error("network down"));
  console.error = () => {};
  try {
    const result = await reportPurchase({
      eventId: "evt_3",
      ttclid: "ABC",
      valueMinor: 299,
      currency: "usd",
    });
    assert.equal(result, "failed");
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete process.env.TIKTOK_PIXEL_ID;
    delete process.env.TIKTOK_EVENTS_TOKEN;
  }
});

test("the payload carries a click id and money, and no person", async () => {
  process.env.TIKTOK_PIXEL_ID = "test-pixel";
  process.env.TIKTOK_EVENTS_TOKEN = "test-token";
  const realFetch = globalThis.fetch;
  let sent: Record<string, unknown> | null = null;
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify({ code: 0, message: "OK" }), { status: 200 }));
  }) as typeof fetch;
  try {
    const outcome = await reportPurchase({
      eventId: "evt_4",
      ttclid: "ABC",
      valueMinor: 1199,
      currency: "usd",
      occurredAt: 1_700_000_000_000,
    });
    // ASSERTED, not merely awaited. This test mocked a bare `{}` and never
    // looked at what came back, so it passed while the function reported that
    // exact response as a success.
    assert.equal(outcome, "sent");
    const body = sent as unknown as { data: [{ event: string; properties: { value: number; currency: string }; event_time: number; event_id: string; user: Record<string, unknown> }] };
    // TikTok's current standard name. It was CompletePayment, and the old name
    // is still accepted and mapped, so this is not a conversion-loss fix: it is
    // that a configuration being set up now should match the standard as it
    // stands, rather than needing its history known to see that both ends agree.
    assert.equal(body.data[0].event, "Purchase");
    // Stripe counts minor units; TikTok wants the major one.
    assert.equal(body.data[0].properties.value, 11.99);
    assert.equal(body.data[0].properties.currency, "USD");
    // The payment's own time, so a webhook retried an hour later does not
    // report an hour-late conversion.
    assert.equal(body.data[0].event_time, 1_700_000_000);
    // Stripe's event id, so a replayed webhook deduplicates at TikTok's end.
    assert.equal(body.data[0].event_id, "evt_4");
    // AND NOTHING THAT DESCRIBES A PERSON. This is the assertion that has to
    // survive somebody later "improving match rates".
    assert.deepEqual(Object.keys(body.data[0].user), ["ttclid"]);
    const raw = JSON.stringify(sent);
    for (const forbidden of ["email", "phone", "ip", "user_agent", "external_id", "sha256"]) {
      assert.ok(!raw.includes(forbidden), `payload must not carry ${forbidden}`);
    }
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.TIKTOK_PIXEL_ID;
    delete process.env.TIKTOK_EVENTS_TOKEN;
  }
});

// A literal control character in the source makes GitHub treat the whole file
// as binary and refuse to render a diff — so the tests guarding the sanitiser
// become the ones nobody can review. Both files shipped that way once. The
// escaped forms assert exactly the same thing and stay readable.
test("neither attribution test file contains a raw control character", async () => {
  const { readFileSync } = await import("node:fs");
  for (const url of [
    new URL("./_attribution.test.ts", import.meta.url),
    new URL("../src/engine/attribution.test.ts", import.meta.url),
  ]) {
    const bytes = readFileSync(url);
    const raw = [...bytes].filter((b) => b < 9 || (b > 13 && b < 32) || b === 127);
    assert.deepEqual(raw, [], `${url.pathname} must escape control characters, not embed them`);
  }
});

// SUCCESS IS STATED, NOT INFERRED.
//
// The Events API answers HTTP 200 and puts the outcome in the body. The first
// version rejected only a numeric non-zero `code`, so the one shape most likely
// to arrive from a proxy, a gateway error page or a moved field — a bare 200
// with no code — was reported as a sale. Downstream that is indistinguishable
// from an ad that converts and never gets paid for.
const okBody = (body: unknown) =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))) as unknown as typeof fetch;

async function outcomeFor(body: unknown): Promise<string> {
  process.env.TIKTOK_PIXEL_ID = "test-pixel";
  process.env.TIKTOK_EVENTS_TOKEN = "test-token";
  const realFetch = globalThis.fetch;
  const realError = console.error;
  globalThis.fetch = okBody(body);
  console.error = () => {};
  try {
    return await reportPurchase({ eventId: "e", ttclid: "ABC", valueMinor: 299, currency: "usd" });
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete process.env.TIKTOK_PIXEL_ID;
    delete process.env.TIKTOK_EVENTS_TOKEN;
  }
}

test("a 200 carrying nothing is a failure, not a sale", async () => {
  assert.equal(await outcomeFor({}), "failed");
  assert.equal(await outcomeFor(null), "failed");
  assert.equal(await outcomeFor({ message: "ok" }), "failed", "a message is not a code");
});

test("a 200 stating an error code is a failure", async () => {
  assert.equal(await outcomeFor({ code: 40002, message: "invalid pixel code" }), "failed");
  assert.equal(await outcomeFor({ code: "0" }), "failed", "the string zero is not the number zero");
});

test("a partial failure inside a successful envelope is a failure", async () => {
  assert.equal(await outcomeFor({ code: 0, data: { partial_failure: true } }), "failed");
  assert.equal(await outcomeFor({ code: 0, data: { failed_events: [{ index: 0 }] } }), "failed");
});

test("only code 0 with nothing failed is a sale", async () => {
  assert.equal(await outcomeFor({ code: 0, message: "OK" }), "sent");
  assert.equal(await outcomeFor({ code: 0, data: { failed_events: [] } }), "sent");
});

test("a transient failure is retried once, and the retry cannot double-count", async () => {
  // Stripe has already been answered 200 by the time anybody reads this
  // result, so nothing else retries a failure: one blip loses the sale from
  // the report for good. Safe to repeat because the payload carries the Stripe
  // event id, which is what TikTok deduplicates on.
  process.env.TIKTOK_PIXEL_ID = "test-pixel";
  process.env.TIKTOK_EVENTS_TOKEN = "test-token";
  const realFetch = globalThis.fetch;
  const realError = console.error;
  console.error = () => {};
  const sentIds: string[] = [];
  let call = 0;
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { data: [{ event_id: string }] };
    sentIds.push(body.data[0].event_id);
    call++;
    return Promise.resolve(
      new Response(JSON.stringify(call === 1 ? { code: 40100 } : { code: 0 }), { status: 200 }),
    );
  }) as typeof fetch;
  try {
    const result = await reportPurchase({
      eventId: "evt_retry",
      ttclid: "ABC",
      valueMinor: 299,
      currency: "usd",
    });
    assert.equal(result, "sent", "the second attempt recovers the sale");
    assert.equal(call, 2, "exactly one retry, never a loop");
    assert.deepEqual(sentIds, ["evt_retry", "evt_retry"], "the same event id, so TikTok drops the duplicate");
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete process.env.TIKTOK_PIXEL_ID;
    delete process.env.TIKTOK_EVENTS_TOKEN;
  }
});

test("a sustained failure stops after the retry rather than looping", async () => {
  assert.equal(await outcomeFor({ code: 40100 }), "failed");
});

test("the retry shares one budget rather than doubling the bound", async () => {
  // settle() awaits this before the response is constructed, so Stripe has NOT
  // been answered while it runs. A timeout applied per attempt with one retry
  // is a six second hold on a payment webhook, described in the code as three.
  const source = (await import("node:fs")).readFileSync(
    new URL("./_attribution.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /const deadline = Date\.now\(\) \+ TOTAL_BUDGET_MS/);
  assert.match(source, /deadline - Date\.now\(\) < MIN_RETRY_MS/, "no retry without budget left");
  assert.match(source, /deadline - Date\.now\(\)/, "each attempt is bounded by what is LEFT");
  assert.doesNotMatch(source, /setTimeout\(\(\) => abort\.abort\(\), TOTAL_BUDGET_MS\)/);
});

test("a first attempt that eats the whole budget is not retried", async () => {
  process.env.TIKTOK_PIXEL_ID = "test-pixel";
  process.env.TIKTOK_EVENTS_TOKEN = "test-token";
  const realFetch = globalThis.fetch;
  const realError = console.error;
  console.error = () => {};
  let calls = 0;
  // Consumes the budget and then fails, exactly as a timeout does.
  globalThis.fetch = (() => {
    calls++;
    return new Promise((resolve) =>
      setTimeout(() => resolve(new Response("{}", { status: 500 })), 3100),
    );
  }) as typeof fetch;
  try {
    const result = await reportPurchase({
      eventId: "evt_slow",
      ttclid: "ABC",
      valueMinor: 299,
      currency: "usd",
    });
    assert.equal(result, "failed");
    assert.equal(calls, 1, "the budget was spent, so there is nothing left to retry with");
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete process.env.TIKTOK_PIXEL_ID;
    delete process.env.TIKTOK_EVENTS_TOKEN;
  }
});
