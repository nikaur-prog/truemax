import { BODY_BOUNDS, bodyMetricUsable, toMetric } from "../engine/bodyUnits.js";
import type { UnitSystem } from "../engine/bodyUnits.js";
import type { User } from "@supabase/supabase-js";
import {
  currentUser,
  requestPasswordReset,
  signIn,
  signInWithLink,
  signInWithProvider,
  signUp,
  socialAvailability,
  updatePassword,
} from "../engine/auth.js";
import { beginIntentionalNavigation } from "../engine/navigationIntent.js";

export type AuthMode = "link" | "password" | "signup" | "forgot" | "reset";

export interface AuthFormOptions {
  initialMode?: AuthMode;
  context?: "account" | "analysis" | "portal";
  portalHref?: string;
  onAuthenticated: (user: User) => void | Promise<void>;
  onDeferred?: () => void | Promise<void>;
}

export function renderAuthForm(root: HTMLElement, options: AuthFormOptions): void {
  renderMode(root, options.initialMode ?? "signup", options);
}

function renderMode(root: HTMLElement, mode: AuthMode, options: AuthFormOptions): void {
  if (mode === "forgot") {
    renderForgot(root, options);
    return;
  }
  if (mode === "reset") {
    renderReset(root, options);
    return;
  }

  const isSignup = mode === "signup";
  const isLink = mode === "link";
  const analysis = options.context === "analysis";
  const title = analysis
    ? "Create an account to see your analysis"
    : isSignup
      ? "Create your account"
      : "Welcome back";
  const lede = analysis
    ? "Your scan is already measured on this device. Sign up or log in to open the result."
    : "Photos stay on this device by default. Your account keeps your membership attached to you across browsers.";

  root.innerHTML = `
    <h2 id="auth-title">${title}</h2>
    <p class="acct-lede">${lede}</p>
    <div class="acct-social" aria-label="Social sign in">
      <button type="button" class="acct-oauth" data-provider="google" data-available="checking" disabled>
        ${socialLabel("google")}<small>Checking…</small>
      </button>
      <button type="button" class="acct-oauth apple" data-provider="apple" data-available="checking" disabled>
        ${socialLabel("apple")}<small>Checking…</small>
      </button>
    </div>
    <div class="acct-divider"><span>or</span></div>
    <form class="acct-form" novalidate>
      ${
        // Signup only. Asked here rather than left to the quiz so the app can
        // greet somebody by name the moment they are through the wall, and so
        // the quiz opens with a field already filled instead of a blank one.
        // Not required: an account is worth more than a name, and this is the
        // screen standing between a finished scan and the person who took it.
        isSignup && !isLink
          ? `<label class="acct-field">
              <span>First name <em>optional</em></span>
              <input type="text" name="name" autocomplete="given-name" placeholder="What should we call you?" maxlength="60" />
            </label>`
          : ""
      }
      <label class="acct-field">
        <span>Email</span>
        <input type="email" name="email" autocomplete="email" placeholder="you@email.com" required />
      </label>
      ${
        // Signup only, and optional in the plainest sense: the fields can be
        // left blank and the button does not care. They are here because the
        // calculator on Max needs them and asking at the start beats an
        // interruption later; a database trigger stores what is entered and
        // drops anything out of bounds. Free and Starter signups are never
        // blocked by them. Whether they are asked again is decided by the
        // server's required flag (api/body-profile.ts), never by this form.
        isSignup && !isLink
          ? `<fieldset class="acct-field acct-body">
              <legend><span>Height and weight <em>optional, for your daily plan</em></span></legend>
              <div class="acct-units" role="group" aria-label="Units">
                <button type="button" data-acct-unit="metric" aria-pressed="true">Metric</button>
                <button type="button" data-acct-unit="imperial" aria-pressed="false">Imperial</button>
              </div>
              <div class="acct-body-fields" data-acct-body="metric">
                <input type="number" name="heightCm" inputmode="decimal" min="${BODY_BOUNDS.heightCm.min}" max="${BODY_BOUNDS.heightCm.max}" step="0.1" placeholder="Height, cm" aria-label="Height in centimetres" />
                <input type="number" name="weightKg" inputmode="decimal" min="${BODY_BOUNDS.weightKg.min}" max="${BODY_BOUNDS.weightKg.max}" step="0.1" placeholder="Weight, kg" aria-label="Weight in kilograms" />
              </div>
              <div class="acct-body-fields" data-acct-body="imperial" hidden>
                <input type="number" name="feet" inputmode="numeric" min="3" max="7" step="1" placeholder="ft" aria-label="Height, feet" />
                <input type="number" name="inches" inputmode="decimal" min="0" max="11.9" step="0.1" placeholder="in" aria-label="Height, inches" />
                <input type="number" name="pounds" inputmode="decimal" min="77" max="661" step="0.1" placeholder="Weight, lb" aria-label="Weight in pounds" />
              </div>
              <small class="acct-body-note">Never used for your face score. You can add or change these later.</small>
            </fieldset>`
          : ""
      }
      ${
        isLink
          ? ""
          : `<label class="acct-field">
              <span>Password</span>
              <input type="password" name="password" autocomplete="${
                isSignup ? "new-password" : "current-password"
              }" placeholder="At least 6 characters" required minlength="6" />
            </label>`
      }
      <p class="acct-msg" role="status" aria-live="polite"></p>
      <button type="submit" class="btn pri acct-submit">${
        isLink ? "Email me a sign-in link" : isSignup ? "Create free account" : "Sign in"
      }</button>
    </form>
    <div class="acct-switch">
      ${
        isLink
          ? `<button type="button" data-mode="password">Use a password</button>
             <button type="button" data-mode="signup">Create an account</button>`
          : isSignup
            ? `<button type="button" data-mode="password">I already have an account</button>
               <button type="button" data-mode="link">Email me a sign-in link</button>`
            : `<button type="button" data-mode="forgot">Forgot password?</button>
               <button type="button" data-mode="signup">Create an account</button>
               <button type="button" data-mode="link">Email me a link</button>`
      }
    </div>
    ${
      options.portalHref
        ? `<a class="acct-portal-link" href="${options.portalHref}">Open the full account portal →</a>`
        : ""
    }`;

  const form = root.querySelector(".acct-form") as HTMLFormElement;
  const msg = root.querySelector(".acct-msg") as HTMLElement;
  const submit = root.querySelector(".acct-submit") as HTMLButtonElement;
  let formWorking = false;
  let bodyUnit: UnitSystem = "metric";
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-acct-unit]")) {
    button.addEventListener("click", () => {
      bodyUnit = button.dataset.acctUnit === "imperial" ? "imperial" : "metric";
      for (const b of root.querySelectorAll<HTMLButtonElement>("[data-acct-unit]")) {
        b.setAttribute("aria-pressed", String(b.dataset.acctUnit === bodyUnit));
      }
      for (const group of root.querySelectorAll<HTMLElement>("[data-acct-body]")) {
        group.hidden = group.dataset.acctBody !== bodyUnit;
      }
    });
  }
  root.querySelector<HTMLAnchorElement>(".acct-portal-link")?.addEventListener("click", () => {
    beginIntentionalNavigation();
  });
  const updateSubmit = syncSubmitState(form, submit, !isLink, () => formWorking);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // A disabled submit button does not stop Enter from dispatching another
    // submit event. Keep the request itself single-flight as well as the UI.
    if (formWorking) return;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    if (!email) {
      say(msg, "Enter your email.", "err");
      return;
    }
    if (!isLink && password.length < 6) {
      say(msg, "Password must be at least 6 characters.", "err");
      return;
    }

    formWorking = true;
    setWorking(submit, true);
    updateSubmit();
    // Optional means optional: blank fields are not sent, a partly filled
    // or out-of-bounds pair is dropped with a note rather than a refusal,
    // and the account is created either way.
    const body = isSignup ? signupBody(data, bodyUnit) : null;
    if (isSignup && body === "invalid") {
      say(msg, "Height and weight were left out: enter both, within a plausible range, or leave both blank. Creating your account without them.", "info");
    }
    const result = isLink
      ? await signInWithLink(email)
      : isSignup
        ? await signUp(email, password, String(data.get("name") || ""), body === "invalid" ? null : body)
        : await signIn(email, password);
    formWorking = false;
    setWorking(submit, false, isLink ? "Email me a sign-in link" : isSignup ? "Create free account" : "Sign in");
    updateSubmit();

    if (!result.ok) {
      say(msg, result.message || "Something went wrong.", "err");
      return;
    }
    if (isLink || result.needsConfirmation) {
      await options.onDeferred?.();
      renderEmailSent(root, email, isLink ? "sign in" : "confirm your account");
      return;
    }
    const user = await currentUser();
    if (user) await options.onAuthenticated(user);
    else say(msg, "The account was created, but the session did not start. Try signing in.", "err");
  });

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    button.addEventListener("click", () => renderMode(root, button.dataset.mode as AuthMode, options));
  }
  let socialWorking = false;
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-provider]")) {
    button.addEventListener("click", async () => {
      if (socialWorking || button.dataset.available !== "true") return;
      const provider = button.dataset.provider as "google" | "apple";
      socialWorking = true;
      disableSocial(root, true);
      button.textContent = "Opening…";
      const result = await signInWithProvider(provider);
      if (!result.ok) {
        socialWorking = false;
        disableSocial(root, false);
        button.innerHTML = socialLabel(provider);
        say(msg, result.message || "Could not start social sign-in.", "err");
      }
    });
  }

  // Provider configuration lives in Supabase, so these buttons become active
  // automatically the moment Google/Apple credentials are enabled—no redeploy.
  //
  // Buttons start disabled, so a quick tap cannot beat this settings read on a
  // slow phone. Unknown stays unavailable; a provider becomes clickable only
  // after Supabase confirms it is configured.
  void socialAvailability().then((availability) => {
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-provider]")) {
      const provider = button.dataset.provider as "google" | "apple";
      if (!availability) {
        const name = provider === "google" ? "Google" : "Apple";
        button.dataset.available = "false";
        button.disabled = true;
        button.title = `${name} sign-in could not be checked. Use email below.`;
        button.setAttribute("aria-label", button.title);
        button.innerHTML = `${socialLabel(provider)}<small>Try email</small>`;
        continue;
      }
      if (availability[provider]) {
        button.dataset.available = "true";
        // The settings read can resolve after an OAuth click. It may confirm
        // availability, but it must not reopen either provider while that
        // navigation request is still in flight.
        button.disabled = socialWorking;
        button.title = "";
        button.removeAttribute("aria-label");
        button.innerHTML = socialLabel(provider);
        continue;
      }
      const name = provider === "google" ? "Google" : "Apple";
      button.dataset.available = "false";
      button.disabled = true;
      button.title = `${name} sign-in is awaiting provider setup`;
      button.setAttribute("aria-label", button.title);
      button.innerHTML = `${socialLabel(provider)}<small>Coming soon</small>`;
    }
  });
}

