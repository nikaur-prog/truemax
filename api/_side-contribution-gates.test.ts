import assert from "node:assert/strict";
import test from "node:test";
import { SIDE_POINTS } from "../src/engine/sideMetrics.js";
import { SIDE_FEEDBACK_CONSENT_VERSION } from "../src/engine/sideFeedbackPayload.js";
import { POST } from "./side-correction-feedback.js";

const USER = "11111111-1111-4111-8111-111111111111";
const SCAN = "a42ad7cd-2285-4f0a-82f8-f075588101f8";
const SUBMISSION = "b42ad7cd-2285-4f0a-82f8-f075588101f9";
const ORIGIN = "https://side-contribution-tests.invalid";
type Write = { path: string; method: string; payload: Record<string, unknown> | null };

/** Real route and Supabase query builders, fake HTTP only: no project access. */
function fixture(options: { dob?: string | null; missing?: boolean; profileError?: boolean; existing?: boolean; staff?: boolean; authError?: boolean } = {}) {
  const reads: string[] = [];
  const writes: Write[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, ORIGIN, "test must never contact a real project");
    const path = url.pathname;
    if (path === "/auth/v1/user") {
      if (options.authError) return Response.json({ message: "Invalid token" }, { status: 401 });
      return Response.json({ id: USER, aud: "authenticated", role: "authenticated" });
    }
    if (request.method === "GET") {
      reads.push(path);
      if (path === "/rest/v1/profiles") {
        assert.equal(url.searchParams.get("user_id"), `eq.${USER}`, "server uses authenticated account, not request metadata");
        if (options.profileError) return Response.json({ message: "Profile read failed", code: "TEST" }, { status: 400 });
        return Response.json(options.missing ? [] : [{ date_of_birth: options.dob === undefined ? "1990-01-01" : options.dob }]);
      }
      if (path === "/rest/v1/side_landmark_feedback") return Response.json(options.existing ? [{
        id: SUBMISSION, scan_id: SCAN, user_id: USER, consent_version: SIDE_FEEDBACK_CONSENT_VERSION,
      }] : []);
      if (path === "/rest/v1/app_admins") return Response.json(options.staff ? [{ user_id: USER }] : []);
      assert.fail(`Unexpected read: ${path}`);
    }
    const payload = request.headers.get("content-type")?.includes("json")
      ? await request.json() as Record<string, unknown> : null;
    writes.push({ path, method: request.method, payload });
    if (path === "/rest/v1/rpc/claim_side_feedback_upload") return Response.json("claimed");
    if (path === "/rest/v1/rpc/finalize_side_feedback_upload") return Response.json(true);
    if (path.startsWith("/storage/v1/object/side-correction-feedback/")) {
      assert.equal(path, `/storage/v1/object/side-correction-feedback/${USER}/${SUBMISSION}.jpg`);
      return Response.json({ Key: `${USER}/${SUBMISSION}.jpg` });
    }
    if (path === "/rest/v1/side_landmark_feedback" || path === "/rest/v1/side_feedback_consent_events") {
      assert.equal(request.method, "POST");
      return new Response(null, { status: 201 });
    }
    assert.fail(`Unexpected write: ${path}`);
  };
  return { fetcher, reads, writes };
}

function request(subjectConfirmation: unknown = "my-own-adult-face", authenticated = true): Request {
  const points = Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [id, { x: 40 + index * 4, y: 50 + index * 5 }]));
  const jpeg = new Uint8Array(120);
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xf4, 0x01, 0x90, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  jpeg.set([0xff, 0xd9], jpeg.length - 2);
  const body = new FormData();
  body.set("metadata", JSON.stringify({
    scanId: SCAN, submissionId: SUBMISSION, consentVersion: SIDE_FEEDBACK_CONSENT_VERSION,
    faceDir: 1, width: 400, height: 500, seedMethod: "mesh",
    automaticPoints: points, correctedPoints: points,
    ...(subjectConfirmation === "legacy" ? {} : { subjectConfirmation }),
    // These must never override server-controlled account eligibility.
    userId: USER, dateOfBirth: "1990-01-01", isAdult: true,
  }));
  body.set("photo", new File([jpeg], "profile.jpg", { type: "image/jpeg" }));
  return new Request("https://truemax.app/api/side-correction-feedback", {
    method: "POST", body,
    headers: { origin: "https://truemax.app", ...(authenticated ? { authorization: "Bearer test-contribution-token" } : {}) },
  });
}

