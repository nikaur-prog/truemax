import { currentAccessToken, onAuthChange } from "../engine/auth.js";
import { activeScanOwner } from "../engine/scanScope.js";
import {
  createMorphRenderRequest,
  pollMorphRender,
  requestMorphRender,
  submitMorphValidation,
  type MorphRenderSource,
} from "../engine/morphContract.js";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type {
  MorphBlueprint,
  MorphEffectId,
  MorphMetricTarget,
} from "../engine/morphPlan.js";
import { ensureGoalPreviewConsent } from "./goalPreviewConsent.js";
import { validateMorphImages } from "./morphValidation.js";

export interface MorphPreviewInput {
  scanId: string;
  selected: MorphBlueprint;
  maxVision: MorphBlueprint;
  frontLandmarks: NormalizedLandmark[];
  frontPhoto: HTMLCanvasElement | null;
  sidePhoto: HTMLCanvasElement | null;
  renderEnabled: boolean;
}

const EFFECT_LABELS: Record<MorphEffectId, { down: string; up: string }> = {
  facialFullness: { down: "Less facial fullness", up: "More facial fullness" },
  underEyePuffiness: { down: "Less under-eye puffiness", up: "More under-eye fullness" },
  jawDefinition: { down: "Softer jaw definition", up: "Clearer jaw definition" },
  underChinFullness: { down: "Less under-chin fullness", up: "More under-chin fullness" },
  skinEvenness: { down: "More natural skin variation", up: "More even skin appearance" },
  blemishVisibility: { down: "Less visible blemish pattern", up: "More visible skin detail" },
  browDefinition: { down: "Softer brow finish", up: "Tidier brow definition" },
  hairFinish: { down: "Softer hair finish", up: "More intentional hair finish" },
  smileFinish: { down: "More relaxed smile", up: "Tidier smile presentation" },
  posture: { down: "More relaxed posture", up: "More controlled posture" },
  lighting: { down: "Softer light", up: "More controlled light" },
};

const esc = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function effectTags(plan: MorphBlueprint): string {
  const tags = Object.entries(plan.effects)
    .filter(([, amount]) => Math.abs(amount) >= 0.08)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .map(([id, amount]) => {
      const labels = EFFECT_LABELS[id as MorphEffectId];
      const strength = Math.abs(amount) >= 0.5 ? "clear" : Math.abs(amount) >= 0.28 ? "moderate" : "subtle";
      return `<span class="morph-effect"><i>${strength}</i>${esc(amount < 0 ? labels.down : labels.up)}</span>`;
    });
  return tags.length ? tags.join("") : `<span class="morph-empty">Add a goal to build the change map.</span>`;
}

function formatTarget(target: MorphMetricTarget, value: number): string {
  return `${value.toFixed(target.decimals)}${target.unit}`;
}

function targets(plan: MorphBlueprint): string {
  if (!plan.targets.length) {
    return `<p class="morph-measure-empty">No repeatable face measurement can verify this selection yet. It stays in the plan, but it will not be given a made-up progress number.</p>`;
  }
  return plan.targets
    .slice(0, 5)
    .map(
      (target) => `<div class="morph-measure">
        <span>${esc(target.name)}</span>
        <b>${formatTarget(target, target.current)} <i>to</i> ${formatTarget(target, target.target)}</b>
        <small>Complete after at least ${formatTarget(target, target.completionDelta)} of movement repeats across comparable scans.</small>
      </div>`,
    )
    .join("");
}

function goals(plan: MorphBlueprint): string {
  if (!plan.goals.length) {
    return `<p class="morph-goal-empty">Choose goals to build your first visual target.</p>`;
  }
  return plan.goals
    .map(
      (goal) => `<article class="morph-goal">
        <div><b>${esc(goal.label)}</b><span>${goal.effortPoints} pts on completion</span></div>
        <p>${esc(goal.visualSummary)}</p>
        <small>${esc(goal.timeframe)}</small>
      </article>`,
    )
    .join("");
}

