import { readBody, writeBody } from "../engine/bodyProfile.js";
import type { StoredBody } from "../engine/bodyProfile.js";

type UnitSystem = "metric" | "imperial";

export interface BodyEntry {
  unit: UnitSystem;
  heightCm?: number;
  weightKg?: number;
  feet?: number;
  inches?: number;
  pounds?: number;
}

const CM_PER_INCH = 2.54;
const KG_PER_POUND = 0.45359237;

/** Converts either display system into the canonical units stored by the calculator. */
export function bodyEntryToMetric(entry: BodyEntry): { heightCm: number; weightKg: number } | null {
  const heightCm = entry.unit === "metric"
    ? Number(entry.heightCm)
    : (Number(entry.feet) * 12 + Number(entry.inches)) * CM_PER_INCH;
  const weightKg = entry.unit === "metric"
    ? Number(entry.weightKg)
    : Number(entry.pounds) * KG_PER_POUND;
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg)) return null;
  return {
    heightCm: Math.round(heightCm * 10) / 10,
    weightKg: Math.round(weightKg * 10) / 10,
  };
}

function metricToImperial(body: StoredBody | null): { feet: number; inches: number; pounds: number } {
  const totalInches = body ? body.heightCm / CM_PER_INCH : 68;
  const feet = Math.floor(totalInches / 12);
  return {
    feet,
    inches: Math.round((totalInches - feet * 12) * 10) / 10,
    pounds: body ? Math.round((body.weightKg / KG_PER_POUND) * 10) / 10 : 154,
  };
}

let active: HTMLDivElement | null = null;
let activePromise: Promise<boolean> | null = null;

export function closeBodyProfileDialog(): void {
  active?.remove();
  active = null;
  document.body.classList.remove("body-profile-open");
}

/**
 * Collects the two inputs a diet or body-composition plan cannot calculate
 * without. Required mode has no dismiss action and is used only after a
 * server-confirmed Max entitlement and adult date of birth.
 */
export function openBodyProfileDialog(options: { required?: boolean } = {}): Promise<boolean> {
  if (activePromise) return activePromise;
  const required = options.required === true;
  const existing = readBody();
  let unit: UnitSystem = "metric";

  activePromise = new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    active = host;
    host.className = "body-profile-overlay";
    document.body.appendChild(host);
    document.body.classList.add("body-profile-open");

    const finish = (saved: boolean) => {
      closeBodyProfileDialog();
      activePromise = null;
      resolve(saved);
    };

    const draw = () => {
      const imperial = metricToImperial(existing);
      host.innerHTML = `<section class="body-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="body-profile-title">
        <header>
          <div><span>YOUR DETAILS</span><h2 id="body-profile-title">Set up your daily plan</h2></div>
          ${required ? "" : `<button type="button" class="body-profile-close" aria-label="Close">&#10005;</button>`}
        </header>
        <p>Height and weight let Max calculate energy and macros from your body rather than a generic example. They do not change your face score.</p>
        <div class="body-profile-units" role="group" aria-label="Units">
          <button type="button" data-body-unit="metric" aria-pressed="${unit === "metric"}">Metric</button>
          <button type="button" data-body-unit="imperial" aria-pressed="${unit === "imperial"}">Imperial</button>
        </div>
        ${unit === "metric"
          ? `<div class="body-profile-fields two">
              <label><span>Height</span><div><input id="body-height-cm" type="number" inputmode="decimal" min="120" max="230" step="0.1" value="${existing?.heightCm ?? ""}" placeholder="175"><i>cm</i></div></label>
              <label><span>Weight</span><div><input id="body-weight-kg" type="number" inputmode="decimal" min="35" max="300" step="0.1" value="${existing?.weightKg ?? ""}" placeholder="70"><i>kg</i></div></label>
            </div>`
          : `<div class="body-profile-fields imperial">
              <label><span>Height</span><div><input id="body-height-ft" type="number" inputmode="numeric" min="3" max="7" step="1" value="${imperial.feet}"><i>ft</i></div></label>
              <label><span>&nbsp;</span><div><input id="body-height-in" type="number" inputmode="decimal" min="0" max="11.9" step="0.1" value="${imperial.inches}"><i>in</i></div></label>
              <label><span>Weight</span><div><input id="body-weight-lb" type="number" inputmode="decimal" min="77" max="661" step="0.1" value="${imperial.pounds}"><i>lb</i></div></label>
            </div>`}
        <p class="body-profile-error" role="alert" hidden></p>
        <p class="body-profile-privacy">Saved on this device for your private calculator. It is never used to change your face score.</p>
        <button type="button" class="btn pri body-profile-save">Save and continue</button>
      </section>`;

      host.querySelector<HTMLButtonElement>(".body-profile-close")?.addEventListener("click", () => finish(false));
      for (const button of host.querySelectorAll<HTMLButtonElement>("[data-body-unit]")) {
        button.addEventListener("click", () => {
          unit = button.dataset.bodyUnit === "imperial" ? "imperial" : "metric";
          draw();
        });
      }
      host.querySelector<HTMLButtonElement>(".body-profile-save")?.addEventListener("click", () => {
        const number = (id: string) => Number(host.querySelector<HTMLInputElement>(`#${id}`)?.value);
        const metric = bodyEntryToMetric(unit === "metric"
          ? { unit, heightCm: number("body-height-cm"), weightKg: number("body-weight-kg") }
          : { unit, feet: number("body-height-ft"), inches: number("body-height-in"), pounds: number("body-weight-lb") });
        const error = host.querySelector<HTMLElement>(".body-profile-error");
        const saved = Boolean(metric && writeBody({
          ...metric,
          activity: existing?.activity ?? "moderate",
          goal: existing?.goal ?? "hold",
          ...(existing?.bodyFat ? { bodyFat: existing.bodyFat } : {}),
        }));
        if (!saved) {
          if (error) {
            error.textContent = unit === "metric"
              ? "Enter a height from 120 to 230 cm and a weight from 35 to 300 kg."
              : "Enter a height from 3 ft 11 in to 7 ft 7 in and a weight from 77 to 661 lb.";
            error.hidden = false;
          }
          return;
        }
        finish(true);
      });
    };

    draw();
  });
  return activePromise;
}
