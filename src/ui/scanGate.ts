import { readAllHistory } from "../engine/history.js";
import { currentAccessToken } from "../engine/auth.js";
import {
  consumeScanCredit,
  loadEntitlement,
  loadIsAdmin,
  loadScanCredits,
  startScanCreditCheckout,
} from "../engine/entitlement.js";
import { TRIAL_SCANS, tierOf } from "../engine/depth.js";
import { mergeScanTimes, nextScanSlotAt, weeklyAllowance } from "../engine/scanAllowance.js";
import { SCAN_PRICE_MEMBER, isMemberPricing, scanPrice, setMemberPricing } from "../engine/scanPricing.js";
import { track } from "../engine/track.js";
import { activeScanOwner, scopedStorageKey } from "../engine/scanScope.js";

// ---------------------------------------------------------------------------
// The weekly scan allowance: one a week, two on Max.
//
// Two reasons for weekly, and the honest one goes in the copy. A face does
// not change by Thursday: the product's second-best feature is the delta
// between scans, and a delta measured across a day is lighting noise wearing
// a trend costume. Weekly is the cadence at which the number can genuinely
// have moved. The commercial reason is the same fact from the other side —
// someone who wants to scan again TODAY is buying a re-measurement, not a
// measurement, and that is what the one-time scan credit already prices.
//
// Max gets two, because that is what its plan card has always said. The gate
// held everybody to one, which made "Two scans a week" a printed promise the
// product did not keep — the kind of bug no subscriber reports, they just
// learn the cards are decoration. The arithmetic (rolling window, which scan
// holds the slot) lives in engine/scanAllowance.ts where it can be tested.
//
// The gate sits at the moment of intent (the upload button, the camera button,
// a pasted photo), never mid-flow: adding the side view to a scan in progress
// or re-verifying its points is the SAME scan and passes untouched.
//
// Staff pass, so the product stays testable. A held scan credit passes and is
// spent by it. Everybody else gets a countdown to their next free scan and the
// existing credit checkout as the way to skip it — members at the member
// price, everyone else at the standard one, both set in Stripe.
// ---------------------------------------------------------------------------

// How long an entitlement read may take before the gate stops waiting for it.
// Two and a half seconds is past the slowest honest round trip and well short
// of the point where a person taps the button again.
const READ_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), READ_TIMEOUT_MS)),
  ]);
}

// A precise timestamp, stamped when an analysis completes. History entries
// carry ISO dates too, and the newer of the two wins, so the gate still works
// for scans that predate this stamp existing.
const STAMP_KEY = "truemax.lastScanAt";

export function recordScanRun(): void {
  try {
    const key = scopedStorageKey(STAMP_KEY);
    if (!key) return;
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage disabled: the gate simply cannot hold this browser, and a gate
    // that fails open is the survivable direction for a free product.
  }
}

// Every completion time this browser can witness: the precise stamp plus the
// stored history's own dates. mergeScanTimes de-duplicates the stamp against
// the entry written moments after it, so one scan cannot hold two slots.
function scanTimes(): number[] {
  let stamp: number | null = null;
  try {
    const key = scopedStorageKey(STAMP_KEY);
    if (key) stamp = Number(localStorage.getItem(key)) || null;
  } catch {
    /* storage disabled */
  }
  const history = readAllHistory()
    .map((scan) => new Date(scan.date).getTime())
    .filter((t) => Number.isFinite(t));
  return mergeScanTimes(stamp, history);
}

// When the next scan unlocks for a given weekly allowance, or null if one is
// allowed right now. Exported for the gate and kept allowance-explicit: the
// caller knows the tier, this file knows the timestamps.
export function nextFreeScanAt(allowance = 1): number | null {
  return nextScanSlotAt(scanTimes(), allowance, Date.now());
}