/**
 * The optional body from the signup form: null when both fields are blank,
 * "invalid" when something was typed that cannot be used, otherwise the
 * canonical pair. Exported for its test; the form never blocks on it.
 */
export function signupBody(
  data: FormData,
  unit: UnitSystem,
): { heightCm: number; weightKg: number; unit: UnitSystem } | null | "invalid" {
  const field = (name: string) => String(data.get(name) ?? "").trim();
  const filled = unit === "metric"
    ? [field("heightCm"), field("weightKg")]
    : [field("feet"), field("pounds")];
  if (filled.every((v) => v === "")) return null;
  if (filled.some((v) => v === "")) return "invalid";
  const metric = toMetric(unit === "metric"
    ? { unit, heightCm: Number(field("heightCm")), weightKg: Number(field("weightKg")) }
    : { unit, feet: Number(field("feet")), inches: Number(field("inches") || 0), pounds: Number(field("pounds")) });
  if (!bodyMetricUsable(metric)) return "invalid";
  return { ...metric, unit };
}

export function authSubmitReady(
  emailPresent: boolean,
  emailValid: boolean,
  passwordLength: number,
  requiresPassword: boolean,
  working: boolean,
): boolean {
  return !working && emailPresent && emailValid && (!requiresPassword || passwordLength >= 6);
}

