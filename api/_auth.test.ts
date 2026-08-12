import assert from "node:assert/strict";
import test from "node:test";
import { authRedirects } from "../src/engine/auth.ts";

test("ordinary auth returns to the scan while password recovery uses the portal", () => {
  const redirects = authRedirects("https://www.truemax.app/some/path");
  assert.equal(redirects.scan, "https://www.truemax.app/");
  assert.equal(redirects.reset, "https://www.truemax.app/auth?mode=reset");
});

test("preview and local origins are preserved instead of forcing production", () => {
  assert.equal(authRedirects("http://localhost:5173").scan, "http://localhost:5173/");
  assert.equal(
    authRedirects("https://truemax-preview.vercel.app").reset,
    "https://truemax-preview.vercel.app/auth?mode=reset",
  );
});
