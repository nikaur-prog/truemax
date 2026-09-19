import { currentAccessToken, onAuthChange } from "../engine/auth.js";
import { activeScanOwner } from "../engine/scanScope.js";
import {
  createMorphRenderRequest,
  listMorphPreviews,
  MorphPreviewCheckError,
  pollMorphRender,
  requestMorphRender,
  submitMorphValidation,
  type MorphRenderSource,
} from "../engine/morphContract.js";
import { blueprintRecoveryKey, readMorphRequestMarker, writeMorphRequestMarker, type SavedMorphPreview, type MorphRequestMarker } from "../engine/morphRecovery.js";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type {
  MorphBlueprint,
  MorphEffectId,
  MorphMetricTarget,
} from "../engine/morphPlan.js";
import { ensureGoalPreviewConsent } from "./goalPreviewConsent.js";
import { validateMorphImages } from "./morphValidation.js";
import { previewDeadline } from "../engine/previewDeadline.js";

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
        <small>Illustrative target only. Comparable repeat scans and validated measurement noise are required before progress can be confirmed.</small>
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
        <div><b>${esc(goal.label)}</b></div>
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
    <div class="morph-measures"><h5>DRAFT MEASUREMENT TARGETS</h5>${targets(plan)}</div>
  </section>`;
}

export function morphPreviewHTML(input: Pick<MorphPreviewInput, "selected" | "maxVision" | "renderEnabled">): string {
  const hasSide = input.selected.hasSide || input.maxVision.hasSide;
  const canCreate = input.renderEnabled && (input.selected.goals.length > 0 || input.maxVision.goals.length > 0);
  return `<section class="morph-preview" data-morph-active="selected">
    <div class="morph-head">
      <div><span>YOUR VISUAL TARGET</span><h4>See what the plan is aiming for</h4></div>
      <span class="morph-points" data-morph-points>Illustrative preview</span>
    </div>
    <p class="morph-intro">An illustrative direction, not a prediction or a proven personal target. Identity and bone structure stay fixed as a requirement. Only permitted presentation changes can be requested, and no appearance points are awarded from this preview.</p>
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
    ${canCreate ? `<button type="button" class="morph-create" data-morph-create${input.selected.renderHoldReason ? " disabled" : ""}>Create my visual target</button>` : ""}
    ${canCreate ? `<button type="button" class="morph-create" data-morph-recover>Check saved previews</button>
      <select data-morph-saved aria-label="Saved previews matching this scan and plan" hidden></select>` : ""}
    <p class="morph-status" data-morph-status aria-live="polite">${
      input.selected.renderHoldReason ? esc(input.selected.renderHoldReason) : input.renderEnabled
        ? "The preview request instructs the service not to retain your source photos. A result appears only after every validation check passes."
        : "Your draft goal map is ready. The image version stays locked until identity, natural-change and required-view checks are validated."
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
  list: typeof listMorphPreviews;
  recipeKey: typeof blueprintRecoveryKey;
  readMarker: typeof readMorphRequestMarker;
  writeMarker: typeof writeMorphRequestMarker;
  submit: typeof submitMorphValidation;
  validate: typeof validateMorphImages;
  photo: typeof photoData;
  wait: typeof delay;
  subscribeOwner: (changed: () => void) => () => void;
  renderBudgetMs: number;
}

