import { loadEntitlement, openBillingPortal, startMaxCheckout } from "../engine/entitlement.js";
import type { Entitlement } from "../engine/entitlement.js";
import { maxCharacterMarkup, wireMaxInteractions } from "./maxCharacter.js";
import { openMaxChat } from "./maxChat.js";
import { MAX_MONTHLY } from "./onboardingFunnel.js";

// ---------------------------------------------------------------------------
// The Max tab on the dashboard.
//
// Two very different rooms behind one door, decided by what the account holds:
//
//   PAID Max — the tab is the front door to the chat. A composer sits at the
//   bottom exactly like the chat's own; touching it opens the real thing. No
//   blur, no sell, because the person standing here has already bought it.
//
//   ADULT, NOT PAID — the tab shows the room through frosted glass: a blurred
//   sample conversation with a live composer underneath. Nothing blocks the
//   click, and that is deliberate — the moment somebody TYPES, the upgrade
//   sheet rises with the benefits and the price. Typing is the show of intent
//   that earns the sell; merely looking never triggers it. The sample lines
//   are written here and blurred on purpose: they demonstrate the register of
//   the product without inventing a single number about the reader's face.
//
// The tab only exists for adults (or paid Max accounts, which the checkout
// already restricts to adults). Minors never see the door — the dashboard
// simply does not render the button — because a blurred advertisement for an
// 18+ product shown to a fifteen-year-old is still an advertisement.
//
// PRICING in the sheet is framed off the live entitlement, loaded lazily the
// first time the sheet is needed:
//
//   free     → the full Max price with the 7-day trial, straight to Checkout.
//   starter  → the DIFFERENCE, "on top of what you already pay", and the CTA
//              opens the Stripe billing portal, where switching plans prorates
//              automatically. The checkout endpoint deliberately refuses a
//              second subscription, so the portal is the only honest route —
//              a member must never be sold a second membership.
//
// If the entitlement read fails the sheet falls back to the free framing,
// which quotes the full price. Overstating the cost on a network blip is the
// survivable direction of that error; understating it is a bait-and-switch.
// ---------------------------------------------------------------------------

// What the blurred preview says. Generic on purpose: it is a demonstration of
// how Max talks, not a claim about the reader, so it must not contain a score,
// a percentile, or a named weakness anybody could mistake for their own.
const PREVIEW = [
  { who: "you", text: "What should I actually focus on first?" },
  {
    who: "max",
    text: "One thing at a time. Your scan ranks every measurement, so we start where the movement is cheapest and the payoff is visible.",
  },
  { who: "you", text: "How long until it shows?" },
  {
    who: "max",
    text: "Weeks, not days: and I will tell you straight whether it moved, because I re-read the same numbers every scan.",
  },
];

const BENEFITS = [
  "Unlimited chats with Coach Max about your numbers",
  "Coach Max's written analysis on every scan",
  "Step-by-step plans, catered to you",
  "Scan up to 50 other people a week",
];

export function maxTabMarkup(paid: boolean): string {
  const composer = `
    <form class="maxtab-composer" autocomplete="off">
      <input type="text" name="q" placeholder="Ask Coach Max something" maxlength="600" autocomplete="off" />
      <button type="submit">Send</button>
    </form>`;

  if (paid) {
    return `<div class="maxtab">
      <div class="maxtab-stage">
        <span class="maxtab-face">${maxCharacterMarkup({ mood: "happy", waving: true })}</span>
        <h2>Ask Coach Max anything</h2>
        <p>He has read every measurement in your scans. Plans, priorities, what moved and what did not: that is what he is for.</p>
      </div>
      ${composer}
    </div>`;
  }

  const bubbles = PREVIEW.map(
    (line) => `<p class="maxtab-msg maxtab-${line.who}">${line.text}</p>`,
  ).join("");
  return `<div class="maxtab locked">
    <div class="maxtab-head">
      <span class="maxtab-face small">${maxCharacterMarkup({ mood: "happy" })}</span>
      <span class="maxtab-who"><b>Coach Max</b><small>Reads your numbers. Does not make them up.</small></span>
      <span class="maxtab-badge">18+</span>
    </div>
    <div class="maxtab-preview" aria-hidden="true" inert>${bubbles}</div>
    ${composer}
    <div class="maxtab-paywall" hidden>
      <div class="maxtab-paywall-card">
        <span class="maxtab-paywall-face">${maxCharacterMarkup({ mood: "excited" })}</span>
        <h3>Coach Max comes with the Max plan</h3>
        <ul>${BENEFITS.map((b) => `<li>${b}</li>`).join("")}</ul>
        <p class="maxtab-price" data-price></p>
        <button type="button" class="btn maxtab-cta" data-cta></button>
        <p class="maxtab-status" role="status"></p>
        <button type="button" class="linkish maxtab-later">Not now</button>
      </div>
    </div>
  </div>`;
}

