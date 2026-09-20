import {
  ANALYTICS_ACQUISITION_KEY, ANALYTICS_CONSENT_KEY,
  analyticsAcquisition, analyticsEventFor, analyticsMeasurementId, analyticsPage,
  analyticsVitalParameters,
  readAnalyticsConsent, validAcquisition,
  type AnalyticsAcquisition, type AnalyticsEvent, type AnalyticsMessage, type AnalyticsVital, type AnalyticsVitalMessage,
} from "./analyticsPolicy.js";

export interface AnalyticsController {
  available(): boolean;
  consent(): boolean | null;
  persistenceFailed(): boolean;
  setConsent(allowed: boolean): void;
  track(event: string): void;
  trackVital(vital: AnalyticsVital): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

// Public for isolated browser fixtures; production passes only the build-time
// public measurement ID. No hostname override or local opt-in flag exists.
export function createAnalyticsController(win: Window, rawId: unknown): AnalyticsController {
  const id = analyticsMeasurementId(rawId);
  if (!id || analyticsPage(win.location.href) === null) return {
    available: () => false, consent: () => null, persistenceFailed: () => false, setConsent() {}, track() {}, trackVital() {},
    subscribe: () => () => {}, dispose() {},
  };
  let frame: HTMLIFrameElement | null = null;
  let ready = false;
  let disposed = false;
  let suspended = false;
  let pageSent = false;
  // A failed storage write must never resurrect an older persisted grant.
  // Only a subsequent successfully persisted explicit choice clears this latch.
  let deniedInMemory = false;
  let pending: Array<AnalyticsMessage | AnalyticsVitalMessage> = [];
  const milestones = new Set<AnalyticsEvent>();
  const listeners = new Set<() => void>();
  const available = () => !disposed && !suspended && !!id && analyticsPage(win.location.href) !== null;
  const consent = (): boolean | null => {
    if (deniedInMemory) return false;
    try { return readAnalyticsConsent(win.localStorage.getItem(ANALYTICS_CONSENT_KEY)); }
    catch { return null; }
  };
  const forgetLanding = () => {
    try { win.sessionStorage.removeItem(ANALYTICS_ACQUISITION_KEY); } catch { /* storage unavailable */ }
  };
  const landing = (): AnalyticsAcquisition | null => {
    if (consent() !== true) return null;
    try {
      const stored = JSON.parse(win.sessionStorage.getItem(ANALYTICS_ACQUISITION_KEY) || "null");
      if (validAcquisition(stored)) return { landing: stored.landing, source: stored.source, medium: stored.medium };
    } catch { /* use this public page instead */ }
    const current = analyticsAcquisition(win.location.href, win.document.referrer);
    if (current) {
      try { win.sessionStorage.setItem(ANALYTICS_ACQUISITION_KEY, JSON.stringify(current)); } catch { /* memory only */ }
    }
    return current;
  };
  const clearCookies = () => {
    // Clear only the GA cookies this optional integration may set, at both
    // historical domain forms and host-only scope. No auth cookies are touched.
    try { for (const part of win.document.cookie.split(";")) {
      const name = part.trim().split("=")[0];
      if (!/^_ga(?:_|$)/.test(name)) continue;
      for (const domain of ["", "; Domain=truemax.app", "; Domain=.truemax.app", "; Domain=www.truemax.app"]) {
        win.document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure${domain}`;
      }
    } } catch { /* Cookies unavailable: no application action may fail. */ }
  };
  const stop = (erase = false) => {
    if (frame?.contentWindow && id) {
      // Same-origin disable is synchronous. Removing the browsing context then
      // stops pending loading, timers and unload callbacks owned by the tag.
      try { (frame.contentWindow as unknown as Record<string, unknown>)[`ga-disable-${id}`] = true; } catch { /* frame already gone */ }
    }
    try { frame?.remove(); } catch { /* A restricted DOM cannot break the app. */ }
    frame = null; ready = false; pending = []; pageSent = false;
    if (erase) { forgetLanding(); clearCookies(); }
  };
  const emit = (event: AnalyticsEvent) => {
    const page = analyticsPage(win.location.href);
    const acquisition = landing();
    if (!available() || consent() !== true || !page || !acquisition || !frame) return;
    const message: AnalyticsMessage = { kind: "truemax-analytics-event", event, page, acquisition };
    if (ready) { try { frame.contentWindow?.postMessage(message, win.location.origin); } catch { stop(); } }
    else if (pending.length < 20) pending.push(message);
  };
  const start = () => {
    if (!available() || consent() !== true || frame) return;
    try {
    frame = win.document.createElement("iframe");
    frame.hidden = true;
    frame.title = "Optional analytics";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.referrerPolicy = "no-referrer";
    // Fixed URL. Never include a parent location, ID, campaign or fragment.
    frame.src = "/analytics";
    frame.addEventListener("load", () => {
      try { if (available() && consent() === true) frame?.contentWindow?.postMessage({ kind: "truemax-analytics-start", id }, win.location.origin); }
      catch { stop(); }
    });
    win.document.body.appendChild(frame);
    if (!pageSent) { pageSent = true; emit("page_view"); }
    } catch { stop(); }
  };
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== win.location.origin || event.source !== frame?.contentWindow
      || event.data?.kind !== "truemax-analytics-ready" || !available() || consent() !== true) return;
    ready = true;
    try { for (const message of pending) frame?.contentWindow?.postMessage(message, win.location.origin); }
    catch { stop(); }
    pending = [];
  };
  const sync = () => {
    if (consent() !== true || !available()) stop(consent() !== true);
    else start();
    for (const listener of listeners) { try { listener(); } catch { /* Optional UI/metric subscribers cannot break the app. */ } }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === ANALYTICS_CONSENT_KEY || event.key === null) sync();
  };
  const onHide = () => { suspended = true; stop(); };
  const onShow = () => { suspended = false; sync(); };
  const originalPush = win.history.pushState;
  const originalReplace = win.history.replaceState;
  const push: History["pushState"] = function (...args) { originalPush.apply(win.history, args); sync(); };
  const replace: History["replaceState"] = function (...args) { originalReplace.apply(win.history, args); sync(); };
  let expiryCheck: number | undefined;
  const hooks = { message: onMessage, storage: onStorage, hashchange: sync, popstate: sync, pagehide: onHide, pageshow: onShow };
  const cleanup = () => {
    disposed = true; stop(); listeners.clear();
    if (expiryCheck !== undefined) { try { win.clearInterval(expiryCheck); } catch { /* restricted timer */ } }
    try {
      if (win.history.pushState === push) win.history.pushState = originalPush;
      if (win.history.replaceState === replace) win.history.replaceState = originalReplace;
    } catch { /* history can be read-only in embedded contexts */ }
    for (const [name, hook] of Object.entries(hooks)) {
      try { win.removeEventListener(name, hook as EventListener); } catch { /* optional hook */ }
    }
  };
  try {
    win.history.pushState = push;
    win.history.replaceState = replace;
    for (const [name, hook] of Object.entries(hooks)) win.addEventListener(name, hook as EventListener);
    expiryCheck = win.setInterval(() => { if (frame && consent() !== true) sync(); }, 60000);
    sync();
  } catch { cleanup(); }
  return {
    available, consent, persistenceFailed: () => deniedInMemory,
    setConsent(allowed) {
      if (!available()) return;
      try { win.localStorage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify({ version: 1, allowed, at: Date.now() })); }
      catch {
        deniedInMemory = true;
        try { win.localStorage.removeItem(ANALYTICS_CONSENT_KEY); } catch { /* The in-memory denial remains authoritative. */ }
        sync(); return;
      }
      deniedInMemory = false;
      if (!allowed) stop(true);
      sync();
    },
    track(event) {
      // No pre-consent event replay. Only activity after permission counts.
      if (!available() || consent() !== true) { if (frame) sync(); return; }
      start();
      const name = analyticsEventFor(event);
      if (name && !milestones.has(name)) { milestones.add(name); emit(name); }
    },
    trackVital(vital) {
      const page = analyticsPage(win.location.href);
      if (!available() || consent() !== true || !page) return;
      const acquisition = landing();
      if (!acquisition) return;
      // Rebuild the metric object too, so callers cannot append raw entries.
      const message: AnalyticsVitalMessage = { kind: "truemax-analytics-vital", page, acquisition,
        vital: { name: vital.name, value: vital.value, delta: vital.delta, rating: vital.rating, id: vital.id } };
      if (!analyticsVitalParameters(message)) return;
      start();
      if (ready) { try { frame?.contentWindow?.postMessage(message, win.location.origin); } catch { stop(); } }
      else if (pending.length < 20) pending.push(message);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose: cleanup,
  };
}

let controller: AnalyticsController | null = null;
export function publicAnalytics(): AnalyticsController | null {
  if (typeof window === "undefined") return null;
  try { controller ??= createAnalyticsController(window, import.meta.env?.DEV ? null : import.meta.env?.VITE_GA_MEASUREMENT_ID); }
  catch { return null; }
  return controller;
}

export function trackAnalytics(event: string): void {
  try { publicAnalytics()?.track(event); } catch { /* Never let optional telemetry interrupt capture or checkout. */ }
}
