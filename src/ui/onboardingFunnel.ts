import type { User } from "@supabase/supabase-js";
import { GOALS, QUIET_TOPICS, loadProfile, saveProfile } from "../engine/goals.js";
import {
  DISCOVERY_SOURCES,
  queueOnboardingProfile,
  emptyOnboardingProfile,
  loadOnboardingProfile,
  profileIsAdult,
  saveOnboardingProfile,
  validateOnboardingStep,
} from "../engine/onboarding.js";
import type { OnboardingProfile } from "../engine/onboarding.js";
import { startTrialCheckout } from "../engine/entitlement.js";

type PlanTier = "starter" | "max";

let host: HTMLDivElement | null = null;

const esc = (value: string): string => value.replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
})[char] || char);

const toggle = (values: string[], value: string): string[] =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

function progress(total: number, index: number): string {
  return Array.from({ length: total }, (_, i) =>
    `<i class="${i < index ? "done" : i === index ? "now" : ""}"></i>`,
  ).join("");
}

function field(
  id: string,
  label: string,
  value: string,
  options: { optional?: boolean; type?: string; placeholder?: string; autocomplete?: string; maxlength?: number; disabled?: boolean } = {},
): string {
  return `<label class="trial-field" for="${id}">
    <span>${label}${options.optional ? " <em>optional</em>" : ""}</span>
    <input id="${id}" class="trial-input" type="${options.type || "text"}"
      value="${esc(value)}" ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ""}
      ${options.autocomplete ? `autocomplete="${options.autocomplete}"` : ""}
      ${options.maxlength ? `maxlength="${options.maxlength}"` : ""}
      ${options.disabled ? "disabled" : ""} />
  </label>`;
}

function textArea(id: string, label: string, value: string, placeholder: string, optional = false): string {
  return `<label class="trial-field" for="${id}">
    <span>${label}${optional ? " <em>optional</em>" : ""}</span>
    <textarea id="${id}" class="trial-input trial-textarea" maxlength="500"
      placeholder="${esc(placeholder)}">${esc(value)}</textarea>
  </label>`;
}

function chip(key: string, label: string, selected: boolean, sub = ""): string {
  return `<button type="button" class="trial-choice${selected ? " on" : ""}" data-key="${esc(key)}"
    aria-pressed="${selected}"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</button>`;
}

function readInputs(profile: OnboardingProfile): void {
  if (!host) return;
  const value = (id: string) => (host?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value || "").trim();
  if (host.querySelector("#trial-first")) {
    profile.firstName = value("trial-first");
    profile.lastName = value("trial-last");
    profile.mobile = value("trial-mobile");
  }
  if (host.querySelector("#trial-dob")) profile.dateOfBirth = value("trial-dob");
  if (host.querySelector("#trial-success")) {
    profile.successOutcome = value("trial-success");
    profile.expectations = value("trial-expectations");
  }
  if (host.querySelector("#trial-strengths")) {
    profile.strengths = value("trial-strengths");
    profile.supportAreas = value("trial-support");
  }
}

// Set while the questions are compulsory — a first run, where the app cannot
// greet you by name or decide which plan it is allowed to show you until they
// are answered. Cleared the moment the answers are saved, so the OFFER is
// always dismissible: the questions are required, the subscription never is.
let locked = false;

function close(): void {
  if (locked) return;
  host?.remove();
  host = null;
  document.body.classList.remove("funnel-open");
  document.removeEventListener("keydown", onKey);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}

interface FunnelPreview {
  profile: OnboardingProfile;
  offer: boolean;
}

export interface FunnelOptions {
  // No ✕, no Escape, no "Not now" — the quiz has to be finished before the
  // rest of the app means anything. Only ever true on a first run.
  required?: boolean;
}