function planPanel(plan: MorphBlueprint): string {
  const label = plan.variant === "selected" ? "Your selected goals" : "Max's full view";
  return `<section class="morph-plan" data-morph-plan="${plan.variant}"${plan.variant === "max_vision" ? " hidden" : ""}>
    <div class="morph-change-map" aria-label="Allowed visual changes for ${esc(label)}">${effectTags(plan)}</div>
    <div class="morph-goals">${goals(plan)}</div>
    <div class="morph-measures"><h5>HOW COMPLETION IS PROVED</h5>${targets(plan)}</div>
  </section>`;
}

export function morphPreviewHTML(input: Pick<MorphPreviewInput, "selected" | "maxVision" | "renderEnabled">): string {
  const hasSide = input.selected.hasSide || input.maxVision.hasSide;
  const canCreate = input.renderEnabled && (input.selected.goals.length > 0 || input.maxVision.goals.length > 0);
  return `<section class="morph-preview" data-morph-active="selected">
    <div class="morph-head">
      <div><span>YOUR VISUAL TARGET</span><h4>See what the plan is aiming for</h4></div>
      <span class="morph-points" data-morph-points>${input.selected.totalPoints} pts available</span>
    </div>
    <p class="morph-intro">A measured target, not a promise. Identity and bone structure stay fixed. Only naturally changeable soft tissue, grooming, skin appearance and presentation can move.</p>
    <div class="morph-switch" role="tablist" aria-label="Visual target version">
      <button type="button" class="active" data-morph-variant="selected" role="tab" aria-selected="true">My goals</button>
      <button type="button" data-morph-variant="max_vision" role="tab" aria-selected="false">Max's full view</button>
    </div>
    <div class="morph-views" role="tablist" aria-label="Visual target angle">
      <button type="button" class="active" data-morph-view-button="front" role="tab" aria-selected="true">Front</button>
      ${hasSide ? `<button type="button" data-morph-view-button="side" role="tab" aria-selected="false">Profile</button>` : ""}
    </div>
    <div class="morph-stage" data-morph-view="front">
      <figure><img data-morph-current="front" alt="Current front photograph"><figcaption>Current</figcaption></figure>
      <span class="morph-arrow" aria-hidden="true">→</span>
      <figure class="morph-target-figure">
        <div class="morph-map-placeholder" data-morph-placeholder="front"><i></i><span>Goal map</span></div>
        <img data-morph-output="front" alt="Front visual target" hidden>
        <figcaption>Visual target</figcaption>
      </figure>
    </div>
    ${hasSide ? `<div class="morph-stage" data-morph-view="side" hidden>
      <figure><img data-morph-current="side" alt="Current profile photograph"><figcaption>Current</figcaption></figure>
      <span class="morph-arrow" aria-hidden="true">→</span>
      <figure class="morph-target-figure">
        <div class="morph-map-placeholder" data-morph-placeholder="side"><i></i><span>Goal map</span></div>
        <img data-morph-output="side" alt="Profile visual target" hidden>
        <figcaption>Visual target</figcaption>
      </figure>
    </div>` : ""}
    ${planPanel(input.selected)}
    ${planPanel(input.maxVision)}
    ${canCreate ? `<button type="button" class="morph-create" data-morph-create>Create my visual target</button>` : ""}
    <p class="morph-status" data-morph-status aria-live="polite">${
      input.renderEnabled
        ? "The preview request instructs the service not to retain your source photos. A result appears only after every validation check passes."
        : "Your measurable target is ready. The image version stays locked until identity, natural-change and two-view consistency checks are live."
    }</p>
  </section>`;
}

