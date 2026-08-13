import {
  currentUser,
  deleteAccount,
  isAuthAvailable,
  onAuthChange,
  signOut,
} from "../engine/auth.js";
import {
  consumeCheckoutResult,
  hasPaidAccess,
  hasMaxAccess,
  loadEntitlement,
  openBillingPortal,
} from "../engine/entitlement.js";
import type { User } from "@supabase/supabase-js";
import { renderAuthForm } from "./authForm.js";
import type { AuthMode } from "./authForm.js";
import { announceMembershipBrand } from "./membershipBrand.js";
import { openTrialFunnel } from "./onboardingFunnel.js";

// ---------------------------------------------------------------------------
// The account modal, and the header button that opens it.
//
// This whole module is inert without Supabase keys: mountAccountButton() does
// nothing and leaves no button, so a build with no keys is byte-for-byte the
// product it was before accounts existed. The moment the two env vars are set
// the button appears and the modal works, with no code change.
//
// An account is deliberately small here. Capture runs on device and history
// stays in localStorage; identity is required only when revealing an analysis
// or attaching a subscription.
// ---------------------------------------------------------------------------

let overlay: HTMLDivElement | null = null;

export interface OpenAccountOptions {
  notice?: string;
  initialMode?: AuthMode;
  reason?: "account" | "analysis";
  onAuthenticated?: (user: User) => void | Promise<void>;
  onDeferred?: () => void | Promise<void>;
}

function initials(email: string): string {
  return email.trim().slice(0, 1).toUpperCase() || "•";
}

export function mountAccountButton(): void {
  if (!isAuthAvailable()) return;
  const right = document.querySelector(".topbar-right");
  if (!right) return;

  const btn = document.createElement("button");
  btn.className = "acct-btn acct-signin-trigger";
  btn.type = "button";
  btn.setAttribute("aria-label", "Sign in to TrueMax");
  btn.textContent = "Sign in";

  const signupBtn = document.createElement("button");
  signupBtn.className = "acct-btn acct-signup-trigger";
  signupBtn.type = "button";
  signupBtn.setAttribute("aria-label", "Create a TrueMax account");
  signupBtn.textContent = "Sign up";
  right.append(btn, signupBtn);

  btn.addEventListener("click", () => openAccount({ initialMode: "password" }));
  signupBtn.addEventListener("click", () => openAccount({ initialMode: "signup" }));

  // Keep the header pill in step with the session: a bare "Sign in" when out,
  // the email's initial in a disc when in. onAuthChange fires on load too, so
  // this also restores a returning, already-signed-in visitor.
  const checkoutResult = consumeCheckoutResult();
  let checkoutHandled = false;
  onAuthChange((user) => {
    if (user?.email) {
      signupBtn.classList.add("hidden");
      btn.textContent = "";
      btn.classList.add("in");
      btn.title = user.email;
      btn.setAttribute("aria-label", `Open account for ${user.email}`);
      const disc = document.createElement("span");
      disc.className = "acct-disc";
      disc.textContent = initials(user.email);
      btn.replaceChildren(disc);
    } else {
      signupBtn.classList.remove("hidden");
      btn.classList.remove("in");
      btn.title = "";
      btn.setAttribute("aria-label", "Sign in to TrueMax");
      btn.textContent = "Sign in";
    }
    if (user && checkoutResult && !checkoutHandled) {
      checkoutHandled = true;
      const notice = checkoutResult === "success"
        ? "Payment received. Stripe is confirming your Max membership now."
        : "Checkout was cancelled. Nothing was charged.";
      void openAccount(notice);
    }
  });
}