// The single entry point: call with what should happen if scanning is allowed.
// Free window open → proceed. In the window: staff proceed, a held credit
// proceeds and is spent, everyone else sees the countdown.
export async function ensureScanAllowed(proceed: () => void): Promise<boolean> {
  const owner = activeScanOwner();
  // The base allowance first, with no network: a browser with an open slot at
  // allowance one has an open slot at every tier, so the common case stays a
  // pure localStorage check. Only a held slot goes on to ask who this is —
  // which it must, because the answer decides whether a SECOND slot exists.
  const next = nextFreeScanAt(1);
  if (!next) {
    proceed();
    return true;
  }

  // Signed out passes, and the gate is applied again after they sign in.
  //
  // The limit belongs to an ACCOUNT, but the only thing this device can see
  // before sign-in is its own localStorage, which says nothing about who is
  // holding the phone. Gating on it stopped whoever borrowed the laptop, and
  // stopped anybody who scanned once before ever making an account — the exact
  // person the funnel is trying to convert.
  //
  // It also produced a dialog that argued with itself: the countdown offered
  // to sell a scan while the line under the button read "Sign in before
  // opening billing", because entitlement.ts refuses checkout without a token.
  // A paywall that cannot take payment is not a paywall.
  //
  // So capture is allowed to run to the end, where the sign-in wall already
  // stands (see engine/pendingAnalysis.ts — the capture is preserved across
  // the OAuth round trip precisely because the account is what reveals the
  // result). main.ts calls this again on the resume path, with a token in
  // hand, which is the first moment the question can honestly be asked.
  const token = await currentAccessToken().catch(() => null);
  if (activeScanOwner() !== owner) return false;
  if (!token) {
    proceed();
    return true;
  }

  // Only reached inside the cooldown, so these network reads never delay the
  // common case. Each fails toward "no", which fails toward the gate. The
  // timeout is the same defence as above: a stalled read resolves to the
  // locked answer rather than hanging the button forever.
  //
  // All three at once rather than the entitlement only when it is needed: the
  // gate has to know whether this is a member before it can quote a price, so
  // the read happens on every path anyway.
  const [admin, credits, entitlement] = await Promise.all([
    withTimeout(loadIsAdmin(), false),
    withTimeout(loadScanCredits(), 0),
    withTimeout(loadEntitlement(), null),
  ]);
  if (activeScanOwner() !== owner) return false;
  const tier = tierOf(entitlement);
  const member = tier !== "free";
  setMemberPricing(member);

  if (admin) {
    proceed();
    return true;
  }
  // The tier's own allowance, now that the tier is known. This is where a Max
  // account's second weekly scan passes — before any credit is touched, since
  // an included scan must never quietly spend a paid one.
  const allowance = weeklyAllowance(tier);
  if (allowance > 1 && nextFreeScanAt(allowance) === null) {
    proceed();
    return true;
  }
  if (credits > 0) {
    // The credit pays for skipping the wait, except for a free-tier account
    // past its trial, where the depth gate on the results screen already
    // spends one credit per full-depth scan. Spending it here too would
    // charge that account twice for one scan.
    const alsoSpentByDepthGate = !member && readAllHistory().length >= TRIAL_SCANS;
    if (!alsoSpentByDepthGate) void consumeScanCredit().catch(() => undefined);
    proceed();
    return true;
  }
  // The countdown must be to THIS tier's next slot. At allowance two that is
  // when the older held scan leaves the window, which can be days sooner than
  // the base-allowance figure computed above.
  openScanGate(nextFreeScanAt(allowance) ?? next, allowance);
  return false;
}

let host: HTMLElement | null = null;
let timer: number | null = null;

export function closeScanGate(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  host?.remove();
  host = null;
}

function remaining(nextAt: number): string {
  const ms = Math.max(0, nextAt - Date.now());
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// Reads who this is from the shared pricing state rather than taking it as an
// argument, so the price on the button and the note under it cannot disagree
// with each other or with the same price quoted on the results screen. Every
// caller sets that state before opening.
function openScanGate(nextAt: number, allowance = 1): void {
  if (host) return;
  track("scan-gate-shown");
  const member = isMemberPricing();

  // The sheet describes the allowance the person actually has. Telling a Max
  // subscriber they have used "your free scan" understates what they paid
  // for at the exact moment they are being asked to pay again.
  const title = allowance > 1
    ? "You've used both of this week's scans"
    : "You've used your free scan this week";
  const sub = allowance > 1
    ? "Max includes two scans a week. Your face doesn't change in a day, so a third scan mostly measures your lighting — leave it and the number can actually move."
    : "You get one free scan a week. Your face doesn't change in a day, so scanning again tomorrow mostly measures your lighting. Leave it a week and the number can actually move.";
  // One upsell line each: non-members hear about the member price, Starter
  // members hear that Max carries a second weekly scan. Max members, who have
  // nothing further to be sold, get neither.
  const note = !member
    ? `<p class="sg-note">Members pay ${SCAN_PRICE_MEMBER} for extra scans.</p>`
    : allowance === 1
      ? `<p class="sg-note">Max includes two scans a week.</p>`
      : "";

  host = document.createElement("div");
  host.className = "scangate";
  host.innerHTML = `
    <div class="scangate-sheet" role="dialog" aria-modal="true" aria-label="Weekly scan limit">
      <b class="sg-title">${title}</b>
      <p class="sg-sub">${sub}</p>
      <div class="sg-timer">
        <span class="klabel">YOUR NEXT FREE SCAN</span>
        <b id="sg-count">–</b>
      </div>
      <button class="btn pri" id="sg-buy">Scan now for ${scanPrice()}</button>
      ${note}
      <button class="btn gho" id="sg-wait">I'll wait</button>
      <p class="sg-err" id="sg-err" hidden></p>
    </div>`;
  document.body.appendChild(host);

  const count = host.querySelector<HTMLElement>("#sg-count")!;
  const tick = (): void => {
    // The wait can genuinely end while the dialog is open; when it does, the
    // countdown becomes the door.
    if (nextAt - Date.now() <= 0) {
      closeScanGate();
      return;
    }
    count.textContent = remaining(nextAt);
  };
  tick();
  timer = window.setInterval(tick, 1000);

  host.querySelector<HTMLButtonElement>("#sg-wait")!.onclick = closeScanGate;
  host.addEventListener("click", (event) => {
    if (event.target === host) closeScanGate();
  });

  host.querySelector<HTMLButtonElement>("#sg-buy")!.onclick = async () => {
    track("scan-gate-buy");
    const result = await startScanCreditCheckout();
    if (!result.ok && host) {
      const err = host.querySelector<HTMLElement>("#sg-err")!;
      err.textContent = result.message ?? "Billing is not available right now.";
      err.hidden = false;
    }
  };
}
