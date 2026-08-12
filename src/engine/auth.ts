import { createClient } from "@supabase/supabase-js";
import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Accounts, on Supabase.
//
// Face capture and analysis stay client-side by default. The one deliberate
// exception is side-landmark improvement feedback after a separate explicit
// Yes: that side photo plus the automatic and corrected points is sent through
// an authenticated server route. Saying No creates no upload payload. An
// account is requested only after capture, before revealing the result, and
// hangs a subscription off a real identity. Scan history remains device-local.
//
// Everything here is guarded by isAuthAvailable(). With no Supabase keys in the
// environment the whole feature is inert: no account button and no auth
// network requests. Production supplies the public client settings.
//
// Auth used to be dynamically imported on first click. A person who kept the
// page open across a deployment could then request an obsolete hashed chunk;
// the request failed before Supabase saw it and signup misleadingly reported
// that the sign-in service was unreachable. Keep the small client in the
// versioned application bundle so the form and its auth code can never drift.
// ---------------------------------------------------------------------------

interface AuthEnv {
  url: string;
  key: string;
}

// The project URL and its PUBLISHABLE key.
//
// These are committed on purpose, and it is safe. A Supabase publishable key
// (the `sb_publishable_…` format) is the client-side key: its entire job is to
// ship in the browser bundle, and it grants no privileged access — every read
// and write is governed by row-level security, which lives in the database and
// cannot be bypassed with this key. Whether it sits here or in an env var, it
// is public the instant the app loads in anyone's browser, so a public repo
// exposes nothing the shipped page does not already. The SECRET key
// (`sb_secret_…`) is the opposite and must never appear in this file or any
// other client code — it bypasses RLS. It is not here.
//
// Env vars still win when set (below), so a second project — a staging one, or
// a rotated key — needs no code change: set VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY in Vercel and they override these.
const DEFAULT_URL = "https://ruvgkrlfmixfnmnzqgap.supabase.co";
const DEFAULT_KEY = "sb_publishable_XLs-l72FzRD5C_QzP9xlkA_vMahWmgw";

function authEnv(): AuthEnv | null {
  const env = import.meta.env;
  const url = env.VITE_SUPABASE_URL || DEFAULT_URL;
  const key = env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY;
  return url && key ? { url, key } : null;
}

export function isAuthAvailable(): boolean {
  return authEnv() !== null;
}

let clientPromise: Promise<SupabaseClient> | null = null;
export async function getSupabaseClient(): Promise<SupabaseClient> {
  const env = authEnv();
  if (!env) throw new Error("Auth is not configured");
  if (!clientPromise) {
    clientPromise = Promise.resolve(
      createClient(env.url, env.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }),
    );
  }
  return clientPromise;
}

export interface AuthResult {
  ok: boolean;
  message?: string;
  needsConfirmation?: boolean;
  redirecting?: boolean;
}

export type SocialProvider = "google" | "apple";
export type SocialAvailability = Record<SocialProvider, boolean>;

// Every ordinary auth path returns to the scan screen. Password recovery is
// the one deliberate exception: the recovery link must first land on a page
// that can accept the new password, then that page returns to the scan.
export function authRedirects(origin = window.location.origin): { scan: string; reset: string } {
  return {
    scan: new URL("/", origin).toString(),
    reset: new URL("/auth?mode=reset", origin).toString(),
  };
}

export async function socialAvailability(): Promise<SocialAvailability | null> {
  const env = authEnv();
  if (!env) return null;
  try {
    const response = await fetch(`${env.url}/auth/v1/settings`, {
      headers: { apikey: env.key },
    });
    if (!response.ok) return null;
    const settings = await response.json() as { external?: Partial<SocialAvailability> };
    return {
      google: settings.external?.google === true,
      apple: settings.external?.apple === true,
    };
  } catch {
    return null;
  }
}

// A password sign-up. Supabase can be set to require email confirmation; the
// result says so rather than pretending the user is signed in.
export async function signUp(email: string, password: string): Promise<AuthResult> {
  try {
    const c = await getSupabaseClient();
    const { data, error } = await c.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authRedirects().scan },
    });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true, needsConfirmation: !data.session };
  } catch (error) {
    console.error("TrueMax signup client failure", error);
    return { ok: false, message: clientFailure(error, "Could not reach the sign-in service. Refresh the page and try again.") };
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const c = await getSupabaseClient();
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true };
  } catch (error) {
    console.error("TrueMax sign-in client failure", error);
    return { ok: false, message: clientFailure(error, "Could not reach the sign-in service. Refresh the page and try again.") };
  }
}

