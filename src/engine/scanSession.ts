// A scan is an owned lifecycle, not a loose collection of module-level values.
//
// The token is immutable and carries the scan ID plus an epoch. Async work keeps
// the token it started with and must check `isCurrent` before it paints or
// persists. Resetting or resuming advances the epoch, so a late callback from a
// prior scan cannot become current again even if an ID were accidentally reused.

export type ScanPhase = "idle" | "front" | "side" | "gate" | "analyzing" | "results";
export type ScanSource = "camera" | "upload" | "restored";

export interface ScanToken {
  readonly scanId: string;
  readonly epoch: number;
}

export interface ScanSessionSnapshot {
  readonly phase: ScanPhase;
  readonly scanId: string | null;
  readonly owner: string | null;
  readonly source: ScanSource | null;
  readonly epoch: number;
}

const NEXT = {
  front: ["side"],
  // `results` is the cancel path when an existing result opened side-point
  // editing and returned without changing anything.
  side: ["gate", "analyzing", "results"],
  gate: ["analyzing"],
  analyzing: ["results"],
  // A result can add/review its side profile or be recalculated after a point
  // correction. Neither path creates a second scan.
  results: ["side", "analyzing"],
} as const satisfies Readonly<Record<Exclude<ScanPhase, "idle">, readonly ScanPhase[]>>;

export function isScanId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createScanId(): string {
  return crypto.randomUUID();
}

export class ScanSession {
  private state: ScanSessionSnapshot = frozenState("idle", null, null, null, 0);

  snapshot(): ScanSessionSnapshot {
    return this.state;
  }

  begin(owner: string, source: Exclude<ScanSource, "restored">, scanId = createScanId()): ScanToken {
    requireOwner(owner);
    requireScanId(scanId);
    const epoch = this.state.epoch + 1;
    this.state = frozenState("front", scanId, owner, source, epoch);
    return frozenToken(scanId, epoch);
  }

  resume(owner: string, scanId: string, phase: "gate" | "side" = "gate"): ScanToken {
    requireOwner(owner);
    requireScanId(scanId);
    const epoch = this.state.epoch + 1;
    this.state = frozenState(phase, scanId, owner, "restored", epoch);
    return frozenToken(scanId, epoch);
  }

  currentToken(): ScanToken | null {
    return this.state.scanId ? frozenToken(this.state.scanId, this.state.epoch) : null;
  }

  isCurrent(token: ScanToken | null | undefined, owner?: string | null): boolean {
    return !!token
      && this.state.phase !== "idle"
      && token.scanId === this.state.scanId
      && token.epoch === this.state.epoch
      && (owner === undefined || owner === this.state.owner);
  }

  transition(token: ScanToken, next: Exclude<ScanPhase, "idle">): boolean {
    if (!this.isCurrent(token)) return false;
    if (this.state.phase === next) return true;
    if (this.state.phase === "idle") return false;
    const allowed = NEXT[this.state.phase] as readonly ScanPhase[];
    if (!allowed.includes(next)) return false;
    this.state = frozenState(
      next,
      this.state.scanId,
      this.state.owner,
      this.state.source,
      this.state.epoch,
    );
    return true;
  }

  // Anonymous -> authenticated is an intentional ownership claim of the same
  // in-memory scan. The ID and epoch stay fixed so its already-running work can
  // finish; all persisted redirect state still requires the one-time claim
  // token enforced by pendingAnalysis.ts.
  claim(token: ScanToken, owner: string): ScanToken | null {
    if (!this.isCurrent(token)) return null;
    requireOwner(owner);
    this.state = frozenState(
      this.state.phase,
      this.state.scanId,
      owner,
      this.state.source,
      this.state.epoch,
    );
    return frozenToken(token.scanId, token.epoch);
  }

  reset(): void {
    this.state = frozenState("idle", null, null, null, this.state.epoch + 1);
  }
}

function frozenToken(scanId: string, epoch: number): ScanToken {
  return Object.freeze({ scanId, epoch });
}

function frozenState(
  phase: ScanPhase,
  scanId: string | null,
  owner: string | null,
  source: ScanSource | null,
  epoch: number,
): ScanSessionSnapshot {
  return Object.freeze({ phase, scanId, owner, source, epoch });
}

function requireOwner(owner: string): void {
  if (!/^(?:user|anonymous):.+/.test(owner)) throw new Error("A scan requires an active owner");
}

function requireScanId(scanId: string): void {
  if (!isScanId(scanId)) throw new Error("Scan ID is invalid");
}
