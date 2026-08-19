// ---------------------------------------------------------------------------
// The owner of device-local scan data.
//
// Supabase scopes server rows with RLS. Browser storage needs the same idea:
// localStorage and IndexedDB are shared by every account that uses one browser,
// so an unqualified `truemax:history` key is effectively a global table.
//
// `null` deliberately means "identity has not resolved yet", not anonymous.
// Reads fail closed in that state. Once Auth emits INITIAL_SESSION (or auth is
// unavailable), the app activates either a user scope or a tab-local anonymous
// scope. A sign-out rotates the anonymous scope so the signed-in person's
// transient data cannot become the next visitor's starting point.
// ---------------------------------------------------------------------------

const ANONYMOUS_SESSION_KEY = "truemax:anonymous-scan-owner:v1";

let activeOwner: string | null = null;

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  }
}

function anonymousId(rotate: boolean): string {
  try {
    if (!rotate) {
      const existing = sessionStorage.getItem(ANONYMOUS_SESSION_KEY);
      if (existing) return existing;
    }
    const next = randomId();
    sessionStorage.setItem(ANONYMOUS_SESSION_KEY, next);
    return next;
  } catch {
    // A private browser may refuse sessionStorage. The in-memory identifier is
    // still enough to keep this page isolated for its lifetime.
    return randomId();
  }
}

export function activateScanOwner(
  userId: string | null,
  options: { rotateAnonymous?: boolean } = {},
): string {
  if (userId) {
    activeOwner = `user:${userId}`;
    return activeOwner;
  }

  // Multiple Auth subscribers receive the same SIGNED_OUT event. Rotate only
  // on the first transition away from a user; a second subscriber must not
  // create a second anonymous identity for the same page.
  const rotate = options.rotateAnonymous === true && !activeOwner?.startsWith("anonymous:");
  if (!rotate && activeOwner?.startsWith("anonymous:")) return activeOwner;
  activeOwner = `anonymous:${anonymousId(rotate)}`;
  return activeOwner;
}

export function activeScanOwner(): string | null {
  return activeOwner;
}

export function scopedStorageKey(base: string): string | null {
  return activeOwner ? `${base}:${activeOwner}` : null;
}
