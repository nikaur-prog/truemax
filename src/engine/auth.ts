import { createClient } from "@supabase/supabase-js";
import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";
import { track } from "./track.js";

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

// A configured value only wins if it is actually usable.
//
// `env.VITE_SUPABASE_URL || DEFAULT_URL` looks safe and is not: `||` only falls
// back on an EMPTY value, so anything non-empty overrides the working default —
// including a project ref with no scheme, a URL with a stray space, or a
// placeholder somebody pasted while setting up Vercel. The Supabase client then
// throws `Invalid supabaseUrl` on construction, which is thrown inside a promise
// during a click handler, so it surfaces as an unhandled rejection and every
// sign-in path dies with no message pointing at the cause. That is exactly the
// failure this shipped with.
//
// A misconfigured override is now ignored in favour of the known-good default,
// and says so loudly. Wrong-but-present should never beat right.
function usableUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

// The key needs the same protection, for the same reason and with a different
// failure. A stale or half-pasted VITE_SUPABASE_ANON_KEY also beats the working
// default under `||`, and the error it produces — "Invalid API key" on the first
// request rather than a throw at construction — points at Supabase rather than
// at the variable, which is a worse trail to follow than the URL one.
//
// Deliberately not format-sniffing. Supabase has already changed key formats
// once (JWT `eyJ…` to `sb_publishable_…`) and a client that rejects the next
// format is a self-inflicted outage. A length floor catches what actually goes
// wrong — blank, whitespace, a truncated paste, a leftover placeholder — and
// never argues with a real key.
const MIN_KEY_LENGTH = 20;

function usableKey(value: string | undefined): string | null {
  const key = value?.trim();
  return key && key.length >= MIN_KEY_LENGTH ? key : null;
}

function authEnv(): AuthEnv | null {
  const env = import.meta.env;
  const configuredUrl = env.VITE_SUPABASE_URL?.trim();
  const url = usableUrl(configuredUrl);
  if (configuredUrl && !url) {
    console.error(
      "[auth] VITE_SUPABASE_URL is not a valid URL, falling back to the built-in project.",
      JSON.stringify(configuredUrl),
    );
  }
  const configuredKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  const key = usableKey(configuredKey);
  if (configuredKey && !key) {
    // Length only. The key itself is never logged.
    console.error(
      `[auth] VITE_SUPABASE_ANON_KEY is too short to be a key (${configuredKey.length} chars), falling back to the built-in key.`,
    );
  }
  return { url: url ?? DEFAULT_URL, key: key ?? DEFAULT_KEY };
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
    if (!response.ok) {
      console.error("[auth] provider settings read failed", response.status, response.statusText);
      return null;
    }
    const settings = await response.json() as { external?: Partial<SocialAvailability> };
    return {
      google: settings.external?.google === true,
      apple: settings.external?.apple === true,
    };
  } catch (error) {
    // Logged rather than swallowed. This one call decides whether the social
    // buttons work, and a silent null here presents as "sign-in is broken" with
    // nothing anywhere to say why — the usual causes are a CSP that does not
    // allow the project host and a project URL typo, and both are invisible
    // without this line.
    console.error("[auth] could not reach provider settings", error);
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
    // Counted at sign-up success, confirmed or not — the account exists either
    // way, and this is the only spot both outcomes pass through.
    track("account-created");
    return { ok: true, needsConfirmation: !data.session };
  } catch (error) {
    console.error("TrueMax signup client failure", error);
    if (reloadOnceAfterClientFailure(error)) {
      return { ok: false, message: "TrueMax was updated. Refreshing the secure sign-up service…" };
    }
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
      options: {
        redirectTo: authRedirects().scan,
        // Always show the account chooser.
        //
        // Not a Google bug and not a phone bug: with no prompt asked for,
        // Google silently reuses the single signed-in session on the device and
        // skips the picker entirely. On a phone that is almost always the
        // personal account somebody happens to be signed into in Chrome, so a
        // person with two accounts had no way to reach the second one — and no
        // way to tell they had been signed in as the wrong one until their
        // history looked empty.
        //
        // "select_account" makes the chooser unconditional. It costs one tap
        // for the single-account case and is the only thing that makes the
        // two-account case possible at all, which is the right trade: an
        // account you cannot choose is an account you cannot leave.
        //
        // Deliberately not "consent" — that re-asks for permissions every time
        // and reads as though the app has forgotten who you are.
        queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
      },
    });
    if (error) {
      console.error("[auth] signInWithOAuth rejected", provider, error);
      return { ok: false, message: friendly(error.message) };
    }
    return { ok: true, redirecting: true };
  } catch (error) {
    console.error("[auth] signInWithOAuth threw", provider, error);
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

// A tab can stay open across a Vercel release. If it later submits code whose
// hashed bundle no longer exists, the request never reaches Supabase and looks
// like an auth outage. Recover once automatically. The session guard prevents
// an actual network outage from creating a reload loop.
function reloadOnceAfterClientFailure(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!/failed to fetch|network|load chunk|dynamically imported/i.test(message)) return false;
  const key = "truemax:auth-reload-v1";
  if (window.sessionStorage.getItem(key)) return false;
  window.sessionStorage.setItem(key, "1");
  window.setTimeout(() => window.location.reload(), 120);
  return true;
}