function syncSubmitState(
  form: HTMLFormElement,
  button: HTMLButtonElement,
  requiresPassword: boolean,
  isWorking: () => boolean,
): () => void {
  const update = () => {
    const email = form.querySelector<HTMLInputElement>('input[name="email"]');
    const password = form.querySelector<HTMLInputElement>('input[name="password"]');
    const ready = authSubmitReady(
      Boolean(email?.value.trim()),
      Boolean(email?.validity.valid),
      password?.value.length ?? 0,
      requiresPassword,
      isWorking(),
    );
    button.disabled = !ready;
    button.classList.toggle("ready", ready);
  };
  form.addEventListener("input", update);
  update();
  return update;
}

function renderForgot(root: HTMLElement, options: AuthFormOptions): void {
  root.innerHTML = `
    <h2 id="auth-title">Reset your password</h2>
    <p class="acct-lede">Enter the email on your account. We will send one secure reset link.</p>
    <form class="acct-form" novalidate>
      <label class="acct-field">
        <span>Email</span>
        <input type="email" name="email" autocomplete="email" placeholder="you@email.com" required />
      </label>
      <p class="acct-msg" role="status" aria-live="polite"></p>
      <button type="submit" class="btn pri acct-submit">Send reset link</button>
    </form>
    <div class="acct-switch"><button type="button" data-mode="password">Back to sign in</button></div>`;

  root.querySelector("[data-mode]")?.addEventListener("click", () => renderMode(root, "password", options));
  const form = root.querySelector("form") as HTMLFormElement;
  const msg = root.querySelector(".acct-msg") as HTMLElement;
  const submit = root.querySelector(".acct-submit") as HTMLButtonElement;
  let working = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (working) return;
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email) return say(msg, "Enter your email.", "err");
    working = true;
    setWorking(submit, true);
    const result = await requestPasswordReset(email);
    working = false;
    setWorking(submit, false, "Send reset link");
    if (!result.ok) return say(msg, result.message || "Could not send the reset link.", "err");
    renderEmailSent(root, email, "reset your password");
  });
}

