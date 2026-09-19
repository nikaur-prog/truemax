import {
  hasMaxOrStaffAccess,
  loadIsAdmin,
  openBillingPortal,
  recoverMaxEntitlement,
  startMaxCheckout,
} from "../engine/entitlement.js";
import type { Entitlement } from "../engine/entitlement.js";
import { maxCharacterMarkup, wireMaxInteractions } from "./maxCharacter.js";
import { mountMaxAvatar3D } from "./maxAvatar3d.js";
import { openMaxChat } from "./maxChat.js";
import { MAX_MONTHLY } from "./onboardingFunnel.js";
import { readProtocols } from "../engine/protocol.js";
import { mountDailyTicks, mountProtocolCard } from "./protocolCard.js";
import { announceMembershipBrand } from "./membershipBrand.js";
import {
  MAX_CONVERSATIONS_CHANGED,
  listMaxConversations,
  syncMaxPlanItems,
  mostRecentCoachConversation,
} from "../engine/maxConversations.js";
import type { MaxConversationSummary, MaxPlanItem } from "../engine/maxConversations.js";
import { MAX_DAILY_MESSAGES } from "../engine/maxAllowance.js";
import { buildCoachingSnapshot, contextFromStoredScan } from "../engine/maxContext.js";
import { loadProfile } from "../engine/goals.js";
import { activeScanOwner } from "../engine/scanScope.js";
import type { MaxChatContext } from "../engine/maxContext.js";
import { ownScans, readAllHistory, readOwnComparableHistory } from "../engine/history.js";
import { DEFAULT_VERDICT_TONE, loadVerdictTone } from "../engine/analysisMode.js";

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
    text: "Start with the goal you care about most. Then choose a routine you can follow consistently. A low measurement alone is not a reason to change something.",
  },
  { who: "you", text: "How long until it shows?" },
  {
    who: "max",
    text: "That depends on the routine. We can record when you start and review your experience alongside comparable scans, without treating a photo change as proof it worked.",
  },
];

const BENEFITS = [
  `Up to ${MAX_DAILY_MESSAGES} messages a day with Coach Max about your numbers`,
  "Coach Max's written analysis on every scan",
  "Step-by-step plans, catered to you",
  "Scan up to 50 other people a week",
];

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function performanceItems(memory: readonly MaxPlanItem[] = []): string {
  const active = readProtocols().filter((protocol) => protocol.status !== "declined" && protocol.status !== "judged");
  const local = active.map((protocol) => ({
    title: protocol.title,
    state: protocol.status === "running"
      ? "In progress"
      : protocol.status === "committed"
        ? "Ready to start"
        : "Waiting for your choice",
  }));
  const seen = new Set(local.map((item) => item.title.trim().toLocaleLowerCase("en-US")));
  const remote = memory
    .filter((item) => !seen.has(item.title.trim().toLocaleLowerCase("en-US")))
    .map((item) => ({
      title: item.title,
      state: item.status === "not_working"
        ? "Saved note: you reported a problem"
        : item.status === "paused"
          ? "Saved note: paused"
          : "Saved chat note, not a tracked routine",
    }));
  const items = [...local, ...remote];
  if (!items.length) {
    return `<p class="maxtab-tracker-empty">Nothing is being tracked yet. Choose an action from your TrueMax plan and it will appear here.</p>`;
  }
  return `<div class="maxtab-tracker-list">${items.map((item) => {
    return `<div class="maxtab-tracker-row"><b>${escapeHTML(item.title)}</b><span>${item.state}</span></div>`;
  }).join("")}</div>`;
}

function performanceTrackerMarkup(): string {
  return `<section class="maxtab-tracker" aria-labelledby="maxtab-tracker-title">
    <span class="klabel">PERFORMANCE TRACKER</span>
    <h3 id="maxtab-tracker-title">Your current plan</h3>
    <p>Check-ins and follow-ups live here, separate from the analysis of a new scan.</p>
    <div data-performance-ticks></div>
    <div data-performance-due></div>
    <div data-performance-items>${performanceItems()}</div>
  </section>`;
}

function conversationHistoryMarkup(): string {
  return `<section class="maxtab-history" aria-labelledby="maxtab-history-title">
    <header><div><span class="klabel">CONVERSATIONS</span><h3 id="maxtab-history-title">Your Max chats</h3></div>
      <button type="button" class="linkish" data-max-new>New chat</button></header>
    <div class="maxtab-history-list" data-max-history><p class="maxtab-history-empty">Loading your chats…</p></div>
  </section>`;
}

