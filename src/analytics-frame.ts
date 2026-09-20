import {
  ANALYTICS_CONSENT_KEY, ANALYTICS_ORIGIN,
  analyticsEventParameters, analyticsVitalParameters, analyticsMeasurementId, readAnalyticsConsent,
  type AnalyticsMessage,
} from "./engine/analyticsPolicy.js";

// An empty, fixed-URL browsing context prevents accidental capture of app DOM,
// forms or links by Enhanced Measurement. This same-origin frame is NOT a
// security boundary against a compromised third-party script. Production
// activation additionally requires Enhanced Measurement off in the GA stream.
export function initAnalyticsFrame(win: Window): () => void {
  const doc = win.document;
  const globals = win as unknown as Record<string, unknown>;
  let id: string | null = null;
  let script: HTMLScriptElement | null = null;
  let configured = false;
  const locationAllowed = () => win.parent !== win && win.location.protocol === "https:"
    && ["truemax.app", "www.truemax.app"].includes(win.location.host)
    && win.location.pathname === "/analytics" && !win.location.search && !win.location.hash;
  const allowed = () => {
    try { return locationAllowed() && readAnalyticsConsent(win.localStorage.getItem(ANALYTICS_CONSENT_KEY)) === true; }
    catch { return false; }
  };
  const stop = () => {
    if (id) globals[`ga-disable-${id}`] = true;
    script?.remove(); script = null;
    if (Array.isArray(globals.dataLayer)) globals.dataLayer.length = 0;
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source !== win.parent || event.origin !== win.location.origin || !allowed()) { if (!allowed()) stop(); return; }
    if (event.data?.kind === "truemax-analytics-start") {
      const requested = analyticsMeasurementId(event.data.id);
      if (!requested || (id && id !== requested)) return;
      id = requested;
      win.parent.postMessage({ kind: "truemax-analytics-ready" }, win.location.origin);
      return;
    }
    const params = analyticsEventParameters(event.data) ?? analyticsVitalParameters(event.data);
    if (!id || !params) return;
    const message = event.data as AnalyticsMessage;
    if (!configured) {
      configured = true;
      globals[`ga-disable-${id}`] = false;
      globals.dataLayer = [];
      const gtag = function (..._args: unknown[]) {
        (globals.dataLayer as unknown[]).push(arguments);
      };
      globals.gtag = gtag;
      // Basic consent mode: the library is absent before opt-in. No denied
      // analytics pings, advertising consent, Signals or user-provided data.
      gtag("consent", "default", {
        analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
      });
      gtag("set", { allow_google_signals: false, allow_ad_personalization_signals: false, ads_data_redaction: true, url_passthrough: false });
      gtag("js", new Date());
      gtag("config", id, {
        ...params, send_page_view: false,
        allow_google_signals: false, allow_ad_personalization_signals: false,
        cookie_domain: win.location.hostname, cookie_path: "/", cookie_expires: 2592000,
        cookie_update: false, cookie_flags: "SameSite=Lax;Secure",
        // Never let the fixed frame's URL or an inherited referrer override
        // the explicit public-page metadata carried by each permitted event.
        page_location: params.page_location || ANALYTICS_ORIGIN + "/", page_referrer: "",
      });
      script = doc.createElement("script");
      script.async = true;
      script.referrerPolicy = "no-referrer";
      script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
      doc.head.appendChild(script);
    }
    if (allowed() && globals[`ga-disable-${id}`] !== true) {
      (globals.gtag as (...args: unknown[]) => void)("event", event.data.kind === "truemax-analytics-vital" ? "web_vital" : message.event, { ...params, send_to: id });
    }
  };
  const onStorage = () => { if (!allowed()) stop(); };
  win.addEventListener("message", onMessage);
  win.addEventListener("storage", onStorage);
  win.addEventListener("pagehide", stop);
  return () => { stop(); win.removeEventListener("message", onMessage); win.removeEventListener("storage", onStorage); win.removeEventListener("pagehide", stop); };
}

if (typeof window !== "undefined") initAnalyticsFrame(window);
