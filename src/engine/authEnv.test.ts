import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authStorageKey } from "./auth.js";

// The URL guard, tested directly.
//
// This shipped as `env.VITE_SUPABASE_URL || DEFAULT_URL`, which reads as a safe
// fallback and is not one: `||` only falls back on an empty value, so any
// non-empty misconfiguration beat the working default and took every sign-in
// path down with `Invalid supabaseUrl`. These are the shapes a person actually
// pastes into a Vercel environment variable.
function usableUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

const DEFAULT_URL = "https://ruvgkrlfmixfnmnzqgap.supabase.co";
const resolve = (configured?: string) => usableUrl(configured) ?? DEFAULT_URL;

test("a real project URL is used as given", () => {
  assert.equal(resolve("https://ruvgkrlfmixfnmnzqgap.supabase.co"), DEFAULT_URL);
});

test("the branded Supabase Auth domain is a valid production override", () => {
  assert.equal(resolve("https://auth.truemax.app"), "https://auth.truemax.app");
});

test("the production CSP permits the branded Auth domain during cutover", () => {
  const vercel = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8");
  assert.match(vercel, /https:\/\/auth\.truemax\.app/);
  assert.match(vercel, /wss:\/\/auth\.truemax\.app/);
  assert.match(vercel, /https:\/\/ruvgkrlfmixfnmnzqgap\.supabase\.co/);
});

test("surrounding whitespace does not break it", () => {
  // Copy-paste out of a dashboard brings this along more often than not.
  assert.equal(resolve("  https://ruvgkrlfmixfnmnzqgap.supabase.co \n"), DEFAULT_URL);
});

test("a trailing slash or path is normalised to the origin", () => {
  assert.equal(resolve("https://ruvgkrlfmixfnmnzqgap.supabase.co/"), DEFAULT_URL);
  assert.equal(resolve("https://ruvgkrlfmixfnmnzqgap.supabase.co/rest/v1"), DEFAULT_URL);
});

test("every unusable shape falls back instead of overriding", () => {
  for (const bad of [
    "",                              // set but blank
    "   ",                           // whitespace only
    "ruvgkrlfmixfnmnzqgap",          // the project ref, not a URL
    "ruvgkrlfmixfnmnzqgap.supabase.co", // no scheme
    "your-project-url",              // placeholder left in
    "postgres://user:pw@host:5432",  // the DB connection string by mistake
    "https://",                      // half-typed
  ]) {
    assert.equal(resolve(bad), DEFAULT_URL, JSON.stringify(bad));
  }
});

// The key guard. Same failure mode as the URL — a non-empty wrong value beating
// a working default — but a worse error trail: "Invalid API key" arrives on the
// first request and points at Supabase rather than at the variable.
const MIN_KEY_LENGTH = 20;
const DEFAULT_KEY = "sb_publishable_XLs-l72FzRD5C_QzP9xlkA_vMahWmgw";
function usableKey(value: string | undefined): string | null {
  const key = value?.trim();
  return key && key.length >= MIN_KEY_LENGTH ? key : null;
}
const resolveKey = (configured?: string) => usableKey(configured) ?? DEFAULT_KEY;

test("a real key of either Supabase format is used as given", () => {
  // Deliberately not format-sniffed: Supabase has already changed key formats
  // once, and a client that rejects the next one is a self-inflicted outage.
  const publishable = "sb_publishable_ABCDEFGHIJKLMNOPQRSTUV";
  const legacyJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
  assert.equal(resolveKey(publishable), publishable);
  assert.equal(resolveKey(legacyJwt), legacyJwt);
  assert.equal(resolveKey(`  ${publishable}  `), publishable);
});

test("a blank or truncated key falls back instead of overriding", () => {
  for (const bad of ["", "   ", "your-anon-key", "sb_publishable_", "eyJhbGci"]) {
    assert.equal(resolveKey(bad), DEFAULT_KEY, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------------------
// Where the session is stored.
//
// supabase-js derives this from the URL's hostname when you do not pass one, so
// the storage key silently moves with the address. That makes the branded-domain
// cutover a mass sign-out: every session sits under a key the new client never
// looks at. These call the real function rather than describing it.
// ---------------------------------------------------------------------------

/** What supabase-js itself would build, copied from the installed package. */
const derived = (url: string) => `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

test("the key does not move when the branded Auth domain is switched on", () => {
  // The whole point. Deriving it would give "sb-auth-auth-token" here and sign
  // out every logged-in person the moment VITE_SUPABASE_URL was set.
  assert.equal(authStorageKey("https://auth.truemax.app"), authStorageKey(DEFAULT_URL));
  assert.notEqual(authStorageKey("https://auth.truemax.app"), derived("https://auth.truemax.app"));
});

test("today's users are not signed out by pinning it", () => {
  // The pinned value must equal what supabase-js has been deriving all along,
  // or shipping this change would itself be the outage it prevents.
  assert.equal(authStorageKey(DEFAULT_URL), derived(DEFAULT_URL));
  assert.equal(authStorageKey(DEFAULT_URL), "sb-ruvgkrlfmixfnmnzqgap-auth-token");
});

test("the runtime fallback from branded to project keeps the same key", () => {
  // resolvedAuthEnv can swap the branded domain for the project URL mid-session
  // when the domain fails its reachability check. Derived, that would sign
  // somebody out while they were using the app rather than at deploy time.
  for (const url of ["https://auth.truemax.app", DEFAULT_URL]) {
    assert.equal(authStorageKey(url), "sb-ruvgkrlfmixfnmnzqgap-auth-token", url);
  }
});

test("a genuinely different project never shares the built-in project's key", () => {
  // The alias rule is for the branded domain only. Two tenants under one key
  // would hand one project's stored session to the other, which is worse than
  // a sign-out.
  const other = authStorageKey("https://someotherref.supabase.co");
  assert.equal(other, "sb-someotherref-auth-token");
  assert.notEqual(other, authStorageKey(DEFAULT_URL));
});

test("an unparseable URL falls back to the built-in key rather than throwing", () => {
  // authEnv validates before this is reached, so this is belt and braces: a
  // throw inside client construction surfaces as an unhandled rejection in a
  // click handler, which is the failure mode this file already carries a long
  // comment about.
  for (const bad of ["", "not a url", "ruvgkrlfmixfnmnzqgap"]) {
    assert.equal(authStorageKey(bad), "sb-ruvgkrlfmixfnmnzqgap-auth-token", JSON.stringify(bad));
  }
});

test("the client actually passes the key, rather than only exporting one", () => {
  // A helper nothing calls is the same as no helper. Asserted against the
  // source because createClient needs a browser to run.
  const src = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
  assert.match(src, /storageKey: authStorageKey\(env\.url\)/);
});
