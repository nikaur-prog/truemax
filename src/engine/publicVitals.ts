import type { AnalyticsController } from "./analytics.js";

export interface PublicVital {
  name: "LCP" | "CLS" | "INP";
  value: number;
  delta: number;
  rating: "good" | "needs-improvement" | "poor";
  id: string;
}

type VitalsLibrary = Pick<typeof import("web-vitals"), "onLCP" | "onCLS" | "onINP">;
type VitalsController = Pick<AnalyticsController, "available" | "consent" | "subscribe" | "trackVital">;
type VitalsLoader = () => Promise<VitalsLibrary>;
const mounted = new WeakMap<VitalsController, () => void>();

/** Drop entries, URLs, DOM attribution and unknown fields before the bridge. */
export function publicVital(raw: unknown): PublicVital | null {
  if (!raw || typeof raw !== "object") return null;
  const metric = raw as Record<string, unknown>;
  if (metric.name !== "LCP" && metric.name !== "CLS" && metric.name !== "INP") return null;
  if (typeof metric.value !== "number" || !Number.isFinite(metric.value)
    || metric.value < 0 || metric.value > Number.MAX_SAFE_INTEGER
    || typeof metric.delta !== "number" || !Number.isFinite(metric.delta)
    || Math.abs(metric.delta) > Number.MAX_SAFE_INTEGER) return null;
  if (metric.rating !== "good" && metric.rating !== "needs-improvement" && metric.rating !== "poor") return null;
  // The pinned standard build creates this ID from a timestamp and randomness,
  // never from an account, DOM node or URL. A package update must review it.
  if (typeof metric.id !== "string" || metric.id.length !== 30 || !/^v6-\d{13}-\d{13}$/.test(metric.id)) return null;
  return { name: metric.name, value: metric.value === 0 ? 0 : metric.value,
    delta: metric.delta === 0 ? 0 : metric.delta, rating: metric.rating, id: metric.id };
}

/**
 * Official standard build only, bundled locally and loaded after permission.
 * It reads buffered performance entries and has page-lifetime observers:
 * https://github.com/GoogleChrome/web-vitals#install-and-load-the-library
 * Therefore a first consent grant takes effect on the NEXT full navigation.
 * Revocation or leaving an eligible public URL silences this document for good,
 * including a later re-grant. That prevents replaying a mixed-consent interval.
 * No approximate INP fallback is emitted in browsers without native support.
 */
export function mountPublicVitals(
  controller: VitalsController,
  load: VitalsLoader = () => import("web-vitals"),
): () => void {
  const existing = mounted.get(controller);
  if (existing) return existing;

  let stopped = !controller.available() || controller.consent() !== true;
  let unsubscribe = () => {};
  const last = new Map<PublicVital["name"], string>();
  const stop = () => { stopped = true; last.clear(); unsubscribe(); };
  const permitted = () => {
    if (!stopped && (!controller.available() || controller.consent() !== true)) stop();
    return !stopped;
  };
  // Keep the record even after stopping: another mount must not register a
  // second set of observers or begin collecting halfway through this page.
  mounted.set(controller, stop);
  if (stopped) return stop;
  unsubscribe = controller.subscribe(() => { permitted(); });

  const report = (raw: unknown) => {
    if (!permitted()) return;
    const metric = publicVital(raw);
    if (!metric) return;
    const signature = `${metric.id}:${metric.value}:${metric.delta}:${metric.rating}`;
    if (last.get(metric.name) === signature) return;
    last.set(metric.name, signature);
    controller.trackVital(metric);
  };
  // Check again after the async import. A revoke during download cannot start
  // observers. A restored BFcache visit uses the library's new metric ID, not
  // another registration. Repeated CLS/INP updates keep their official deltas.
  void Promise.resolve().then(() => permitted() ? load() : null).then(library => {
    if (!library || !permitted()) return;
    library.onLCP(report);
    library.onCLS(report);
    library.onINP(report);
  }).catch(stop);
  return stop;
}
