import type { User } from "@supabase/supabase-js";
import { GOALS, QUIET_TOPICS, loadProfile, saveProfile } from "../engine/goals.js";
import {
  DISCOVERY_SOURCES,
  queueOnboardingProfile,
  emptyOnboardingProfile,
  loadOnboardingProfile,
  profileIsAdult,
  saveOnboardingProfile,
  firstUnansweredStep,
  validateOnboardingStep,
} from "../engine/onboarding.js";
import type { OnboardingProfile } from "../engine/onboarding.js";
import { hasPaidAccess, loadEntitlement, openBillingPortal, startTrialCheckout } from "../engine/entitlement.js";
import type { Entitlement } from "../engine/entitlement.js";
import { track } from "../engine/track.js";
import { maxCharacterMarkup, maxLoaderMarkup, reactMax, wireMaxInteractions } from "./maxCharacter.js";
import { typewriteBlock } from "./typewriter.js";
import { isNativeApp } from "../engine/platform.js";
import { METRICS } from "../engine/metrics.js";
import { SIDE_METRICS } from "../engine/sideMetrics.js";

type PlanTier = "starter" | "max";

// The number on the offer screen.
//
// Every subscription page in this category leads with an outcome statistic —
// "members are 4.2x more likely to reach their goal". We cannot write that
// sentence, and not only because it would be tacky: an efficacy claim has to be
// defensible under the Fair Trading Act and at App Store review, and inventing
// one on a product whose entire pitch is "we show the actual math" would be the
// single most expensive sentence in the app.
//
// So the slot holds a number that is true by construction and computed from the
// engine rather than typed here, which means it cannot drift into a lie the way
// the scan narration's "15 side proportions" did after the experimental metrics
// were filtered out.
//
// When there IS outcome data — once scan histories are long enough — the honest
// version of the Duolingo line becomes available and should replace this: the
// median points gained by accounts that scanned N times versus once, measured
// from our own numbers, stated with the sample size next to it. Not before.
const MEASUREMENT_COUNT = METRICS.length + SIDE_METRICS.length;

let host: HTMLDivElement | null = null;

// ---------------------------------------------------------------------------
// Monthly or yearly.
//
// Governs the Max card only — Starter has no yearly price — and it defaults to
// monthly, which is the smaller commitment. The saving is stated as a real
// figure rather than a percentage badge, because "$54 less" is a number
// somebody can check against the two prices on screen and a "-37%" is not.
//
// The weekly equivalent is shown deliberately. Every competitor in this
// category prices weekly, which makes their number look small while extracting
// more over a year: the leader charges $3.99 a week, with no monthly or yearly
// option at all, which is about $207 a year. Monthly TrueMax is $2.77 a week
// and the yearly is $1.73. Saying so is not a trick, it is the same comparison
// the reader would make if they did the arithmetic, done for them.
// ---------------------------------------------------------------------------
export const MAX_MONTHLY = 11.99;
export const MAX_ANNUAL = 89.99;
// Exported for the Max tab's upgrade sheet, which quotes the difference a
// Starter member pays on top of what they already pay. One constant, so the
// plan card here and the upsell there can never disagree about the price.
export const STARTER_MONTHLY = 7.99;

/**
 * The price, anchored against $0.
 *
 * A card that opens with "$7.99 USD / month" asks the reader to weigh a
 * monthly commitment before it has told them the first week costs nothing, so
 * the number they judge the offer on is the wrong one. Struck through, with $0
 * in the position their eye was already going to, the first thing read is what
 * they will actually be charged today. The real rate is not hidden: it is on
 * the card twice over, struck through here and stated plainly in the renewal
 * line under the button.
 *
 * Returns the INNER html of `.plan-top b`, because the billing toggle rewrites
 * that node wholesale and the two used to hold separate copies of the same
 * markup. A card reading one period under a toggle set to the other is the
 * kind of mismatch somebody notices only after being charged, and one function
 * is the only way they cannot drift.
 */