function photoData(photo: HTMLCanvasElement): string {
  const maxEdge = 1400;
  const scale = Math.min(1, maxEdge / Math.max(photo.width, photo.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(photo.width * scale));
  canvas.height = Math.max(1, Math.round(photo.height * scale));
  const g = canvas.getContext("2d");
  if (!g) throw new Error("The photograph could not be prepared.");
  g.drawImage(photo, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

interface MorphPreviewRuntime {
  owner: typeof activeScanOwner;
  token: typeof currentAccessToken;
  consent: typeof ensureGoalPreviewConsent;
  request: typeof requestMorphRender;
  poll: typeof pollMorphRender;
  submit: typeof submitMorphValidation;
  validate: typeof validateMorphImages;
  photo: typeof photoData;
  wait: typeof delay;
  subscribeOwner: (changed: () => void) => () => void;
}

/** Returns the panel's disposer; replacing the report must cancel its work. */
export function wireMorphPreview(host: HTMLElement, input: MorphPreviewInput, overrides: Partial<MorphPreviewRuntime> = {}): () => void {
  const shell = host.querySelector<HTMLElement>(".morph-preview");
  if (!shell) return () => {};
  const runtime: MorphPreviewRuntime = {
    owner: activeScanOwner, token: currentAccessToken, consent: ensureGoalPreviewConsent,
    request: requestMorphRender, poll: pollMorphRender, submit: submitMorphValidation,
    validate: validateMorphImages, photo: photoData, wait: delay,
    subscribeOwner: (changed) => onAuthChange(() => changed()),
    ...overrides,
  };
  const owner = runtime.owner();
  const userId = owner?.startsWith("user:") ? owner.slice(5) : null;
  let variant: MorphBlueprint["variant"] = "selected";
  const blueprints: Record<MorphBlueprint["variant"], MorphBlueprint> = {
    selected: input.selected,
    max_vision: input.maxVision,
  };
  const outputs: Partial<Record<MorphBlueprint["variant"], MorphRenderSource>> = {};
  const controller = new AbortController();
  let disposed = false;
  let busy = false;
  let unsubscribe = () => {};

  let source: MorphRenderSource | null = null;
  try {
    if (input.frontPhoto) {
      source = {
        front: runtime.photo(input.frontPhoto),
        ...(input.sidePhoto ? { side: runtime.photo(input.sidePhoto) } : {}),
      };
      for (const image of shell.querySelectorAll<HTMLImageElement>('[data-morph-current="front"]')) image.src = source.front;
      if (source.side) {
        for (const image of shell.querySelectorAll<HTMLImageElement>('[data-morph-current="side"]')) image.src = source.side;
      }
    }
  } catch {
    source = null;
  }

  const status = shell.querySelector<HTMLElement>("[data-morph-status]");
  const create = shell.querySelector<HTMLButtonElement>("[data-morph-create]");

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    unsubscribe();
    source = null;
    delete outputs.selected;
    delete outputs.max_vision;
    for (const image of shell.querySelectorAll<HTMLImageElement>("[data-morph-current], [data-morph-output]")) image.removeAttribute("src");
    for (const button of shell.querySelectorAll<HTMLButtonElement>("[data-morph-variant], [data-morph-view-button], [data-morph-create]")) {
      button.onclick = null;
      button.disabled = true;
    }
  };
  const current = (): boolean => {
    if (!disposed && shell.isConnected && runtime.owner() === owner) return true;
    dispose();
    return false;
  };

  const showOutput = (): void => {
    const result = outputs[variant];
    for (const view of ["front", "side"] as const) {
      const image = shell.querySelector<HTMLImageElement>(`[data-morph-output="${view}"]`);
      const placeholder = shell.querySelector<HTMLElement>(`[data-morph-placeholder="${view}"]`);
      const next = result?.[view];
      if (image) {
        image.hidden = !next;
        if (next) image.src = next;
        else image.removeAttribute("src");
      }
      if (placeholder) placeholder.hidden = Boolean(next);
    }
  };

  const activateVariant = (next: MorphBlueprint["variant"]): void => {
    if (!current()) return;
    variant = next;
    shell.dataset.morphActive = next;
    for (const button of shell.querySelectorAll<HTMLButtonElement>("[data-morph-variant]")) {
      const active = button.dataset.morphVariant === next;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    }
    for (const panel of shell.querySelectorAll<HTMLElement>("[data-morph-plan]")) {
      panel.hidden = panel.dataset.morphPlan !== next;
    }
    const points = shell.querySelector<HTMLElement>("[data-morph-points]");
    if (points) points.textContent = `${blueprints[next].totalPoints} pts available`;
    if (create) create.disabled = busy || !userId || blueprints[next].goals.length === 0;
    if (status && !busy && input.renderEnabled) {
      status.textContent = outputs[next] ? "Preview checks passed." : "Create a visual target for this selection.";
    }
    showOutput();
  };

  for (const button of shell.querySelectorAll<HTMLButtonElement>("[data-morph-variant]")) {
    button.onclick = () => activateVariant(button.dataset.morphVariant as MorphBlueprint["variant"]);
  }
  for (const button of shell.querySelectorAll<HTMLButtonElement>("[data-morph-view-button]")) {
    button.onclick = () => {
      if (!current()) return;
      const view = button.dataset.morphViewButton;
      for (const candidate of shell.querySelectorAll<HTMLButtonElement>("[data-morph-view-button]")) {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-selected", String(active));
      }
      for (const stage of shell.querySelectorAll<HTMLElement>("[data-morph-view]")) {
        stage.hidden = stage.dataset.morphView !== view;
      }
    };
  }

  if (create) {
    create.onclick = async () => {
      if (!current() || busy || !userId || !input.renderEnabled) return;
      if (!source || !input.frontPhoto) {
        if (status) status.textContent = "The scan photographs are not available. Reopen the latest scan and try again.";
        return;
      }
      const renderVariant = variant;
      const blueprint = blueprints[renderVariant];
      if (!blueprint.goals.length) return;
      const renderSource = source;
      busy = true;
      create.disabled = true;
      create.classList.add("working");
      if (status) status.textContent = "Building a natural target and checking identity across both views...";
      try {
        let accessToken = await runtime.token(userId);
        if (!current()) return;
        if (!accessToken) throw new Error("Sign in again to create this preview.");
        const consented = await runtime.consent({ userId, signal: controller.signal });
        if (!current()) return;
        if (!consented) {
          if (status) status.textContent = "Goal preview was not enabled. You can choose it whenever you are ready.";
          return;
        }
        // Consent can remain open long enough for a session to change or its
        // token to refresh. Bind the upload to the original scan owner again.
        accessToken = await runtime.token(userId);
        if (!current()) return;
        if (!accessToken) throw new Error("Sign in again to create this preview.");
        const request = createMorphRenderRequest(input.scanId, blueprint, renderSource);
        let state = await runtime.request(request, accessToken, controller.signal);
        if (!current()) return;
        for (let attempt = 0; (state.status === "accepted" || state.status === "processing") && attempt < 90; attempt++) {
          await runtime.wait(2500, controller.signal);
          if (!current()) return;
          state = await runtime.poll(state.jobId, blueprint.hasSide, accessToken, controller.signal);
          if (!current()) return;
        }
        if (state.status === "validation_pending") {
          if (status) status.textContent = "Checking that the result kept your identity and reached the measured target...";
          const validation = await runtime.validate({
            blueprint,
            originalFrontLandmarks: input.frontLandmarks,
            images: state.images,
            signal: controller.signal,
          });
          if (!current()) return;
          const submitted = await runtime.submit(state.jobId, validation.passed, accessToken, controller.signal);
          if (!current()) return;
          if (!submitted.ok) throw new Error(submitted.error || "The validation result could not be recorded.");
          if (!validation.passed) {
            if (status) status.textContent = validation.reason || "The generated face did not pass the identity and target checks, so it was withheld.";
            return;
          }
          state = await runtime.poll(state.jobId, blueprint.hasSide, accessToken, controller.signal);
          if (!current()) return;
        }
        if (state.status === "ready") {
          outputs[renderVariant] = state.images;
          showOutput();
          if (status) status.textContent = variant === renderVariant
            ? "Identity, natural-change and cross-view checks passed."
            : "Your other preview is ready. Switch back to view it.";
        } else if (state.status === "failed") {
          if (status) status.textContent = state.error;
        } else if (status) {
          status.textContent = "The preview is taking longer than expected. Try again shortly.";
        }
      } catch (error) {
        if (current() && status && (!(error instanceof DOMException) || error.name !== "AbortError")) {
          status.textContent = error instanceof Error ? error.message : "The preview could not be created.";
        }
      } finally {
        busy = false;
        if (current()) {
          create.disabled = !userId || blueprints[variant].goals.length === 0;
          create.classList.remove("working");
        }
      }
    };
  }

  const stop = runtime.subscribeOwner(() => { if (runtime.owner() !== owner) dispose(); });
  if (disposed) stop();
  else unsubscribe = stop;
  activateVariant("selected");
  return dispose;
}
