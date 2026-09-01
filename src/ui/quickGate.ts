import { currentAccessToken, currentUser, getSupabaseClient } from "../engine/auth.js";
import { loadIsAdmin } from "../engine/entitlement.js";

// ---------------------------------------------------------------------------
// Who may open /quick.
//
// /quick is the tool that MAKES the content, not content itself. It scores
// strangers, shows their ceiling, exports finished videos, and reaches an
// endpoint that turns text into billable speech. None of that is meant for the
// public, and until now the only thing keeping it private was that the URL is
// not linked anywhere — which stops nobody the moment one clipper shares a
// screen recording with the address bar visible.
//
// Two doors in, both of them rows granted by hand:
//
//   - `app_admins` — staff. Granted only in the SQL editor, never self-serve.
//   - `league_creators` with status 'approved' — a Creator League member. The
//     approval only ever happens in the League admin panel, by the founder,
//     and RLS pins the status a person can write about themselves to
//     'applied'. Membership IS the /quick grant: the League's whole pitch is
//     "we hand you the tools", and this is the door those tools live behind.
//
// Rows rather than a shared password, for the reasons that matter
// operationally:
//
//   - a password leaks the first time it is sent to somebody, and cannot be
//     revoked for one person without changing it for everybody
//   - a row can be added when a creator is approved and flipped to 'paused'
//     when they leave, which is the actual lifecycle this needs to model
//   - the tables already exist, /api/tts already gates on the same pair, and
//     the RLS policies already scope a read to its own owner
//
// Honest about what this is: a CLIENT-side gate on a client-side tool. The
// scanning runs in the browser, so somebody determined who already knows the
// URL could read the logic out of the bundle. What it actually prevents is
// casual discovery and forwarded links, which is the real exposure — the part
// that costs money is /api/tts, and that is gated server-side where it counts.
//
// The refusal says "Not found", matching /api/tts returning 404 rather than
// 403. A page that announces it is a staff tool has told a stranger there is
// something here worth trying to reach.
// ---------------------------------------------------------------------------

export interface QuickAccess {
  allowed: boolean;
  staff: boolean;
  /** Identity-scopes device drafts so a shared browser cannot show another creator's work. */
  userId: string | null;
  /** Pillar grants from the creator's row. Staff hold every grant. */
  grants: Record<string, boolean>;
}

const DENIED: QuickAccess = { allowed: false, staff: false, userId: null, grants: {} };

/**
 * Who is at the door, and which rooms they hold keys to.
 *
 * Not just a boolean any more, because the page gates twice: once at the door
 * (allowed at all?) and once per pillar (the owner ticks grants at approval,
 * and a grant the interface ignores is a checkbox that lies). Staff see
 * everything; a creator sees the pillars they were granted. Calibrate stays
 * staff-only, while paid generation is controlled by the `studio` grant and a
 * server-side render reservation.
 */
export async function quickAccessProfile(): Promise<QuickAccess> {
  const token = await currentAccessToken().catch(() => null);
  // Signed out is simply not allowed, and there is deliberately no sign-in form
  // here. Offering one would confirm the page exists and is worth a login
  // attempt; staff sign in on the main app and arrive already carrying a
  // session, which is one step for the handful of people who need it and a dead
  // end for everybody else.
  if (!token) return DENIED;
  if (await loadIsAdmin().catch(() => false)) {
    const user = await currentUser().catch(() => null);
    if (!user) return DENIED;
    return {
      allowed: true,
      staff: true,
      userId: user.id,
      grants: { cta: true, clips: true, polisher: true, studio: true },
    };
  }
  // The League door. Reads the caller's OWN league_creators row — the RLS
  // select policy is `auth.uid() = user_id or staff`, and the explicit eq
  // keeps this a single-row read even if that policy is ever widened. Any
  // error is a refusal: a gate that fails open is not a gate.
  try {
    const user = await currentUser();
    if (!user) return DENIED;
    const client = await getSupabaseClient();
    const { data } = await client
      .from("league_creators")
      .select("status, pillar_grants")
      .eq("user_id", user.id)
      .maybeSingle<{ status: string; pillar_grants: Record<string, boolean> | null }>();
    if (data?.status !== "approved") return DENIED;
    return { allowed: true, staff: false, userId: user.id, grants: data.pillar_grants ?? {} };
  } catch {
    return DENIED;
  }
}

/** Replaces the page. Nothing underneath keeps running. */
export function denyQuickAccess(): void {
  document.title = "Not found";
  document.body.innerHTML = `
    <main class="q-denied">
      <h1>Not found</h1>
      <p>This page does not exist, or you do not have access to it.</p>
      <a href="/">Go to TrueMax</a>
    </main>`;
}
