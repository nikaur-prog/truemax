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
  reconcileEntitlement,
} from "../engine/entitlement.js";
import type { User } from "@supabase/supabase-js";
import { renderAuthForm } from "./authForm.js";
import { scoreTone } from "./scoreTone.js";
import type { AuthMode } from "./authForm.js";
import { announceMembershipBrand } from "./membershipBrand.js";
import { openTrialFunnel } from "./onboardingFunnel.js";
import { isNativeApp } from "../engine/platform.js";
import { loadAvatar, onAvatarChange } from "../engine/avatar.js";

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
let overlayUserId: string | null = null;
const reconciledUsers = new Set<string>();

export interface OpenAccountOptions {
  notice?: string;
  checkoutSessionId?: string | null;
  initialMode?: AuthMode;
  reason?: "account" | "analysis";
  /**
   * The computed-but-locked result, shown INSIDE the modal as a blurred chip.
   *
   * The gate already blurs the full result behind this dialog, and on a phone
   * the dialog covers all of it — so at the exact moment somebody is asked to
   * type an email, the thing they would be typing it FOR is invisible. The
   * chip is the same promise at the same fidelity as the preview underneath:
   * the real number, unreadable, present.
   */
  teaser?: {
    overall: number;
    regionCount: number;
    /** The two captured photographs, as small data URLs. */
    front?: string | null;
    side?: string | null;
    /** Region label and score, in report order. */
    regions?: ReadonlyArray<{ label: string; score: number }>;
  };
  onAuthenticated?: (user: User) => void | Promise<void>;
  onDeferred?: () => void | Promise<void>;
}

/**
 * The finished-but-locked scan, shown rather than described.
 *
 * The first version of this was a label, a blurred number, and a sentence:
 * "YOUR RESULT · COMPUTED ON THIS DEVICE" over a grey smudge. Which is
 * exactly as persuasive as it sounds — a person who has just photographed
 * their face twice cannot tell from that whether anything happened at all, so
 * the box read as decoration on a paywall rather than as their own result
 * sitting behind it.
 *
 * So it shows the thing. Their two photographs, the number under them, and
 * the eight region scores as a grid. Three different treatments, and each one
 * is deliberate:
 *
 *   the faces   lightly blurred — enough to read as locked, not so much that
 *               you cannot recognise your own head, which is the whole point
 *   the score   heavily blurred, and COLOURED
 *   the grid    heavily blurred, and coloured
 *
 * The colour is what makes this work. Blur destroys the digits and leaves the
 * hue completely intact, so somebody sees a green number over a grid of mostly
 * green cells with two amber ones, and knows precisely how much they want to
 * read it. That is a real tease rather than a grey rectangle claiming to be
 * one — and it gives nothing away that is not already theirs, on their own
 * device, computed before the dialog opened.
 *
 * aria-hidden and inert throughout: a screen reader announcing the real digits
 * would unblur the whole thing for exactly the people the blur is meant to
 * treat the same as everybody else.
 */
