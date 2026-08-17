import { currentAccessToken } from "../engine/auth.js";
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
// Gated on `app_admins` rather than a shared password, and the reasons are the
// ones that matter operationally:
//
//   - a password leaks the first time it is sent to somebody, and cannot be
//     revoked for one person without changing it for everybody
//   - a row can be added when a clipper is hired and deleted when they leave,
//     which is the actual lifecycle this needs to model
//   - the table already exists, /api/tts already gates on it, and the RLS
//     policy already scopes a read to its own owner
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

export async function allowQuickAccess(): Promise<boolean> {
  const token = await currentAccessToken().catch(() => null);
  // Signed out is simply not allowed, and there is deliberately no sign-in form
  // here. Offering one would confirm the page exists and is worth a login
  // attempt; staff sign in on the main app and arrive already carrying a
  // session, which is one step for the handful of people who need it and a dead
  // end for everybody else.
  if (!token) return false;
  return loadIsAdmin().catch(() => false);
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
