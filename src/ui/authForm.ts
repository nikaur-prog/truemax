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
} from "../engine/auth.ts";

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
    ? "Your analysis is ready"
    : isSignup
      ? "Create your account"
      : "Welcome back";
  const lede = analysis
    ? "Create a free account to reveal your results. Your face photos stay on this device; only your account and membership use Supabase."
    : "Your face photos stay on this device. Your account keeps your membership attached to you across browsers.";

  root.innerHTML = `
    <h2 id="auth-title">${title}</h2>
    <p class="acct-lede">${lede}</p>
    <div class="acct-social" aria-label="Social sign in">
      <button type="button" class="acct-oauth" data-provider="google">
        <span aria-hidden="true">G</span> Continue with Google
      </button>
      <button type="button" class="acct-oauth apple" data-provider="apple">
        <span aria-hidden="true">●</span> Continue with Apple
      </button>
    </div>
    <div class="acct-divider"><span>or</span></div>
    <form class="acct-form" novalidate>
      <label class="acct-field">
        <span>Email</span>
        <input type="email" name="email" autocomplete="email" placeholder="you@email.com" required />
      </label>
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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

    setWorking(submit, true);
    const result = isLink
      ? await signInWithLink(email)
      : isSignup
        ? await signUp(email, password)
        : await signIn(email, password);
    setWorking(submit, false, isLink ? "Email me a sign-in link" : isSignup ? "Create free account" : "Sign in");

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
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-provider]")) {
    button.addEventListener("click", async () => {
      const provider = button.dataset.provider as "google" | "apple";
      disableSocial(root, true);
      button.textContent = "Opening…";
      const result = await signInWithProvider(provider);
      if (!result.ok) {
        disableSocial(root, false);
        button.innerHTML = provider === "google"
          ? `<span aria-hidden="true">G</span> Continue with Google`
          : `<span aria-hidden="true">●</span> Continue with Apple`;
        say(msg, result.message || "Could not start social sign-in.", "err");
      }
    });
  }

  // Provider configuration lives in Supabase, so these buttons become active
  // automatically the moment Google/Apple credentials are enabled—no redeploy.
  void socialAvailability().then((availability) => {
    if (!availability) return;
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-provider]")) {
      const provider = button.dataset.provider as "google" | "apple";
      if (availability[provider]) continue;
      button.disabled = true;
      button.title = `${provider === "google" ? "Google" : "Apple"} sign-in is awaiting provider setup`;
      button.setAttribute("aria-label", button.title);
    }
  });
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
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email) return say(msg, "Enter your email.", "err");
    setWorking(submit, true);
    const result = await requestPasswordReset(email);
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
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const password = String(data.get("password") || "");
    const confirm = String(data.get("confirm") || "");
    if (password.length < 8) return say(msg, "Use at least 8 characters.", "err");
    if (password !== confirm) return say(msg, "The passwords do not match.", "err");
    setWorking(submit, true);
    const result = await updatePassword(password);
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
  for (const button of root.querySelectorAll<HTMLButtonElement>(".acct-oauth")) button.disabled = disabled;
}

function say(node: HTMLElement, text: string, kind: "err" | "ok"): void {
  node.textContent = text;
  node.className = `acct-msg ${kind}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}
