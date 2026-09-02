import { currentAccessToken } from "../engine/auth.js";

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
// The role and grants are resolved server-side. Scanning still runs in the
// browser, but a visitor cannot grant themselves a room by altering local
// storage or changing a DOM attribute.
//
// The refusal says "Not found", matching /api/tts returning 404 rather than
// 403. A page that announces it is a staff tool has told a stranger there is
// something here worth trying to reach.
// ---------------------------------------------------------------------------

export interface QuickAccess {
  allowed: boolean;
  staff: boolean;
  /** True only for an app_admins row whose note is exactly "owner". */
  owner: boolean;
  /** Identity-scopes device drafts so a shared browser cannot show another creator's work. */
  userId: string | null;
  /** Pillar grants from the creator's row. Staff hold every creator grant. */
  grants: Record<string, boolean>;
}

const DENIED: QuickAccess = { allowed: false, staff: false, owner: false, userId: null, grants: {} };

/**
 * Who is at the door, and which rooms they hold keys to.
 *
 * Not just a boolean any more, because the page gates twice: once at the door
 * (allowed at all?) and once per pillar (the owner ticks grants at approval,
 * and a grant the interface ignores is a checkbox that lies). Staff see
 * everything; a creator sees the pillars they were granted. Calibrate stays
 * staff-only, while paid generation is controlled by the `studio` grant and a
 * server-side render reservation. Brand Engine and Calibration are resolved
 * separately from the explicit owner role returned by the server.
 */
export async function quickAccessProfile(): Promise<QuickAccess> {
  const token = await currentAccessToken().catch(() => null);
  // Signed out is simply not allowed, and there is deliberately no sign-in form
  // here. Offering one would confirm the page exists and is worth a login
  // attempt; staff sign in on the main app and arrive already carrying a
  // session, which is one step for the handful of people who need it and a dead
  // end for everybody else.
  if (!token) return DENIED;
  try {
    const response = await fetch("/api/quick-access", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return DENIED;
    const data = await response.json() as Partial<QuickAccess>;
    if (data.allowed !== true || typeof data.userId !== "string") return DENIED;
    return {
      allowed: true,
      staff: data.staff === true,
      owner: data.owner === true,
      userId: data.userId,
      grants: data.grants && typeof data.grants === "object" ? data.grants : {},
    };
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
