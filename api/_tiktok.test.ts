import assert from "node:assert/strict";
import test from "node:test";
import { listOwnTikTokVideos, tiktokVideoIdFromUrl } from "./_tiktok.js";

test("TikTok IDs come only from HTTPS TikTok video URLs", () => {
  assert.equal(tiktokVideoIdFromUrl("https://www.tiktok.com/@creator/video/1234567890"), "1234567890");
  assert.equal(tiktokVideoIdFromUrl("https://m.tiktok.com/@creator/video/123456"), "123456");
  assert.equal(tiktokVideoIdFromUrl("http://www.tiktok.com/@creator/video/1234567890"), null);
  assert.equal(tiktokVideoIdFromUrl("https://tiktok.com.evil.example/@creator/video/1234567890"), null);
  assert.equal(tiktokVideoIdFromUrl("javascript:alert(1)"), null);
});

test("TikTok paging keeps cursor zero and filters empty video IDs", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  let call = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
    call += 1;
    return Response.json(call === 1
      ? { data: { videos: [{ id: "", title: "bad" }, { id: "1", view_count: 4 }], cursor: 0, has_more: true } }
      : { data: { videos: [{ id: "2", comment_count: 3 }], has_more: false } });
  }) as typeof fetch;
  try {
    const videos = await listOwnTikTokVideos("token", 40, new Set(["2"]));
    assert.deepEqual(videos?.map((video) => video.id), ["1", "2"]);
    assert.equal(bodies[0].cursor, undefined);
    assert.equal(bodies[1].cursor, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TikTok paging stops safely when has_more has no cursor", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ data: { videos: [{ id: "1" }], has_more: true } });
  }) as typeof fetch;
  try {
    assert.deepEqual((await listOwnTikTokVideos("token", 200))?.map((video) => video.id), ["1"]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TikTok paging respects the requested maximum and de-duplicates pages", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json(calls === 1
      ? { data: { videos: Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1) })), cursor: 20, has_more: true } }
      : { data: { videos: [{ id: "10" }, { id: "21" }], cursor: 20, has_more: true } });
  }) as typeof fetch;
  try {
    const ten = await listOwnTikTokVideos("token", 10);
    assert.equal(ten?.length, 10);
    assert.equal(calls, 1);

    calls = 0;
    const many = await listOwnTikTokVideos("token", 40);
    assert.equal(many?.filter((video) => video.id === "10").length, 1);
    assert.equal(calls, 2, "a repeated cursor must stop pagination");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