export async function openTrialFunnel(
  user: User,
  preview?: FunnelPreview,
  options: FunnelOptions = {},
): Promise<void> {
  locked = false;
  const required = Boolean(options.required);
  close();
  host = document.createElement("div");
  host.className = "trial-overlay";
  host.innerHTML = `<div class="trial-shell trial-loading" role="dialog" aria-modal="true" aria-label="Build your TrueMax pathway">
    <div class="trial-loader"></div><p>Preparing your pathway…</p>
  </div>`;
  document.body.appendChild(host);
  document.body.classList.add("funnel-open");
  document.addEventListener("keydown", onKey);

  let profile = preview?.profile ?? emptyOnboardingProfile(user);
  try {
    if (!preview) profile = await loadOnboardingProfile(user);
  } catch {
    if (!host) return;
    host.innerHTML = `<div class="trial-shell trial-loading" role="dialog" aria-modal="true">
      <button class="trial-close" type="button" aria-label="Close">✕</button>
      <span class="trial-eyebrow">PATHWAY</span>
      <h2>We couldn't load your profile.</h2>
      <p>Your analysis is safe on this device. Please try again when your connection is stable.</p>
      <button class="btn pri" id="trial-retry" type="button">Try again</button>
    </div>`;
    host.querySelector(".trial-close")?.addEventListener("click", close);
    host.querySelector("#trial-retry")?.addEventListener("click", () => void openTrialFunnel(user));
    return;
  }

  const localGoals = loadProfile();
  if (!profile.primaryObjectives.length && localGoals.goals.length) profile.primaryObjectives = [...localGoals.goals];
  if (!profile.quietTopics.length && localGoals.quiet.length) profile.quietTopics = [...localGoals.quiet];

  let step = 0;
  let busy = false;
  const total = 6;
  // Only lock once the profile has loaded, so a network failure on the way in
  // leaves the retry screen closable rather than trapping somebody in a dialog
  // that cannot succeed.
  locked = required && !preview;

  const drawOffer = () => {
    if (!host) return;
    const adult = profileIsAdult(profile);
    // The .offer-enter classes drive the reveal: the shell rises, then the two
    // plans slide in from their own sides with the Max card landing a beat
    // later. This is the one moment in the product where money is asked for,
    // and it should arrive like a result, not like a form. Pure CSS, and the
    // global reduced-motion rule collapses all of it to a plain appearance.
    host.innerHTML = `<div class="trial-shell trial-offer offer-enter" role="dialog" aria-modal="true" aria-labelledby="trial-title">
      <button class="trial-close" type="button" aria-label="Close">✕</button>
      <div class="trial-offer-head">
        <div class="max-guide" aria-hidden="true">
          <img src="/brand/max-avatar-v1.webp" alt="" width="640" height="640">
          <span>MAX</span>
        </div>
        <div><span class="trial-eyebrow">YOUR PATHWAY IS READY</span>
          <h2 id="trial-title">One more scan. Seven days to explore.</h2>
          <p>Your card is collected securely by Stripe. Cancel before the trial ends and you pay $0.</p></div>
      </div>
      <div class="plan-grid">
        <article class="plan-card starter" data-plan="starter">
          <div class="plan-top"><span>STARTER</span><b>$7.99<small> USD / month</small></b></div>
          <p>A clear weekly pathway to keep your progress moving.</p>
          <ul><li>One additional scan in the trial</li><li>One included scan each week after</li><li>Personal pathway and progress tracking</li><li>Available at every age</li></ul>
          <button class="btn plan-cta" type="button" data-checkout="starter">Start 7-day free trial</button>
          <small>Then $7.99/month. Cancel anytime.</small>
        </article>
        <article class="plan-card max${adult ? " featured" : " locked"}" data-plan="max">
          ${adult ? `<span class="plan-ribbon">MOST IMMERSIVE</span>` : `<span class="plan-ribbon lock">18+ · LOCKED</span>`}
          <div class="plan-top"><span>TRUE<span>MAX</span></span><b>$11.99<small> USD / month</small></b></div>
          <p>Your highest-touch experience with Max alongside you.</p>
          <ul><li>Everything in Starter</li><li>Max AI guidance</li><li>Deeper personalised coaching</li><li>One additional scan in the trial</li></ul>
          <button class="btn plan-cta" type="button" data-checkout="max" ${adult ? "" : "disabled"}>
            ${adult ? "Try Max free for 7 days" : "Available when you're 18"}
          </button>
          <small>${adult ? "Then $11.99/month. Cancel anytime." : "Starter remains fully available."}</small>
        </article>
      </div>
      <div class="max-pop" aria-hidden="true">
        <img src="/brand/max-avatar-v1.webp" alt="" width="640" height="640">
        <p><b>Hey — I'm Max.</b> I read your measurements every time you scan,
          write the routine around what you told me you want, and tell you
          straight whether it moved. Including when it didn't.</p>
      </div>
      <p class="trial-status" role="status"></p>
      <button class="trial-decline" type="button">No thank you — show me my analysis</button>
      <p class="trial-legal">Subscriptions renew monthly until cancelled, and your plan and trial terms are shown again in secure Checkout. Not ready for a subscription? Individual scans can be bought one at a time instead — the option is on your results screen.</p>
    </div>`;

    host.querySelector(".trial-close")?.addEventListener("click", close);
    host.querySelector(".trial-decline")?.addEventListener("click", close);

    // Tapping a card opens what is actually in it, rather than making people
    // read two feature lists at once. The Max card additionally brings Max in
    // from the side to introduce himself — ONCE. He is a character, and a
    // character who repeats his introduction every time you tap him stops being
    // charming somewhere around the third tap.
    let maxSpoken = false;
    for (const card of host.querySelectorAll<HTMLElement>(".plan-card")) {
      card.addEventListener("click", (event) => {
        // Not when the tap was the buy button — that has its own job.
        if ((event.target as HTMLElement).closest("[data-checkout]")) return;
        const opening = !card.classList.contains("open");
        for (const other of host?.querySelectorAll<HTMLElement>(".plan-card") || []) {
          other.classList.toggle("open", other === card && opening);
        }
        if (opening && card.dataset.plan === "max" && !maxSpoken) {
          maxSpoken = true;
          const bubble = host?.querySelector<HTMLElement>(".max-pop");
          bubble?.classList.add("show");
        }
      });
    }
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-checkout]")) {
      button.addEventListener("click", async () => {
        if (busy || button.disabled) return;
        busy = true;
        const status = host?.querySelector<HTMLElement>(".trial-status");
        for (const item of host?.querySelectorAll<HTMLButtonElement>("[data-checkout]") || []) item.disabled = true;
        button.textContent = "Opening secure Checkout…";
        const result = await startTrialCheckout(button.dataset.checkout as PlanTier);
        if (!result.ok && host) {
          busy = false;
          for (const item of host.querySelectorAll<HTMLButtonElement>("[data-checkout]")) {
            item.disabled = item.dataset.checkout === "max" && !adult;
          }
          button.textContent = button.dataset.checkout === "starter" ? "Start 7-day free trial" : "Try Max free for 7 days";
          if (status) status.textContent = result.message || "Checkout is not available yet.";
        }
      });
    }
  };

  const complete = async () => {
    if (busy || !host) return;
    readInputs(profile);
    busy = true;
    const next = host.querySelector<HTMLButtonElement>("#trial-next");
    if (next) {
      next.disabled = true;
      next.textContent = "Saving your pathway…";
    }
    const result = preview ? { ok: true } : await saveOnboardingProfile(user, profile);
    busy = false;

    // A failed write must NEVER strand somebody at the end of the quiz.
    //
    // This is what a tester hit: six screens answered, one bar of 4G, and the
    // upsert came back "TypeError: Load failed" — Safari's words for a request
    // that never left the handset. The button reset, the offer never appeared,
    // and the whole funnel dead-ended on the last step with every answer still
    // sitting in memory. A dropped packet was costing a signup.
    //
    // So the answers are queued locally and the flow continues. They go up on
    // the next sign-in without asking again, and being unable to reach a
    // database is not a reason to withhold the plans from somebody who just
    // spent two minutes telling us about themselves.
    if (!result.ok && !preview) {
      queueOnboardingProfile(profile);
      profile.completedAt = new Date().toISOString();
    }

    if (!preview) {
      localGoals.goals = [...profile.primaryObjectives];
      localGoals.quiet = profile.quietTopics as typeof localGoals.quiet;
      localGoals.preDone = true;
      localGoals.postDone = true;
      saveProfile(localGoals);
    }
    // The answers are in, so the lock comes off before the plans appear. The
    // questions were compulsory; being sold to is not, and a paywall you cannot
    // close is a different product to the one this is trying to be.
    locked = false;
    drawOffer();
  };

  const draw = () => {
    if (!host) return;
    const headers = [
      ["A LITTLE ABOUT YOU", `Let's make this yours, ${esc(profile.firstName || "first")}.`, "Your email already comes from your secure account. We only ask for what shapes your experience."],
      ["AGE & DISCOVERY", "Keep the experience age-appropriate.", "Your date of birth controls which plan can be offered. Your mobile is optional and is never required for analysis."],
      ["YOUR OBJECTIVE", "What would you most like to improve?", "Pick as many as fit. This personalises the pathway; it never changes your measurements or score."],
      ["THE OUTCOME", "What would make TrueMax genuinely useful?", "A short answer helps Max focus on your version of progress, not somebody else's."],
      ["YOUR STARTING POINT", "Bring the whole picture, not just a score.", "These are optional. We use them to keep coaching specific, constructive and grounded in what you already value."],
      ["BOUNDARIES", "Anything you don't want made into a project?", "Optional. Measurements still appear, but your written pathway and Max will avoid pushing these topics."],
    ];
    const [eyebrow, title, note] = headers[step];
    let content = "";
    if (step === 0) {
      content = `<div class="trial-fields two">
        ${field("trial-first", "First name", profile.firstName, { autocomplete: "given-name", maxlength: 60 })}
        ${field("trial-last", "Last name", profile.lastName, { autocomplete: "family-name", maxlength: 60 })}
      </div>${field("trial-mobile", "Mobile", profile.mobile, { optional: true, type: "tel", autocomplete: "tel", placeholder: "+1 555 123 4567", maxlength: 32 })}`;
    } else if (step === 1) {
      content = `${field("trial-dob", "Date of birth", profile.dateOfBirth, { type: "date", autocomplete: "bday", disabled: Boolean(profile.completedAt) })}
        ${profile.completedAt ? `<p class="trial-field-note">For safety, date of birth is locked after onboarding. Contact support if it needs correcting.</p>` : ""}
        <span class="trial-label">How did you hear about TrueMax?</span>
        <div class="trial-choices compact">${DISCOVERY_SOURCES.map(([key, label]) => chip(key, label, profile.discoverySource === key)).join("")}</div>`;
    } else if (step === 2) {
      content = `<div class="trial-choices">${GOALS.map((goal) => chip(goal.id, goal.label, profile.primaryObjectives.includes(goal.id), goal.blurb)).join("")}</div>`;
    } else if (step === 3) {
      content = `${textArea("trial-success", "What would satisfy you about this app?", profile.successOutcome, "e.g. A practical routine and a calmer way to track real progress")}
        ${textArea("trial-expectations", "What would you expect from TrueMax?", profile.expectations, "e.g. Honest measurements, clear next steps and no pressure")}`;
    } else if (step === 4) {
      content = `${textArea("trial-strengths", "What do you already feel confident about?", profile.strengths, "Anything you already like or want to preserve", true)}
        ${textArea("trial-support", "Where would support be most useful?", profile.supportAreas, "Use your own words — or leave this blank", true)}`;
    } else {
      content = `<div class="trial-choices compact">${QUIET_TOPICS.map((topic) => chip(topic.region, topic.label, profile.quietTopics.includes(topic.region))).join("")}</div>
        <div class="privacy-note"><b>Your face analysis stays on this device by default.</b><span>These answers save to your account so your pathway can follow you. Photo-feedback sharing remains a separate, optional Yes/No choice.</span></div>`;
    }

    host.innerHTML = `<div class="trial-shell" role="dialog" aria-modal="true" aria-labelledby="trial-title">
      <header class="trial-nav">
        <div class="trial-brand">TRUE<span>MAX</span></div>
        <div class="trial-progress" aria-label="Step ${step + 1} of ${total}">${progress(total, step)}</div>
        ${locked ? "" : `<button class="trial-close" type="button" aria-label="Close">✕</button>`}
      </header>
      <main class="trial-body">
        <span class="trial-eyebrow">${eyebrow} · ${step + 1} OF ${total}</span>
        <h2 id="trial-title">${title}</h2>
        <p class="trial-note">${note}</p>
        <div class="trial-content">${content}</div>
      </main>
      <p class="trial-status" role="status"></p>
      <footer class="trial-actions">
        <button class="btn gho" id="trial-back" type="button" ${locked && step === 0 ? "hidden" : ""}>${step === 0 ? "Not now" : "Back"}</button>
        <button class="btn pri" id="trial-next" type="button">${step === total - 1 ? "See my trial options" : "Continue"}</button>
      </footer>
    </div>`;

    host.querySelector(".trial-close")?.addEventListener("click", close);
    host.querySelector("#trial-back")?.addEventListener("click", () => {
      if (step === 0) return close();
      readInputs(profile);
      step--;
      draw();
    });
    host.querySelector("#trial-next")?.addEventListener("click", () => {
      readInputs(profile);
      const issue = validateOnboardingStep(profile, step);
      const status = host?.querySelector<HTMLElement>(".trial-status");
      if (issue) {
        if (status) status.textContent = issue;
        return;
      }
      if (step === total - 1) void complete();
      else {
        step++;
        draw();
      }
    });
    for (const choice of host.querySelectorAll<HTMLButtonElement>(".trial-choice")) {
      choice.addEventListener("click", () => {
        const key = choice.dataset.key || "";
        if (step === 1) profile.discoverySource = key as OnboardingProfile["discoverySource"];
        else if (step === 2) profile.primaryObjectives = toggle(profile.primaryObjectives, key);
        else if (step === 5) profile.quietTopics = toggle(profile.quietTopics, key);
        for (const item of host?.querySelectorAll<HTMLButtonElement>(".trial-choice") || []) {
          const selected = step === 1
            ? profile.discoverySource === item.dataset.key
            : (step === 2 ? profile.primaryObjectives : profile.quietTopics).includes(item.dataset.key || "");
          item.classList.toggle("on", selected);
          item.setAttribute("aria-pressed", String(selected));
        }
      });
    }
  };

  if (preview?.offer) drawOffer();
  else draw();
}

// Local visual QA only. Vite folds import.meta.env.DEV to false in production,
// so main.ts never exposes this route in the deployed build.
export function openTrialFunnelPreview(adult: boolean, offer: boolean): Promise<void> {
  const user = {
    id: "00000000-0000-0000-0000-000000000000",
    user_metadata: { first_name: "Nikau", last_name: "Preview" },
  } as unknown as User;
  const profile: OnboardingProfile = {
    ...emptyOnboardingProfile(user),
    dateOfBirth: adult ? "2000-01-01" : "2010-01-01",
    discoverySource: "tiktok",
    primaryObjectives: [GOALS[0].id, GOALS[1].id],
    successOutcome: "A practical pathway I can actually stick to.",
    expectations: "Honest measurements and clear next steps.",
    completedAt: null,
  };
  return openTrialFunnel(user, { profile, offer });
}