export async function openAccount(input?: string | OpenAccountOptions): Promise<void> {
  if (!isAuthAvailable()) return;
  const options: OpenAccountOptions = typeof input === "string" ? { notice: input } : input ?? {};
  close();
  const activeOverlay = document.createElement("div");
  overlay = activeOverlay;
  activeOverlay.className = "hist-overlay acct-overlay";
  activeOverlay.setAttribute("role", "dialog");
  activeOverlay.setAttribute("aria-modal", "true");
  activeOverlay.setAttribute("aria-labelledby", "auth-title");
  activeOverlay.innerHTML = `<div class="hist-panel acct-panel">
    <button class="hist-close" aria-label="Close">✕</button>
    <div class="acct-body"><p id="auth-title" class="acct-loading" role="status">Opening your account…</p></div>
  </div>`;

  activeOverlay.addEventListener("click", (e) => {
    if (e.target === activeOverlay) close();
  });
  activeOverlay.querySelector(".hist-close")?.addEventListener("click", () => close());
  document.addEventListener("keydown", escClose);
  document.body.classList.add("auth-modal-open");
  document.body.appendChild(activeOverlay);

  const body = activeOverlay.querySelector(".acct-body") as HTMLElement;
  const requestedMode = options.initialMode ?? (options.reason === "analysis" ? "signup" : null);
  const renderSignedOut = (initialMode: AuthMode) => {
    renderAuthForm(body, {
      initialMode,
      context: options.reason === "analysis" ? "analysis" : "account",
      portalHref: `/auth?mode=${initialMode}`,
      onDeferred: options.onDeferred,
      onAuthenticated: async (signedInUser) => {
        if (options.onAuthenticated) {
          close();
          await options.onAuthenticated(signedInUser);
        } else {
          renderSignedIn(body, signedInUser, options.notice);
        }
      },
    });
  };

  // A deliberate Sign in / Sign up click should never wait on Supabase's
  // persisted-session lock. Render the requested sheet now, then replace it
  // with the account view only if a late session check proves the visitor is
  // already signed in.
  const sessionCheck = currentUser().catch(() => null);
  if (requestedMode) {
    renderSignedOut(requestedMode);
    void sessionCheck.then((lateUser) => {
      if (lateUser && overlay === activeOverlay && body.isConnected) {
        renderSignedIn(body, lateUser, options.notice);
      }
    });
    return;
  }

  // Automatic account openings (for example after Checkout) still prefer the
  // signed-in view, but a stuck browser storage lock must not leave an endless
  // loading sheet. Fall back to sign-in after a short bounded check.
  const user = await Promise.race([
    sessionCheck,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1200)),
  ]);
  if (overlay !== activeOverlay || !activeOverlay.isConnected) return;
  if (user) renderSignedIn(body, user, options.notice);
  else {
    renderSignedOut("password");
    void sessionCheck.then((lateUser) => {
      if (lateUser && overlay === activeOverlay && body.isConnected) {
        renderSignedIn(body, lateUser, options.notice);
      }
    });
  }
}

function escClose(ev: KeyboardEvent): void {
  if (ev.key === "Escape") close();
}

function close(): void {
  document.removeEventListener("keydown", escClose);
  overlay?.remove();
  overlay = null;
  document.body.classList.remove("auth-modal-open");
}

// --- signed in ------------------------------------------------------------

