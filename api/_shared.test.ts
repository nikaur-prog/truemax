import assert from "node:assert/strict";
import test from "node:test";
import { requestOrigin } from "./_shared.js";

test("same-origin Checkout returns to the deployment that opened it", () => {
  const previous = process.env.TRUEMAX_APP_URL;
  process.env.TRUEMAX_APP_URL = "https://www.truemax.app";
  try {
    const request = new Request("https://preview-123.vercel.app/api/create-checkout-session", {
      headers: { Origin: "https://preview-123.vercel.app" },
    });
    assert.equal(requestOrigin(request), "https://preview-123.vercel.app");
  } finally {
    if (previous === undefined) delete process.env.TRUEMAX_APP_URL;
    else process.env.TRUEMAX_APP_URL = previous;
  }
});

test("cross-origin Checkout is rejected", () => {
  const request = new Request("https://www.truemax.app/api/create-checkout-session", {
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(requestOrigin(request), null);
});

test("non-browser jobs fall back to the configured canonical origin", () => {
  const previous = process.env.TRUEMAX_APP_URL;
  process.env.TRUEMAX_APP_URL = "https://www.truemax.app/path";
  try {
    assert.equal(
      requestOrigin(new Request("https://deployment.vercel.app/api/health")),
      "https://www.truemax.app",
    );
  } finally {
    if (previous === undefined) delete process.env.TRUEMAX_APP_URL;
    else process.env.TRUEMAX_APP_URL = previous;
  }
});
