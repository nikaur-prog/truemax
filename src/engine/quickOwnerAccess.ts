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
