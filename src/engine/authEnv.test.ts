import test from "node:test";
import assert from "node:assert/strict";

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