function teaserMarkup(t: NonNullable<OpenAccountOptions["teaser"]>): string {
  const face = (src: string | null | undefined, label: string) =>
    src ? `<figure class="acct-face"><img src="${src}" alt="" /><figcaption>${label}</figcaption></figure>` : "";
  const faces = [face(t.front, "FRONT"), face(t.side, "SIDE")].filter(Boolean).join("");
  const grid = (t.regions ?? [])
    .slice(0, 8)
    .map(
      (r) => `<div class="acct-cell tone-${scoreTone(r.score)}">
        <span>${r.label}</span><b>${r.score.toFixed(1)}</b>
      </div>`,
    )
    .join("");

  return `<aside class="acct-teaser" aria-hidden="true" inert>
    <span class="acct-teaser-k">YOUR SCAN · MEASURED ON THIS DEVICE</span>
    ${faces ? `<div class="acct-faces">${faces}</div>` : ""}
    <div class="acct-teaser-score tone-${scoreTone(t.overall)}">
      <b>${t.overall.toFixed(1)}</b><small>/10</small>
    </div>
    ${grid ? `<div class="acct-cells">${grid}</div>` : ""}
    <em>${t.regionCount} regions measured. It unlocks the moment you are in.</em>
  </aside>`;
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
  // The disc shows the person's own face when the account has one — that is
  // the profile picture the scan adopts — and the email initial until then.
  // Painted from a helper because it has two triggers: the auth change, and
  // the avatar being written LATER (the first scan of a fresh account adopts
  // its face after this button already rendered).
  let signedInEmail: string | null = null;
  const paintDisc = () => {
    if (!signedInEmail) return;
    const face = loadAvatar();
    if (face) {
      const img = document.createElement("img");
      img.className = "acct-disc acct-disc-face";
      img.src = face;
      img.alt = "";
      btn.replaceChildren(img);
    } else {
      const disc = document.createElement("span");
      disc.className = "acct-disc";
      disc.textContent = initials(signedInEmail);
      btn.replaceChildren(disc);
    }
  };
  onAvatarChange(paintDisc);
  onAuthChange((user) => {
    if (overlayUserId && overlayUserId !== user?.id) close();
    if (user?.email) {
      signupBtn.classList.add("hidden");
      btn.textContent = "";
      btn.classList.add("in");
      btn.title = user.email;
      btn.setAttribute("aria-label", `Open account for ${user.email}`);
      signedInEmail = user.email;
      paintDisc();
    } else {
      signedInEmail = null;
      signupBtn.classList.remove("hidden");
      btn.classList.remove("in");
      btn.title = "";
      btn.setAttribute("aria-label", "Sign in to TrueMax");
      btn.textContent = "Sign in";
    }
    if (user && checkoutResult && !checkoutHandled) {
      checkoutHandled = true;
      const notice = checkoutResult.status === "success"
        ? "Payment received. We are activating your membership now."
        : "Checkout was cancelled. Nothing was charged.";
      void openAccount({
        notice,
        checkoutSessionId: checkoutResult.status === "success" ? checkoutResult.sessionId : null,
      });
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
    // The finished scan sits beside the form, not above the notice text: a
    // sentence says a result exists, this SHOWS it existing. aria-hidden and
    // inert because a screen reader reading out the real digits would unblur
    // it for exactly the people the blur is supposed to be even-handed with.
    //
    // The form goes in a column of its own rather than straight into the body,
    // because it renders as half a dozen siblings — heading, lede, social
    // buttons, fields — and two columns need two boxes, not one box and a
    // scatter.
    body.innerHTML = "";
    body.classList.toggle("acct-two", Boolean(options.teaser));
    if (options.teaser) body.insertAdjacentHTML("beforeend", teaserMarkup(options.teaser));
    const formCol = document.createElement("div");
    formCol.className = "acct-form-col";
    body.appendChild(formCol);
    renderAuthForm(formCol, {
      initialMode,
      context: options.reason === "analysis" ? "analysis" : "account",
      portalHref: `/auth?mode=${initialMode}`,
      onDeferred: options.onDeferred,
      onAuthenticated: async (signedInUser) => {
        if (options.onAuthenticated) {
          close();
          await options.onAuthenticated(signedInUser);
        } else {
          body.classList.remove("acct-two");
          renderSignedIn(body, signedInUser, options.notice, options.checkoutSessionId);
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
        body.classList.remove("acct-two");
        renderSignedIn(body, lateUser, options.notice, options.checkoutSessionId);
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
  if (user) {
    body.classList.remove("acct-two");
    renderSignedIn(body, user, options.notice, options.checkoutSessionId);
  }
  else {
    renderSignedOut("password");
    void sessionCheck.then((lateUser) => {
      if (lateUser && overlay === activeOverlay && body.isConnected) {
        body.classList.remove("acct-two");
        renderSignedIn(body, lateUser, options.notice, options.checkoutSessionId);
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
  overlayUserId = null;
  document.body.classList.remove("auth-modal-open");
}

// --- signed in ------------------------------------------------------------

function renderSignedIn(
  body: HTMLElement,
  user: User,
  notice?: string,
  checkoutSessionId?: string | null,
): void {
  overlayUserId = user.id;
  body.innerHTML = `
    <h2>Your account</h2>
    <div class="acct-who">
      ${(() => {
        const face = loadAvatar();
        return face
          ? `<img class="acct-disc lg acct-disc-face" src="${face}" alt="" />`
          : `<span class="acct-disc lg">${initials(user.email || "?")}</span>`;
      })()}
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
  void renderMembership(
    membership,
    user,
    notice?.startsWith("Payment received") ?? false,
    checkoutSessionId,
  );

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

async function renderMembership(
  node: HTMLElement,
  user: User,
  waitForWebhook: boolean,
  checkoutSessionId?: string | null,
): Promise<void> {
  try {
    let entitlement = await loadEntitlement();
    if (!hasPaidAccess(entitlement) && (checkoutSessionId || !reconciledUsers.has(user.id))) {
      reconciledUsers.add(user.id);
      const reconciled = await reconcileEntitlement(checkoutSessionId);
      if (!node.isConnected) return;
      if (reconciled) entitlement = await loadEntitlement();
    }
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

    // NO BILLING BUTTON INSIDE THE WRAPPED APP.
    //
    // The offer screen already checks isNativeApp and the purchase chrome is
    // hidden by a .native-app CSS rule, but this button was in neither list, so
    // it was the one purchase surface still reachable in the native build — and
    // the more dangerous of the two states:
    //
    //   "Manage billing" redirects to Stripe's hosted portal, which is an
    //   external purchasing mechanism for a digital subscription. That is the
    //   straightforward version of what App Review rejects.
    //
    //   "Explore plans" opened the trial funnel, which then detects the native
    //   platform and closes itself — so the button did nothing at all. Not a
    //   rejection, but a dead control in the account screen, which a reviewer
    //   is quite likely to tap.
    //
    // Native gets the STATUS and no control. No link either: the entitlement is
    // read from the server and works in the app regardless of where it was
    // bought, so there is nothing a person needs to do from here.
    const native = isNativeApp();
    node.innerHTML = `
      <span class="acct-tier">${active ? `TRUEMAX ${planName.toUpperCase()}` : "FREE"}</span>
      <b>${active ? `${planName} membership` : billingProblem ? "Billing needs attention" : "Free plan"}</b>
      <p>${detail}</p>
      ${
        native
          ? `<p class="acct-msg">${
              active || billingProblem
                ? "Your membership is managed from the account you subscribed with, and applies here automatically."
                : ""
            }</p>`
          : `<button type="button" class="btn ${active || billingProblem ? "gho" : "pri"} acct-billing">
        ${active || billingProblem ? "Manage billing" : "Explore plans"}
      </button>`
      }`;

    const button = node.querySelector(".acct-billing") as HTMLButtonElement | null;
    if (!button) return;
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
