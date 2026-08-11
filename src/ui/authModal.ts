import {
  currentUser,
  deleteAccount,
  isAuthAvailable,
  onAuthChange,
  signIn,
  signInWithLink,
  signOut,
  signUp,
} from "../engine/auth.ts";
import {
  consumeCheckoutResult,
  hasMaxAccess,
  loadEntitlement,
  openBillingPortal,
  startMaxCheckout,
} from "../engine/entitlement.ts";
import type { User } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// The account modal, and the header button that opens it.
//
// This whole module is inert without Supabase keys: mountAccountButton() does
// nothing and leaves no button, so a build with no keys is byte-for-byte the
// product it was before accounts existed. The moment the two env vars are set
// the button appears and the modal works, with no code change.
//
// An account is deliberately small here. Signed out, the app is complete: a
// scan runs on device and the history lives in localStorage. Signing in buys
// exactly two things — history that follows you to another device, and an
// identity to hang a subscription on later — and the copy says so rather than
// pretending an account is required.
// ---------------------------------------------------------------------------

let overlay: HTMLDivElement | null = null;

// Mode of the form inside the modal when signed out.
type Mode = "link" | "password" | "signup";

function initials(email: string): string {
  return email.trim().slice(0, 1).toUpperCase() || "•";
}

export function mountAccountButton(): void {
  if (!isAuthAvailable()) return;
  const right = document.querySelector(".topbar-right");
  if (!right) return;

  const btn = document.createElement("button");
  btn.className = "acct-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Account");
  btn.textContent = "Sign in";
  right.appendChild(btn);

  btn.addEventListener("click", () => openAccount());

  // Keep the header pill in step with the session: a bare "Sign in" when out,
  // the email's initial in a disc when in. onAuthChange fires on load too, so
  // this also restores a returning, already-signed-in visitor.
  const checkoutResult = consumeCheckoutResult();
  let checkoutHandled = false;
  onAuthChange((user) => {
    if (user?.email) {
      btn.textContent = "";
      btn.classList.add("in");
      btn.title = user.email;
      const disc = document.createElement("span");
      disc.className = "acct-disc";
      disc.textContent = initials(user.email);
      btn.replaceChildren(disc);
    } else {
      btn.classList.remove("in");
      btn.title = "";
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

export async function openAccount(notice?: string): Promise<void> {
  if (!isAuthAvailable()) return;
  close();
  const user = await currentUser();
  overlay = document.createElement("div");
  overlay.className = "hist-overlay acct-overlay";
  overlay.innerHTML = `<div class="hist-panel acct-panel">
    <button class="hist-close" aria-label="Close">✕</button>
    <div class="acct-body"></div>
  </div>`;
  const body = overlay.querySelector(".acct-body") as HTMLElement;
  if (user) renderSignedIn(body, user, notice);
  else renderSignedOut(body, "link");

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".hist-close")?.addEventListener("click", () => close());
  document.addEventListener("keydown", escClose);
  document.body.appendChild(overlay);
}

function escClose(ev: KeyboardEvent): void {
  if (ev.key === "Escape") close();
}

function close(): void {
  document.removeEventListener("keydown", escClose);
  overlay?.remove();
  overlay = null;
}

// --- signed out -----------------------------------------------------------

function renderSignedOut(body: HTMLElement, mode: Mode): void {
  const isSignup = mode === "signup";
  const isLink = mode === "link";
  const title = isLink ? "Sign in" : isSignup ? "Create an account" : "Sign in";

  body.innerHTML = `
    <h2>${title}</h2>
    <p class="acct-lede">Your scans are saved on this device already. An account carries
      them to your phone or a new browser, and nothing else changes: every scan still runs
      on your device, and nothing is uploaded but the numbers.</p>
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
      <p class="acct-msg" role="status"></p>
      <button type="submit" class="btn pri acct-submit">${
        isLink ? "Email me a sign-in link" : isSignup ? "Create account" : "Sign in"
      }</button>
    </form>
    <div class="acct-switch">
      ${
        isLink
          ? `<button type="button" data-mode="password">Use a password instead</button>
             <button type="button" data-mode="signup">Create an account</button>`
          : isSignup
            ? `<button type="button" data-mode="link">Email me a link instead</button>
               <button type="button" data-mode="password">I already have an account</button>`
            : `<button type="button" data-mode="link">Email me a link instead</button>
               <button type="button" data-mode="signup">Create an account</button>`
      }
    </div>`;

  const form = body.querySelector(".acct-form") as HTMLFormElement;
  const msg = body.querySelector(".acct-msg") as HTMLElement;
  const submit = body.querySelector(".acct-submit") as HTMLButtonElement;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    if (!email) {
      say(msg, "Enter your email.", "err");
      return;
    }
    submit.disabled = true;
    submit.textContent = "Working…";
    const res = isLink
      ? await signInWithLink(email)
      : isSignup
        ? await signUp(email, password)
        : await signIn(email, password);
    submit.disabled = false;

    if (!res.ok) {
      submit.textContent = isLink ? "Email me a sign-in link" : isSignup ? "Create account" : "Sign in";
      say(msg, res.message || "Something went wrong.", "err");
      return;
    }
    if (isLink || res.needsConfirmation) {
      // Both the magic link and a confirm-email signup end the same way: go
      // check your inbox. The modal stays open with the instruction rather
      // than closing on an action that has not finished.
      body.innerHTML = `<h2>Check your email</h2>
        <p class="acct-lede">We sent a link to <b>${escapeHtml(email)}</b>. Open it on this
          device to finish${isLink ? " signing in" : " and confirm your account"}. You can
          close this and keep using the app.</p>
        <button type="button" class="btn gho acct-done">Done</button>`;
      body.querySelector(".acct-done")?.addEventListener("click", () => close());
      return;
    }
    // Password sign-in / instant signup: onAuthChange repaints the header,
    // re-render the modal to the signed-in state.
    const u = await currentUser();
    if (u) renderSignedIn(body, u);
    else close();
  });

  for (const b of body.querySelectorAll<HTMLButtonElement>(".acct-switch button")) {
    b.addEventListener("click", () => renderSignedOut(body, b.dataset.mode as Mode));
  }
}

