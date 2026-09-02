import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

interface HeaderConfig {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

const config = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
) as { headers: HeaderConfig[] };

function contentSecurityPolicy(): string {
  const globalHeaders = config.headers.find((entry) => entry.source === "/(.*)");
  const policy = globalHeaders?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
  assert.ok(policy, "the global Content-Security-Policy header is missing");
  return policy;
}

function directive(policy: string, name: string): string[] {
  const match = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([directiveName]) => directiveName === name);
  assert.ok(match, `${name} is missing from the production CSP`);
  return match.slice(1);
}

test("TikTok covers, profile images and the official player can render", () => {
  const policy = contentSecurityPolicy();
  assert.ok(
    directive(policy, "img-src").includes("https://*.tiktokcdn.com"),
    "TikTok-signed cover and avatar URLs are blocked",
  );
  assert.deepEqual(
    directive(policy, "frame-src"),
    ["https://www.tiktok.com"],
    "only the official TikTok player may be framed",
  );
});

test("TikTok display permissions do not weaken the surrounding frame policy", () => {
  const policy = contentSecurityPolicy();
  assert.deepEqual(directive(policy, "frame-ancestors"), ["'none'"]);
  assert.deepEqual(directive(policy, "object-src"), ["'none'"]);
  assert.ok(!directive(policy, "img-src").includes("https:"), "img-src must not allow every HTTPS origin");
});