export function maxTabMarkup(paid: boolean): string {
  const composer = `
    <form class="maxtab-composer" autocomplete="off">
      <input type="text" name="q" placeholder="Ask Coach Max something" maxlength="600" autocomplete="off" />
      <button type="submit">Send</button>
    </form>`;

  if (paid) {
    return `<div class="maxtab">
      <div class="maxtab-stage">
        <span class="maxtab-face">${maxCharacterMarkup({ mood: "happy" })}</span>
        <h2>Ask Coach Max anything</h2>
        <p>Discuss your goals, current routine and available scan readings. Keep the plan practical and review what you have actually tried.</p>
        <div class="maxtab-plan-actions"><button type="button" class="btn primary" data-build-plan>Build my plan</button><button type="button" class="btn" data-choose-routines>Choose routines</button></div>
      </div>
      ${conversationHistoryMarkup()}
      ${performanceTrackerMarkup()}
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

// What the dashboard chat can see: the owner's latest scan, from the stored
// row. The tab used to open the chat with no context and a greeting that
// hinted otherwise, so the first question a member asked here was answered by
// a model that had never seen their numbers. Now the scores, pillars and
// region standings travel with the chat; the metric table stays on the scan
// itself, and the greeting says which scan is open rather than implying more.
function dashboardContext(): { context: MaxChatContext | null; greeting: string } {
  const own = readOwnComparableHistory()
    .filter((scan) => Number.isFinite(new Date(scan.date).getTime()))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const latest = own[0];
  if (!latest) {
    return {
      context: null,
      greeting: "Ask about your goals or current routine. A completed scan adds measurement context.",
    };
  }
  const activePlan = readProtocols()
    .filter((protocol) => protocol.status !== "declined" && protocol.status !== "judged")
    .map((protocol) => `${protocol.title}: ${protocol.status}`);
  const context = contextFromStoredScan({
    latest,
    previous: own[1] ?? null,
    tone: loadVerdictTone() ?? DEFAULT_VERDICT_TONE,
    scans: ownScans(readAllHistory()).length,
    // The tab only reaches this function on the paid side of the gate.
    includePotential: true,
    activePlan,
  });
  const when = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(latest.date));
  return {
    context,
    greeting: `Latest scan: ${when}. This view includes summary scores; open the full report for individual measurements.`,
  };
}

export function wireMaxTab(panel: HTMLElement, opts: { paid: boolean }): void {
  const root = panel.querySelector<HTMLElement>(".maxtab");
  if (!root) return;
  if (opts.paid) mountMaxAvatar3D(root.querySelector<HTMLElement>(".maxtab-stage .maxtab-face"), { state: "idle" });
  else wireMaxInteractions(root.querySelector<HTMLElement>(".maxtab-face"));

  const form = root.querySelector<HTMLFormElement>(".maxtab-composer")!;
  const input = form.querySelector<HTMLInputElement>("input")!;

  if (opts.paid) {
    const items = root.querySelector<HTMLElement>("[data-performance-items]");
    mountDailyTicks(root.querySelector<HTMLElement>("[data-performance-ticks]"));
    mountProtocolCard(root.querySelector<HTMLElement>("[data-performance-due]"), null, () => {
      if (items) items.innerHTML = performanceItems();
      // Starting a protocol adds its tick immediately; judging removes it.
      mountDailyTicks(root.querySelector<HTMLElement>("[data-performance-ticks]"));
    });
    // Let the composer work as an actual text field. Opening on focus used to
    // discard typed questions and could reopen chat when focus returned on close.
    const owner = activeScanOwner();
    root.querySelector<HTMLButtonElement>("[data-build-plan]")?.addEventListener("click", async () => {
      try {
        const { openMaxPlanBrief } = await import("./maxPlanBrief.js");
        if (!root.isConnected || owner !== activeScanOwner()) return;
        openMaxPlanBrief((question) => {
          if (!root.isConnected || owner !== activeScanOwner()) return;
          const latest = dashboardContext();
          openMaxChat(latest.context, { source: "dashboard", initialQuestion: question, greeting: latest.greeting });
        });
      } catch {
        const slot = root.querySelector<HTMLElement>("[data-max-history]");
        if (slot && root.isConnected && owner === activeScanOwner()) slot.textContent = "The plan builder could not load. Try again.";
      }
    });
    root.querySelector<HTMLButtonElement>("[data-choose-routines]")?.addEventListener("click", async () => {
      try {
        const { openMaxRoutinePicker } = await import("./maxRoutinePicker.js");
        if (root.isConnected && owner === activeScanOwner()) openMaxRoutinePicker();
      } catch {
        const slot = root.querySelector<HTMLElement>("[data-max-history]");
        if (slot && root.isConnected && owner === activeScanOwner()) slot.textContent = "Routine options could not load. Try again.";
      }
    });
    let opening = false;
    const open = async (fresh = false, initialQuestion?: string) => {
      if (opening) return;
      opening = true;
      const submittedDraft = input.value;
      input.blur();
      try {
        const saved = fresh ? undefined : mostRecentCoachConversation((await listMaxConversations()).conversations);
        if (!root.isConnected || owner !== activeScanOwner()) return;
        const latest = dashboardContext();
        const opened = openMaxChat(latest.context, { greeting: latest.greeting, source: "dashboard", conversationId: saved?.id, initialQuestion });
        // Preserve edits made during the history request, and drafts that were
        // not delivered because another action opened a chat first.
        if (opened && initialQuestion && input.value === submittedDraft) input.value = "";
      } catch {
        const slot = root.querySelector<HTMLElement>("[data-max-history]");
        if (slot && owner === activeScanOwner()) slot.textContent = "Your recent chat could not load. Try again, or choose New chat.";
      } finally { opening = false; }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (input.value.trim()) void open(false, input.value.trim());
    });

    root.querySelector<HTMLButtonElement>("[data-max-new]")?.addEventListener("click", () => { void open(true); });
    const history = root.querySelector<HTMLElement>("[data-max-history]");
    const renderHistory = (conversations: readonly MaxConversationSummary[]): void => {
      if (!history) return;
      history.innerHTML = "";
      if (!conversations.length) {
        history.innerHTML = `<p class="maxtab-history-empty">No saved chats yet. Your first conversation will appear here automatically.</p>`;
        return;
      }
      for (const conversation of conversations) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "maxtab-history-row";
        const when = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
          .format(new Date(conversation.last_message_at));
        button.innerHTML = `<span><b>${escapeHTML(conversation.title)}</b><small>${conversation.source === "post_analysis" ? "Post-analysis" : "Coach"} · ${when}</small></span><i aria-hidden="true">›</i>`;
        button.onclick = () => {
          if (!panel.isConnected || activeScanOwner() !== owner) return;
          const latest = dashboardContext();
          openMaxChat(latest.context, {
            conversationId: conversation.id,
            source: conversation.source,
            greeting: latest.greeting,
          });
        };
        history.appendChild(button);
      }
    };
    const refresh = (): void => {
      void listMaxConversations()
        .then((result) => {
          if (!panel.isConnected || activeScanOwner() !== owner) return;
          renderHistory(result.conversations);
          if (items) items.innerHTML = performanceItems(result.planItems);
          mountDailyTicks(root.querySelector<HTMLElement>("[data-performance-ticks]"));
          mountProtocolCard(root.querySelector<HTMLElement>("[data-performance-due]"), null, () => {
            if (items) items.innerHTML = performanceItems(result.planItems);
            mountDailyTicks(root.querySelector<HTMLElement>("[data-performance-ticks]"));
          });
          const restoration = result.routineRestoration;
          if (restoration?.error || restoration?.historyPartial) {
            const note = document.createElement("p");
            note.className = "maxtab-history-empty";
            note.textContent = restoration.error ?? "Routines restored from your account include recent check-ins, not a complete daily history.";
            items?.append(note);
          }
        })
        .catch((error) => {
          if (!history || !panel.isConnected || activeScanOwner() !== owner) return;
          history.innerHTML = `<p class="maxtab-history-empty">${escapeHTML(error instanceof Error ? error.message : "Your chats could not be loaded.")}</p>`;
        });
    };
    const onChanged = (): void => {
      if (!panel.isConnected) {
        window.removeEventListener(MAX_CONVERSATIONS_CHANGED, onChanged);
        return;
      }
      refresh();
    };
    window.addEventListener(MAX_CONVERSATIONS_CHANGED, onChanged);
    const localPlan = buildCoachingSnapshot(loadProfile(), readProtocols()).routines;
    void syncMaxPlanItems(localPlan).catch(() => undefined).finally(refresh);
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
    cta.disabled = true;
    cta.textContent = "Checking your Max access…";
    price.textContent = "Checking the subscription already attached to this account.";
    status.textContent = "";
    void Promise.all([
      recoverMaxEntitlement(),
      loadIsAdmin().catch(() => false),
    ])
      .then(([entitlement, staff]: [Entitlement, boolean]) => {
        if (!panel.isConnected) return;
        if (hasMaxOrStaffAccess(entitlement, staff)) {
          const question = input.value.trim();
          announceMembershipBrand("max");
          panel.innerHTML = maxTabMarkup(true);
          wireMaxTab(panel, { paid: true });
          const latest = dashboardContext();
          openMaxChat(latest.context, { greeting: latest.greeting, initialQuestion: question || undefined, source: "dashboard" });
          return;
        }
        const upgrading =
          entitlement.tier === "starter" &&
          (entitlement.status === "active" || entitlement.status === "trialing");
        applyFraming(upgrading);
        cta.disabled = false;
      })
      .catch(() => {
        if (!panel.isConnected) return;
        applyFraming(false);
        cta.disabled = false;
        status.textContent = "We could not confirm an existing Max subscription just now.";
      })
      .finally(() => undefined);
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