// --- signed in ------------------------------------------------------------

function renderSignedIn(body: HTMLElement, user: User, notice?: string): void {
  body.innerHTML = `
    <h2>Your account</h2>
    <div class="acct-who">
      <span class="acct-disc lg">${initials(user.email || "?")}</span>
      <div>
        <b>${escapeHtml(user.email || "Signed in")}</b>
        <span>Your scans sync to this account.</span>
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
      <p>This permanently removes your account and any synced scans. Scans stored on this
        device stay until you clear your browser. This cannot be undone.</p>
      <button type="button" class="acct-delete">Delete account permanently</button>
    </details>`;

  const msg = body.querySelector(".acct-msg") as HTMLElement;
  const membership = body.querySelector(".acct-membership") as HTMLElement;
  void renderMembership(membership, notice?.startsWith("Payment received") ?? false);

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

async function renderMembership(node: HTMLElement, waitForWebhook: boolean): Promise<void> {
  try {
    let entitlement = await loadEntitlement();
    for (let attempt = 0; waitForWebhook && !hasMaxAccess(entitlement) && attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (!node.isConnected) return;
      entitlement = await loadEntitlement();
    }
    if (!node.isConnected) return;

    const active = hasMaxAccess(entitlement);
    const billingProblem = entitlement.status === "past_due" || entitlement.status === "unpaid";
    const period = entitlement.currentPeriodEnd
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(entitlement.currentPeriodEnd))
      : null;
    const detail = active
      ? entitlement.cancelAtPeriodEnd && period
        ? `Max stays active until ${period}; cancellation is scheduled.`
        : period
          ? `Max is active. Your current billing period ends ${period}.`
          : "Max is active on this account."
      : billingProblem
        ? "Stripe could not renew Max. Update your payment method to restore access."
        : waitForWebhook
          ? "Stripe has not confirmed the subscription yet. Reopen your account in a moment."
          : "Free includes scanning, results and device-local progress.";

    node.innerHTML = `
      <span class="acct-tier">${active ? "TRUEMAX MAX" : "FREE"}</span>
      <b>${active ? "Max membership" : billingProblem ? "Billing needs attention" : "Free plan"}</b>
      <p>${detail}</p>
      <button type="button" class="btn ${active || billingProblem ? "gho" : "pri"} acct-billing">
        ${active || billingProblem ? "Manage billing" : "Upgrade to Max"}
      </button>`;

    const button = node.querySelector(".acct-billing") as HTMLButtonElement;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = active || billingProblem ? "Opening billing…" : "Opening secure checkout…";
      const result = active || billingProblem
        ? await openBillingPortal()
        : await startMaxCheckout();
      if (!result.ok) {
        button.disabled = false;
        button.textContent = active || billingProblem ? "Manage billing" : "Upgrade to Max";
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
