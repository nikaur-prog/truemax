/** Server-resolved role, never a device preference or a DOM attribute. */
export interface QuickOwnerAccess {
  allowed: boolean;
  staff: boolean;
  owner: boolean;
  userId: string | null;
}

/** Calibration and brand tools stay with the explicitly designated owner admin. */
export function canUseOwnerTools(access: QuickOwnerAccess | null, activeUserId: string | null): boolean {
  return Boolean(access?.allowed && access.staff && access.owner && activeUserId && access.userId === activeUserId);
}

/** Device storage scopes carry a prefix; server-resolved grants carry the raw Auth user ID. */
export function quickOwnerScopeTransition(previous: string | null | undefined, next: string | null): {
  userId: string | null; changed: boolean;
} {
  return {
    userId: next?.startsWith("user:") && next.length > 5 ? next.slice(5) : null,
    changed: previous !== undefined && previous !== next,
  };
}
