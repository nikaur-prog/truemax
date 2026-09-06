import { fetchBodyProfile, readBody, saveBodyProfile, type ServerBodyProfile } from "../engine/bodyProfile.js";
import { currentAccessToken } from "../engine/auth.js";
import { activeScanOwner } from "../engine/scanScope.js";
import { bodyMetricUsable, boundsSentence, convertBodyEntryUnits, toMetric, type BodyEntry, type UnitSystem } from "../engine/bodyUnits.js";

export { type BodyEntry } from "../engine/bodyUnits.js";
export const bodyEntryToMetric = toMetric;

let active: HTMLDivElement | null = null;
let activePromise: Promise<boolean> | null = null;
let activeOwner: string | null = null;
let activeFinish: ((saved: boolean) => void) | null = null;

export function closeBodyProfileDialog(): void {
  activeFinish?.(false);
}

/** A required prompt is only allowed by the authenticated server's flag. */
export function openBodyProfileDialog(options: {
  required?: boolean;
  userId?: string;
  initialProfile?: ServerBodyProfile;
  source?: "dialog" | "settings";
} = {}): Promise<boolean> {
  const owner = activeScanOwner();
  if (!owner?.startsWith("user:") || (options.userId && owner !== `user:${options.userId}`)) return Promise.resolve(false);
  if (activePromise && activeOwner === owner) return activePromise;
  closeBodyProfileDialog();
  const userId = owner.slice(5);
  const existing = readBody();
  let entry: BodyEntry = { unit: "metric", ...(existing ? { heightCm: existing.heightCm, weightKg: existing.weightKg } : {}) };
  let drafts: Partial<Record<UnitSystem, BodyEntry>> = {};
  let server = options.userId === userId ? options.initialProfile ?? null : null;
  let loading = !server;
  let busy = false;
  let message = "";
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  activePromise = new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    active = host;
    activeOwner = owner;
    host.className = "body-profile-overlay";
    document.body.appendChild(host);
    document.body.classList.add("body-profile-open");
    const current = () => active === host && host.isConnected && activeScanOwner() === owner;
    const required = () => options.required === true && server?.required === true;
    const abort = new AbortController();
    const finish = (saved: boolean) => {
      if (active !== host) return;
      abort.abort();
      host.remove();
      active = null;
      activeOwner = null;
      activeFinish = null;
      activePromise = null;
      document.body.classList.remove("body-profile-open");
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(saved);
    };
    activeFinish = finish;
    const value = (id: string) => {
      const raw = host.querySelector<HTMLInputElement>(`#${id}`)?.value.trim();
      return raw ? Number(raw) : undefined;
    };
    const readEntry = () => {
      const next: BodyEntry = entry.unit === "metric"
        ? { unit: "metric", heightCm: value("body-height-cm"), weightKg: value("body-weight-kg") }
        : { unit: "imperial", feet: value("body-height-ft"), inches: value("body-height-in"), pounds: value("body-weight-lb") };
      if (JSON.stringify(next) !== JSON.stringify(entry)) drafts = {};
      entry = next;
      drafts[entry.unit] = { ...entry };
    };
    const field = (id: string, label: string, unit: string, v: number | undefined, min: number, max: number, step = "0.1") =>
      `<label><span>${label}</span><div><input id="${id}" aria-label="${label} in ${unit}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${Number.isFinite(v) ? v : ""}"${busy ? " disabled" : ""}><i>${unit}</i></div></label>`;
    const draw = () => {
      if (!current()) { finish(false); return; }
      host.innerHTML = `<section class="body-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="body-profile-title">
        <header><div><span>YOUR DETAILS</span><h2 id="body-profile-title">${options.source === "settings" ? "Height and weight" : "Set up your daily plan"}</h2></div>
        ${required() ? "" : '<button type="button" class="body-profile-close" aria-label="Close">&#10005;</button>'}</header>
        <p>Height and weight let Max calculate energy and macros from your body rather than a generic example. They do not change your face score.</p>
        ${loading ? '<p role="status">Loading your saved details...</p>' : `<div class="body-profile-units" role="group" aria-label="Units">
          <button type="button" data-body-unit="metric" aria-pressed="${entry.unit === "metric"}"${busy ? " disabled" : ""}>Metric</button>
          <button type="button" data-body-unit="imperial" aria-pressed="${entry.unit === "imperial"}"${busy ? " disabled" : ""}>Imperial</button></div>
          <div class="body-profile-fields ${entry.unit === "metric" ? "two" : "imperial"}">
          ${entry.unit === "metric"
            ? field("body-height-cm", "Height", "cm", entry.heightCm, 120, 230) + field("body-weight-kg", "Weight", "kg", entry.weightKg, 35, 300)
            : field("body-height-ft", "Height", "ft", entry.feet, 3, 7, "1") + field("body-height-in", "Height", "in", entry.inches, 0, 11.9) + field("body-weight-lb", "Weight", "lb", entry.pounds, 77, 661.4)}</div>`}
        <p class="body-profile-error" role="alert"${message ? "" : " hidden"}></p>
        <p class="body-profile-privacy">Height and weight are saved privately to your account, with a copy on this device for your calculator. You can edit or clear them in Settings. They never change your face score.</p>
        <button type="button" class="btn pri body-profile-save"${busy || loading ? " disabled" : ""}>${busy ? "Saving..." : "Save and continue"}</button>
      </section>`;
      const error = host.querySelector<HTMLElement>(".body-profile-error");
      if (error) error.textContent = message;
      host.querySelector(".body-profile-close")?.addEventListener("click", () => finish(false));
      for (const button of host.querySelectorAll<HTMLButtonElement>("[data-body-unit]")) {
        button.onclick = () => {
          readEntry();
          const unit = button.dataset.bodyUnit === "imperial" ? "imperial" : "metric";
          entry = drafts[unit] ?? convertBodyEntryUnits(entry, unit);
          draw();
          host.querySelector<HTMLButtonElement>(`[data-body-unit="${entry.unit}"]`)?.focus();
        };
      }
      host.querySelector(".body-profile-save")?.addEventListener("click", () => { void save(); });
    };
    const save = async () => {
      if (busy || loading || !current()) return;
      readEntry();
      if (!bodyMetricUsable(toMetric(entry))) {
        message = boundsSentence(entry.unit);
        const error = host.querySelector<HTMLElement>(".body-profile-error")!;
        error.textContent = message;
        error.hidden = false;
        return;
      }
      busy = true;
      message = "";
      draw();
      const token = await currentAccessToken(userId).catch(() => null);
      if (!current()) { finish(false); return; }
      const result = token ? await saveBodyProfile(token, entry, options.source ?? "dialog")
        : { ok: false as const, message: "Sign in again to save your details." };
      if (!current()) { finish(false); return; }
      if (result.ok) { finish(true); return; }
      busy = false;
      message = result.message;
      draw();
    };
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!required()) finish(false);
      } else if (event.key === "Tab") {
        const focusable = [...host.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }, { capture: true, signal: abort.signal });
    const adopt = () => {
      if (server) {
        const metric: BodyEntry = { unit: "metric", heightCm: server.heightCm ?? undefined, weightKg: server.weightKg ?? undefined };
        entry = convertBodyEntryUnits(metric, server.unit);
        drafts = { metric, [server.unit]: entry };
      }
    };
    adopt();
    draw();
    host.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
    if (!server) void (async () => {
      const token = await currentAccessToken(userId).catch(() => null);
      if (!current()) { finish(false); return; }
      server = token ? await fetchBodyProfile(token) : null;
      if (!current()) { finish(false); return; }
      loading = false;
      if (!server) message = "Your saved details could not be loaded. Check your connection before saving.";
      adopt();
      draw();
    })();
  });
  return activePromise;
}