test("optional contribution server gate runs before every storage and database write", { timeout: 15000 }, async (t) => {
  const savedFetch = globalThis.fetch;
  const savedUrl = process.env.SUPABASE_URL;
  const savedSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = ORIGIN;
  process.env.SUPABASE_SECRET_KEY = "side-contribution-test-secret";
  let current = fixture();
  globalThis.fetch = (input, init) => current.fetcher(input, init);
  try {
    const minorDob = `${new Date().getUTCFullYear() - 10}-01-01`;
    for (const scenario of [
      { name: "minor", options: { dob: minorDob }, status: 403 },
      { name: "minor staff member", options: { dob: minorDob, staff: true }, status: 403 },
      { name: "missing DOB", options: { dob: null }, status: 403 },
      { name: "missing profile", options: { missing: true }, status: 403 },
      { name: "invalid DOB", options: { dob: "invalid" }, status: 403 },
      { name: "failed profile lookup", options: { profileError: true }, status: 503 },
    ]) {
      await t.test(`${scenario.name} cannot upload even with forged adult metadata`, async () => {
        current = fixture(scenario.options);
        assert.equal((await POST(request())).status, scenario.status);
        assert.deepEqual(current.reads, ["/rest/v1/profiles"]);
        assert.deepEqual(current.writes, [], "no quota claim, object, feedback row, or consent event");
      });
    }
    for (const subject of ["legacy", "guest", "friend", null]) {
      await t.test(`an adult with ${subject} declaration cannot upload`, async () => {
        current = fixture();
        const response = await POST(request(subject));
        assert.ok(response.status === 400 || response.status === 403);
        assert.deepEqual(current.writes, []);
      });
    }
    await t.test("no token and rejected token cannot reach profile or storage", async () => {
      current = fixture({ authError: true });
      assert.equal((await POST(request("my-own-adult-face", false))).status, 401);
      assert.equal((await POST(request())).status, 401);
      assert.deepEqual(current.reads, []);
      assert.deepEqual(current.writes, []);
    });
    await t.test("consenting adult uploads to their private path, never marks labels expert-reviewed", async () => {
      current = fixture();
      assert.equal((await POST(request())).status, 200);
      assert.deepEqual(current.writes.map(({ path }) => path), [
        "/rest/v1/rpc/claim_side_feedback_upload",
        `/storage/v1/object/side-correction-feedback/${USER}/${SUBMISSION}.jpg`,
        "/rest/v1/side_landmark_feedback", "/rest/v1/side_feedback_consent_events",
        "/rest/v1/rpc/finalize_side_feedback_upload",
      ]);
      assert.equal(current.writes[2].payload?.review_status, "new");
      const details = current.writes[3].payload?.details as Record<string, unknown>;
      assert.equal(details.subjectConfirmation, "my-own-adult-face");
    });
    await t.test("idempotent repair retains own-face consent without substituting retry geometry", async () => {
      current = fixture({ existing: true });
      const response = await POST(request());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).duplicate, true);
      assert.equal(current.writes.length, 1, "retry never reuploads or consumes quota");
      assert.equal(current.writes[0].path, "/rest/v1/side_feedback_consent_events");
      assert.deepEqual(current.writes[0].payload?.details, {
        source: "idempotent_retry", subjectConfirmation: "my-own-adult-face",
      });
    });
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = savedSecret;
  }
});
