// Tiny public-page enhancement. Keep this graph free of auth, scoring, vision,
// account state and app styling. It must not turn a guide into the full app.
import { captureAttribution } from "./engine/attribution.js";
import { analyticsPage } from "./engine/analyticsPolicy.js";
import { publicAnalytics } from "./engine/analytics.js";
import { mountPublicAnalyticsChoice } from "./ui/analyticsConsent.js";

let started = false;
export function initPublicPage(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!analyticsPage(location.href)) return;
  // Existing campaign-to-checkout attribution, already explained separately
  // in Privacy. Never invent internal UTMs or conflate it with GA permission.
  try {
    captureAttribution();
    const controller = publicAnalytics();
    mountPublicAnalyticsChoice(controller);
    // Field-performance collection stays unshipped: the empty-frame bridge
    // cannot yet guarantee delivery of final exit metrics. Do not mount the
    // prepared collector here, including when a GA ID is configured.
  } catch { /* Optional enhancements must never prevent reading or scanning. */ }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initPublicPage, { once: true });
  else initPublicPage();
}
