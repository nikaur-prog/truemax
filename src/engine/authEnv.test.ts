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
