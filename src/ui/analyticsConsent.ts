import { publicAnalytics, type AnalyticsController } from "../engine/analytics.js";
import "./analyticsConsent.css";

const PREFERENCE_WARNING = "Your browser could not save this choice. Analytics is off for this page, but the choice may not survive a reload or reach other tabs. Check your browser storage settings.";

/** Shared by signed-out public pages and Settings. No account lookup needed. */
export function mountAnalyticsSetting(host: HTMLElement | null, controller = publicAnalytics()): () => void {
  if (!host || !controller?.available()) { if (host) host.hidden = true; return () => {}; }
  const render = () => {
    const allowed = controller.consent() === true;
    host.hidden = !controller.available();
    host.innerHTML = `<div class="analytics-setting"><p>Optional Google Analytics is <b>${allowed ? "on" : "off"}</b>. It helps us understand public pages and scan, sign-up and checkout steps. We do not send your photos, measurements, scores, account details or conversations.</p>
      ${controller.persistenceFailed() ? `<p role="status" class="analytics-save-warning">${PREFERENCE_WARNING}</p>` : ""}
      <button type="button" class="analytics-choice" aria-pressed="${allowed}">${allowed ? "Turn analytics off" : "Allow analytics"}</button>
      <p class="analytics-small">This browser only. <a href="/privacy#optional-analytics">What is collected</a>. Turning it off stops future collection; it does not delete reports already received by Google.</p></div>`;
    host.querySelector("button")?.addEventListener("click", () => controller.setConsent(!allowed));
  };
  render();
  const unsubscribe = controller.subscribe(render);
  return () => { unsubscribe(); host.replaceChildren(); };
}

export function mountPublicAnalyticsChoice(controller: AnalyticsController | null = publicAnalytics()): () => void {
  if (!controller?.available()) return () => {};
  const root = document.createElement("div");
  root.className = "analytics-public";
  const entry = document.createElement("button");
  entry.type = "button"; entry.className = "analytics-preferences-link"; entry.textContent = "Analytics preferences";
  const panel = document.createElement("aside");
  panel.className = "analytics-consent";
  panel.setAttribute("aria-label", "Optional analytics preferences");
  panel.setAttribute("role", "region");
  root.append(entry, panel);
  (document.querySelector(".foot") ?? document.body).appendChild(root);
  let opened = controller.consent() === null;
  const render = () => {
    if (controller.persistenceFailed()) opened = true;
    root.hidden = !controller.available();
    panel.hidden = !opened;
    panel.innerHTML = `<h2>Help us improve TrueMax?</h2>
      ${controller.persistenceFailed() ? `<p role="status" class="analytics-save-warning">${PREFERENCE_WARNING}</p>` : ""}
      <p>Allow optional Google Analytics to understand which public pages and product steps are useful. Google receives a cookie identifier and basic browser information, but not your photos, scores, measurements, account details or Max conversations.</p>
      <p class="analytics-small">You can use TrueMax without it and change this choice here or in Settings. <a href="/privacy#optional-analytics">Read about analytics</a>.</p>
      <div class="analytics-actions"><button class="analytics-choice" type="button" data-analytics-no>Keep analytics off</button><button class="analytics-choice" type="button" data-analytics-yes>Allow analytics</button></div>`;
    const choose = (allowed: boolean) => { opened = false; controller.setConsent(allowed); render(); entry.focus({ preventScroll: true }); };
    panel.querySelector("[data-analytics-no]")?.addEventListener("click", () => choose(false));
    panel.querySelector("[data-analytics-yes]")?.addEventListener("click", () => choose(true));
  };
  entry.addEventListener("click", () => { opened = !opened; render(); if (opened) panel.querySelector<HTMLButtonElement>("button")?.focus(); });
  panel.addEventListener("keydown", event => { if (event.key === "Escape") { opened = false; render(); entry.focus(); } });
  const unsubscribe = controller.subscribe(() => { if (controller.consent() !== null) opened = false; render(); });
  render();
  return () => { unsubscribe(); root.remove(); };
}