function renderReset(root: HTMLElement, options: AuthFormOptions): void {
  root.innerHTML = `
    <h2 id="auth-title">Choose a new password</h2>
    <p class="acct-lede">Use at least 8 characters. This will replace the password on your TrueMax account.</p>
    <form class="acct-form" novalidate>
      <label class="acct-field">
        <span>New password</span>
        <input type="password" name="password" autocomplete="new-password" minlength="8" required />
      </label>
      <label class="acct-field">
        <span>Confirm password</span>
        <input type="password" name="confirm" autocomplete="new-password" minlength="8" required />
      </label>
      <p class="acct-msg" role="status" aria-live="polite"></p>
      <button type="submit" class="btn pri acct-submit">Update password</button>
    </form>`;

  const form = root.querySelector("form") as HTMLFormElement;
  const msg = root.querySelector(".acct-msg") as HTMLElement;
  const submit = root.querySelector(".acct-submit") as HTMLButtonElement;
  let working = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (working) return;
    const data = new FormData(form);
    const password = String(data.get("password") || "");
    const confirm = String(data.get("confirm") || "");
    if (password.length < 8) return say(msg, "Use at least 8 characters.", "err");
    if (password !== confirm) return say(msg, "The passwords do not match.", "err");
    working = true;
    setWorking(submit, true);
    const result = await updatePassword(password);
    working = false;
    setWorking(submit, false, "Update password");
    if (!result.ok) return say(msg, result.message || "Could not update the password.", "err");
    const user = await currentUser();
    if (user) await options.onAuthenticated(user);
    else say(msg, "Password updated. Sign in with the new password.", "ok");
  });
}

function renderEmailSent(root: HTMLElement, email: string, action: string): void {
  root.innerHTML = `<h2 id="auth-title">Check your email</h2>
    <p class="acct-lede">We sent a link to <b>${escapeHtml(email)}</b>. Open the newest link on this device to ${action}.</p>
    <a class="btn gho acct-home" href="/">Back to the scan</a>`;
}

function setWorking(button: HTMLButtonElement, working: boolean, idleText = "Working…"): void {
  button.disabled = working;
  button.textContent = working ? "Working…" : idleText;
}

function disableSocial(root: HTMLElement, disabled: boolean): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>(".acct-oauth")) {
    button.disabled = disabled || button.dataset.available === "false";
  }
}

function say(node: HTMLElement, text: string, kind: "err" | "ok" | "info"): void {
  node.textContent = text;
  node.className = `acct-msg ${kind}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}

function socialLabel(provider: "google" | "apple"): string {
  if (provider === "google") {
    return `<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z"/>
      <path fill="#34a853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"/>
      <path fill="#fbbc05" d="M6.39 13.86a6.01 6.01 0 0 1 0-3.72V7.52H3.04a10 10 0 0 0 0 8.96l3.35-2.62Z"/>
      <path fill="#ea4335" d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z"/>
    </svg><span>Continue with Google</span>`;
  }
  return `<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
    <path fill="currentColor" d="M16.7 12.76c.02 2.45 2.15 3.27 2.18 3.28-.02.06-.34 1.17-1.12 2.31-.68.99-1.39 1.97-2.5 1.99-1.08.02-1.44-.65-2.69-.65-1.24 0-1.64.63-2.66.67-1.06.04-1.88-1.07-2.56-2.06-1.39-2.01-2.45-5.68-1.02-8.17a3.97 3.97 0 0 1 3.38-2.05c1.05-.02 2.05.71 2.69.71.63 0 1.83-.88 3.08-.75.53.02 2 .21 2.95 1.6-.08.05-1.76 1.03-1.73 3.12Zm-2.04-6.05c.57-.69.96-1.65.85-2.61-.83.03-1.84.55-2.43 1.24-.53.61-.99 1.59-.87 2.53.93.07 1.88-.47 2.45-1.16Z"/>
  </svg><span>Continue with Apple</span>`;
}
