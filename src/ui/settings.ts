import { maxLoaderMarkup } from "./maxCharacter.js";
import type { User } from "@supabase/supabase-js";
import { GOALS, QUIET_TOPICS, loadProfile, saveProfile } from "../engine/goals.js";
import {
  loadOnboardingProfile,
  saveOnboardingProfile,
} from "../engine/onboarding.js";
import type { OnboardingProfile } from "../engine/onboarding.js";
import { loadVerdictTone } from "../engine/analysisMode.js";
import {
  listSideCorrectionFeedback,
  revokeSideCorrectionFeedback,
} from "../engine/sideFeedback.js";
import type { SharedSideFeedback } from "../engine/sideFeedback.js";
import { askVerdictTone } from "./tonePrompt.js";

// ---------------------------------------------------------------------------
// Everything the quiz asked, afterwards.
//
// The quiz collects a profile once and then never mentions it again, which
// turns a person's own answers into something that happened to them. Goals
// change. So does what somebody is willing to be coached about — the topic you
// were happy to discuss in week one is not always the topic you want raised in
// week six.
//
// Three groups, and the split between them is the point.
//
// WHO YOU ARE — name, and a date of birth shown but not editable. Age decides
// which plan may be sold, so a field that changed it would be a field that sold
// an adult subscription to a fifteen-year-old with two clicks. Correcting it is
// a support conversation, deliberately.
//
// WHAT YOU WANT — goals, the outcome in the person's own words, what they
// already like about themselves. This is what personalises the plan and what
// Max reads before it says anything.
//
// WHAT TO LEAVE ALONE — the quiet topics, and the wording of the verdict.
// These are consent, not preference, and consent that cannot be withdrawn as
// easily as it was given is not consent. One tap, no confirmation, applies to
// the next sentence the app writes.
//
// The measurements are not in here and never will be. Nothing on this screen
// changes a score; the scan reports the number it read whatever anyone would
// prefer, which is the whole product.
// ---------------------------------------------------------------------------

let host: HTMLDivElement | null = null;

const esc = (value: string): string =>
  value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] || char);

const toggle = (values: string[], value: string): string[] =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

function close(): void {
  host?.remove();
  host = null;
  document.body.classList.remove("funnel-open");
  document.removeEventListener("keydown", onKey);
}

export function closeSettings(): void {
  close();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}

function chip(key: string, label: string, on: boolean, sub = ""): string {
  return `<button type="button" class="trial-choice${on ? " on" : ""}" data-key="${esc(key)}"
    aria-pressed="${on}"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</button>`;
}

