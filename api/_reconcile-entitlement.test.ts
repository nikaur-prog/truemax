import assert from "node:assert/strict";
import test from "node:test";
import { chooseCurrentSubscription } from "./reconcile-entitlement.js";

function subscription(id: string, status: string, created: number) {
  return { id, status, created };
}

test("reconciliation chooses the newest current subscription", () => {
  const chosen = chooseCurrentSubscription([
    subscription("sub_canceled", "canceled", 30),
    subscription("sub_old", "active", 10),
    subscription("sub_current", "trialing", 20),
  ] as never);

  assert.equal(chosen?.id, "sub_current");
});

test("reconciliation does not revive a canceled subscription", () => {
  const chosen = chooseCurrentSubscription([
    subscription("sub_canceled", "canceled", 30),
    subscription("sub_expired", "incomplete_expired", 20),
  ] as never);

  assert.equal(chosen, null);
});
