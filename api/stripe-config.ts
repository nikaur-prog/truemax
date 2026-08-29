import { getStripe, json } from "./_shared.js";

// ---------------------------------------------------------------------------
// Do the configured price IDs actually exist, in the mode the key is in?
//
// /api/health answers a different and much weaker question: is the environment
// variable SET. It reported STRIPE_MAX_PRICE_ID: true for months while the live
// Stripe account held zero products and zero prices, because the variable was
// populated with an ID minted in the sandbox. Present and valid are not the
// same claim, and the gap between them is the whole reason a payment path can
// look configured on a dashboard and fail at the checkout button.
//
// That gap is easy to fall into rather than careless. A price ID is an opaque
// string in both modes; nothing about `price_1ABC...` says which account it
// belongs to. The only way to know is to ask Stripe with the key you actually
// deploy with, which is exactly what this does.
//
// Deliberately NOT folded into /api/health. That route imports nothing on
// purpose — it is the probe you run when every other function is crashing, and
// importing the Stripe SDK into it would destroy the one property it has.
//
// Access: the CRON_SECRET, because the answer names your product catalogue and
// prices. None of that is truly secret — a customer sees it at checkout — but
// it is configuration rather than marketing, and an unauthenticated endpoint
// enumerating your billing setup is not worth the convenience.
// ---------------------------------------------------------------------------

// Every price the server will try to charge, under both accepted names. Kept
// in step with create-checkout-session.ts and scan pricing: a price that is
// resolved at runtime but missing from this list is a hole in the check.
const PRICES: Array<{ label: string; names: string[] }> = [
  { label: "Starter monthly", names: ["STRIPE_STARTER_PRICE_ID", "STRIPE_PRICE_STARTER_MONTHLY"] },
  { label: "Max monthly", names: ["STRIPE_MAX_PRICE_ID", "STRIPE_PRICE_MAX_MONTHLY"] },
  { label: "Max annual", names: ["STRIPE_MAX_ANNUAL_PRICE_ID", "STRIPE_PRICE_MAX_ANNUAL"] },
  { label: "Extra scan", names: ["STRIPE_SCAN_PRICE_ID", "STRIPE_PRICE_EXTRA_SCAN_STANDARD"] },
  { label: "Extra scan (member)", names: ["STRIPE_MEMBER_SCAN_PRICE_ID", "STRIPE_PRICE_EXTRA_SCAN_MEMBER"] },
  { label: "Voiced analysis", names: ["STRIPE_VOICED_PRICE_ID", "STRIPE_PRICE_VOICED_ANALYSIS"] },
];

interface PriceReport {
  label: string;
  configured: boolean;
  resolves?: boolean;
  active?: boolean;
  livemode?: boolean;
  amount?: string;
  interval?: string;
  product?: string;
  error?: string;
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  // Fails closed when CRON_SECRET is unset, rather than open. An unconfigured
  // deployment is exactly where a leak would go unnoticed. Keep the secret in
  // the Authorization header: query strings are routinely retained in access
  // logs, browser history, screenshots, and copied diagnostic URLs.
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Not found" }, 404);
  }

  const key = process.env.STRIPE_SECRET_KEY ?? "";
  // The prefix, not a value. sk_live_ vs sk_test_ is the single most useful
  // fact here and it is the part of the key that is not a credential.
  const keyMode = key.startsWith("sk_live_")
    ? "live"
    : key.startsWith("sk_test_")
      ? "test"
      : key
        ? "unrecognised"
        : "missing";

  const stripe = getStripe();
  const prices: PriceReport[] = [];

  for (const entry of PRICES) {
    const id = entry.names.map((n) => process.env[n]).find(Boolean);
    if (!id) {
      prices.push({ label: entry.label, configured: false });
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(id, { expand: ["product"] });
      const product = price.product;
      prices.push({
        label: entry.label,
        configured: true,
        resolves: true,
        active: price.active,
        livemode: price.livemode,
        amount:
          price.unit_amount == null
            ? "n/a"
            : `${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()}`,
        interval: price.recurring?.interval ?? "one-time",
        product: typeof product === "string" || product.deleted ? undefined : product.name,
      });
    } catch (error) {
      // The interesting failure. A price minted in the other mode raises
      // "No such price", which is the symptom this endpoint exists to name
      // before a customer finds it on the checkout button.
      prices.push({
        label: entry.label,
        configured: true,
        resolves: false,
        error: (error as { code?: string })?.code ?? "retrieve_failed",
      });
    }
  }

  // The headline. Anything configured that does not resolve, or that resolves
  // into a different mode than the key, will fail at checkout.
  const broken = prices.filter((p) => p.configured && (!p.resolves || p.active === false));
  const mismatched = prices.filter(
    (p) => p.resolves && p.livemode !== undefined && p.livemode !== (keyMode === "live"),
  );

  return json(
    {
      ok: broken.length === 0 && mismatched.length === 0,
      keyMode,
      summary:
        broken.length || mismatched.length
          ? `${broken.length} unusable, ${mismatched.length} in the wrong mode — checkout will fail for these`
          : "every configured price resolves in the key's own mode",
      prices,
    },
    200,
  );
}
