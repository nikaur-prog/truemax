import { GOALS } from "./goals.js";
import type { Profile } from "./goals.js";
import { recsFor } from "./recommendations.js";
import type { Rec } from "./recommendations.js";
import { commitProtocol, offerProtocol, readProtocols, writeProtocols } from "./protocol.js";
import type { Protocol } from "./protocol.js";

// This small action bridge has no authoritative age/body-profile payload. Keep
// it to existing basic care habits; body-composition and medicinal plans stay
// outside this picker rather than treating staff access as proof of adulthood.
const BASIC_ROUTINES = new Set(["sleep", "gentle-cleanse", "razor-technique", "brow-shape", "hair-damage", "scar-sun"]);

export function coachRoutineChoices(profile: Profile, protocols: readonly Protocol[]): Rec[] {
  const quiet = new Set(GOALS.filter((goal) => goal.regions.length && goal.regions.every((region) => profile.quiet.includes(region))).map((goal) => goal.id));
  const existing = new Set(protocols.map((protocol) => protocol.recId));
  return recsFor(profile, quiet).filter((rec) => BASIC_ROUTINES.has(rec.id) && !existing.has(rec.id)
    && !rec.guardian && !rec.otc && rec.evidence !== "none" && rec.channel !== "diet").slice(0, 8);
}

/** Read-back is essential: the existing protocol store intentionally swallows storage failures. */
export function addSelectedCoachRoutine(rec: Rec, at = Date.now()): "added" | "existing" | "failed" {
  const existing = readProtocols().find((protocol) => protocol.recId === rec.id);
  if (existing && existing.status !== "offered") return "existing";
  const offered = existing ?? offerProtocol(rec, "", at);
  const committed = commitProtocol(offered, at);
  writeProtocols(readProtocols().map((protocol) => protocol.id === committed.id ? committed : protocol));
  const saved = readProtocols().find((protocol) => protocol.id === committed.id && protocol.recId === rec.id);
  return saved?.status === "committed" && saved.startBy === committed.startBy ? "added" : "failed";
}
