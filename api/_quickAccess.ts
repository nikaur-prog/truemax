export const QUICK_GRANTS = ["cta", "clips", "polisher", "studio"] as const;

export type QuickGrant = (typeof QUICK_GRANTS)[number];

/**
 * Ownership is deliberately an explicit role, not an alias for "is staff".
 * There may eventually be several staff accounts, but only the founder's row
 * should unlock calibration data and the Brand Engine.
 */
export function isQuickOwner(note: unknown): boolean {
  return typeof note === "string" && note.trim().toLowerCase() === "owner";
}

export function normalizedQuickGrants(value: unknown, staff: boolean): Record<QuickGrant, boolean> {
  if (staff) return { cta: true, clips: true, polisher: true, studio: true };
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    cta: source.cta === true,
    clips: source.clips === true,
    polisher: source.polisher === true,
    studio: source.studio === true,
  };
}
