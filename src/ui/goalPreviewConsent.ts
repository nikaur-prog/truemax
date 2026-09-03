import { currentAccessToken } from "../engine/auth.js";
import {
  grantGoalPreviewConsent,
  readGoalPreviewConsent,
} from "../engine/goalPreviewConsent.js";

let active: HTMLDivElement | null = null;

function close(result: boolean, resolve: (value: boolean) => void): void {
  active?.remove();
  active = null;
  document.body.classList.remove("funnel-open");
  resolve(result);
}

/**
 * A separate, purpose-bound consent. Agreeing to cloud landmark placement or
 * correction feedback never grants this one.
 */
export async function ensureGoalPreviewConsent(): Promise<boolean> {
  const accessToken = await currentAccessToken();
  if (!accessToken) return false;
  const current = await readGoalPreviewConsent(accessToken);
  if (current.ok && current.state?.granted) return true;

  if (active) return false;
  return new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    active = host;
    host.className = "trial-overlay goal-preview-consent";
    host.innerHTML = `<div class="trial-shell goal-preview-consent-shell" role="dialog" aria-modal="true" aria-labelledby="goal-consent-title">
      <header class="trial-nav">
        <span class="trial-eyebrow">GOAL PREVIEW</span>
        <button class="trial-close" type="button" aria-label="Close">✕</button>
      </header>
      <main class="trial-body">
        <h2 id="goal-consent-title">Send this scan once to create your visual target?</h2>
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

    const no = host.querySelector<HTMLButtonElement>("[data-goal-consent-no]");
    const yes = host.querySelector<HTMLButtonElement>("[data-goal-consent-yes]");
    const status = host.querySelector<HTMLElement>(".trial-status");
    const decline = () => close(false, resolve);
    no?.addEventListener("click", decline);
    host.querySelector(".trial-close")?.addEventListener("click", decline);
    yes?.addEventListener("click", async () => {
      if (!yes) return;
      yes.disabled = true;
      if (no) no.disabled = true;
      yes.textContent = "Saving choice...";
      const result = await grantGoalPreviewConsent(accessToken);
      if (result.ok && result.state?.granted) {
        close(true, resolve);
        return;
      }
      yes.disabled = false;
      if (no) no.disabled = false;
      yes.textContent = "Create my preview";
      if (status) status.textContent = result.error || "Consent could not be saved.";
    });
  });
}
