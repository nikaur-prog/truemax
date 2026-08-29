import { currentAccessToken } from "../engine/auth.js";

// ---------------------------------------------------------------------------
// "Do you think we scored you wrong?" — the self-score collector.
//
// Data collection ONLY. Nothing here moves a displayed score, now or later: a
// scoring system that adjusts itself to whoever complains is not a measurement
// any more. What the submissions are for is calibration review in aggregate —
// if people whose measured score sits in one range systematically place
// themselves in another, that range of the curve deserves a look, done by
// hand, against the reference data, the same way the side-landmark feedback
// feeds a manual refit rather than a live update.
//
// Consent-shaped like the side feedback: an explicit dialog that says exactly
// what is stored (two numbers and the scan's reference population, no photo)
// and what it will not do (change this report).
// ---------------------------------------------------------------------------

export const SELF_SCORE_CONSENT_VERSION = "2026-08-29-self-score-v1";

export interface SelfScoreArgs {
  scanId: string;
  ourScore: number;
  sex: "male" | "female";
}

// Remembered per scan so the quiet button can become a receipt: one opinion
// per scan is the useful unit, and re-sending it is noise for the analysis.
const sentKey = (scanId: string) => `truemax:selfScore:${scanId}`;

export function selfScoreSent(scanId: string): boolean {
  try {
    return localStorage.getItem(sentKey(scanId)) === "1";
  } catch {
    return false;
  }
}

function markSent(scanId: string): void {
  try {
    localStorage.setItem(sentKey(scanId), "1");
  } catch {
    /* storage disabled: the server's per-scan uniqueness still holds */
  }
}

async function submit(args: SelfScoreArgs, selfScore: number): Promise<{ ok: boolean; message: string }> {
  const token = await currentAccessToken().catch(() => null);
  if (!token) return { ok: false, message: "Sign in to send this. Your report is unaffected either way." };
  try {
    const response = await fetch("/api/self-score-feedback", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scanId: args.scanId,
        ourScore: Math.round(args.ourScore * 10) / 10,
        selfScore: Math.round(selfScore * 10) / 10,
        sex: args.sex,
        consentVersion: SELF_SCORE_CONSENT_VERSION,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { received?: boolean; error?: string };
    if (!response.ok || result.received !== true) {
      return { ok: false, message: result.error || "That could not be sent. Try again later." };
    }
    return { ok: true, message: "" };
  } catch {
    return { ok: false, message: "That could not be sent. Try again later." };
  }
}

export function openSelfScoreDialog(args: SelfScoreArgs, onSent?: () => void): void {
  const backdrop = document.createElement("div");
  backdrop.className = "side-feedback-backdrop";
  const start = Math.min(10, Math.max(1, Math.round(args.ourScore * 10) / 10));
  backdrop.innerHTML = `<section class="side-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="selfscore-title">
    <span class="klabel">OPTIONAL · CALIBRATION FEEDBACK</span>
    <h2 id="selfscore-title">Do you think we scored you wrong?</h2>
    <p>TrueMax measured <b>${start.toFixed(1)}</b>. Set the score you would give yourself. This is used to review the scoring calibration across many submissions. It does not change this report or any future score of yours.</p>
    <div class="selfscore-row">
      <input type="range" id="selfscore-range" min="1" max="10" step="0.1" value="${start}" aria-label="Your own score" />
      <b class="selfscore-value" id="selfscore-value">${start.toFixed(1)}</b>
    </div>
    <p class="side-feedback-privacy">Two numbers are stored with your account: the measured score and yours, plus the reference population this scan used. No photo or measurement detail is included. Saying no changes nothing.</p>
    <div class="side-feedback-actions">
      <button type="button" class="btn gho" data-choice="no">Cancel</button>
      <button type="button" class="btn pri" data-choice="yes">Send my score</button>
    </div>
  </section>`;
  document.body.appendChild(backdrop);

  const range = backdrop.querySelector<HTMLInputElement>("#selfscore-range")!;
  const value = backdrop.querySelector<HTMLElement>("#selfscore-value")!;
  range.oninput = () => {
    value.textContent = Number(range.value).toFixed(1);
  };

  const no = backdrop.querySelector<HTMLButtonElement>('[data-choice="no"]')!;
  const yes = backdrop.querySelector<HTMLButtonElement>('[data-choice="yes"]')!;
  no.onclick = () => backdrop.remove();
  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") backdrop.remove();
  });
  yes.onclick = async () => {
    yes.disabled = true;
    no.disabled = true;
    const result = await submit(args, Number(range.value));
    const dialog = backdrop.querySelector<HTMLElement>(".side-feedback-dialog")!;
    if (!result.ok) {
      yes.disabled = false;
      no.disabled = false;
      let note = dialog.querySelector<HTMLElement>(".selfscore-error");
      if (!note) {
        note = document.createElement("p");
        note.className = "side-feedback-privacy selfscore-error";
        dialog.querySelector(".side-feedback-actions")!.before(note);
      }
      note.textContent = result.message;
      return;
    }
    markSent(args.scanId);
    onSent?.();
    dialog.innerHTML = `<span class="side-feedback-thanks" aria-live="polite">Recorded.</span>
      <p>Thanks. Your take is stored for calibration review. Your report stays exactly as measured.</p>`;
    window.setTimeout(() => backdrop.remove(), 1400);
  };
  range.focus();
}