function renderSignedIn(body: HTMLElement, user: User, notice?: string): void {
  body.innerHTML = `
    <h2>Your account</h2>
    <div class="acct-who">
      <span class="acct-disc lg">${initials(user.email || "?")}</span>
      <div>
        <b>${escapeHtml(user.email || "Signed in")}</b>
        <span>Your membership is linked here. Scan history stays on this device for now.</span>
      </div>
    </div>
    ${notice ? `<p class="acct-notice">${escapeHtml(notice)}</p>` : ""}
    <section class="acct-membership" aria-live="polite">
      <span class="acct-tier">MEMBERSHIP</span>
      <p>Checking your plan…</p>
    </section>
    <p class="acct-msg" role="status"></p>
    <div class="acct-actions">
      <button type="button" class="btn gho acct-signout">Sign out</button>
    </div>
    <details class="acct-danger">
      <summary>Delete my account</summary>
      <p>This permanently removes your account and its membership link. Scans stored on
        this device stay until you clear your browser. This cannot be undone.</p>
      <button type="button" class="acct-delete">Delete account permanently</button>
    </details>`;

  const msg = body.querySelector(".acct-msg") as HTMLElement;
  const membership = body.querySelector(".acct-membership") as HTMLElement;
  void renderMembership(membership, user, notice?.startsWith("Payment received") ?? false);

  body.querySelector(".acct-signout")?.addEventListener("click", async () => {
    await signOut();
    close();
  });

  const del = body.querySelector(".acct-delete") as HTMLButtonElement;
  let armed = false;
  del.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      del.textContent = "Tap again to confirm — this is permanent";
      return;
    }
    del.disabled = true;
    del.textContent = "Deleting…";
    const res = await deleteAccount();
    if (res.ok) close();
    else {
      del.disabled = false;
      del.textContent = "Delete account permanently";
      armed = false;
      say(msg, res.message || "Could not delete the account.", "err");
    }
  });
}

async function renderMembership(node: HTMLElement, user: User, waitForWebhook: boolean): Promise<void> {
  try {
    let entitlement = await loadEntitlement();
    for (let attempt = 0; waitForWebhook && !hasPaidAccess(entitlement) && attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (!node.isConnected) return;
      entitlement = await loadEntitlement();
    }
    if (!node.isConnected) return;

    const active = hasPaidAccess(entitlement);
    const max = hasMaxAccess(entitlement);
    const planName = max ? "Max" : entitlement.tier === "starter" ? "Starter" : "Free";
    announceMembershipBrand(max ? "max" : "member");
    const billingProblem = entitlement.status === "past_due" || entitlement.status === "unpaid";
    const period = entitlement.currentPeriodEnd
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(entitlement.currentPeriodEnd))
      : null;
    const detail = active
      ? entitlement.cancelAtPeriodEnd && period
        ? `${planName} stays active until ${period}; cancellation is scheduled.`
        : period
          ? `${planName} is active. Your current billing period ends ${period}.`
          : `${planName} is active on this account.`
      : billingProblem
        ? `Stripe could not renew ${planName}. Update your payment method to restore access.`
        : waitForWebhook
          ? "Stripe has not confirmed the subscription yet. Reopen your account in a moment."
          : "Free includes scanning, results and device-local progress.";

    node.innerHTML = `
      <span class="acct-tier">${active ? `TRUEMAX ${planName.toUpperCase()}` : "FREE"}</span>
      <b>${active ? `${planName} membership` : billingProblem ? "Billing needs attention" : "Free plan"}</b>
      <p>${detail}</p>
      <button type="button" class="btn ${active || billingProblem ? "gho" : "pri"} acct-billing">
        ${active || billingProblem ? "Manage billing" : "Explore plans"}
      </button>`;

    const button = node.querySelector(".acct-billing") as HTMLButtonElement;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = active || billingProblem ? "Opening billing…" : "Preparing plans…";
      if (!active && !billingProblem) {
        close();
        await openTrialFunnel(user);
        return;
      }
      const result = await openBillingPortal();
      if (!result.ok) {
        button.disabled = false;
        button.textContent = active || billingProblem ? "Manage billing" : "Explore plans";
        const error = document.createElement("p");
        error.className = "acct-msg err";
        error.textContent = result.message || "Billing is not available yet.";
        node.appendChild(error);
      }
    });
  } catch {
    if (!node.isConnected) return;
    node.innerHTML = `<span class="acct-tier">MEMBERSHIP</span>
      <b>Payments are being configured</b>
      <p>Your scans and account still work. Max checkout will appear after the payment setup is complete.</p>`;
  }
}

// --- helpers --------------------------------------------------------------

function say(node: HTMLElement, text: string, kind: "err" | "ok"): void {
  node.textContent = text;
  node.className = `acct-msg ${kind}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c,
  );
}

// Re-exported so a caller can gate on it without importing engine/auth too.
export { isAuthAvailable };
