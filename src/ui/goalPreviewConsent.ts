import { currentAccessToken } from "../engine/auth.js";
import { activeScanOwner } from "../engine/scanScope.js";
import {
  grantGoalPreviewConsent,
  readGoalPreviewConsent,
} from "../engine/goalPreviewConsent.js";

let active: HTMLDivElement | null = null;

interface ConsentRuntime {
  owner: typeof activeScanOwner;
  token: typeof currentAccessToken;
  read: typeof readGoalPreviewConsent;
  grant: typeof grantGoalPreviewConsent;
}

/**
 * A separate, purpose-bound consent. Agreeing to cloud landmark placement or
 * correction feedback never grants this one.
 */
export async function ensureGoalPreviewConsent(
  options: { userId: string; signal?: AbortSignal },
  overrides: Partial<ConsentRuntime> = {},
): Promise<boolean> {
  const runtime: ConsentRuntime = { owner: activeScanOwner, token: currentAccessToken, read: readGoalPreviewConsent, grant: grantGoalPreviewConsent, ...overrides };
  const owner = `user:${options.userId}`;
  const current = () => !options.signal?.aborted && runtime.owner() === owner;
  if (!current()) return false;
  const accessToken = await runtime.token(options.userId);
  if (!current() || !accessToken) return false;
  let saved;
  try {
    saved = await runtime.read(accessToken, options.signal);
  } catch (error) {
    if (!current()) return false;
    throw error;
  }
  if (!current()) return false;
  if (!saved.ok) throw new Error(saved.error || "Consent could not be checked.");
  if (saved.state?.granted) return true;

  if (active) return false;
  return new Promise<boolean>((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const host = document.createElement("div");
    const controller = new AbortController();
    let settled = false;
    let busy = false;
    const finish = (granted: boolean) => {
      if (settled) return;
      settled = true;
      controller.abort();
      options.signal?.removeEventListener("abort", cancelled);
      document.removeEventListener("focusin", containFocus);
      host.remove();
      // Only this request's modal may be closed by a late grant response.
      if (active === host) active = null;
      if (!document.querySelector(".trial-overlay")) document.body.classList.remove("funnel-open");
      if (current() && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(granted);
    };
    const containFocus = (event: FocusEvent) => {
      if (!settled && active === host && !host.contains(event.target as Node)) {
        host.querySelector<HTMLElement>("#goal-consent-title")?.focus({ preventScroll: true });
      }
    };
    const cancelled = () => finish(false);
    options.signal?.addEventListener("abort", cancelled, { once: true });
    active = host;
    host.className = "trial-overlay goal-preview-consent";
    host.innerHTML = `<div class="trial-shell goal-preview-consent-shell" role="dialog" aria-modal="true" aria-labelledby="goal-consent-title">
      <header class="trial-nav">
        <span class="trial-eyebrow">GOAL PREVIEW</span>
        <button class="trial-close" type="button" aria-label="Close">✕</button>
      </header>
      <main class="trial-body">
        <h2 id="goal-consent-title" tabindex="-1">Send this scan once to create your visual target?</h2>
        <p>TrueMax will send the front photograph, the profile photograph if this scan has one, and a bounded list of your selected presentation goals. It does not send your name, chat history or measurements outside that goal recipe.</p>
        <div class="goal-consent-facts">
          <p><b>Who processes it</b> The render may be processed by Higgsfield or OpenAI, depending on which service is available. <a href="https://higgsfield.ai/privacy-policy" target="_blank" rel="noopener noreferrer">Higgsfield privacy</a> · <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noopener noreferrer">OpenAI privacy</a>.</p>
          <p><b>What is kept</b> TrueMax does not store the source photographs for this request. It keeps only the generated preview for up to 30 days, or up to one year if you explicitly keep it. Generated previews are not used for training or advertising.</p>
          <p><b>Provider retention</b> The OpenAI API may retain abuse-monitoring data for up to 30 days and does not train on API data by default. Higgsfield receives uploaded references under its commercial privacy terms; its current integration does not provide TrueMax a way to delete that provider upload.</p>
          <p><b>Your control</b> Goal preview is for signed-in adults and never runs for a guest scan. You can revoke it in Settings, which deletes every preview stored by TrueMax.</p>
        </div>
        <p class="trial-note">The result is a synthetic visual direction based on selected goals, not a forecast. Identity and bone structure are required to stay fixed, and the result is withheld if the device checks fail.</p>
      </main>
      <p class="trial-status" role="status"></p>
      <footer class="trial-actions">
        <button class="btn gho" data-goal-consent-no type="button">Not now</button>
        <button class="btn pri" data-goal-consent-yes type="button">Create my preview</button>
      </footer>
    </div>`;
    document.body.appendChild(host);
    document.body.classList.add("funnel-open");
    document.addEventListener("focusin", containFocus);
    host.querySelector<HTMLElement>("#goal-consent-title")?.focus({ preventScroll: true });

    const no = host.querySelector<HTMLButtonElement>("[data-goal-consent-no]");
    const yes = host.querySelector<HTMLButtonElement>("[data-goal-consent-yes]");
    const status = host.querySelector<HTMLElement>(".trial-status");
    const decline = () => finish(false);
    no?.addEventListener("click", decline);
    host.querySelector(".trial-close")?.addEventListener("click", decline);
    host.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); decline(); }
      if (event.key === "Tab") {
        const controls = [...host.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')]
          .filter((element) => !element.hidden && !(element as HTMLButtonElement).disabled);
        if (!controls.length) { event.preventDefault(); return; }
        const index = controls.indexOf(document.activeElement as HTMLElement);
        if (index < 0 || (!event.shiftKey && index === controls.length - 1) || (event.shiftKey && index === 0)) {
          event.preventDefault();
          controls[event.shiftKey ? controls.length - 1 : 0].focus({ preventScroll: true });
        }
      }
    });
    yes?.addEventListener("click", async () => {
      if (!yes || settled || busy) return;
      if (!current() || active !== host) { finish(false); return; }
      busy = true;
      yes.disabled = true;
      if (no) no.disabled = true;
      yes.textContent = "Saving choice...";
      try {
        const token = await runtime.token(options.userId);
        if (!current() || active !== host || settled) { finish(false); return; }
        if (!token) throw new Error("Sign in again to create this preview.");
        const result = await runtime.grant(token, controller.signal);
        if (!current() || active !== host || settled) { finish(false); return; }
        if (result.ok && result.state?.granted) {
          finish(true);
          return;
        }
        if (status) status.textContent = result.error || "Consent could not be saved.";
      } catch (error) {
        if (!current() || settled || active !== host) { finish(false); return; }
        if (status) status.textContent = error instanceof Error ? error.message : "Consent could not be saved.";
      }
      busy = false;
      yes.disabled = false;
      if (no) no.disabled = false;
      yes.textContent = "Create my preview";
    });
  });
}
