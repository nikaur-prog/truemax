import { acceptedNativeInstall, canOfferInstall, installKind } from "../engine/installOffer.js";
import { isNativeApp } from "../engine/platform.js";
import { isStandaloneLaunch } from "../engine/standalone.js";
import { track } from "../engine/track.js";
import "./installPrompt.css";

interface BrowserInstallEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice?: Promise<unknown>;
}
const SHOWN_KEY = "truemax:install-offered:v1";

/** Passive until a real own-account result exists; no automatic modal. */
export function mountInstallPrompt() {
  let nativePrompt: BrowserInstallEvent | null = null;
  let host: HTMLElement | null = null;
  let eligible = () => false;
  let banner: HTMLElement | null = null;
  let sheet: HTMLDialogElement | null = null;
  let observer: IntersectionObserver | null = null;
  let shown = false;
  let accepted = false;
  try { shown = localStorage.getItem(SHOWN_KEY) === "1"; } catch { /* session only */ }

  if (isStandaloneLaunch()) track("launch-standalone");

  const closeSheet = () => {
    sheet?.close();
    sheet?.remove();
    sheet = null;
  };
  const removeBanner = () => {
    observer?.disconnect();
    observer = null;
    banner?.remove();
    banner = null;
  };
  const markShown = () => {
    if (shown || !banner?.isConnected || !eligible() || document.hidden) return;
    if (document.querySelector('.dash, [aria-modal="true"], dialog[open]')) return;
    shown = true;
    try { localStorage.setItem(SHOWN_KEY, "1"); } catch { /* session only */ }
    track("install-prompt-shown");
    observer?.disconnect();
    observer = null;
  };
  const markAccepted = () => {
    if (!shown || accepted) return;
    accepted = true;
    track("install-accepted");
  };
  const openIosSheet = () => {
    closeSheet();
    sheet = document.createElement("dialog");
    sheet.className = "install-sheet";
    sheet.setAttribute("aria-labelledby", "install-sheet-title");
    sheet.innerHTML = `<h2 id="install-sheet-title">Keep TrueMax on your home screen</h2>
      <ol><li>Tap Safari's Share button. If it is hidden, open the More menu first.</li>
      <li>Choose <b>Add to Home Screen</b>.</li><li>Keep <b>Open as Web App</b> on if shown, then tap <b>Add</b>.</li></ol>
      <p>Your scan history stays on this device. Adding the icon is not a cloud backup.</p>
      <button type="button" class="btn pri">Got it</button>`;
    sheet.querySelector("button")?.addEventListener("click", closeSheet);
    sheet.addEventListener("cancel", (event) => { event.preventDefault(); closeSheet(); });
    sheet.addEventListener("click", (event) => { if (event.target === sheet) closeSheet(); });
    document.body.appendChild(sheet);
    sheet.showModal();
  };
  const offer = () => {
    if (banner?.isConnected || !host?.isConnected) return;
    // A report rerender may have detached an unseen invitation. Do not leave
    // its observer retaining the old report when a replacement is offered.
    removeBanner();
    const kind = installKind({
      standalone: isStandaloneLaunch(),
      nativeApp: isNativeApp(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      nativePromptAvailable: nativePrompt !== null,
    });
    if (!canOfferInstall(eligible(), true, shown, kind)) return;
    banner = document.createElement("aside");
    banner.className = "install-offer";
    banner.setAttribute("aria-label", "Add TrueMax to your home screen");
    banner.innerHTML = `<div><strong>TrueMax, one tap away</strong><p>Add TrueMax to your home screen to keep your streak and rescan in a tap.</p></div>
      <button type="button" class="btn pri" data-install>Add to home screen</button>
      <button type="button" class="install-offer-dismiss" aria-label="Dismiss home screen invitation">✕</button>`;
    banner.querySelector(".install-offer-dismiss")?.addEventListener("click", () => { markShown(); removeBanner(); });
    banner.querySelector<HTMLButtonElement>("[data-install]")?.addEventListener("click", async (event) => {
      if (!eligible()) { removeBanner(); return; }
      markShown();
      if (kind === "ios") { openIosSheet(); return; }
      const prompt = nativePrompt;
      nativePrompt = null;
      if (!prompt) { removeBanner(); return; }
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        const result = await prompt.prompt();
        if (acceptedNativeInstall(result) || acceptedNativeInstall(await prompt.userChoice)) markAccepted();
      } catch { /* browser refusal cannot interrupt the report */ }
      removeBanner();
    });
    // At the end of the report, outside the changing tab body and sticky rail.
    // It occupies its own space instead of covering measurements on a phone.
    host.appendChild(banner);
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.25)) markShown();
      }, { threshold: 0.25 });
      observer.observe(banner);
    } else {
      // Older engines: count when a real interaction exposes the invitation.
      banner.addEventListener("focusin", markShown, { once: true });
      banner.addEventListener("pointerenter", markShown, { once: true });
    }
  };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    nativePrompt = event as BrowserInstallEvent;
    offer();
  });
  window.addEventListener("appinstalled", () => { markAccepted(); nativePrompt = null; removeBanner(); closeSheet(); });
  return {
    afterOwnResult(target: HTMLElement, stillEligible: () => boolean) {
      host = target;
      eligible = stillEligible;
      offer();
    },
    clear() {
      eligible = () => false;
      host = null;
      removeBanner();
      closeSheet();
    },
  };
}
