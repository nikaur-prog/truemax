// Only this vocabulary can cross the optional analytics bridge. Never pass a
// report, account, form value, document title or arbitrary URL to that bridge.
export const ANALYTICS_ORIGIN = "https://www.truemax.app";
export const ANALYTICS_CONSENT_KEY = "truemax.analytics-consent.v1";
export const ANALYTICS_ACQUISITION_KEY = "truemax.analytics-landing.v1";
export const ANALYTICS_CONSENT_DAYS = 180;

export const ANALYTICS_PAGES = {
  "/": ["TrueMax facial analysis", "product"],
  "/guides": ["TrueMax guides", "guide"],
  "/face-score": ["Understanding face scores", "guide"],
  "/improve-your-looks": ["Improving your appearance", "guide"],
  "/looksmaxxing-guide": ["Looksmaxxing guide", "guide"],
  "/glow-up-guide": ["Glow-up guide", "guide"],
  "/methodology": ["TrueMax methodology", "methodology"],
  "/pricing": ["TrueMax pricing", "pricing"],
  "/how-it-works": ["How TrueMax works", "product"],
  "/about": ["About TrueMax", "product"],
  "/help/take-a-good-face-scan": ["Face photo guide", "guide"],
  "/measurements": ["Facial measurement library", "measurement"],
  "/measurements/gonial-angle": ["Gonial angle", "measurement"],
  "/measurements/canthal-tilt": ["Canthal tilt", "measurement"],
  "/measurements/side-profile-analysis": ["Side profile analysis", "measurement"],
} as const;
export type AnalyticsPath = keyof typeof ANALYTICS_PAGES;
const QUERY_KEYS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ttclid", "ttp"]);

export function analyticsMeasurementId(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() === raw && /^G-[A-Z0-9]{6,15}$/.test(raw) ? raw : null;
}

export function isAnalyticsPath(value: unknown): value is AnalyticsPath {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ANALYTICS_PAGES, value);
}

export function analyticsPage(href: string): AnalyticsPath | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || !["truemax.app", "www.truemax.app"].includes(url.host)
      || url.username || url.password || url.hash || !isAnalyticsPath(url.pathname)) return null;
    // OAuth, preview, calibration, payment and unknown state never load a tag.
    for (const key of url.searchParams.keys()) if (!QUERY_KEYS.has(key)) return null;
    return url.pathname;
  } catch { return null; }
}

const SOURCES = ["google", "bing", "duckduckgo", "tiktok", "instagram", "youtube", "newsletter", "other", "direct"] as const;
const MEDIA = ["organic", "paid", "social", "email", "referral", "direct"] as const;
export type AnalyticsSource = typeof SOURCES[number];
export type AnalyticsMedium = typeof MEDIA[number];
export interface AnalyticsAcquisition {
  landing: AnalyticsPath;
  source: AnalyticsSource;
  medium: AnalyticsMedium;
}

function referrerSource(referrer: string): AnalyticsSource {
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (["google.com", "google.co.nz", "google.com.au", "google.co.uk", "google.ca", "google.de", "google.fr"].includes(host)) return "google";
    if (host === "bing.com") return "bing";
    if (host === "duckduckgo.com") return "duckduckgo";
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
    if (host === "youtube.com" || host === "youtu.be") return "youtube";
    if (["truemax.app", "www.truemax.app"].includes(host)) return "direct";
    return "other";
  } catch { return "direct"; }
}

export function analyticsAcquisition(href: string, referrer: string): AnalyticsAcquisition | null {
  const landing = analyticsPage(href);
  if (!landing) return null;
  const url = new URL(href);
  const named = url.searchParams.get("utm_source")?.toLowerCase();
  const source = named ? (SOURCES.includes(named as AnalyticsSource) ? named as AnalyticsSource : "other") : referrerSource(referrer);
  const paid = ["cpc", "ppc", "paid", "paid_social"].includes(url.searchParams.get("utm_medium")?.toLowerCase() || "");
  const medium: AnalyticsMedium = paid ? "paid" : source === "newsletter" ? "email"
    : ["google", "bing", "duckduckgo"].includes(source) ? "organic"
      : ["tiktok", "instagram", "youtube"].includes(source) ? "social" : source === "direct" ? "direct" : "referral";
  return { landing, source, medium };
}