function priceInner(amount: number, period: "month" | "year"): string {
  return `<s class="plan-was">$${amount.toFixed(2)} USD / ${period}</s>`
    + `<span class="plan-now">$0</span>`
    + `<small> for your first 7 days</small>`;
}


/** $X.XX/week for a year priced at yearTotal. */
const weeklyOf = (yearTotal: number) => (yearTotal / 52).toFixed(2);

function billingToggle(): string {
  // Labels only. The toggle used to carry both prices, and sitting above the
  // plan grid it read as a third plan — "$11.99" floating directly over
  // Starter's $7.99. It now lives inside the Max card (the only card it
  // governs) and the prices live where prices live: on the card.
  return `<div class="billtoggle" data-billing="monthly">
    <button type="button" class="bt-opt on" data-set="monthly"><b>Monthly</b></button>
    <button type="button" class="bt-opt" data-set="annual">
      <b>Yearly</b>
      <i class="bt-save">Save $${(MAX_MONTHLY * 12 - MAX_ANNUAL).toFixed(2)}</i>
    </button>
  </div>`;
}

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

function readInputs(profile: OnboardingProfile, root = host): void {
  if (!root) return;
  const value = (id: string) => (root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value || "").trim();
  if (root.querySelector("#trial-first")) {
    profile.firstName = value("trial-first");
    profile.lastName = value("trial-last");
    profile.mobile = value("trial-mobile");
  }
  if (root.querySelector("#trial-dob")) profile.dateOfBirth = value("trial-dob");
  if (root.querySelector("#trial-success")) {
    profile.successOutcome = value("trial-success");
    profile.expectations = value("trial-expectations");
  }
  if (root.querySelector("#trial-strengths")) {
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

// Identity changes override the compulsory-question lock. Keeping a previous
// account's profile panel visible is never an acceptable way to preserve form
// progress; failed saves are already queued under that exact user id.
export function closeTrialFunnel(): void {
  locked = false;
  close();
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
  const activeHost = document.createElement("div");
  host = activeHost;
  const alive = () => host === activeHost && activeHost.isConnected;
  activeHost.className = "trial-overlay";
  activeHost.innerHTML = `<div class="trial-shell trial-loading" role="dialog" aria-modal="true" aria-label="Build your TrueMax pathway">
    ${maxLoaderMarkup("Preparing your pathway")}<p>Preparing your pathway…</p>
  </div>`;
  document.body.appendChild(activeHost);
  document.body.classList.add("funnel-open");
  document.addEventListener("keydown", onKey);

  let profile = preview?.profile ?? emptyOnboardingProfile(user);
  try {
    if (!preview) profile = await loadOnboardingProfile(user);
  } catch {
    if (!alive()) return;
    activeHost.innerHTML = `<div class="trial-shell trial-loading" role="dialog" aria-modal="true">
      <button class="trial-close" type="button" aria-label="Close">✕</button>
      <span class="trial-eyebrow">PATHWAY</span>
      <h2>We couldn't load your profile.</h2>
      <p>Your analysis is safe on this device. Please try again when your connection is stable.</p>
      <button class="btn pri" id="trial-retry" type="button">Try again</button>
    </div>`;
    activeHost.querySelector(".trial-close")?.addEventListener("click", close);
    activeHost.querySelector("#trial-retry")?.addEventListener("click", () => void openTrialFunnel(user));
    return;
  }
  if (!alive()) return;

  const localGoals = loadProfile();
  if (!profile.primaryObjectives.length && localGoals.goals.length) profile.primaryObjectives = [...localGoals.goals];
  if (!profile.quietTopics.length && localGoals.quiet.length) profile.quietTopics = [...localGoals.quiet];

  const total = 6;
  // Open on the first question this profile has not answered, not on step 0.
  //
  // Every one of the six steps re-renders the answer already stored against
  // the account, so a returning person was shown their own name, their own
  // date of birth and their own goals and made to press Continue past each of
  // them. `validateOnboardingStep` is the same predicate the Continue button
  // uses, so "answered" here means exactly what "may proceed" means there and
  // the two cannot drift apart.
  //
  // Steps 4 and 5 are optional, so they always validate; a profile that is
  // complete therefore lands on the last step rather than running off the end,
  // and one Continue reaches the offer. A first run has nothing stored, fails
  // at step 0, and behaves exactly as it always has.
  let step = firstUnansweredStep(profile, total);
  let busy = false;
  // Only lock once the profile has loaded, so a network failure on the way in
  // leaves the retry screen closable rather than trapping somebody in a dialog
  // that cannot succeed.
  locked = required && !preview;

  // The scripted demo conversation. Written here rather than generated: this
  // is a demonstration of what the paid product FEELS like on the screen where
  // the money is asked for, so it must cost nothing, never fail, and never
  // surprise anyone. The question arrives from the person's side of the chat,
  // Max visibly thinks about it — messenger dots, thinking face — and the
  // answer types itself out while his mouth runs. Runs once; a demo that loops
  // on a payment screen becomes a screensaver.
  //
  // One exchange for a long time, which is one exchange too few. People reach
  // this screen more than once — they close it, scan again, come back — and a
  // scripted conversation that replays word for word stops being a
  // demonstration the second time and becomes an advert they have already
  // seen. Worse, a single question can only answer a single objection, and the
  // objections that actually stop someone here are different from each other:
  // can it fix THIS, will it be honest with me, what if nothing moves.
  //
  // So there is a set, and one is drawn per open. Every answer has to survive
  // being read by somebody who then buys — nothing here may promise a number
  // will move, or claim the engine measures something it does not. The
  // constraints are the same ones the report copy works under, because a
  // promise made on the payment screen is the one people hold you to.
  const DEMO_EXCHANGES: ReadonlyArray<{ ask: string; lead: string; body: string }> = [
    {
      ask: "Real talk, can you actually fix my jawline?",
      lead: "If it's soft tissue, yes.",
      body:
        "Your scan tells me exactly which numbers are holding it back. I build your weekly routine around them, and every rescan I tell you straight whether it moved. If it stalls, I rebuild the plan.",
    },
    {
      ask: "My skin is the main thing. Is that even in here?",
      lead: "It is, and it's the part that moves fastest.",
      body:
        "Skin is the one area where weeks of consistent work show up as a visibly different photograph. I read what your scan found, build the routine around it, and keep the plan boring on purpose — the products that work are cheap and the results come from not skipping.",
    },
    {
      ask: "What if I do everything and the number doesn't move?",
      lead: "Then I tell you that, and we change the plan.",
      body:
        "Two photos of the same unchanged face already differ by about half a point, so I won't call noise a win to keep you subscribed. If a real rescan comes back flat after a fair run at it, that's information about the plan, not about you.",
    },
    {
      ask: "Is this just going to tell me what I want to hear?",
      lead: "No, and you can check that.",
      body:
        "Every number on your report shows its working — the measurement, the average it's compared against, and whether it's reliable enough to be scored at all. The ones that aren't get marked and given no weight. A tool that flattered you would hide that column, not print it.",
    },
    {
      ask: "How is a photo supposed to know anything about my face?",
      lead: "It measures, it doesn't guess.",
      body:
        "The mesh puts a few hundred points on your face and I read proportions off them — spacing, angles, ratios. That's geometry, and it's repeatable. What it can't see is the things a photograph doesn't contain, which is why the report tells you when a number is indicative rather than scored.",
    },
    {
      ask: "How long before I actually see something?",
      lead: "Depends entirely which lever you pull.",
      body:
        "Skin and body composition move in weeks. Hair moves in months. Bone doesn't move at all, and I'll say so rather than sell you a routine for it. Your plan is ordered by what's actually movable on your face, so the early weeks are spent where the return is.",
    },
  ];

  let demoRan = false;
  const runMaxDemo = () => {
    if (demoRan || !alive()) return;
    demoRan = true;
    const feed = activeHost.querySelector<HTMLElement>(".max-feed");
    const say = activeHost.querySelector<HTMLElement>(".max-say");
    const svg = activeHost.querySelector<SVGSVGElement>(".max-stage .mx-svg");
    if (!feed || !say || !svg) return;

    // Drawn per open rather than rotated in order, because the order would be
    // per page load and everybody would see the same first one anyway.
    const exchange = DEMO_EXCHANGES[Math.floor(Math.random() * DEMO_EXCHANGES.length)]!;

    const ask = document.createElement("div");
    ask.className = "max-ask";
    ask.textContent = exchange.ask;
    feed.insertBefore(ask, say);
    ask.classList.add("show");

    window.setTimeout(() => {
      if (!alive()) return;
      // Thinking: dots in the bubble, thinking face on him. The pause is the
      // point — an instant answer reads as a recording, a visible think reads
      // as somebody working on YOUR question.
      say.classList.add("pondering");
      say.innerHTML = "<p><i></i><i></i><i></i></p>";
      svg.classList.remove("mx-mood-happy");
      svg.classList.add("mx-mood-thinking");

      window.setTimeout(() => {
        if (!alive()) return;
        say.classList.remove("pondering");
        svg.classList.remove("mx-mood-thinking");
        svg.classList.add("mx-mood-happy");
        say.innerHTML = `<p><b>${exchange.lead}</b> ${exchange.body}</p>`;
        typewriteBlock(say);
        svg.classList.add("speaking");
        window.setTimeout(() => {
          svg.classList.remove("speaking");
          // Said his piece: the same follow-through nod the real chat gives.
          if (alive()) reactMax(activeHost.querySelector<HTMLElement>(".max-stage"), "nod");
        }, 5600);
      }, 2100);
    }, 700);
  };

  // What an existing subscriber sees instead of the plan cards.
  //
  // The offer screen used to be unconditional, so somebody already paying
  // reached the end of the questions and was invited to start a free trial.
  // Tapping it did not even fail politely: create-checkout-session answers 409
  // "This account already has a subscription", which landed as red error text
  // on the last screen of their own onboarding.
  const drawAlreadySubscribed = (entitlement: Entitlement) => {
    if (!alive()) return;
    // Same rule as drawOffer: the wrapped native build renders no purchase or
    // billing surface at all. Apple requires in-app digital subscriptions to
    // go through IAP, and outside the US an app may not even link out to a web
    // checkout — which a "Manage billing" button plainly is.
    if (isNativeApp()) {
      close();
      return;
    }
    track("offer-already-subscribed");
    const plan = entitlement.tier === "max" ? "Max" : "Starter";
    const trialing = entitlement.status === "trialing";
    activeHost.innerHTML = `<div class="trial-shell trial-offer offer-enter" role="dialog" aria-modal="true" aria-labelledby="trial-title">
      <button class="trial-close" type="button" aria-label="Close">✕</button>
      <div class="trial-offer-head">
        <div><span class="trial-eyebrow">YOUR PATHWAY IS READY</span>
          <h2 id="trial-title">You are already on ${plan}.</h2>
          <p>${trialing
            ? `Your trial is running. Nothing to set up: your pathway is saved and your plan is on your report.`
            : `Nothing to set up: your pathway is saved and your plan is on your report.`}</p></div>
      </div>
      <div class="trial-actions">
        <button class="btn pri" id="trial-done" type="button">Back to my plan</button>
        <button class="btn gho" id="trial-billing" type="button">Manage billing</button>
      </div>
    </div>`;
    activeHost.querySelector(".trial-close")?.addEventListener("click", close);
    activeHost.querySelector("#trial-done")?.addEventListener("click", close);
    activeHost.querySelector("#trial-billing")?.addEventListener("click", () => {
      void openBillingPortal();
    });
  };

  const drawOffer = () => {
    if (!alive()) return;
    // Inside the wrapped native app there is no offer screen at all. Apple
    // requires in-app digital subscriptions to go through In-App Purchase,
    // and outside the US an app may not even link to a web checkout — so
    // until IAP exists, the native build simply never sells. The pathway
    // questions above still ran; only the sell is skipped.
    if (isNativeApp()) {
      close();
      return;
    }
    track("offer-shown");
    const adult = profileIsAdult(profile);
    // The .offer-enter classes drive the reveal: the shell rises, then the two
    // plans slide in from their own sides with the Max card landing a beat
    // later. This is the one moment in the product where money is asked for,
    // and it should arrive like a result, not like a form. Pure CSS, and the
    // global reduced-motion rule collapses all of it to a plain appearance.
    activeHost.innerHTML = `<div class="trial-shell trial-offer offer-enter" role="dialog" aria-modal="true" aria-labelledby="trial-title">
      <button class="trial-close" type="button" aria-label="Close">✕</button>
      <div class="trial-offer-head">
        <div><span class="trial-eyebrow">YOUR PATHWAY IS READY</span>
          <h2 id="trial-title">One more scan. Seven days to explore.</h2>
          <p>Your card is collected securely by Stripe. Cancel before the trial ends and you pay $0.</p></div>
      </div>
      <div class="stat-band">
        <b><i class="stat-num" data-to="${MEASUREMENT_COUNT}">0</i> measurements</b>
        <span>re-taken the same way every scan. One scan is a score; a run of them
          is the only thing that can tell you a change was real and not the camera.</span>
      </div>
      <div class="plan-grid">
        <article class="plan-card starter" data-plan="starter">
          <div class="plan-top"><span>STARTER</span><b>${priceInner(STARTER_MONTHLY, "month")}</b></div>
          <p>A clear weekly pathway to keep your progress moving.</p>
          <div class="plan-feat"><ul><li>Your weekly pathway, ordered by what moves</li><li>Daily accountability tracker</li><li>Progress tracking scan to scan</li><li>Scan other people too</li></ul></div>
          <span class="plan-hint">Tap for what's included</span>
          <button class="btn plan-cta" type="button" data-checkout="starter">Start 7-day free trial</button>
          <small>Then $${STARTER_MONTHLY.toFixed(2)}/month. Cancel anytime.</small>
        </article>
        <article class="plan-card max${adult ? " featured" : " locked"}" data-plan="max">
          ${adult ? `<span class="plan-ribbon">MOST IMMERSIVE</span>` : `<span class="plan-ribbon lock">18+ · LOCKED</span>`}
          ${adult ? billingToggle() : ""}
          <div class="plan-top"><span>TRUE<span>MAX</span></span><b>${priceInner(MAX_MONTHLY, "month")}</b></div>
          ${adult ? `<span class="plan-week">$${weeklyOf(MAX_MONTHLY * 12)}/week. The leading weekly-priced app: $3.99/week.</span>` : ""}
          <p>Your highest-touch experience with Max alongside you.</p>
          <div class="plan-feat"><ul><li>Everything in Starter</li><li>Coach Max, your AI coach</li><li>Step-by-step plans, catered to you</li><li>Two scans a week</li></ul></div>
          <span class="plan-hint">Tap for what's included</span>
          <button class="btn plan-cta" type="button" data-checkout="max" ${adult ? "" : "disabled"}>
            ${adult ? "Try Max free for 7 days" : "Available when you're 18"}
          </button>
          <small>${adult ? "Then $11.99/month. Cancel anytime." : "Starter remains fully available."}</small>
          <!-- Max lives at the foot of his own plan, not at the top of the
               screen. He starts fully hidden behind the card's bottom edge —
               the card's overflow does the hiding — and pops up waist-deep
               once the offer settles, waves, and says his piece from a white
               bubble that types itself out. -->
          ${adult
            ? `<div class="max-stage">
            <div class="max-feed">
              <div class="max-say" id="max-say">
                <p><b>Hey! I'm Max.</b> I'm here to help you hit your glow-up goals.
                  I read your measurements every scan, lock you into the routine
                  that gets you there, and tell you straight whether it moved.</p>
              </div>
            </div>
            <span class="max-pop" aria-hidden="true">${maxCharacterMarkup()}</span>
          </div>`
            : ""}
        </article>
      </div>
      <p class="trial-status" role="status"></p>
      <button class="trial-decline" type="button">No thank you — show me my analysis</button>
      <p class="trial-legal">Subscriptions renew monthly until cancelled, and your plan and trial terms are shown again in secure Checkout.</p>
    </div>`;

    activeHost.querySelector(".trial-close")?.addEventListener("click", close);
    activeHost.querySelector(".trial-decline")?.addEventListener("click", close);

    // The sequence: the offer settles, Max pops up from behind the card's
    // bottom edge, waves (and puts his arm down), and only THEN does the
    // bubble appear and type itself out — a greeting that arrives before the
    // character does reads as a flash of text, not as somebody speaking. Once
    // per screen: a character who repeats his introduction stops being
    // charming somewhere around the third time.
    window.setTimeout(() => {
      if (!alive()) return;
      const stage = activeHost.querySelector(".max-stage");
      stage?.classList.add("up");
      const svg = stage?.querySelector(".mx-svg");
      const arm = stage?.querySelector(".mx-arm");
      window.setTimeout(() => arm?.classList.add("waving"), 480);
      window.setTimeout(() => {
        if (!alive()) return;
        const say = activeHost.querySelector(".max-say");
        if (say instanceof HTMLElement) {
          say.classList.add("show");
          typewriteBlock(say);
        }
        // The mouth runs while the greeting types, then stops — roughly
        // reading speed for that many words, so he does not stand there
        // mouthing at nothing.
        svg?.classList.add("speaking");
        window.setTimeout(() => svg?.classList.remove("speaking"), 5200);
        // Ten seconds after he says hello, the demo: a question pops in from
        // the person's side and Max answers it, live on the payment screen.
        window.setTimeout(() => runMaxDemo(), 10_000);
      }, 900);
    }, 620);
    // Plain interactions here. This screen used to opt into the knock, which
    // cost it the idle repertoire as well as looking like a pivot rather than
    // a fall; he stands, breathes and gets on with his acts now, and a poke
    // gets the hop and the wave every other surface gives.
    wireMaxInteractions(activeHost.querySelector<HTMLElement>(".max-stage"));

    // The stat counts up rather than appearing. A number that ticks reads as
    // something being measured; the same number sitting still reads as a claim.
    const counter = activeHost.querySelector<HTMLElement>(".stat-num");
    if (counter && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const target = Number(counter.dataset.to) || 0;
      const started = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - started) / 900);
        counter.textContent = String(Math.round(target * (1 - (1 - p) ** 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else if (counter) {
      counter.textContent = String(counter.dataset.to);
    }

    // Tapping a card opens what is actually in it, rather than making people
    // read two feature lists at once.
    for (const card of activeHost.querySelectorAll<HTMLElement>(".plan-card")) {
      card.addEventListener("click", (event) => {
        // Not when the tap was the buy button — that has its own job.
        if ((event.target as HTMLElement).closest("[data-checkout]")) return;
        const opening = !card.classList.contains("open");
        for (const other of activeHost.querySelectorAll<HTMLElement>(".plan-card")) {
          other.classList.toggle("open", other === card && opening);
        }
        // Max reacts to the card being opened rather than narrating it: one
        // short wave, no new sentence. Cheap, and it makes the screen feel
        // inhabited instead of animated-at.
        if (opening) {
          const arm = activeHost.querySelector<HTMLElement>(".mx-arm");
          arm?.classList.remove("waving");
          // Reflow, or re-adding the class in the same frame does nothing.
          void arm?.offsetWidth;
          arm?.classList.add("waving");
        }
      });
    }
    // Switching the period rewrites the Max card in place. The price, the
    // renewal sentence and the button all have to move together: a card
    // reading "$11.99 / month" under a selected Yearly toggle is the kind of
    // mismatch somebody notices only after they have been charged.
    const bill = activeHost.querySelector<HTMLElement>(".billtoggle");
    if (bill) {
      for (const opt of bill.querySelectorAll<HTMLButtonElement>(".bt-opt")) {
        opt.addEventListener("click", () => {
          const mode = opt.dataset.set === "annual" ? "annual" : "monthly";
          bill.dataset.billing = mode;
          for (const other of bill.querySelectorAll(".bt-opt")) {
            other.classList.toggle("on", other === opt);
          }
          const card = activeHost.querySelector<HTMLElement>('.plan-card[data-plan="max"]');
          if (!card) return;
          const price = card.querySelector<HTMLElement>(".plan-top b");
          // :scope > small, not just small. The price itself contains a
          // <small> for the "USD / month" suffix, so a bare selector matches
          // that one and the renewal sentence underneath never changes —
          // leaving "Then $11.99/month" sitting under a $89.99 yearly price.
          const note = card.querySelector<HTMLElement>(":scope > small");
          if (price) {
            price.innerHTML = mode === "annual"
              ? priceInner(MAX_ANNUAL, "year")
              : priceInner(MAX_MONTHLY, "month");
          }
          if (note && adult) {
            note.textContent = mode === "annual"
              ? `Then $${MAX_ANNUAL.toFixed(2)}/year. Cancel anytime.`
              : `Then $${MAX_MONTHLY.toFixed(2)}/month. Cancel anytime.`;
          }
          const week = card.querySelector<HTMLElement>(".plan-week");
          if (week) {
            week.textContent = mode === "annual"
              ? `$${weeklyOf(MAX_ANNUAL)}/week. The leading weekly-priced app: $3.99/week.`
              : `$${weeklyOf(MAX_MONTHLY * 12)}/week. The leading weekly-priced app: $3.99/week.`;
          }
        });
      }
    }

    for (const button of activeHost.querySelectorAll<HTMLButtonElement>("[data-checkout]")) {
      button.addEventListener("click", async () => {
        if (busy || button.disabled) return;
        busy = true;
        const status = activeHost.querySelector<HTMLElement>(".trial-status");
        for (const item of activeHost.querySelectorAll<HTMLButtonElement>("[data-checkout]")) item.disabled = true;
        track("checkout-started");
        button.textContent = "Opening secure Checkout…";
        // Starter has no yearly price, so the toggle only governs Max. Sending
        // billing: "annual" for Starter would resolve to the monthly price
        // anyway, but asking for something that does not exist is how a wrong
        // charge happens later when somebody adds the price and forgets this.
        const wantsAnnual = activeHost.querySelector<HTMLElement>(".billtoggle")?.dataset.billing === "annual";
        const chosen = button.dataset.checkout as PlanTier;
        const result = await startTrialCheckout(
          chosen,
          chosen === "max" && wantsAnnual ? "annual" : "monthly",
        );
        if (!alive()) return;
        if (!result.ok) {
          busy = false;
          for (const item of activeHost.querySelectorAll<HTMLButtonElement>("[data-checkout]")) {
            item.disabled = item.dataset.checkout === "max" && !adult;
          }
          button.textContent = button.dataset.checkout === "starter" ? "Start 7-day free trial" : "Try Max free for 7 days";
          if (status) status.textContent = result.message || "Checkout is not available yet.";
        }
      });
    }
  };

  const complete = async () => {
    if (busy || !alive()) return;
    readInputs(profile, activeHost);
    busy = true;
    const next = activeHost.querySelector<HTMLButtonElement>("#trial-next");
    if (next) {
      next.disabled = true;
      next.textContent = "Saving your pathway…";
    }
    const result = preview ? { ok: true } : await saveOnboardingProfile(user, profile);
    if (!alive()) return;
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
      queueOnboardingProfile(user, profile);
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
    await showSell();
  };

  // The offer, or the reason there isn't one.
  //
  // The entitlement read is awaited rather than raced, because the whole point
  // is not to show plan cards to a subscriber, and drawing them first would
  // put the wrong screen up and snatch it back. It is the last step of a flow
  // that has already done several round trips, so one more is not what makes
  // this slow. A failed read falls through to the offer: that is the direction
  // that stays recoverable, since the server refuses a duplicate subscription
  // anyway, whereas wrongly telling somebody they are subscribed hides the
  // only route they have to buy.
  const showSell = async () => {
    if (preview) {
      drawOffer();
      return;
    }
    let entitlement: Entitlement | null = null;
    try {
      entitlement = await loadEntitlement();
    } catch {
      entitlement = null;
    }
    if (!alive()) return;
    if (entitlement && hasPaidAccess(entitlement)) drawAlreadySubscribed(entitlement);
    else drawOffer();
  };

  const draw = () => {
    if (!alive()) return;
    const headers = [
      ["A LITTLE ABOUT YOU", `Let's make this yours, ${esc(profile.firstName || "first")}.`, "Your email already comes from your secure account. We only ask for what shapes your experience."],
      ["AGE & DISCOVERY", "Keep the experience age-appropriate.", "Your date of birth controls which plan can be offered. Your mobile is optional and is never required for analysis."],
      ["YOUR OBJECTIVE", "What would you most like to improve?", "Pick as many as fit. This personalises the pathway; it never changes your measurements or score."],
      ["THE OUTCOME", "What would make TrueMax genuinely useful?", "A short answer helps Coach Max focus on your version of progress, not somebody else's."],
      ["YOUR STARTING POINT", "Bring the whole picture, not just a score.", "These are optional. We use them to keep coaching specific, constructive and grounded in what you already value."],
      ["BOUNDARIES", "Anything you don't want made into a project?", "Optional. Measurements still appear, but your written pathway and Coach Max will avoid pushing these topics."],
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

    activeHost.innerHTML = `<div class="trial-shell" role="dialog" aria-modal="true" aria-labelledby="trial-title">
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

    activeHost.querySelector(".trial-close")?.addEventListener("click", close);
    activeHost.querySelector("#trial-back")?.addEventListener("click", () => {
      if (step === 0) return close();
      readInputs(profile, activeHost);
      step--;
      draw();
    });
    activeHost.querySelector("#trial-next")?.addEventListener("click", () => {
      readInputs(profile, activeHost);
      const issue = validateOnboardingStep(profile, step);
      const status = activeHost.querySelector<HTMLElement>(".trial-status");
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
    for (const choice of activeHost.querySelectorAll<HTMLButtonElement>(".trial-choice")) {
      choice.addEventListener("click", () => {
        const key = choice.dataset.key || "";
        if (step === 1) profile.discoverySource = key as OnboardingProfile["discoverySource"];
        else if (step === 2) profile.primaryObjectives = toggle(profile.primaryObjectives, key);
        else if (step === 5) profile.quietTopics = toggle(profile.quietTopics, key);
        for (const item of activeHost.querySelectorAll<HTMLButtonElement>(".trial-choice")) {
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
  else if (step === total - 1 && !validateOnboardingStep(profile, total - 1) && profile.completedAt) {
    // Nothing left to ask. Opening on the last answered question and making
    // somebody press Continue to reach a screen that may say "you are already
    // subscribed" is the long way round to a dead end, so go straight there.
    locked = false;
    await showSell();
  } else draw();
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