// The paid greeting is honest about what the dashboard chat can see: the full
// measurement context is built on the results screen, so from here Max offers
// the conversation rather than pretending to have the table open.
const TAB_GREETING =
  "Hey, I'm Max. Ask me anything: and open a scan if you want me talking through your exact numbers.";

export function wireMaxTab(panel: HTMLElement, opts: { paid: boolean }): void {
  const root = panel.querySelector<HTMLElement>(".maxtab");
  if (!root) return;
  wireMaxInteractions(root.querySelector<HTMLElement>(".maxtab-face"));

  const form = root.querySelector<HTMLFormElement>(".maxtab-composer")!;
  const input = form.querySelector<HTMLInputElement>("input")!;

  if (opts.paid) {
    // Any intent — focus, tap, submit — opens the real chat. The composer here
    // is a doorknob shaped like the door.
    const open = () => {
      input.blur();
      openMaxChat(null, { greeting: TAB_GREETING });
    };
    input.addEventListener("focus", open);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      open();
    });
    return;
  }

  const paywall = root.querySelector<HTMLElement>(".maxtab-paywall")!;
  const status = paywall.querySelector<HTMLElement>(".maxtab-status")!;
  const price = paywall.querySelector<HTMLElement>("[data-price]")!;
  const cta = paywall.querySelector<HTMLButtonElement>("[data-cta]")!;
  let framed = false;

  // The sheet never waits on the network: it opens quoting the full price,
  // and the entitlement read — kicked off on first raise — only ever improves
  // the copy to the Starter difference. A read that fails or never returns
  // leaves the full price standing, which is the survivable direction of the
  // error; a sheet with a blank where the cost should be is not a sheet.
  function applyFraming(upgrading: boolean): void {
    if (upgrading) {
      // The MAX price, and a promise about the difference — never a computed
      // difference figure. Subtracting two hardcoded constants publishes a
      // number this client cannot actually verify: the Starter constant lives
      // here, the real amount lives in Stripe, and the two have already
      // disagreed once ($7.99 on the plan card against $6.99 in the portal).
      // Stripe prorates the switch and shows the exact amount on the screen
      // the button opens, so the honest thing to state here is the plan's
      // price and the fact that the existing plan is credited against it.
      price.innerHTML = `<b>$${MAX_MONTHLY.toFixed(2)}<small> USD / month</small></b>: and what you already pay for Starter comes off it. Not a second membership:
        your plan switches over and billing adjusts automatically, so you only pay the
        difference. Stripe shows you the exact amount before you confirm.`;
      cta.textContent = "Add Max to my plan";
      cta.onclick = async () => {
        cta.disabled = true;
        status.textContent = "Opening your billing…";
        const result = await openBillingPortal();
        if (!result.ok) {
          status.textContent = result.message ?? "Billing is not available yet.";
          cta.disabled = false;
        }
      };
    } else {
      price.innerHTML = `<b>$${MAX_MONTHLY.toFixed(2)}<small> USD / month</small></b>
        after 7 days free. Cancel before the trial ends and you pay $0.`;
      cta.textContent = "Try Max free for 7 days";
      cta.onclick = async () => {
        cta.disabled = true;
        status.textContent = "Opening secure Checkout…";
        const result = await startMaxCheckout();
        if (!result.ok) {
          status.textContent = result.message ?? "Checkout is not available yet.";
          cta.disabled = false;
        }
      };
    }
  }

  const raise = () => {
    if (!paywall.hidden) return;
    paywall.hidden = false;
    input.blur();
    if (framed) return;
    framed = true;
    applyFraming(false);
    void loadEntitlement()
      .then((entitlement: Entitlement) => {
        const upgrading =
          entitlement.tier === "starter" &&
          (entitlement.status === "active" || entitlement.status === "trialing");
        // Not while a click is mid-flight: swapping the handler under a
        // pressed button would send somebody down both billing paths.
        if (upgrading && !cta.disabled) applyFraming(true);
      })
      .catch(() => undefined);
  };

  // Typing is the trigger; clicking into the field is not. Somebody may click
  // around a blurred screen just to see what is interactive, and punishing
  // curiosity with a sales sheet is how a paywall starts to feel like a trap.
  input.addEventListener("input", raise);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    raise();
  });

  paywall.querySelector<HTMLButtonElement>(".maxtab-later")!.onclick = () => {
    paywall.hidden = true;
    input.value = "";
  };
  paywall.addEventListener("click", (event) => {
    if (event.target === paywall) {
      paywall.hidden = true;
      input.value = "";
    }
  });
}