export function validAcquisition(raw: unknown): raw is AnalyticsAcquisition {
  if (!raw || typeof raw !== "object") return false;
  const a = raw as AnalyticsAcquisition;
  return isAnalyticsPath(a.landing) && SOURCES.includes(a.source) && MEDIA.includes(a.medium);
}

export const ANALYTICS_EVENTS = ["page_view", "scan_start", "scan_front_complete", "scan_side_complete", "scan_side_skipped", "view_results", "sign_up", "view_plans", "begin_checkout", "scan_gate_view"] as const;
export type AnalyticsEvent = typeof ANALYTICS_EVENTS[number];
export function analyticsEventFor(event: string): AnalyticsEvent | null {
  const names: Record<string, AnalyticsEvent> = {
    "scan-started": "scan_start",
    "scan-front-done": "scan_front_complete", "scan-side-done": "scan_side_complete",
    "scan-side-skipped": "scan_side_skipped", "results-shown": "view_results",
    "account-created": "sign_up", "plan-opened": "view_plans", "offer-shown": "view_plans",
    "checkout-started": "begin_checkout", "scan-gate-shown": "scan_gate_view",
  };
  return Object.prototype.hasOwnProperty.call(names, event) ? names[event] : null;
}

export interface AnalyticsMessage {
  kind: "truemax-analytics-event";
  event: AnalyticsEvent;
  page: AnalyticsPath;
  acquisition: AnalyticsAcquisition;
}

export interface AnalyticsVital {
  name: "LCP" | "CLS" | "INP";
  value: number;
  delta: number;
  rating: "good" | "needs-improvement" | "poor";
  /** Generated by pinned web-vitals v6, not an account, photo or DOM ID. */
  id: string;
}
export interface AnalyticsVitalMessage {
  kind: "truemax-analytics-vital";
  page: AnalyticsPath;
  acquisition: AnalyticsAcquisition;
  vital: AnalyticsVital;
}

export function analyticsVitalParameters(raw: unknown): Record<string, string | number> | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as AnalyticsVitalMessage;
  const v = message.vital;
  if (message.kind !== "truemax-analytics-vital" || !v || !["LCP", "CLS", "INP"].includes(v.name)
    || !["good", "needs-improvement", "poor"].includes(v.rating) || typeof v.id !== "string" || v.id.length !== 30 || !/^v6-\d{13}-\d{13}$/.test(v.id)
    || !Number.isFinite(v.value) || v.value < 0 || v.value > 3600000
    || !Number.isFinite(v.delta) || Math.abs(v.delta) > 3600000) return null;
  const page = analyticsEventParameters({ kind: "truemax-analytics-event", event: "page_view", page: message.page, acquisition: message.acquisition });
  return page ? { ...page, metric_name: v.name, metric_value: v.value, metric_delta: v.delta, metric_rating: v.rating, metric_id: v.id } : null;
}

/** Reconstruct, never spread an untrusted message or its extra keys. */
export function analyticsEventParameters(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as AnalyticsMessage;
  if (message.kind !== "truemax-analytics-event" || !ANALYTICS_EVENTS.includes(message.event)
    || !isAnalyticsPath(message.page) || !validAcquisition(message.acquisition)) return null;
  const a = message.acquisition;
  return {
    page_location: ANALYTICS_ORIGIN + message.page,
    page_title: ANALYTICS_PAGES[message.page][0],
    page_referrer: "", // Not the document referrer, which may contain private URLs.
    page_category: ANALYTICS_PAGES[message.page][1],
    landing_page: a.landing,
    acquisition_source: a.source,
    acquisition_medium: a.medium,
    campaign_source: a.source,
    campaign_medium: a.medium,
  };
}

export function readAnalyticsConsent(raw: string | null, now = Date.now()): boolean | null {
  try {
    const value = JSON.parse(raw || "null");
    return value?.version === 1 && typeof value.allowed === "boolean" && Number.isFinite(value.at)
      && value.at <= now && now - value.at < ANALYTICS_CONSENT_DAYS * 86400000 ? value.allowed : null;
  } catch { return null; }
}
