import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Accounts, on Supabase.
//
// The app is otherwise entirely client-side and stays that way: a scan still
// runs on device with nothing uploaded, and a signed-out visitor loses no
// capability. An account exists for the two things localStorage cannot do —
// carry your history to another device, and hang a subscription off a real
// identity.
//
// Everything here is guarded by isAuthAvailable(). With no Supabase keys in the
// environment the whole feature is inert: no account button, no network, the
// product behaves exactly as it did before. So this can ship dark and light up
// the moment the keys are set, without a second deploy that could break the
// live app.
//
// The client library is dynamically imported on first use, so the ~120KB it
// weighs never lands on a visitor who only wants a scan.
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
  const env = import.meta.env as Record<string, string | undefined>;
  const url = env.VITE_SUPABASE_URL || DEFAULT_URL;
  const key = env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY;
  return url && key ? { url, key } : null;
}

export function isAuthAvailable(): boolean {
  return authEnv() !== null;
}

let clientPromise: Promise<SupabaseClient> | null = null;
async function getClient(): Promise<SupabaseClient> {
  const env = authEnv();
  if (!env) throw new Error("Auth is not configured");
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then((m) =>
      m.createClient(env.url, env.key, {
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
}

// A password sign-up. Supabase can be set to require email confirmation; the
// result says so rather than pretending the user is signed in.
export async function signUp(email: string, password: string): Promise<AuthResult> {
  try {
    const c = await getClient();
    const { data, error } = await c.auth.signUp({ email, password });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true, needsConfirmation: !data.session };
  } catch {
    return { ok: false, message: "Could not reach the sign-in service. Try again." };
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const c = await getClient();
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not reach the sign-in service. Try again." };
  }
}

// Passwordless, for people who will not make up a password on a face app. Sends
// a one-time link to the address.
export async function signInWithLink(email: string): Promise<AuthResult> {
  try {
    const c = await getClient();
    const { error } = await c.auth.signInWithOtp({ email });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true, needsConfirmation: true };
  } catch {
    return { ok: false, message: "Could not reach the sign-in service. Try again." };
  }
}

export async function signOut(): Promise<void> {
  if (!isAuthAvailable()) return;
  const c = await getClient();
  await c.auth.signOut();
}

export async function currentUser(): Promise<User | null> {
  if (!isAuthAvailable()) return null;
  const c = await getClient();
  const { data } = await c.auth.getSession();
  return data.session?.user ?? null;
}

// App Store guideline 5.1.1(v): an account that can be created in the app must
// be deletable in the app. This calls a Postgres function the setup SQL
// installs (auth.uid() has no client-side delete), then signs the user out.
export async function deleteAccount(): Promise<AuthResult> {
  try {
    const c = await getClient();
    const { error } = await c.rpc("delete_own_account");
    if (error) return { ok: false, message: friendly(error.message) };
    await c.auth.signOut();
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not delete the account. Try again, or contact support." };
  }
}

// Fires on sign-in and sign-out so the header can reflect the state. Returns an
// unsubscribe, and a no-op one when auth is off.
export function onAuthChange(cb: (user: User | null) => void): () => void {
  if (!isAuthAvailable()) return () => {};
  let unsub = () => {};
  void getClient().then((c) => {
    const { data } = c.auth.onAuthStateChange((_e: string, session: Session | null) => {
      cb(session?.user ?? null);
    });
    unsub = () => data.subscription.unsubscribe();
  });
  return () => unsub();
}

// Supabase's error strings are for developers. These are the ones a user can
// actually act on.
function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already registered")) return "That email already has an account. Sign in instead.";
  if (m.includes("invalid login")) return "Email or password is wrong.";
  if (m.includes("password")) return "Password must be at least 6 characters.";
  if (m.includes("email")) return "That does not look like a valid email.";
  if (m.includes("rate limit")) return "Too many tries. Wait a minute and try again.";
  return "Something went wrong. Try again.";
}
