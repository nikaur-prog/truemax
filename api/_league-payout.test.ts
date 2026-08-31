import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedPayoutCountries,
  leaguePayoutAccountState,
  payoutCountryAllowed,
  stripeLivemode,
  validCountry,
  validEntityType,
} from "./_league-payout.js";

function account(
  transfers: string | undefined,
  payouts: string | undefined,
  requirements = 0,
) {
  return {
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: transfers ? { status: transfers, status_details: [] } : undefined,
            payouts: payouts ? { status: payouts, status_details: [] } : undefined,
          },
        },
      },
    },
    requirements: { entries: Array.from({ length: requirements }, () => ({})) },
  } as never;
}

test("a recipient is ready only when transfers, payouts and requirements are clear", () => {
  assert.equal(leaguePayoutAccountState(account("active", "active")).ready, true);
  assert.equal(leaguePayoutAccountState(account("pending", "active")).ready, false);
  assert.equal(leaguePayoutAccountState(account("active", "restricted")).ready, false);
  assert.equal(leaguePayoutAccountState(account("active", "active", 1)).ready, false);
});

test("missing or new capability values fail closed", () => {
  const state = leaguePayoutAccountState(account(undefined, "future_status"));
  assert.equal(state.transfersStatus, "unknown");
  assert.equal(state.payoutsStatus, "unknown");
  assert.equal(state.ready, false);
});

test("Stripe mode recognises secret and restricted live keys", () => {
  assert.equal(stripeLivemode("sk_live_value"), true);
  assert.equal(stripeLivemode("rk_live_value"), true);
  assert.equal(stripeLivemode("sk_test_value"), false);
  assert.equal(stripeLivemode(""), false);
});

test("account identity inputs are narrow", () => {
  assert.equal(validCountry("NZ"), true);
  assert.equal(validCountry("nz"), false);
  assert.equal(validCountry("NZZ"), false);
  assert.equal(validEntityType("individual"), true);
  assert.equal(validEntityType("government_entity"), false);
});

test("payout countries fail closed to the approved Stripe corridors", () => {
  assert.deepEqual([...allowedPayoutCountries("nz, AU,not-a-country")], ["NZ", "AU"]);
  assert.equal(payoutCountryAllowed("NZ", "NZ,AU"), true);
  assert.equal(payoutCountryAllowed("US", "NZ,AU"), false);
  assert.equal(payoutCountryAllowed("NZ", ""), false);
});
