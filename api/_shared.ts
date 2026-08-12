import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import Stripe from "stripe";

let stripeClient: Stripe | null = null;
let adminClient: SupabaseClient | null = null;

function required(name: string, fallback?: string): string {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export function getStripe(): Stripe {
  if (!stripeClient) stripeClient = new Stripe(required("STRIPE_SECRET_KEY"));
  return stripeClient;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return adminClient;
}

export async function authenticatedUser(request: Request): Promise<User | null> {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const { data, error } = await getSupabaseAdmin().auth.getUser(match[1]);
  return error ? null : data.user;
}

export function requestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return null;

  const configured = process.env.TRUEMAX_APP_URL;
  if (!configured) return requestUrl.origin;
  try {
    return new URL(configured).origin;
  } catch {
    throw new Error("TRUEMAX_APP_URL must be an absolute URL");
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