function readableDate(iso: string): string {
  // Rendered from the parts rather than through toLocaleDateString, because a
  // plain "1996-04-20" is parsed as UTC midnight and can print as the 19th to
  // anybody west of Greenwich. Being wrong by a day about somebody's birthday
  // is a small thing that reads as carelessness.
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "Not set";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${Number(d)} ${months[Number(m) - 1] ?? ""} ${y}`;
}

function readableTimestamp(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export async function openSettings(user: User): Promise<void> {
  close();
  const activeHost = document.createElement("div");
  host = activeHost;
  activeHost.className = "trial-overlay settings-overlay";
  activeHost.innerHTML = `<div class="trial-shell trial-loading" role="dialog" aria-modal="true" aria-label="Your profile">
    ${maxLoaderMarkup("Loading your profile")}<p>Loading your profile…</p>
  </div>`;
  document.body.appendChild(activeHost);
  document.body.classList.add("funnel-open");
  document.addEventListener("keydown", onKey);

  let profile: OnboardingProfile;
  try {
    profile = await loadOnboardingProfile(user);
  } catch {
    if (host !== activeHost || !activeHost.isConnected) return;
    activeHost.innerHTML = `<div class="trial-shell trial-loading" role="dialog" aria-modal="true">
      <button class="trial-close" type="button" aria-label="Close">✕</button>
      <span class="trial-eyebrow">YOUR PROFILE</span>
      <h2>We couldn't load your profile.</h2>
      <p>Your scans are safe on this device. Try again when your connection is steady.</p>
      <button class="btn pri" id="set-retry" type="button">Try again</button>
    </div>`;
    activeHost.querySelector(".trial-close")?.addEventListener("click", close);
    activeHost.querySelector("#set-retry")?.addEventListener("click", () => void openSettings(user));
    return;
  }
  if (host !== activeHost || !activeHost.isConnected) return;

  const local = loadProfile();
  let busy = false;
  let dirty = false;
  let feedbackItems: SharedSideFeedback[] | null = null;
  let feedbackMessage = "";
  let feedbackLoadFailed = false;
  let feedbackRequest = 0;
  const revokingFeedback = new Set<string>();

  const feedbackMarkup = (): string => {
    if (feedbackItems === null) {
      return `<div class="set-feedback-state"><span class="trial-loader" aria-hidden="true"></span><span>Loading shared feedback…</span></div>`;
    }
    if (!feedbackItems.length) {
      return `<div class="set-feedback-empty">You have no side-correction feedback stored for review.</div>`;
    }
    return `<div class="set-feedback-list">${feedbackItems.map((item) => {
      const revoking = revokingFeedback.has(item.submissionId);
      return `<article class="set-feedback-item">
        <div>
          <b>Side correction shared ${esc(readableTimestamp(item.createdAt))}</b>
          <span>Automatically deletes by ${esc(readableTimestamp(item.expiresAt))}.</span>
        </div>
        <button class="set-feedback-revoke" type="button"
          data-feedback-submission="${esc(item.submissionId)}"
          data-feedback-scan="${esc(item.scanId)}"${revoking ? " disabled" : ""}>
          ${revoking ? "Revoking…" : "Revoke and delete"}
        </button>
      </article>`;
    }).join("")}</div>`;
  };

  const draw = () => {
    if (host !== activeHost || !activeHost.isConnected) return;
    const tone = loadVerdictTone();
    activeHost.innerHTML = `<div class="trial-shell settings-shell" role="dialog" aria-modal="true" aria-labelledby="set-title">
      <header class="trial-nav">
        <div class="trial-brand">TRUE<span>MAX</span></div>
        <button class="trial-close" type="button" aria-label="Close">✕</button>
      </header>
      <main class="trial-body settings-body">
        <span class="trial-eyebrow">YOUR PROFILE</span>
        <h2 id="set-title">What we know, and what you'd rather we didn't bring up.</h2>
        <p class="trial-note">Nothing here changes a measurement. Your score is whatever your face measures; this is what the app does with it afterwards.</p>

        <section class="set-group">
          <h3>Who you are</h3>
          <label class="trial-field" for="set-first"><span>First name</span>
            <input id="set-first" class="trial-input" type="text" maxlength="60" value="${esc(profile.firstName)}" autocomplete="given-name" /></label>
          <label class="trial-field" for="set-last"><span>Last name</span>
            <input id="set-last" class="trial-input" type="text" maxlength="60" value="${esc(profile.lastName)}" autocomplete="family-name" /></label>
          <div class="set-locked">
            <span>Date of birth</span>
            <b>${esc(readableDate(profile.dateOfBirth))}</b>
            <small>Locked. Your age decides which plans can be offered to you, so changing it here isn't something we let a form do — email support@truemax.app if it's wrong.</small>
          </div>
        </section>

        <section class="set-group">
          <h3>What you want out of this</h3>
          <p class="set-hint">Reorders your plan. Never changes a number.</p>
          <div class="trial-choices" data-field="goals">
            ${GOALS.map((g) => chip(g.id, g.label, profile.primaryObjectives.includes(g.id), g.blurb)).join("")}
          </div>
          <label class="trial-field" for="set-success"><span>What would make this genuinely useful?</span>
            <textarea id="set-success" class="trial-input trial-textarea" maxlength="500">${esc(profile.successOutcome)}</textarea></label>
          <label class="trial-field" for="set-strengths"><span>What do you already feel good about? <em>optional</em></span>
            <textarea id="set-strengths" class="trial-input trial-textarea" maxlength="500">${esc(profile.strengths)}</textarea></label>
        </section>

        <section class="set-group">
          <h3>What to leave alone</h3>
          <p class="set-hint">Measurements for these regions still appear in full. What stops is the coaching — nothing written, and Max won't raise them.</p>
          <div class="trial-choices compact" data-field="quiet">
            ${QUIET_TOPICS.map((t) => chip(t.region, t.label, profile.quietTopics.includes(t.region))).join("")}
          </div>
        </section>

        <!-- The depth chooser is gone; there is one analysis and it is the full
             one. See the note at modeSwitcher in results.ts. The TONE control
             stays, because how bluntly Max words things is a voice preference
             rather than a depth one, and it now stands on its own. -->
        <section class="set-group">
          <h3>How Max words things</h3>
          <div class="set-tone">
            <span>Results are currently worded <b>${tone === "kind" ? "kept civil" : "straight up"}</b>.</span>
            <button type="button" class="linkish" id="set-tone">Change the wording</button>
          </div>
        </section>

        <section class="set-group" aria-labelledby="set-feedback-title">
          <h3 id="set-feedback-title">Correction feedback you've shared</h3>
          <p class="set-hint">Only optional side-photo corrections appear here. They are private, never affect your score, and expire after 90 days. Revoking removes the review record immediately and queues the private photo for deletion.</p>
          ${feedbackMarkup()}
          <p class="set-feedback-message" role="status">${esc(feedbackMessage)}</p>
          ${feedbackLoadFailed
            ? `<button type="button" class="linkish" id="set-feedback-retry">Try loading again</button>`
            : ""}
        </section>
      </main>
      <p class="trial-status" role="status"></p>
      <footer class="trial-actions">
        <button class="btn gho" id="set-cancel" type="button">Close</button>
        <button class="btn pri" id="set-save" type="button">Save changes</button>
      </footer>
    </div>`;

    activeHost.querySelector(".trial-close")?.addEventListener("click", close);
    activeHost.querySelector("#set-cancel")?.addEventListener("click", close);

    for (const group of activeHost.querySelectorAll<HTMLElement>("[data-field]")) {
      const field = group.dataset.field;
      for (const button of group.querySelectorAll<HTMLButtonElement>(".trial-choice")) {
        button.addEventListener("click", () => {
          const key = button.dataset.key || "";
          dirty = true;
          if (field === "goals") profile.primaryObjectives = toggle(profile.primaryObjectives, key);
          else if (field === "quiet") profile.quietTopics = toggle(profile.quietTopics, key);
          const on = field === "goals"
            ? profile.primaryObjectives.includes(key)
            : profile.quietTopics.includes(key);
          button.classList.toggle("on", on);
          button.setAttribute("aria-pressed", String(on));
        });
      }
    }

    activeHost.querySelector("#set-tone")?.addEventListener("click", async () => {
      // force: true, because somebody who came here to change it has already
      // answered once and the stored answer is exactly what they are rejecting.
      await askVerdictTone(true);
      if (host !== activeHost || !activeHost.isConnected) return;
      readInputs();
      draw();
    });

    activeHost.querySelector("#set-feedback-retry")?.addEventListener("click", () => {
      void loadFeedback();
    });

    for (const button of activeHost.querySelectorAll<HTMLButtonElement>("[data-feedback-submission]")) {
      button.addEventListener("click", () => {
        const submissionId = button.dataset.feedbackSubmission || "";
        const scanId = button.dataset.feedbackScan || "";
        const item = feedbackItems?.find((candidate) =>
          candidate.submissionId === submissionId && candidate.scanId === scanId);
        if (item) void revokeFeedback(item);
      });
    }

    activeHost.querySelector("#set-save")?.addEventListener("click", () => void save());
  };

  const readInputs = () => {
    if (host !== activeHost || !activeHost.isConnected) return;
    const value = (id: string) =>
      (activeHost.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value || "").trim();
    if (activeHost.querySelector("#set-first")) {
      profile.firstName = value("set-first");
      profile.lastName = value("set-last");
      profile.successOutcome = value("set-success");
      profile.strengths = value("set-strengths");
    }
  };

  const save = async () => {
    if (busy || host !== activeHost || !activeHost.isConnected) return;
    readInputs();
    const status = activeHost.querySelector<HTMLElement>(".trial-status");
    const button = activeHost.querySelector<HTMLButtonElement>("#set-save");
    if (!profile.firstName) {
      if (status) status.textContent = "Your first name is how the app greets you — it can't be blank.";
      return;
    }
    busy = true;
    if (button) {
      button.disabled = true;
      button.textContent = "Saving…";
    }
    const result = await saveOnboardingProfile(user, profile);
    if (host !== activeHost || !activeHost.isConnected) return;
    busy = false;
    if (!result.ok) {
      if (button) {
        button.disabled = false;
        button.textContent = "Save changes";
      }
      if (status) status.textContent = result.message || "Couldn't save. Try again in a moment.";
      return;
    }
    // The plan generator reads goals and quiet topics from the device copy, so
    // both have to move together or the next scan is written against the old
    // answers while the account holds the new ones.
    local.goals = [...profile.primaryObjectives];
    local.quiet = profile.quietTopics as typeof local.quiet;
    saveProfile(local);
    dirty = false;
    if (button) button.textContent = "Saved";
    if (status) status.textContent = "Saved. This applies from your next scan.";
    setTimeout(() => {
      if (!dirty && host === activeHost && activeHost.isConnected) close();
    }, 700);
  };

  const loadFeedback = async () => {
    const request = ++feedbackRequest;
    readInputs();
    feedbackItems = null;
    feedbackMessage = "";
    feedbackLoadFailed = false;
    draw();
    const result = await listSideCorrectionFeedback(user.id);
    if (request !== feedbackRequest || host !== activeHost || !activeHost.isConnected) return;
    readInputs();
    feedbackItems = result.submissions;
    feedbackLoadFailed = !result.ok;
    feedbackMessage = result.ok ? "" : (result.message || "Shared feedback could not be loaded.");
    draw();
  };

  const revokeFeedback = async (item: SharedSideFeedback) => {
    if (revokingFeedback.has(item.submissionId)) return;
    revokingFeedback.add(item.submissionId);
    feedbackMessage = "";
    readInputs();
    draw();
    const result = await revokeSideCorrectionFeedback(user.id, item);
    if (host !== activeHost || !activeHost.isConnected) return;
    revokingFeedback.delete(item.submissionId);
    readInputs();
    if (result.ok) {
      feedbackLoadFailed = false;
      feedbackItems = (feedbackItems || []).filter((candidate) =>
        candidate.submissionId !== item.submissionId);
      feedbackMessage = result.cleanupPending
        ? "Review access is revoked. The private photo is queued for deletion."
        : "Feedback revoked and its private photo deleted.";
    } else {
      feedbackMessage = result.message || "Feedback could not be revoked. Try again.";
    }
    draw();
  };

  draw();
  void loadFeedback();
}