/** Returns the panel's disposer; replacing the report must cancel its work. */
export function wireMorphPreview(host: HTMLElement, input: MorphPreviewInput, overrides: Partial<MorphPreviewRuntime> = {}): () => void {
  const shell = host.querySelector<HTMLElement>(".morph-preview");
  if (!shell) return () => {};
  const runtime: MorphPreviewRuntime = {
    owner: activeScanOwner, token: currentAccessToken, consent: ensureGoalPreviewConsent,
    request: requestMorphRender, poll: pollMorphRender, submit: submitMorphValidation,
    list: listMorphPreviews, recipeKey: blueprintRecoveryKey, readMarker: readMorphRequestMarker, writeMarker: writeMorphRequestMarker,
    validate: validateMorphImages, photo: photoData, wait: delay,
    subscribeOwner: (changed) => onAuthChange(() => changed()),
    renderBudgetMs: 300_000,
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
  const pendingJobs: Partial<Record<MorphBlueprint["variant"], string>> = {};
  const uncertainRequests: Partial<Record<MorphBlueprint["variant"], MorphRequestMarker>> = {};
  const savedJobs: Partial<Record<MorphBlueprint["variant"], SavedMorphPreview[]>> = {};
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
  const recover = shell.querySelector<HTMLButtonElement>("[data-morph-recover]");
  const saved = shell.querySelector<HTMLSelectElement>("[data-morph-saved]");

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    unsubscribe();
    source = null;
    delete outputs.selected;
    delete outputs.max_vision;
    delete pendingJobs.selected;
    delete pendingJobs.max_vision;
    if (saved) { saved.onchange = null; saved.innerHTML = ""; saved.hidden = true; }
    for (const image of shell.querySelectorAll<HTMLImageElement>("[data-morph-current], [data-morph-output]")) image.removeAttribute("src");
    for (const button of shell.querySelectorAll<HTMLButtonElement>("[data-morph-variant], [data-morph-view-button], [data-morph-create], [data-morph-recover]")) {
      button.onclick = null;
      button.disabled = true;
    }
  };

  const showSavedJobs = (): void => {
    if (!saved) return;
    const jobs = savedJobs[variant] ?? [];
    saved.hidden = !jobs.length;
    saved.innerHTML = jobs.map((job) => `<option value="${esc(job.jobId)}">${esc(new Date(job.createdAt).toLocaleString())}: ${job.status === "ready" ? "ready to check" : job.status === "failed" ? "unavailable: check status" : "processing"}</option>`).join("");
    saved.value = pendingJobs[variant] ?? jobs[0]?.jobId ?? "";
  };
  const refreshActions = (): void => {
    const disabled = busy || !userId || blueprints[variant].goals.length === 0 || Boolean(blueprints[variant].renderHoldReason);
    if (create) {
      create.disabled = disabled;
      create.textContent = pendingJobs[variant] || uncertainRequests[variant] ? "Check existing preview" : "Create my visual target";
    }
    if (recover) recover.disabled = disabled;
    if (saved) saved.disabled = disabled;
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
    if (points) points.textContent = "Illustrative preview";
    refreshActions();
    showSavedJobs();
    if (status && !busy && input.renderEnabled) {
      status.textContent = blueprints[next].renderHoldReason || (outputs[next] ? "Preview checks passed." : "Create a visual target for this selection.");
    }
    showOutput();
  };

  if (saved) saved.onchange = () => {
    if (!current() || busy || !savedJobs[variant]?.some((job) => job.jobId === saved.value)) return;
    pendingJobs[variant] = saved.value;
    delete outputs[variant];
    showOutput();
    refreshActions();
    if (status) status.textContent = "Saved preview selected. Check existing preview loads this job without starting another render.";
  };

  if (recover) recover.onclick = async () => {
    if (!current() || busy || !userId || !input.renderEnabled || !blueprints[variant].goals.length || blueprints[variant].renderHoldReason) return;
    const recoveringVariant = variant;
    const budget = previewDeadline(controller.signal, runtime.renderBudgetMs, "The saved-preview check took too long. No new render was started.");
    busy = true;
    delete outputs[recoveringVariant];
    showOutput();
    refreshActions();
    if (status) status.textContent = "Checking saved previews for this scan and plan...";
    try {
      const recipeKey = await budget.run(() => runtime.recipeKey(blueprints[recoveringVariant]));
      const baseMatch = { scanId: input.scanId, recipeKey };
      uncertainRequests[recoveringVariant] ||= runtime.readMarker(owner!, baseMatch) ?? undefined;
      const match = { ...baseMatch, requestId: uncertainRequests[recoveringVariant]?.requestId };
      const token = await budget.run(() => runtime.token(userId));
      if (!current()) return;
      if (!token) throw new MorphPreviewCheckError("auth", "Sign in again to check your saved previews.");
      const jobs = await budget.run((signal) => runtime.list(match, token, signal));
      if (!current()) return;
      savedJobs[recoveringVariant] = jobs;
      if (jobs.length) pendingJobs[recoveringVariant] = jobs[0].jobId;
      if (variant === recoveringVariant) showSavedJobs();
      if (status) status.textContent = jobs.length
        ? "Saved previews found. Choose one, then check the existing preview. No new render was started."
        : uncertainRequests[recoveringVariant]
          ? "The earlier request has no recoverable result yet. Check saved previews again shortly. If it stays missing, contact support to reconcile the request; no new render will start here."
          : "No saved preview matches this scan and plan. No new render was started.";
    } catch (error) {
      if (current() && status) status.textContent = error instanceof Error ? error.message : "Saved previews could not be checked. No new render was started.";
    } finally {
      budget.dispose();
      busy = false;
      if (current()) refreshActions();
    }
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
      if (!blueprint.goals.length || blueprint.renderHoldReason) return;
      const renderSource = source;
      busy = true;
      delete outputs[renderVariant];
      showOutput();
      refreshActions();
      create.classList.add("working");
      if (status) status.textContent = blueprint.hasSide ? "Building your preview and checking both supplied views..." : "Building your preview and checking the supplied front view...";
      let budget: ReturnType<typeof previewDeadline> | undefined;
      try {
        let accessToken = await runtime.token(userId);
        if (!current()) return;
        if (!accessToken) throw new MorphPreviewCheckError("auth", "Sign in again to check or create your preview.");
        const consented = await runtime.consent({ userId, signal: controller.signal });
        if (!current()) return;
        if (!consented) {
          if (status) status.textContent = "Goal preview was not enabled. You can choose it whenever you are ready.";
          return;
        }
        // Consent can remain open long enough for a session to change or its
        // token to refresh. Bind the upload to the original scan owner again.
        // Deliberating over consent is not timed. Once accepted, token refresh,
        // upload, response bodies, polling and device checks share one budget.
        budget = previewDeadline(controller.signal, runtime.renderBudgetMs, "The preview took too long and was withheld. Your plan is still here. Try again shortly.");
        accessToken = await budget.run(() => runtime.token(userId));
        if (!current()) return;
        if (!accessToken) throw new MorphPreviewCheckError("auth", "Sign in again to check or create your preview.");
        const recipeKey = await budget.run(() => runtime.recipeKey(blueprint));
        if (!current()) return;
        const baseMatch = { scanId: input.scanId, recipeKey };
        uncertainRequests[renderVariant] ||= runtime.readMarker(owner!, baseMatch) ?? undefined;
        const match = { ...baseMatch, requestId: uncertainRequests[renderVariant]?.requestId };
        if (!pendingJobs[renderVariant]) {
          if (status) status.textContent = "Checking for an existing preview before creating one...";
          const jobs = await budget.run((signal) => runtime.list(match, accessToken!, signal));
          if (!current()) return;
          savedJobs[renderVariant] = jobs;
          if (jobs.length) pendingJobs[renderVariant] = jobs[0].jobId;
          if (variant === renderVariant) showSavedJobs();
          if (!jobs.length && uncertainRequests[renderVariant]) {
            if (status) status.textContent = "The earlier request has no recoverable result yet. Check saved previews again shortly. If it stays missing, contact support to reconcile the request; no new render will start here.";
            return;
          }
        }
        const request = createMorphRenderRequest(input.scanId, blueprint, renderSource);
        const existingJob = pendingJobs[renderVariant];
        if (!existingJob) {
          const marker = { startedAt: Date.now(), requestId: crypto.randomUUID() };
          uncertainRequests[renderVariant] = marker;
          request.requestId = marker.requestId;
          match.requestId = marker.requestId;
          runtime.writeMarker(owner!, match, marker);
        }
        let state = existingJob
          ? await budget.run((signal) => runtime.poll(existingJob, blueprint.hasSide, accessToken!, signal, undefined, match))
          : await budget.run((signal) => runtime.request(request, accessToken!, signal));
        if (!current()) return;
        if (state.status !== "failed") pendingJobs[renderVariant] = state.jobId;
        for (let attempt = 0; (state.status === "accepted" || state.status === "processing") && attempt < 90; attempt++) {
          await budget.run((signal) => runtime.wait(2500, signal));
          if (!current()) return;
          const pendingId = state.jobId;
          state = await budget.run((signal) => runtime.poll(pendingId, blueprint.hasSide, accessToken!, signal, undefined, match));
          if (!current()) return;
        }
        if (state.status === "validation_pending") {
          if (status) status.textContent = "Checking that the result kept your identity and reached the measured target...";
          const pendingState = state;
          const validation = await budget.run((signal) => runtime.validate({
            blueprint,
            originalFrontLandmarks: input.frontLandmarks,
            originalFrontSize: { width: input.frontPhoto!.width, height: input.frontPhoto!.height },
            images: pendingState.images,
            signal,
          }));
          if (!current()) return;
          const submitted = await budget.run((signal) => runtime.submit(pendingState.jobId, validation.passed, accessToken!, signal));
          if (!current()) return;
          if (!submitted.ok) throw new Error(submitted.error || "The validation result could not be recorded.");
          if (!validation.passed) {
            delete pendingJobs[renderVariant];
            delete uncertainRequests[renderVariant];
            runtime.writeMarker(owner!, match, null);
            if (status) status.textContent = validation.reason || "The generated face did not pass the identity and target checks, so it was withheld.";
            return;
          }
          state = await budget.run((signal) => runtime.poll(pendingState.jobId, blueprint.hasSide, accessToken!, signal, undefined, match));
          if (!current()) return;
        }
        if (state.status === "ready") {
          // Keep the selected ready job as the explicit check target in this report.
          pendingJobs[renderVariant] = state.jobId;
          delete uncertainRequests[renderVariant];
          runtime.writeMarker(owner!, match, null);
          outputs[renderVariant] = state.images;
          showOutput();
          if (status) status.textContent = variant === renderVariant
            ? "Preview checks passed. This illustration is not a prediction or proof of an achievable result."
            : "Your other preview is ready. Switch back to view it.";
        } else if (state.status === "failed") {
          delete pendingJobs[renderVariant];
          delete uncertainRequests[renderVariant];
          runtime.writeMarker(owner!, match, null);
          if (status) status.textContent = state.error;
        } else if (status) {
          status.textContent = "The preview is still processing. Check the existing preview shortly; this does not start another render.";
        }
      } catch (error) {
        if (current() && status && (!(error instanceof DOMException) || error.name !== "AbortError")) {
          status.textContent = pendingJobs[renderVariant]
            ? `${error instanceof MorphPreviewCheckError ? error.message : "The preview check was interrupted."} Check existing preview resumes this job without starting another render.`
            : uncertainRequests[renderVariant]
              ? `${error instanceof Error ? error.message : "The request was interrupted."} Check existing preview looks for the earlier job without starting another render.`
              : error instanceof Error ? error.message : "The preview could not be created.";
        }
      } finally {
        budget?.dispose();
        busy = false;
        if (current()) {
          refreshActions();
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