// Passwordless, for people who will not make up a password on a face app. Sends
// a one-time link to the address.
export async function signInWithLink(email: string): Promise<AuthResult> {
  try {
    const c = await getSupabaseClient();
    const { error } = await c.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authRedirects().scan,
        // This is a sign-in surface, not a second unlabelled signup path.
        shouldCreateUser: false,
      },
    });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true, needsConfirmation: true };
  } catch {
    return { ok: false, message: "Could not reach the sign-in service. Try again." };
  }
}

export async function signInWithProvider(provider: SocialProvider): Promise<AuthResult> {
  try {
    const c = await getSupabaseClient();
    const { error } = await c.auth.signInWithOAuth({
      provider,
      options: { redirectTo: authRedirects().scan },
    });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true, redirecting: true };
  } catch {
    return { ok: false, message: "Could not start social sign-in. Try again." };
  }
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  try {
    const c = await getSupabaseClient();
    const { error } = await c.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirects().reset,
    });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true, needsConfirmation: true };
  } catch {
    return { ok: false, message: "Could not send the reset email. Try again." };
  }
}

export async function updatePassword(password: string): Promise<AuthResult> {
  try {
    const c = await getSupabaseClient();
    const { error } = await c.auth.updateUser({ password });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not update the password. Open the newest reset link and try again." };
  }
}

export async function signOut(): Promise<void> {
  if (!isAuthAvailable()) return;
  const c = await getSupabaseClient();
  await c.auth.signOut();
}

export async function currentUser(): Promise<User | null> {
  if (!isAuthAvailable()) return null;
  const c = await getSupabaseClient();
  const { data } = await c.auth.getSession();
  return data.session?.user ?? null;
}

// Used only for same-origin calls to TrueMax's Vercel functions. The token is
// short-lived and lets the server verify who requested Checkout; it is never
// sent to Stripe or stored outside Supabase's normal browser session.
export async function currentAccessToken(): Promise<string | null> {
  if (!isAuthAvailable()) return null;
  const c = await getSupabaseClient();
  const { data } = await c.auth.getSession();
  return data.session?.access_token ?? null;
}

// App Store guideline 5.1.1(v): an account that can be created in the app must
// be deletable in the app. The server cancels any Stripe subscription first,
// deletes the Supabase identity second, then the browser clears its session.
export async function deleteAccount(): Promise<AuthResult> {
  try {
    const token = await currentAccessToken();
    if (!token) return { ok: false, message: "Sign in again before deleting your account." };
    const response = await fetch("/api/delete-account", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) return { ok: false, message: body?.error || "Could not delete the account." };
    const c = await getSupabaseClient();
    await c.auth.signOut();
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not delete the account. Try again, or contact support." };
  }
}

// Fires on sign-in and sign-out so the header can reflect the state. Returns an
// unsubscribe, and a no-op one when auth is off.
export function onAuthChange(
  cb: (user: User | null, event: AuthChangeEvent) => void,
): () => void {
  if (!isAuthAvailable()) return () => {};
  let disposed = false;
  let unsub: (() => void) | null = null;
  void getSupabaseClient().then((c) => {
    const { data } = c.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      cb(session?.user ?? null, event);
    });
    unsub = () => data.subscription.unsubscribe();
    // A caller can unmount before the dynamic Supabase import resolves. Do not
    // leave a subscription behind in that race.
    if (disposed) unsub();
  });
  return () => {
    disposed = true;
    unsub?.();
  };
}

// Supabase's error strings are for developers. These are the ones a user can
// actually act on.
function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already registered")) return "That email already has an account. Sign in instead.";
  if (m.includes("invalid login")) return "Email address or password not found.";
  if (m.includes("email address not authorized"))
    return "Email signup is awaiting production email setup. Continue with Google for now.";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider"))
    return "That sign-in option is not enabled yet.";
  if (m.includes("same password")) return "Choose a password you have not used for this account.";
  if (m.includes("session") || m.includes("expired"))
    return "That link has expired. Request a new one and try again.";
  if (m.includes("password")) return "Password must be at least 6 characters.";
  if (m.includes("email")) return "That does not look like a valid email.";
  if (m.includes("rate limit")) return "Too many tries. Wait a minute and try again.";
  return "Something went wrong. Try again.";
}

function clientFailure(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|network|load chunk|dynamically imported/i.test(message)) return fallback;
  return friendly(message);
}
