/** A creator application must never demote a separately granted staff role. */
export function leagueEntry(staff: boolean, creatorStatus: string | null): "staff" | "creator" | "status" | "apply" {
  if (creatorStatus === "approved") return "creator";
  if (staff) return "staff";
  return creatorStatus === null ? "apply" : "status";
}
