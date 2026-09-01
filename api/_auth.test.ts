import assert from "node:assert/strict";
import test from "node:test";
import { authRedirects, authUrlCandidates, safeOAuthRedirect } from "../src/engine/auth.js";

test("ordinary auth returns to the scan while password recovery uses the portal", () => {
  const redirects = authRedirects("https://www.truemax.app/some/path");
  assert.equal(redirects.scan, "https://www.truemax.app/");
  assert.equal(redirects.reset, "https://www.truemax.app/auth?mode=reset");
});

test("the branded Auth cutover falls back only to the same built-in project", () => {
  assert.deepEqual(authUrlCandidates("https://auth.truemax.app"), [
    "https://auth.truemax.app",
    "https://ruvgkrlfmixfnmnzqgap.supabase.co",
  ]);
  assert.deepEqual(authUrlCandidates("https://staging.example.com"), ["https://staging.example.com"]);
});

test("social sign-in navigates only to the active Supabase authorize route", () => {
  const origin = "https://ruvgkrlfmixfnmnzqgap.supabase.co";
  const good = `${origin}/auth/v1/authorize?provider=google`;
  assert.equal(safeOAuthRedirect(good, origin), good);
  assert.equal(safeOAuthRedirect("https://accounts.google.com/o/oauth2/auth", origin), null);
  assert.equal(safeOAuthRedirect(`${origin}/rest/v1/profiles`, origin), null);
  assert.equal(safeOAuthRedirect(`${origin}/auth/v1/authorize-elsewhere`, origin), null);
  assert.equal(safeOAuthRedirect(null, origin), null);
});

test("preview and local origins are preserved instead of forcing production", () => {
  assert.equal(authRedirects("http://localhost:5173").scan, "http://localhost:5173/");
  assert.equal(
    authRedirects("https://truemax-preview.vercel.app").reset,
    "https://truemax-preview.vercel.app/auth?mode=reset",
  );
});
