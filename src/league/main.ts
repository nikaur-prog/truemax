import { getSupabaseClient, currentAccessToken, currentUser, signIn, signUp } from "../engine/auth.js";
import type { Tier } from "./tiers.js";
import { earnedCents, nextTier, fmtMoney, fmtCount } from "./tiers.js";
import type { AudienceStats, AudienceTier } from "./audience.js";
import { TIER_1, TIER_RULES, ruleFor, shortfall, statsArePossible, tierFor } from "./audience.js";
import type { EarningsFormula, VideoTotals } from "./earnings.js";
import {
  DEFAULT_FORMULA,
  creatorAccruedCents,
  engagementFactor,
  formulaFrom,
  poolScale,
  unlockProgress,
  unlocked,
} from "./earnings.js";
import { campaignTag, DEFAULT_CAMPAIGN_TAG } from "./compliance.js";

// ---------------------------------------------------------------------------
// The TrueMax Creator League — /league.
//
// Backstage for creators and clippers on the commission ladder. The page is a
// single state machine:
//
//   signed out            → the gate: pitch, ladder, montage, apply
//   signed in, no row     → the application form
//   applied / rejected    → status
//   approved              → the dashboard (sprints, submit, mine, ranks, money)
//   staff                 → all of the above plus the Admin section
//
// Approval is never self-serve: the transition out of "applied" only happens
// in the Admin section, which renders only for accounts with an app_admins
// row — granted, as everywhere else in this product, by hand in the SQL
// editor. RLS enforces the same shape server-side; the UI is a convenience,
// not the security boundary.
// ---------------------------------------------------------------------------

interface CreatorRow {
  user_id: string;
  handle: string;
  display_name: string;
  niche: string | null;
  status: "applied" | "approved" | "rejected" | "paused";
  pillar_grants: Record<string, boolean>;
  monthly_render_quota: number;
}

interface SprintRow {
  id: string;
  name: string;
  pool_cents: number;
  tiers: Tier[];
  /** When set, the sprint pays by the continuous formula, not the ladder. */
  formula: unknown;
  starts_at: string;
  ends_at: string;
  status: string;
  campaign_tag: string;
}

const sprintFormula = (s: SprintRow): EarningsFormula | null => formulaFrom(s.formula);

function sprintIsLive(sprint: SprintRow, at = Date.now()): boolean {
  const starts = Date.parse(sprint.starts_at);
  const ends = Date.parse(sprint.ends_at);
  return sprint.status === "active"
    && Number.isFinite(starts)
    && Number.isFinite(ends)
    && starts <= at
    && at <= ends;
}

interface SubmissionRow {
  id: string;
  sprint_id: string;
  creator_id: string;
  url: string;
  platform: string;
  status: string;
  created_at: string;
  /** Set by the hourly tracker when the URL matched a video on the
   *  creator's own linked TikTok — ownership proven, counts automatic. */
  tiktok_video_id: string | null;
  caption_snapshot: string | null;
  caption_checked_at: string | null;
  caption_compliant: boolean;
  compliance_hold_reason: string | null;
  creator_cta_attested_at: string | null;
  creator_disclosure_attested_at: string | null;
  cta_variant: "short" | "long" | "custom" | null;
  cta_verified_at: string | null;
  disclosure_verified_at: string | null;
  review_note: string | null;
}

/** One creator's submitted audience breakdown, awaiting or carrying a review. */
interface AudienceProofRow {
  id: string;
  user_id: string;
  platform: string;
  proof_url: string;
  tier1_share: number;
  usa_share: number;
  views_28d: number;
  videos_28d: number;
  status: string;
  note: string | null;
  submitted_at: string;
}

const root = document.getElementById("league")!;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function platformUrl(value: string, platform: string): URL | null {
  const url = httpsUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const valid = platform === "tiktok"
    ? /(^|\.)tiktok\.com$/.test(host)
    : platform === "instagram"
      ? /(^|\.)instagram\.com$/.test(host)
      : platform === "youtube"
        ? /(^|\.)youtube\.com$/.test(host) || host === "youtu.be"
        : false;
  return valid ? url : null;
}

function externalLink(value: string, label: string): string {
  const url = httpsUrl(value);
  return url
    ? `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
    : `<span>${esc(label)}</span>`;
}

function tierCardsHTML(tiers: readonly Tier[]): string {
  return `<div class="lg-tiers">${tiers
    .map(
      (t) => `<div class="lg-tier">
        <div class="lg-money">${fmtMoney(t.cents)}</div>
        <div class="lg-tier-req">${fmtCount(t.views)} views · ${t.comments}+ comments</div>
      </div>`,
    )
    .join("")}</div>`;
}

// The formula, as four cards. Same slot the ladder used to fill — but the
// deal it states has no cliffs: the rate, the dial, the unlock, the pay day.
function formulaCardsHTML(f: EarningsFormula): string {
  return `<div class="lg-tiers">
    <div class="lg-tier">
      <div class="lg-money">$${(f.rpmCents / 100).toFixed(2)}</div>
      <div class="lg-tier-req">per 1,000 views: every view counts</div>
    </div>
    <div class="lg-tier">
      <div class="lg-money">×${f.eMax.toFixed(1)}</div>
      <div class="lg-tier-req">engagement multiplier: real comments raise your rate</div>
    </div>
    <div class="lg-tier">
      <div class="lg-money">${fmtCount(f.thresholdViews)}</div>
      <div class="lg-tier-req">views to unlock, then every view you already have pays</div>
    </div>
    <div class="lg-tier">
      <div class="lg-money">7 days</div>
      <div class="lg-tier-req">from sprint close to payout</div>
    </div>
  </div>`;
}

interface PublicLeagueOffer {
  id: string;
  name: string;
  poolCents: number;
  currency: string;
  formula: EarningsFormula;
  startsAt: string;
  endsAt: string;
}

async function publicOfferHTML(): Promise<string> {
  const response = await fetch("/api/league-offer").catch(() => null);
  const payload = response
    ? await response.json().catch(() => null) as { offer?: PublicLeagueOffer | null } | null
    : null;
  const offer = payload?.offer;
  if (!response?.ok || !offer || !formulaFrom(offer.formula)) {
    return `<div class="lg-card"><h3>Applications are open</h3>
      <p class="lg-sub">There is no live sprint right now. Every sprint shows its exact rate,
      pool, caps and dates before you submit a video. Applying does not commit you to post.</p></div>`;
  }
  return `<p class="lg-note" style="margin-top:24px">CURRENT OFFER · ${esc(offer.name)} ·
    ${fmtMoney(offer.poolCents)} USD POOL · CLOSES ${new Date(offer.endsAt).toLocaleDateString()}</p>
    ${formulaCardsHTML(offer.formula)}`;
}

function topBarHTML(right = ""): string {
  return `<div class="lg-top">
    <div class="lg-mark"><img src="/brand/truemax-mark-512.png" alt="" />TRUEMAX <span class="lg-league">CREATOR LEAGUE</span></div>
    <div>${right}</div>
  </div>`;
}

// --- the gate ---------------------------------------------------------------

function renderGate(): void {
  document.title = "TrueMax Creator League";
  root.innerHTML = `${topBarHTML(`<button class="lg-btn" id="lg-signin">Sign in / Sign up</button>`)}
  <div class="lg-gate">
    <span class="lg-chip ok">PAID ON VIEWS · APPLICATION ONLY</span>
    <h1>Make TrueMax videos.<br/>Get paid when they hit.</h1>
    <p class="lg-tagline">The face scan is the most filmable thing on this app. We hand you the
    tools that make the videos, you post in your own style, and every view you get is worth
    money: a flat rate per thousand, raised by real engagement.</p>
    <div class="lg-montage">
      <!-- The montage master drops in as /league/montage.mp4 when rendered; the
           poster keeps the box honest until then. -->
      <video src="/league/montage.mp4" poster="/og.png" autoplay muted loop playsinline></video>
    </div>
    <div id="lg-public-offer"><p class="lg-note">Loading the current sprint terms…</p></div>
    <p class="lg-note">Views and comments combine across all approved TrueMax videos. Every post
    counts. No cliffs: 237k views is worth exactly what 237k views is worth. Comments are the
    bot filter: silent view farms earn half-rate.</p>
    <ol class="lg-how">
      <li><b>Apply.</b> Two minutes: handles, niche, why you.</li>
      <li><b>Get approved.</b> Every application is reviewed by the founder. You get the tools
      that fit what you make.</li>
      <li><b>Post and track.</b> Submit each video's link; your dashboard shows views, earnings
      and the sprint pool live.</li>
    </ol>
    <p style="margin-top:26px"><button class="lg-btn pri lg-cta" id="lg-apply">Apply to join</button></p>
    <div class="lg-form" id="lg-authbox" hidden>
      <h3 style="margin:0 0 2px">Sign in, or create your account</h3>
      <p class="lg-note" style="margin-top:4px">One account works for the app and the League.
      New here? The same button below creates your account.</p>
      <label for="lg-email">Email</label>
      <input id="lg-email" type="email" autocomplete="email" />
      <label for="lg-pass">Password</label>
      <input id="lg-pass" type="password" autocomplete="new-password" />
      <p style="margin-top:16px"><button class="lg-btn pri" id="lg-auth-go">Sign in / Create account</button></p>
      <p class="lg-error" id="lg-auth-err"></p>
      <p class="lg-note">Signing up agrees to the
      <a href="/terms" target="_blank" rel="noopener">terms</a> and
      <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.</p>
    </div>
  </div>`;

  const authbox = document.getElementById("lg-authbox")!;
  const show = () => {
    authbox.hidden = false;
    document.getElementById("lg-email")?.focus();
  };
  document.getElementById("lg-apply")!.onclick = show;
  document.getElementById("lg-signin")!.onclick = show;
  void publicOfferHTML().then((html) => {
    const offer = document.getElementById("lg-public-offer");
    if (offer) offer.innerHTML = html;
  });
  document.getElementById("lg-auth-go")!.onclick = async () => {
    const email = (document.getElementById("lg-email") as HTMLInputElement).value.trim();
    const pass = (document.getElementById("lg-pass") as HTMLInputElement).value;
    const err = document.getElementById("lg-auth-err")!;
    err.textContent = "";
    // 6 is the app-wide minimum (authForm.ts) — demanding 8 here locked out
    // existing app accounts with shorter passwords before signIn even ran.
    if (!email || pass.length < 6) {
      err.textContent = "Email and a password of at least 6 characters.";
      return;
    }
    // Try sign-in first; a fresh visitor falls through to sign-up. One button,
    // because "do I already have an account?" is not the applicant's problem.
    const si = await signIn(email, pass);
    if (si.ok) return void boot();
    const su = await signUp(email, pass);
    if (su.ok && su.needsConfirmation) {
      err.textContent = `Check ${email} for the confirmation link, then return here to apply.`;
      return;
    }
    if (su.ok) return void boot();
    err.textContent = su.message || si.message || "That didn't work. Try again.";
  };
}

// --- application -------------------------------------------------------------

function renderApply(): void {
  root.innerHTML = `${topBarHTML()}
  <div class="lg-gate">
    <h1 style="font-size:34px">Tell us what you make</h1>
    <p class="lg-tagline">Reviewed by the founder, usually within a day.</p>
    <div class="lg-form">
      <label for="ap-name">Name you go by</label>
      <input id="ap-name" maxlength="60" />
      <label for="ap-handle">Main handle (TikTok or IG)</label>
      <input id="ap-handle" maxlength="60" placeholder="@yourhandle" />
      <label for="ap-niche">What you make</label>
      <select id="ap-niche">
        <option value="looksmaxxing">Looksmaxxing / self-improvement</option>
        <option value="clipping">Clipping / edits</option>
        <option value="beauty">Beauty / GRWM / skincare</option>
        <option value="fitness">Fitness</option>
        <option value="lifestyle">Lifestyle / vlog</option>
        <option value="other">Something else</option>
      </select>
      <label for="ap-links">Links to 2–3 of your videos</label>
      <textarea id="ap-links" rows="3" placeholder="one per line"></textarea>
      <label for="ap-pitch">Why you (one or two sentences)</label>
      <textarea id="ap-pitch" rows="3" maxlength="500"></textarea>
      <p class="lg-note" style="margin-top:14px">The League leaderboard shows your name, handle
      and earnings to other approved members: that's the game. Nothing else about your account
      is ever visible to anyone.</p>
      <label class="lg-check"><input id="ap-adult" type="checkbox" /> I confirm I am at least 18 years old.</label>
      <label class="lg-check"><input id="ap-terms" type="checkbox" /> I accept the
      <a href="/terms#creator-league" target="_blank" rel="noopener">Creator League terms</a>,
      including the sprint pool, validation and payout rules.</label>
      <p style="margin-top:16px"><button class="lg-btn pri" id="ap-send">Send application</button></p>
      <p class="lg-error" id="ap-err"></p>
    </div>
  </div>`;

  document.getElementById("ap-send")!.onclick = async () => {
    const err = document.getElementById("ap-err")!;
    err.textContent = "";
    const name = (document.getElementById("ap-name") as HTMLInputElement).value.trim();
    const handle = (document.getElementById("ap-handle") as HTMLInputElement).value.trim();
    if (!name || !handle) {
      err.textContent = "Name and handle are the two we can't do without.";
      return;
    }
    const user = await currentUser();
    if (!user) return renderGate();
    const client = await getSupabaseClient();
    const links = (document.getElementById("ap-links") as HTMLTextAreaElement).value
      .split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3);
    if (links.length < 2 || links.some((link) => !httpsUrl(link))) {
      err.textContent = "Add 2–3 full https:// links to your work.";
      return;
    }
    const adult = (document.getElementById("ap-adult") as HTMLInputElement).checked;
    const accepted = (document.getElementById("ap-terms") as HTMLInputElement).checked;
    if (!adult || !accepted) {
      err.textContent = "The Creator League is 18+ and requires the current creator terms.";
      return;
    }
    const { error } = await client.rpc("apply_to_creator_league", {
      p_handle: handle,
      p_display_name: name,
      p_niche: (document.getElementById("ap-niche") as HTMLSelectElement).value,
      p_links: links,
      p_pitch: (document.getElementById("ap-pitch") as HTMLTextAreaElement).value.trim() || null,
      p_adult: adult,
      p_accept_terms: accepted,
      p_terms_version: "2026-08-31",
    });
    if (error) {
      err.textContent = error.message;
      return;
    }
    void boot();
  };
}

function renderStatus(row: CreatorRow): void {
  const copy = row.status === "rejected"
    ? { chip: "NOT THIS TIME", chipClass: "warn", body: "This application wasn't approved. That's sometimes about fit and timing rather than your content: you're welcome to reach out on the account email." }
    : row.status === "paused"
      ? { chip: "PAUSED", chipClass: "warn", body: "Your membership is paused. Reach out on the account email if that's unexpected." }
      : { chip: "IN REVIEW", chipClass: "ok", body: "Application received. Every one is read by the founder: you'll see the dashboard here the moment you're approved." };
  root.innerHTML = `${topBarHTML()}
  <div class="lg-gate">
    <span class="lg-chip ${copy.chipClass}">${copy.chip}</span>
    <h1 style="font-size:34px">Thanks, ${esc(row.display_name)}.</h1>
    <p class="lg-tagline">${copy.body}</p>
  </div>`;
}

// --- the dashboard -----------------------------------------------------------

type Page = "overview" | "submit" | "mine" | "ranks" | "money" | "offers" | "tools" | "admin";

async function renderDash(me: CreatorRow, staff: boolean): Promise<void> {
  const pages: Array<[Page, string]> = [
    ["overview", "Overview"],
    ["submit", "Submit"],
    ["mine", "Submissions"],
    ["ranks", "Ranks"],
    ["money", "Money"],
    ["offers", "Offers"],
    ["tools", "Tools"],
  ];
  if (staff) pages.push(["admin", "Admin"]);

  root.innerHTML = `${topBarHTML(`<span class="lg-chip ok">${esc(me.handle)}</span>`)}
  <div class="lg-shell">
    <nav class="lg-nav">${pages.map(([id, label]) => `<button data-page="${id}">${label}</button>`).join("")}</nav>
    <main class="lg-main" id="lg-page"></main>
  </div>`;

  const host = document.getElementById("lg-page")!;
  const nav = [...root.querySelectorAll<HTMLButtonElement>(".lg-nav button")];
  const go = (page: Page) => {
    for (const b of nav) b.classList.toggle("on", b.dataset.page === page);
    location.hash = page;
    // A FRESH pane per navigation, and the reason is a race rather than
    // tidiness. Every page here loads before it writes, and they take
    // different amounts of time, so two taps in a row could land in the wrong
    // order: the slower page's innerHTML arrived last and left its content
    // under the other tab's highlight. A page that has been navigated away
    // from now finishes its load and writes into a pane that is no longer in
    // the document, which is exactly what it should do.
    //
    // It also means the eight page functions need to know nothing about this.
    // A sequence number would have to be checked inside every one of them,
    // and the first one written without the check would bring the bug back.
    const pane = document.createElement("div");
    host.replaceChildren(pane);
    void PAGES[page](pane, me);
  };
  for (const b of nav) b.onclick = () => go(b.dataset.page as Page);
  const initial = (location.hash.slice(1) || "overview") as Page;
  go(pages.some(([id]) => id === initial) ? initial : "overview");
}

async function loadSprints(): Promise<SprintRow[]> {
  const client = await getSupabaseClient();
  const { data } = await client
    .from("league_sprints")
    .select("*")
    .in("status", ["active", "closed"])
    .order("starts_at", { ascending: false });
  return (data ?? []) as SprintRow[];
}

async function loadMySubmissions(userId: string): Promise<SubmissionRow[]> {
  const client = await getSupabaseClient();
  const { data } = await client
    .from("league_submissions")
    .select("*")
    .eq("creator_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as SubmissionRow[];
}

/**
 * The latest snapshot of each of a creator's counted videos in a sprint.
 * Per-video rather than pre-combined, because the formula computes its
 * engagement factor per video; combining is one reduce away for callers
 * that want totals.
 */
async function myVideoTotalsFor(sprint: SprintRow, userId: string): Promise<VideoTotals[]> {
  const client = await getSupabaseClient();
  const { data: subs } = await client
    .from("league_submissions")
    .select("id")
    .eq("creator_id", userId)
    .eq("sprint_id", sprint.id)
    .in("status", ["approved", "earning", "paid_out"]);
  const ids = (subs ?? []).map((s: { id: string }) => s.id);
  if (!ids.length) return [];
  const { data: snaps } = await client
    .from("league_stat_snapshots")
    .select("submission_id, at, views, comments")
    .in("submission_id", ids);
  const latest = new Map<string, { at: number; views: number; comments: number }>();
  for (const s of (snaps ?? []) as Array<{ submission_id: string; at: string; views: number; comments: number }>) {
    const at = Date.parse(s.at);
    const held = latest.get(s.submission_id);
    if (!held || at > held.at) latest.set(s.submission_id, { at, views: s.views, comments: s.comments });
  }
  return [...latest.values()].map((v) => ({ views: v.views, comments: v.comments }));
}

const sumTotals = (videos: VideoTotals[]): { views: number; comments: number } =>
  videos.reduce((a, v) => ({ views: a.views + v.views, comments: a.comments + v.comments }), { views: 0, comments: 0 });

// --- TikTok link (Phase 2 tracking) -----------------------------------------

/** One shape for every call to the TikTok endpoint; the server does the work. */
async function apiTikTok<T = Record<string, unknown>>(
  action: string,
  extra: Record<string, unknown> = {},
): Promise<(T & { error?: string }) | null> {
  const token = await currentAccessToken().catch(() => null);
  const response = await fetch("/api/tiktok-auth", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...extra }),
  }).catch(() => null);
  if (!response) return null;
  return (await response.json().catch(() => null)) as (T & { error?: string }) | null;
}

/**
 * The link card on the Overview: connect, or show what is connected.
 *
 * The tokens never reach this code — the table's column grants stop even the
 * owner's browser reading them — so everything here is display state plus
 * calls to the server, which is the only party that talks to TikTok.
 */
async function renderTikTokCard(el: HTMLElement, me: CreatorRow): Promise<void> {
  const client = await getSupabaseClient();
  const { data } = await client
    .from("league_tiktok_accounts")
    .select("display_name, open_id")
    .eq("user_id", me.user_id)
    .maybeSingle<{ display_name: string | null; open_id: string }>();
  const oauthError = sessionStorage.getItem("lg-tt-error");
  if (oauthError) sessionStorage.removeItem("lg-tt-error");

  if (!data) {
    el.innerHTML = `<div class="lg-row" style="border:none;padding:0">
      <div><h3>TikTok</h3><p class="lg-sub" style="margin:4px 0 0">Link your own account and the
      views and comments on your submitted videos count themselves: no screenshots, no waiting
      on review day.</p></div>
      <button class="lg-btn pri" id="lg-tt-go">Connect</button></div>
      <p class="lg-error" id="lg-tt-err"></p>`;
    if (oauthError) el.querySelector("#lg-tt-err")!.textContent = oauthError;
    el.querySelector<HTMLButtonElement>("#lg-tt-go")!.onclick = async () => {
      const res = await apiTikTok<{ url: string; state: string }>("start");
      if (res?.url && res.state) {
        // The state is checked on the way back — a redirect carrying somebody
        // else's code gets ignored rather than exchanged.
        sessionStorage.setItem("lg-tt-state", res.state);
        const authUrl = httpsUrl(res.url);
        if (!authUrl || authUrl.hostname !== "www.tiktok.com" || authUrl.pathname !== "/v2/auth/authorize/") {
          el.querySelector("#lg-tt-err")!.textContent = "TikTok returned an unsafe sign-in address.";
          return;
        }
        location.href = authUrl.href;
        return;
      }
      el.querySelector("#lg-tt-err")!.textContent = res?.error ?? "Couldn't reach TikTok just now.";
    };
    return;
  }

  el.innerHTML = `<div class="lg-row" style="border:none;padding:0">
    <div><h3>TikTok</h3><p class="lg-sub" style="margin:4px 0 0">Linked as
    <b>${esc(data.display_name ?? "your TikTok account")}</b>. Counts on your submitted videos
    are read from here.</p></div>
    <span style="display:flex;gap:8px">
      <button class="lg-btn" id="lg-tt-videos">My videos</button>
      <button class="lg-btn danger" id="lg-tt-off">Disconnect</button>
    </span></div>
    <div id="lg-tt-list"></div>
    <p class="lg-error" id="lg-tt-err"></p>`;
  if (oauthError) {
    el.querySelector("#lg-tt-err")!.textContent = oauthError;
  }
  el.querySelector<HTMLButtonElement>("#lg-tt-videos")!.onclick = async () => {
    const list = el.querySelector<HTMLElement>("#lg-tt-list")!;
    list.innerHTML = `<p class="lg-sub">Loading…</p>`;
    const res = await apiTikTok<{ videos: Array<{ title: string; views: number; comments: number; url: string }> }>("videos");
    if (!res?.videos) {
      list.innerHTML = "";
      el.querySelector("#lg-tt-err")!.textContent = res?.error ?? "TikTok didn't answer just now.";
      return;
    }
    list.innerHTML = res.videos.map((v) => `<div class="lg-row">
      <span>${v.url ? externalLink(v.url, v.title || "Untitled video") : esc(v.title || "Untitled video")}</span>
      <b class="lg-num">${fmtCount(v.views)} views · ${fmtCount(v.comments)} comments</b>
    </div>`).join("") || `<p class="lg-sub">No videos on the account yet.</p>`;
  };
  el.querySelector<HTMLButtonElement>("#lg-tt-off")!.onclick = async () => {
    await apiTikTok("disconnect");
    void renderTikTokCard(el, me);
  };
}

async function leaguePost<T>(path: string, body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  data: (T & { error?: string }) | null;
}> {
  const token = await currentAccessToken().catch(() => null);
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, status: 0, data: null };
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => null) as (T & { error?: string }) | null,
  };
}

interface PayoutSetupState {
  status: "not_started" | "needs_attention" | "ready";
  livemode: boolean;
  transfersStatus?: string;
  payoutsStatus?: string;
  requirementsDue?: number;
}

async function payoutSetupHTML(): Promise<string> {
  const result = await leaguePost<PayoutSetupState>("/api/league-connect", { action: "status" });
  if (!result.ok || !result.data) {
    return `<div class="lg-card"><h3>Stripe payout account</h3>
      <p class="lg-error">Payout setup could not be checked. Reload before a sprint closes.</p></div>`;
  }
  if (result.data.status === "ready") {
    return `<div class="lg-card"><div class="lg-row" style="border:none;padding:0">
      <div><h3>Stripe payout account</h3><p class="lg-sub" style="margin:4px 0 0">
      Ready to receive Creator League transfers.</p></div><span class="lg-chip ok">READY</span></div>
      <p style="margin:14px 0 0"><button class="lg-btn" id="lg-payout-onboard">Update payout details</button></p></div>`;
  }
  if (result.data.status === "needs_attention") {
    return `<div class="lg-card"><div class="lg-row" style="border:none;padding:0">
      <div><h3>Finish Stripe payout setup</h3><p class="lg-sub" style="margin:4px 0 0">
      Stripe still needs information before TrueMax can transfer earnings.</p></div>
      <span class="lg-chip warn">ACTION NEEDED</span></div>
      <p style="margin:14px 0 0"><button class="lg-btn pri" id="lg-payout-onboard">Continue with Stripe</button></p></div>`;
  }
  return `<div class="lg-card lg-form" id="lg-payout-start"><h3>Set up payouts</h3>
    <p class="lg-sub">Stripe collects and verifies your legal identity and bank details. TrueMax
    receives only your account status and sends your approved earnings to your Stripe balance.</p>
    <div class="lg-payout-grid">
      <label>Legal country <input id="lg-payout-country" maxlength="2" value="NZ" autocomplete="country" /></label>
      <label>Account type <select id="lg-payout-entity">
        <option value="individual">Individual</option>
        <option value="company">Company</option>
        <option value="non_profit">Non-profit</option>
      </select></label>
    </div>
    <p style="margin:14px 0 0"><button class="lg-btn pri" id="lg-payout-onboard">Set up with Stripe</button></p>
    <p class="lg-error" id="lg-payout-error"></p></div>`;
}

function bindPayoutSetup(mount: HTMLElement): void {
  const button = mount.querySelector<HTMLButtonElement>("#lg-payout-onboard");
  if (!button) return;
  button.onclick = async () => {
    button.disabled = true;
    const country = mount.querySelector<HTMLInputElement>("#lg-payout-country")?.value.trim().toUpperCase();
    const entityType = mount.querySelector<HTMLSelectElement>("#lg-payout-entity")?.value;
    const result = await leaguePost<{ url?: string }>("/api/league-connect", {
      action: "onboard",
      ...(country ? { country } : {}),
      ...(entityType ? { entityType } : {}),
    });
    const error = mount.querySelector<HTMLElement>("#lg-payout-error");
    if (!result.ok || !result.data?.url) {
      if (error) error.textContent = result.data?.error ?? "Payout setup is unavailable. Try again.";
      button.disabled = false;
      return;
    }
    const url = httpsUrl(result.data.url);
    if (!url || (url.hostname !== "stripe.com" && !url.hostname.endsWith(".stripe.com"))) {
      if (error) error.textContent = "Stripe returned an unsafe setup address.";
      button.disabled = false;
      return;
    }
    location.href = url.href;
  };
}


const PAGES: Record<Page, (mount: HTMLElement, me: CreatorRow) => Promise<void> | void> = {
  async overview(mount, me) {
    mount.innerHTML = `<h1 class="lg-h">Overview</h1><p class="lg-sub">Loading…</p>`;
    const sprints = (await loadSprints()).filter((s) => sprintIsLive(s));
    if (!sprints.length) {
      mount.innerHTML = `<h1 class="lg-h">Overview</h1>
        <div class="lg-card"><h3>No live sprint right now</h3>
        <p class="lg-sub">The next pool opens soon. Anything you post in the meantime can be
        submitted once it does.</p></div>
        <div class="lg-card" id="lg-tt"><p class="lg-sub">Loading…</p></div>`;
      void renderTikTokCard(mount.querySelector<HTMLElement>("#lg-tt")!, me);
      return;
    }
    const cards = await Promise.all(sprints.map(async (s) => {
      const videos = await myVideoTotalsFor(s, me.user_id);
      const totals = sumTotals(videos);
      const f = sprintFormula(s);
      const head = `<div class="lg-row" style="border:none;padding:0 0 8px">
          <h3>${esc(s.name)}</h3><span class="lg-chip ok">POOL ${fmtMoney(s.pool_cents)}</span>
        </div>
        <div class="lg-row"><span>Your combined views</span><b class="lg-num">${fmtCount(totals.views)}</b></div>
        <div class="lg-row"><span>Your combined comments</span><b class="lg-num">${fmtCount(totals.comments)}</b></div>`;
      if (f) {
        // The formula sprint: continuous accrual once the threshold unlocks.
        if (!unlocked(f, totals)) {
          const p = unlockProgress(f, totals);
          return `<div class="lg-card">${head}
            <div class="lg-row"><span>Earnings</span><span class="lg-chip">LOCKED</span></div>
            <div class="lg-bar"><i style="width:${Math.round(p * 100)}%"></i></div>
            <div class="lg-bar-note">Pay unlocks at ${fmtCount(f.thresholdViews)} views and
            ${f.thresholdComments} comments, combined, then it counts every view you already have.</div>
          </div>`;
        }
        const accrued = creatorAccruedCents(f, videos);
        const factors = videos.map((video) => engagementFactor(f, video));
        const low = factors.length ? Math.min(...factors) : f.eMin;
        const high = factors.length ? Math.max(...factors) : f.eMin;
        const factorText = low === high ? `${low.toFixed(2)}×` : `${low.toFixed(2)}×–${high.toFixed(2)}×`;
        return `<div class="lg-card">${head}
          <div class="lg-row"><span>Accrued this sprint</span><span class="lg-money">${fmtMoney(accrued)}</span></div>
          <div class="lg-bar-note">$${(f.rpmCents / 100).toFixed(2)} per 1,000 views; each video earned at
          its own ${factorText} engagement factor. Locks at sprint close, paid within 7 days.</div>
        </div>`;
      }
      const earned = earnedCents(s.tiers, totals);
      const next = nextTier(s.tiers, totals);
      return `<div class="lg-card">${head}
        <div class="lg-row"><span>Earned so far</span><span class="lg-money">${fmtMoney(earned)}</span></div>
        ${next
          ? `<div class="lg-bar"><i style="width:${Math.round(next.progress * 100)}%"></i></div>
             <div class="lg-bar-note">Next rung: ${fmtMoney(next.tier.cents)} at ${fmtCount(next.tier.views)} views · ${next.tier.comments} comments</div>`
          : `<div class="lg-bar-note">Top rung reached. Well played.</div>`}
      </div>`;
    }));
    const explainer = sprintFormula(sprints[0]) ? formulaCardsHTML(sprintFormula(sprints[0])!) : tierCardsHTML(sprints[0].tiers);
    mount.innerHTML = `<h1 class="lg-h">Overview</h1>${cards.join("")}
      <div class="lg-card" id="lg-tt"><p class="lg-sub">Loading…</p></div>${explainer}`;
    void renderTikTokCard(mount.querySelector<HTMLElement>("#lg-tt")!, me);
  },

  async submit(mount, me) {
    const sprints = (await loadSprints()).filter((s) => sprintIsLive(s));
    const firstTag = campaignTag(sprints[0]?.campaign_tag) ?? DEFAULT_CAMPAIGN_TAG;
    mount.innerHTML = `<h1 class="lg-h">Submit a video</h1>
      <p class="lg-sub">Paste the link the moment it is live. A connected account proves ownership,
      but payout starts only after we verify the official TrueMax outro, campaign tag and disclosure.</p>
      <div class="lg-card lg-form" style="max-width:520px;margin-left:0">
        <label for="sb-sprint">Sprint</label>
        <select id="sb-sprint">${sprints.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>
        <div class="lg-proof-rule">
          <b>Before you post</b>
          <ol>
            <li>Finish with the rundown's embedded <b>Short CTA</b>, the optional <b>Long CTA</b> from <a href="/league/tools#cta">Creator Tools</a>, or a custom TrueMax CTA approved in review.</li>
            <li>Keep <code id="sb-tag">${esc(firstTag)}</code> in the public caption until the sprint is settled.</li>
            <li>Turn on the platform's paid partnership or commercial-content disclosure when required.</li>
          </ol>
        </div>
        <label for="sb-url">Video link</label>
        <input id="sb-url" type="url" placeholder="https://www.tiktok.com/@you/video/…" />
        <label for="sb-platform">Platform</label>
        <select id="sb-platform">
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
          <option value="youtube">YouTube</option>
        </select>
        <label class="lg-check"><input id="sb-cta" type="checkbox" />
          <span>I confirm this exact post ends with a clear TrueMax CTA.</span></label>
        <label class="lg-check"><input id="sb-disclosure" type="checkbox" />
          <span>I confirm its caption has the sprint tag and its commercial-content disclosure is correct.</span></label>
        <p style="margin-top:16px"><button class="lg-btn pri" id="sb-go" ${sprints.length ? "" : "disabled"}>Submit</button></p>
        <p class="lg-error" id="sb-err"></p>
      </div>`;
    const sprintSelect = mount.querySelector<HTMLSelectElement>("#sb-sprint")!;
    sprintSelect.onchange = () => {
      const selected = sprints.find((s) => s.id === sprintSelect.value);
      mount.querySelector<HTMLElement>("#sb-tag")!.textContent = campaignTag(selected?.campaign_tag) ?? DEFAULT_CAMPAIGN_TAG;
    };
    mount.querySelector<HTMLButtonElement>("#sb-go")!.onclick = async () => {
      const err = mount.querySelector<HTMLElement>("#sb-err")!;
      err.textContent = "";
      const url = mount.querySelector<HTMLInputElement>("#sb-url")!.value.trim();
      const platform = mount.querySelector<HTMLSelectElement>("#sb-platform")!.value;
      const validated = platformUrl(url, platform);
      if (!validated) {
        err.textContent = `That needs to be a full ${platform} https:// link.`;
        return;
      }
      if (!mount.querySelector<HTMLInputElement>("#sb-cta")!.checked
          || !mount.querySelector<HTMLInputElement>("#sb-disclosure")!.checked) {
        err.textContent = "Confirm the CTA, campaign tag and disclosure before submitting.";
        return;
      }
      const client = await getSupabaseClient();
      const attestedAt = new Date().toISOString();
      const { error } = await client.from("league_submissions").insert({
        creator_id: me.user_id,
        sprint_id: sprintSelect.value,
        url: validated.href,
        platform,
        creator_cta_attested_at: attestedAt,
        creator_disclosure_attested_at: attestedAt,
      });
      if (error) {
        err.textContent = /duplicate/i.test(error.message)
          ? "That video is already submitted. Every video counts once."
          : error.message;
        return;
      }
      void PAGES.mine(mount, me);
    };
  },

  async mine(mount, me) {
    mount.innerHTML = `<h1 class="lg-h">Your submissions</h1><p class="lg-sub">Loading…</p>`;
    const subs = await loadMySubmissions(me.user_id);
    const chip = (s: string) =>
      s === "pending" ? `<span class="lg-chip">IN REVIEW</span>`
      : s === "rejected" ? `<span class="lg-chip warn">REJECTED</span>`
      : `<span class="lg-chip ok">${s.toUpperCase().replace("_", " ")}</span>`;
    mount.innerHTML = `<h1 class="lg-h">Your submissions</h1>
      ${subs.length ? `<div class="lg-card">${subs.map((s) => `
        <div class="lg-row">
          ${externalLink(s.url, s.url.replace(/^https:\/\/(www\.)?/, "").slice(0, 48))}
          <span style="display:flex;gap:8px">
            ${s.tiktok_video_id ? `<span class="lg-chip ok">AUTO-TRACKED</span>` : ""}
            ${s.caption_compliant ? `<span class="lg-chip ok">TAG VERIFIED</span>` : `<span class="lg-chip warn">TAG WAITING</span>`}
            ${s.cta_verified_at ? `<span class="lg-chip ok">${esc((s.cta_variant ?? "CTA").toUpperCase())} CTA</span>` : `<span class="lg-chip warn">CTA REVIEW</span>`}
            ${chip(s.status)}
          </span>
          ${s.compliance_hold_reason ? `<p class="lg-note" style="width:100%">${esc(s.compliance_hold_reason)}</p>` : ""}
          ${s.review_note ? `<p class="lg-note" style="width:100%">Review: ${esc(s.review_note)}</p>` : ""}
          ${!s.creator_cta_attested_at || !s.creator_disclosure_attested_at
            ? `<p style="width:100%;margin:8px 0 0"><button class="lg-btn" data-attest="${s.id}">Confirm CTA and disclosure</button></p>`
            : ""}
        </div>`).join("")}</div>`
      : `<div class="lg-card"><h3>Nothing yet</h3><p class="lg-sub">Post, then submit the link. Every video counts.</p></div>`}`;
    mount.querySelectorAll<HTMLButtonElement>("[data-attest]").forEach((button) => {
      button.onclick = async () => {
        if (!window.confirm("Confirm that this exact post ends with the official TrueMax CTA, keeps the sprint hashtag, and has the correct commercial-content disclosure?")) return;
        button.disabled = true;
        const client = await getSupabaseClient();
        const { data, error } = await client.rpc("attest_league_submission", {
          p_submission_id: button.dataset.attest!,
          p_cta_attested: true,
          p_disclosure_attested: true,
        });
        if (error || data !== true) {
          button.disabled = false;
          window.alert(error?.message ?? "The declaration was not saved.");
          return;
        }
        void PAGES.mine(mount, me);
      };
    });
  },

  async ranks(mount) {
    mount.innerHTML = `<h1 class="lg-h">Ranks</h1><p class="lg-sub">Loading…</p>`;
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc("league_leaderboard");
    if (error) {
      mount.innerHTML = `<h1 class="lg-h">Ranks</h1><p class="lg-error">${esc(error.message)}</p>`;
      return;
    }
    const rows = (data ?? []) as Array<{ display_name: string; handle: string; earned_cents: number }>;
    mount.innerHTML = `<h1 class="lg-h">Ranks</h1>
      <p class="lg-sub">Paid-out totals, all time. Real money that actually moved: nothing on
      this table is projected.</p>
      <div class="lg-card">${rows.length ? rows.map((r, i) => `
        <div class="lg-row">
          <span><b class="lg-num" style="color:var(--lg-mut);margin-right:12px">${i + 1}</b>
          ${esc(r.display_name)} <span class="lg-note">${esc(r.handle)}</span></span>
          <span class="lg-money">${fmtMoney(r.earned_cents)}</span>
        </div>`).join("") : `<p class="lg-sub">The table starts when the first payout lands.</p>`}</div>`;
  },

  async money(mount, me) {
    mount.innerHTML = `<h1 class="lg-h">Money</h1><p class="lg-sub">Loading…</p>`;
    const client = await getSupabaseClient();
    const [{ data, error: payoutError }, setup] = await Promise.all([
      client
      .from("league_payouts")
      .select("amount_cents,currency,note,status,due_at,transferred_at,created_at")
      .eq("creator_id", me.user_id)
      .order("created_at", { ascending: false }),
      payoutSetupHTML(),
    ]);
    if (payoutError) {
      mount.innerHTML = `<h1 class="lg-h">Money</h1><p class="lg-error">Payout history could not be loaded.</p>`;
      return;
    }
    const rows = (data ?? []) as Array<{
      amount_cents: number;
      currency: string;
      note: string | null;
      status: string;
      due_at: string | null;
      transferred_at: string | null;
      created_at: string;
    }>;
    const total = rows.filter((r) => r.status === "transferred").reduce((a, r) => a + r.amount_cents, 0);
    // Live accrual for formula sprints: the number that moves between
    // payouts, clearly marked as accruing rather than owed. Locked totals
    // become payout rows below at sprint close.
    const active = (await loadSprints()).filter((s) => sprintIsLive(s) && sprintFormula(s));
    const accrualCards = await Promise.all(active.map(async (s) => {
      const f = sprintFormula(s)!;
      const videos = await myVideoTotalsFor(s, me.user_id);
      const totals = sumTotals(videos);
      if (!unlocked(f, totals)) {
        const p = unlockProgress(f, totals);
        return `<div class="lg-card"><h3>${esc(s.name)}</h3>
          <div class="lg-row"><span>Earnings</span><span class="lg-chip">LOCKED</span></div>
          <div class="lg-bar"><i style="width:${Math.round(p * 100)}%"></i></div>
          <div class="lg-bar-note">${fmtCount(totals.views)} / ${fmtCount(f.thresholdViews)} views ·
          ${totals.comments} / ${f.thresholdComments} comments, cross both and every view you
          already have starts counting.</div></div>`;
      }
      const accrued = creatorAccruedCents(f, videos);
      return `<div class="lg-card"><h3>${esc(s.name)}</h3>
        <div class="lg-row"><span>Accruing this sprint</span><span class="lg-money">${fmtMoney(accrued)}</span></div>
        <div class="lg-bar-note">$${(f.rpmCents / 100).toFixed(2)} per 1,000 views, engagement-adjusted
        per video. Locks from the final counts at sprint close; if the whole pool
        (${fmtMoney(s.pool_cents)}) is oversubscribed, every payout scales by the same factor.</div>
      </div>`;
    }));
    mount.innerHTML = `<h1 class="lg-h">Money</h1>
      ${setup}
      ${accrualCards.join("")}
      <div class="lg-card"><div class="lg-row"><span>Sent to Stripe, all time</span>
      <span class="lg-money">${fmtMoney(total)}</span></div></div>
      ${rows.length ? `<div class="lg-card">${rows.map((r) => `
        <div class="lg-row">
          <span>${new Date(r.transferred_at ?? r.created_at).toLocaleDateString()} ${r.note ? `· ${esc(r.note)}` : ""}
          <span class="lg-note"> · ${r.status === "transferred" ? "sent to Stripe" : r.status.replace("_", " ")}</span></span>
          <span class="lg-money">${fmtMoney(r.amount_cents)} ${esc(r.currency.toUpperCase())}</span>
        </div>`).join("")}</div>` : `<p class="lg-sub">Payouts land here once a sprint settles.</p>`}`;
    bindPayoutSetup(mount);
  },

  /**
   * Offers: which tier this account is in, and what it would take to move up.
   *
   * The pay formula answers "how many people watched" and says nothing about
   * who. This is the other half, and it is deliberately the most transparent
   * page in the League: every floor is printed, the creator's own numbers are
   * printed next to them, and a shortfall names the exact gap. A creator
   * programme that rejects without a reason does not get posted in.
   */
  async offers(mount, me) {
    const client = await getSupabaseClient();
    const [tierRow, proofRow] = await Promise.all([
      client
        .from("league_audience_tiers")
        .select("tier, note, decided_at")
        .eq("user_id", me.user_id)
        .maybeSingle<{ tier: AudienceTier; note: string | null; decided_at: string }>(),
      client
        .from("league_audience_proofs")
        .select("status, note, submitted_at, tier1_share, usa_share, views_28d, videos_28d")
        .eq("user_id", me.user_id)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle<{
          status: string;
          note: string | null;
          submitted_at: string;
          tier1_share: number;
          usa_share: number;
          views_28d: number;
          videos_28d: number;
        }>(),
    ]);

    const mine: AudienceTier = tierRow.data?.tier ?? "unrated";
    const latest = proofRow.data ?? null;
    const claimed: AudienceStats | null = latest
      ? {
          tier1Share: Number(latest.tier1_share),
          usaShare: Number(latest.usa_share),
          views28d: Number(latest.views_28d),
          videos28d: Number(latest.videos_28d),
        }
      : null;

    const cards = TIER_RULES.filter((r) => r.id !== "unrated")
      .map((rule) => {
        const gap = claimed ? shortfall(rule, claimed) : [];
        const held = mine === rule.id;
        return `<div class="lg-card lg-offer${held ? " held" : ""}">
        <div class="lg-offer-h"><b>${rule.label.toUpperCase()}</b>${held ? `<span class="lg-chip ok">YOUR TIER</span>` : ""}</div>
        <p class="lg-sub">${esc(rule.blurb)}</p>
        <ul class="lg-offer-reqs">
          ${rule.minTier1Share ? `<li>${Math.round(rule.minTier1Share * 100)}% of views from Tier 1 countries</li>` : ""}
          ${rule.minUsaShare ? `<li>${Math.round(rule.minUsaShare * 100)}% of views from the United States</li>` : ""}
          <li>${fmtCount(rule.minViews28d)} views in the last 28 days</li>
          ${rule.minVideos28d > 1 ? `<li>across at least ${rule.minVideos28d} videos</li>` : ""}
        </ul>
        ${
          claimed && !held
            ? gap.length
              ? `<div class="lg-offer-gap"><b>What is missing</b><ul>${gap
                  .map((g) => `<li>${esc(g)}</li>`)
                  .join("")}</ul></div>`
              : `<div class="lg-offer-gap ok">Your submitted numbers clear every floor here. Waiting on review.</div>`
            : ""
        }
      </div>`;
      })
      .join("");

    // One breakdown at a time. A second pending row is not a thing the queue
    // should hold: the honest pattern is file, wait, hear why, file again, and
    // a unique index over the pending rows says so at the database as well.
    const pending = latest?.status === "pending";

    const status = !latest
      ? `<p class="lg-sub">Nothing submitted yet. Send your audience breakdown below and an admin will place your account.</p>`
      : latest.status === "pending"
        ? `<p class="lg-sub">Submitted ${new Date(latest.submitted_at).toLocaleDateString()}, waiting on review.</p>`
        : `<p class="lg-sub">Last review: <b>${esc(latest.status)}</b>${latest.note ? `. ${esc(latest.note)}` : ""}</p>`;

    mount.innerHTML = `<h1 class="lg-h">Offers</h1>
      <p class="lg-sub">Accounts are placed into a tier from where their viewers are, not just how many
      there are. A view from a country TrueMax cannot sell in still counts toward your totals; the tier
      is what decides the rate those totals are paid at.</p>
      <div class="lg-card">
        <div class="lg-row"><span>Your tier</span><span class="lg-money">${esc(ruleFor(mine).label)}</span></div>
        ${status}
        ${
          // What the submitted numbers would reach, said out loud while the
          // review is pending. It is what the claim reaches, not a decision:
          // a person still watches the recording against it.
          claimed && latest?.status === "pending" && tierFor(claimed) !== mine
            ? `<p class="lg-sub">On the numbers you sent, this account reaches
               <b>${esc(ruleFor(tierFor(claimed)).label)}</b>. The review decides.</p>`
            : ""
        }
        ${tierRow.data?.note ? `<p class="lg-sub">${esc(tierRow.data.note)}</p>` : ""}
      </div>
      <div class="lg-offers">${cards}</div>
      <h2 class="lg-h2">Send your audience breakdown</h2>
      <p class="lg-sub">Screen-record the audience page of your own platform analytics and link it, then
      type the same numbers in. A person watches the recording against what you typed.</p>
      ${pending
        ? `<div class="lg-card" style="max-width:520px;margin-left:0"><p class="lg-sub">One breakdown is
           already with the reviewer, so the form is closed until it comes back. If the numbers you sent
           were wrong, say so on the account email and it will be sent back rather than stacked up
           behind a second one.</p></div>`
        : `<div class="lg-card lg-form" style="max-width:520px;margin-left:0">
        <label for="au-platform">Account</label>
        <select id="au-platform">
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
        </select>
        <label for="au-url">Link to your screen recording</label>
        <input id="au-url" type="url" placeholder="https://…" />
        <label for="au-t1">% of views from Tier 1 countries</label>
        <input id="au-t1" type="number" min="0" max="100" step="0.1" />
        <label for="au-us">% of views from the United States</label>
        <input id="au-us" type="number" min="0" max="100" step="0.1" />
        <label for="au-views">Views in the last 28 days</label>
        <input id="au-views" type="number" min="0" step="1" />
        <label for="au-videos">Videos those views are spread across</label>
        <input id="au-videos" type="number" min="0" step="1" />
        <p class="lg-note" style="margin-top:14px">Tier 1 today: ${TIER_1.join(", ")}. The United States is
        inside Tier 1, so its share can never be the larger of the two.</p>
        <p style="margin-top:16px"><button class="lg-btn pri" id="au-go">Send for review</button></p>
        <p class="lg-error" id="au-err"></p>
      </div>`}`;

    // No form on screen, so nothing to wire. The pending state is the one the
    // database enforces too: one pending proof per account per platform.
    if (pending) return;

    document.getElementById("au-go")!.onclick = async () => {
      const err = document.getElementById("au-err")!;
      err.textContent = "";
      const num = (id: string) => Number((document.getElementById(id) as HTMLInputElement).value);
      const url = (document.getElementById("au-url") as HTMLInputElement).value.trim();
      let link: URL;
      try {
        link = new URL(url);
      } catch {
        err.textContent = "That needs to be a full https:// link to your recording.";
        return;
      }
      if (link.protocol !== "https:") {
        err.textContent = "That needs to be a full https:// link to your recording.";
        return;
      }
      const stats = {
        tier1Share: num("au-t1") / 100,
        usaShare: num("au-us") / 100,
        views28d: num("au-views"),
        videos28d: num("au-videos"),
      };
      // The message is chosen BEFORE the guard, because the guard is a type
      // predicate: inside its false branch the value has been narrowed away
      // and there is nothing left to read the mistake off.
      const wrongRow = stats.usaShare > stats.tier1Share;
      // The same check the database runs, so the message names the problem
      // rather than surfacing a constraint violation. The US share exceeding
      // the Tier 1 share is the commonest one: it means the wrong row was read.
      if (!statsArePossible(stats)) {
        err.textContent = wrongRow
          ? "The US is inside Tier 1, so its share cannot be larger. Check which row you read."
          : "Those numbers do not add up. Percentages are 0 to 100, and views need videos behind them.";
        return;
      }
      const { error } = await client.from("league_audience_proofs").insert({
        user_id: me.user_id,
        platform: (document.getElementById("au-platform") as HTMLSelectElement).value,
        proof_url: link.href,
        tier1_share: stats.tier1Share,
        usa_share: stats.usaShare,
        views_28d: stats.views28d,
        videos_28d: stats.videos28d,
      });
      if (error) {
        // The two failures a creator can actually cause get their own words.
        // A raw Postgres message is not something to put in front of somebody:
        // it names a constraint, and they need to know what to do next.
        err.textContent = error.code === "23505"
          ? "There is already a breakdown for that account waiting on review."
          : error.code === "42501"
            ? "Only approved League members can send a breakdown."
            : "That did not send. Check your connection and try again.";
        return;
      }
      // Shown back immediately, including which tier these numbers would reach,
      // so the creator knows what they have asked for rather than waiting to
      // find out. It is what the numbers CLAIM; the review decides.
      void PAGES.offers(mount, me);
    };
  },

  async tools(mount, me) {
    const granted = (id: string) => me.pillar_grants?.[id] === true;
    // The pillars, in the order a member meets them. Each granted card is a
    // real door: the hash tells /quick which room to open on arrival.
    // The Rundown was buried inside "CTA Generator", which nobody decodes —
    // the tool people click most is the narrated analysis video, so it stands
    // as its own door. Both video doors share the cta grant: they are the
    // same room in /quick and the same render meter; splitting the card is a
    // navigation fix, not a new entitlement.
    const tools = [
      {
        id: "cta", n: "01", name: "The Rundown",
        body: "The narrated analysis video: measurement by measurement across every photo you attach, voiced and captioned, ready to post.",
        needs: "A scan and 1-4 extra photos of the same face", href: "/league/tools#rundown",
      },
      {
        id: "cta", n: "02", name: "Video Studio",
        body: "Score videos, ratio videos, breakdowns and the outro, rendered in the house style, voiced, ready to post.",
        needs: "One photo · a face worth talking about", href: "/league/tools#cta",
      },
      {
        id: "polisher", n: "03", name: "The Polisher",
        body: "Clean up a soft clip on this device: sharpen, colour, and a 4K upscale for the ones worth it.",
        needs: "Your clips or photos · nothing uploaded", href: "/league/tools#polisher",
      },
      {
        id: "studio", n: "04", name: "Studio",
        body: "Describe a character, generate the before and after of the same face, then film them. The bone structure is identical in both shots because that is what a real glow-up does.",
        needs: "No photos, a description, and one render slot a pair", href: "/league/tools#ai",
      },
      {
        id: "clips", n: "05", name: "Clips Library",
        body: "Saved faces, celebrity references and demo exports to cut from, scored instantly, no rescan.",
        needs: "Nothing · it's all in the library", href: "/league/tools#clips",
      },
    ];
    mount.innerHTML = `<h1 class="lg-h">Tools</h1>
      <p class="lg-sub">What you see here is what your membership includes. Renders are the
      calls that cost us money (a voiceover, a 4K pass), everything else is unmetered.</p>
      <div class="lg-card" id="lg-quota-card">
        <div class="lg-row" style="border:none;padding:0 0 8px"><h3>Renders this month</h3>
        <b class="lg-num" id="lg-quota-num">– / ${me.monthly_render_quota}</b></div>
        <div class="lg-bar"><i id="lg-quota-fill" style="width:0%"></i></div>
        <div class="lg-bar-note">Resets on the 1st. Need more? Ask, quotas are set per creator.</div>
      </div>
      <div class="lg-tools">
      ${tools.map((t) => `<div class="lg-card lg-tool ${granted(t.id) ? "" : "off"}">
        <div class="lg-tool-kicker">${t.n}</div>
        <div class="lg-row" style="border:none;padding:0">
          <div><h3>${t.name}</h3><p class="lg-sub" style="margin:4px 0 6px">${t.body}</p>
          <p class="lg-note" style="margin:0">${t.needs}</p></div>
          ${granted(t.id)
            ? `<a class="lg-btn pri" href="${t.href}">Open</a>`
            : `<span class="lg-chip">NOT IN YOUR PLAN</span>`}
        </div></div>`).join("")}
      <div class="lg-card lg-tool off">
        <div class="lg-tool-kicker">06</div>
        <div class="lg-row" style="border:none;padding:0">
          <div><h3>Brand Engine</h3><p class="lg-sub" style="margin:4px 0 6px">Logos, marks and
          the house palette, how every TrueMax video gets its look.</p>
          <p class="lg-note" style="margin:0">Owner-run · assets land in your pillars automatically</p></div>
          <span class="lg-chip">OWNER ONLY</span>
        </div></div>
      </div>`;
    // Own usage, via the render_log RLS (a creator reads their own rows).
    // Loaded after paint so a slow count never blocks the cards.
    try {
      const client = await getSupabaseClient();
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const { count } = await client
        .from("league_render_log")
        .select("id", { count: "exact", head: true })
        .eq("creator_id", me.user_id)
        .gte("created_at", monthStart);
      const used = count ?? 0;
      const num = mount.querySelector<HTMLElement>("#lg-quota-num");
      const fill = mount.querySelector<HTMLElement>("#lg-quota-fill");
      if (num) num.textContent = `${used} / ${me.monthly_render_quota}`;
      if (fill) fill.style.width = `${Math.min(100, Math.round((used / Math.max(1, me.monthly_render_quota)) * 100))}%`;
    } catch {
      /* the bar simply stays at the dash — usage is a nicety, not a gate */
    }
  },

  async admin(mount) {
    mount.innerHTML = `<h1 class="lg-h">Admin</h1><p class="lg-sub">Loading…</p>`;
    const client = await getSupabaseClient();
    const [appResult, pendingResult, sprintResult, proofResult] = await Promise.all([
      client.from("league_creators").select("*").eq("status", "applied").order("created_at"),
      client.from("league_submissions").select("*").in("status", ["pending", "approved", "earning"]).order("created_at"),
      // Every status, drafts included — loadSprints deliberately hides drafts
      // from creators, and the admin is exactly who drafts exist for.
      client.from("league_sprints").select("*").order("starts_at", { ascending: false }),
      client
        .from("league_audience_proofs")
        .select("*")
        .eq("status", "pending")
        .order("submitted_at"),
    ]);
    const firstLoadError = [appResult.error, pendingResult.error, sprintResult.error, proofResult.error].find(Boolean);
    if (firstLoadError) {
      mount.innerHTML = `<h1 class="lg-h">Admin</h1><p class="lg-error">${esc(firstLoadError.message)}</p>`;
      return;
    }
    const { data: apps } = appResult;
    const { data: pending } = pendingResult;
    const { data: allSprints } = sprintResult;
    const { data: proofs } = proofResult;
    const applications = (apps ?? []) as (CreatorRow & { links: string[]; pitch: string | null })[];
    const subs = (pending ?? []) as SubmissionRow[];
    const sprints = (allSprints ?? []) as SprintRow[];
    const f = DEFAULT_FORMULA;
    const liveOffer = sprints.find((s) => sprintIsLive(s) && sprintFormula(s));
    const liveFormula = liveOffer ? sprintFormula(liveOffer) : null;
    const outreachDeal = liveOffer && liveFormula
      ? `$${(liveFormula.rpmCents / 100).toFixed(2)} per 1,000 views, engagement up to ${liveFormula.eMax.toFixed(1)}x, unlocking at ${fmtCount(liveFormula.thresholdViews)} combined views. The ${fmtMoney(liveOffer.pool_cents)} ${liveOffer.status === "active" ? "live" : "planned"} sprint pool closes ${new Date(liveOffer.ends_at).toLocaleDateString()}.`
      : "Applications are open, but there is no live sprint offer to quote yet. Send the application link and share exact terms when the next sprint activates.";

    const sprintChip = (s: string) =>
      s === "active" ? `<span class="lg-chip ok">ACTIVE</span>`
      : s === "closed" ? `<span class="lg-chip">CLOSED</span>`
      : `<span class="lg-chip warn">DRAFT</span>`;
    const day = (iso: string) => new Date(iso).toLocaleDateString();

    const audience = (proofs ?? []) as AudienceProofRow[];

    // What the numbers the creator typed would reach, computed here rather
    // than trusted from anywhere, so the reviewer is comparing the recording
    // against a tier this code derived from the same rules the offer page
    // printed. The decision is still theirs: accept places the tier, reject
    // does not.
    const audienceCard = `<div class="lg-card"><h3>Audience reviews · ${audience.length}</h3>
      ${audience.length ? "" : `<p class="lg-sub">Nothing waiting. Creators send their breakdown from the Offers page.</p>`}
      ${audience
        .map((p) => {
          const claim: AudienceStats = {
            tier1Share: Number(p.tier1_share),
            usaShare: Number(p.usa_share),
            views28d: Number(p.views_28d),
            videos28d: Number(p.videos_28d),
          };
          const reaches = tierFor(claim);
          return `<div class="lg-row" style="flex-wrap:wrap;gap:8px">
            <span style="flex:1;min-width:240px">
              <b>${esc(p.platform)}</b>
              <span class="lg-note">Tier 1 ${Math.round(claim.tier1Share * 100)}% ·
              US ${Math.round(claim.usaShare * 100)}% ·
              ${fmtCount(claim.views28d)} views · ${claim.videos28d} videos</span><br>
              <a href="${esc(p.proof_url)}" target="_blank" rel="noopener noreferrer">Watch the recording ↗</a>
            </span>
            <span style="display:flex;gap:8px;align-items:center">
              <span class="lg-chip${reaches === "unrated" ? " warn" : " ok"}">CLAIMS ${ruleFor(reaches).label.toUpperCase()}</span>
              <button class="lg-btn pri" data-aud-ok="${p.id}" data-aud-user="${p.user_id}" data-aud-tier="${reaches}">Place as ${ruleFor(reaches).label}</button>
              <button class="lg-btn danger" data-aud-no="${p.id}">Reject</button>
            </span>
          </div>`;
        })
        .join("")}
    </div>`;

    mount.innerHTML = `<h1 class="lg-h">Admin</h1>
      ${audienceCard}
      <div class="lg-card"><h3>Sprints · ${sprints.length}</h3>
        ${sprints.map((s) => `<div class="lg-row" style="flex-wrap:wrap">
          <span><b>${esc(s.name)}</b> <span class="lg-note">${day(s.starts_at)} → ${day(s.ends_at)} ·
          pool ${fmtMoney(s.pool_cents)} · ${esc(campaignTag(s.campaign_tag) ?? DEFAULT_CAMPAIGN_TAG)} ·
          ${sprintFormula(s) ? "formula" : "tier ladder"}</span></span>
          <span style="display:flex;gap:8px;align-items:center">
            ${sprintChip(s.status)}
            ${s.status === "draft" ? `<button class="lg-btn pri" data-sprint-activate="${s.id}">Activate</button>` : ""}
            ${s.status === "active" ? `<button class="lg-btn danger" data-sprint-close="${s.id}">Close</button>` : ""}
          </span>
        </div>`).join("") || `<p class="lg-sub">No sprints yet. The league starts when the first one goes active.</p>`}
        <div class="lg-sprint-new">
          <h3 style="margin-top:18px">New sprint</h3>
          <p class="lg-sub">Created as a DRAFT, creators see nothing until you activate it. The
          formula fields are the deal the gate advertises; change them here and this sprint pays
          differently, story included.</p>
          <div class="lg-sprint-grid">
            <label>Name <input id="sp-name" maxlength="60" placeholder="Sprint 1, September" /></label>
            <label>Pool ($) <input id="sp-pool" type="number" min="0" step="50" value="2000" /></label>
            <label>Currency <input id="sp-currency" maxlength="3" value="USD" /></label>
            <label>Required hashtag <input id="sp-tag" maxlength="33" value="${DEFAULT_CAMPAIGN_TAG}" /></label>
            <label>Starts <input id="sp-start" type="date" /></label>
            <label>Ends <input id="sp-end" type="date" /></label>
            <label>$ per 1,000 views <input id="sp-rpm" type="number" min="0" step="0.25" value="${(f.rpmCents / 100).toFixed(2)}" /></label>
            <label>Max engagement × <input id="sp-emax" type="number" min="1" step="0.1" value="${f.eMax}" /></label>
            <label>Unlock views <input id="sp-tviews" type="number" min="0" step="1000" value="${f.thresholdViews}" /></label>
            <label>Unlock comments <input id="sp-tcomments" type="number" min="0" value="${f.thresholdComments}" /></label>
            <label>Per-video cap ($) <input id="sp-vcap" type="number" min="0" step="50" value="${(f.videoCapCents / 100).toFixed(0)}" /></label>
            <label>Per-creator cap ($) <input id="sp-ccap" type="number" min="0" step="50" value="${(f.creatorCapCents / 100).toFixed(0)}" /></label>
          </div>
          <p style="margin-top:14px"><button class="lg-btn pri" id="sp-create">Create draft sprint</button></p>
          <p class="lg-error" id="sp-err"></p>
        </div>
      </div>

      <div class="lg-card"><h3>Applications · ${applications.length}</h3>${applications.map((a) => `
        <div class="lg-row" style="align-items:flex-start;flex-direction:column">
          <div style="width:100%"><b>${esc(a.display_name)}</b> <span class="lg-note">${esc(a.handle)} · ${esc(a.niche ?? "")}</span>
          ${a.pitch ? `<p class="lg-sub" style="margin:6px 0">${esc(a.pitch)}</p>` : ""}
          ${(a.links ?? []).map((l) => `<div>${externalLink(l, l.slice(0, 60))}</div>`).join("")}</div>
          <div class="lg-grants">
            <label><input type="checkbox" data-grant="cta" checked />CTA Generator</label>
            <label><input type="checkbox" data-grant="clips" checked />Clips Library</label>
            <label><input type="checkbox" data-grant="polisher" />Polisher</label>
            <label><input type="checkbox" data-grant="studio" />Studio</label>
            <label>Quota <input type="number" data-quota value="30" style="width:70px" /></label>
          </div>
          <div style="display:flex;gap:10px">
            <button class="lg-btn pri" data-approve="${a.user_id}">Approve</button>
            <button class="lg-btn danger" data-reject="${a.user_id}">Reject</button>
          </div>
        </div>`).join("") || `<p class="lg-sub">Inbox zero.</p>`}</div>

      <div class="lg-card"><h3>Submission compliance · ${subs.length}</h3>
        <p class="lg-sub">A linked account proves ownership only. Open every post and confirm
        the official TrueMax short or long outro is visibly present, the campaign tag remains in
        the caption, and the platform disclosure is on. Counts cannot accrue until all four checks pass.</p>
        ${subs.map((s) => {
          const waiting = s.status === "pending";
          const recheck = s.status === "approved" || s.status === "earning";
          const manuallyTracked = s.platform !== "tiktok" && (s.status === "approved" || s.status === "earning");
          return `
          <div class="lg-row" style="flex-wrap:wrap;align-items:flex-start">
            <span style="display:flex;gap:10px;align-items:center;min-width:0;flex-wrap:wrap">
              ${externalLink(s.url, s.url.slice(0, 52))}
              ${s.tiktok_video_id ? `<span class="lg-chip ok">OWNED</span>` : `<span class="lg-chip warn">OWNERSHIP WAITING</span>`}
              ${s.caption_compliant ? `<span class="lg-chip ok">TAG VERIFIED</span>` : `<span class="lg-chip warn">TAG WAITING</span>`}
              ${s.cta_verified_at ? `<span class="lg-chip ok">${esc((s.cta_variant ?? "CTA").toUpperCase())} CTA</span>` : ""}
            </span>
            ${s.caption_snapshot ? `<p class="lg-note" style="width:100%;margin:4px 0">Caption: ${esc(s.caption_snapshot.slice(0, 300))}</p>` : ""}
            ${s.compliance_hold_reason ? `<p class="lg-error" style="width:100%;margin:4px 0">${esc(s.compliance_hold_reason)}</p>` : ""}
            ${waiting || recheck ? `<div class="lg-review-checks">
              <label class="lg-check"><input type="checkbox" data-sub-viewed="${s.id}" />I opened and watched the actual post.</label>
              <label>Outro
                <select data-sub-cta="${s.id}"><option value="">Choose</option><option value="short">Short CTA</option><option value="long">Long CTA</option><option value="custom">Approved custom CTA</option></select>
              </label>
              ${s.platform === "tiktok" ? "" : `<label class="lg-check"><input type="checkbox" data-sub-caption="${s.id}" />Campaign tag is in the caption.</label>`}
              <label class="lg-check"><input type="checkbox" data-sub-disclosure="${s.id}" />Paid partnership / commercial disclosure is correct.</label>
              <button class="lg-btn pri" data-sub-approve="${s.id}">${waiting ? "Approve verified post" : "Re-check before settlement"}</button>
              <button class="lg-btn danger" data-sub-reject="${s.id}">Reject</button>
            </div>` : ""}
            ${manuallyTracked ? `<span class="lg-counts">
              <input type="number" min="0" placeholder="views" data-v="${s.id}" />
              <input type="number" min="0" placeholder="likes" data-l="${s.id}" />
              <input type="number" min="0" placeholder="comments" data-c="${s.id}" />
              <button class="lg-btn" data-snap="${s.id}">Record counts</button>
            </span>` : ""}
          </div>`;
        }).join("") || `<p class="lg-sub">Nothing waiting or earning.</p>`}</div>

      <div class="lg-card"><h3>Outreach</h3>
        <p class="lg-sub">The daily engine: 100 DMs and 50 emails, sent by hand, tracked by hand.
        The scripts are the proven structure, "Paid promo?" gets answered where a pitch gets
        scrolled past. Never lead with the deal; it's message two.</p>
        <div class="lg-scripts">
          ${[
            {
              t: "DM · message 1 (the opener)",
              s: "Paid promo?",
            },
            {
              t: "DM · message 2 (they replied)",
              s: `We run TrueMax: you scan your face, it scores it against real measurements, and a coach tells you what to actually work on. The scan looks strong on camera.\n\n${outreachDeal}\n\nWant the link to apply?`,
            },
            {
              t: "DM · follow-up (48h silence)",
              s: "Still open if you want it. Creators are getting paid per view this sprint, not per post. Two minutes to apply: truemax.app/league",
            },
            {
              t: "Email (from their bio / Linktree / YouTube About)",
              s: `Subject: Paid promo: your {niche} content\n\nHey {name},\n\nSaw {video}: that's exactly the style we pay for. We run TrueMax (truemax.app): a face-scan app that scores real facial measurements and coaches what to work on.\n\n${outreachDeal}\n\nApproved amounts are sent to your Stripe balance within 7 days of sprint close once payout setup is complete. Apply at truemax.app/league, two minutes. Happy to answer anything here first.\n`,
            },
          ].map((x, i) => `<div class="lg-row" style="align-items:flex-start">
            <div style="flex:1;min-width:0"><b style="font-size:13.5px">${x.t}</b>
            <pre class="lg-script" id="lg-script-${i}">${esc(x.s)}</pre></div>
            <button class="lg-btn" data-copy="${i}">Copy</button>
          </div>`).join("")}
        </div>
        <p class="lg-note" style="margin-top:12px">Where the addresses come from: TikTok/IG bios
        and Linktrees first, YouTube About tabs second (most mirror to Shorts). Clippers live in
        Whop clipping communities, clipping Discords, and under #clips #edits in the niche: the
        /league link is the whole pitch. Fill {name}, {video}, {niche} before sending; a script
        sent unfilled reads as spam because it is.</p>
      </div>

      <div class="lg-card"><h3>Settlement</h3>
        <p class="lg-sub">Closing a sprint freezes its final counts and computes every amount in
        one database transaction. The browser cannot supply or edit money. Review each immutable
        row, then approve its idempotent Stripe transfer.</p>
        <div id="lg-settle-sprints"></div>
        <div id="lg-settle-out"></div>
      </div>`;

    // Settlement rows are already frozen by the database. This client only
    // displays them, records the staff approval and asks the server to send the
    // exact stored amount to the exact stored creator account.
    {
      const closedSprints = (await loadSprints()).filter((s) => s.status === "closed" && sprintFormula(s));
      const box = mount.querySelector<HTMLElement>("#lg-settle-sprints")!;
      const out = mount.querySelector<HTMLElement>("#lg-settle-out")!;
      box.innerHTML = closedSprints.length
        ? closedSprints.map((s) => `<button class="lg-btn" data-settle="${s.id}" style="margin:6px 8px 0 0">Open · ${esc(s.name)}</button>`).join("")
        : `<p class="lg-sub">No closed formula sprint ready to settle.</p>`;
      mount.querySelectorAll<HTMLButtonElement>("[data-settle]").forEach((b) => {
        b.onclick = async () => {
          const sprint = closedSprints.find((s) => s.id === b.dataset.settle)!;
          out.innerHTML = `<p class="lg-sub">Loading frozen settlement…</p>`;
          const { data: payoutRows, error } = await client
            .from("league_payouts")
            .select("id,creator_display_name,creator_handle,amount_cents,accrued_cents,currency,status,final_views,final_comments,calculation,due_at")
            .eq("sprint_id", sprint.id)
            .order("amount_cents", { ascending: false });
          if (error) {
            out.innerHTML = `<p class="lg-error">${esc(error.message)}</p>`;
            return;
          }
          const rows = (payoutRows ?? []) as Array<{
            id: string;
            creator_display_name: string | null;
            creator_handle: string | null;
            amount_cents: number;
            accrued_cents: number | null;
            currency: string;
            status: string;
            final_views: number;
            final_comments: number;
            calculation: { totalAccruedCents?: number; poolScale?: number };
            due_at: string | null;
          }>;
          const total = rows.reduce((sum, row) => sum + row.amount_cents, 0);
          const totalAccrued = rows[0]?.calculation?.totalAccruedCents ?? rows.reduce((sum, row) => sum + (row.accrued_cents ?? 0), 0);
          const scale = rows[0]?.calculation?.poolScale ?? poolScale(sprint.pool_cents, totalAccrued);
          const actionLabel = (status: string) => status === "computed" ? "Approve and send"
            : status === "failed" ? "Retry transfer"
              : status === "approved" ? "Send transfer"
                : status === "processing" ? "Sending"
                  : "Sent to Stripe";
          out.innerHTML = `<div class="lg-row"><span>Total accrued</span><b class="lg-num">${fmtMoney(totalAccrued)}</b></div>
            <div class="lg-row"><span>Pool</span><b class="lg-num">${fmtMoney(sprint.pool_cents)}</b></div>
            <div class="lg-row"><span>Allocated exactly</span><b class="lg-num">${fmtMoney(total)}</b></div>
            <div class="lg-row"><span>Pro-rata factor</span><b class="lg-num">${Number(scale) === 1 ? "1.00, pool covers everyone" : Number(scale).toFixed(6)}</b></div>
            ${rows.map((r) => `<div class="lg-row">
              <span>${esc(r.creator_display_name ?? "Deleted creator")} <span class="lg-note">${esc(r.creator_handle ?? "")} ·
              ${fmtCount(r.final_views)} views · ${fmtCount(r.final_comments)} comments ·
              due ${r.due_at ? new Date(r.due_at).toLocaleDateString() : "after review"}</span></span>
              <span style="display:flex;gap:10px;align-items:center">
                <span class="lg-money">${fmtMoney(r.amount_cents)} ${esc(r.currency.toUpperCase())}</span>
                <button class="lg-btn" data-pay="${r.id}" ${["processing", "transferred"].includes(r.status) ? "disabled" : ""}>${actionLabel(r.status)}</button>
              </span>
            </div>`).join("") || `<p class="lg-sub">Nobody crossed the payout threshold.</p>`}`;
          out.querySelectorAll<HTMLButtonElement>("[data-pay]").forEach((btn) => {
            btn.onclick = async () => {
              const r = rows.find((row) => row.id === btn.dataset.pay);
              if (!r) return;
              btn.disabled = true;
              if (r.status === "computed") {
                const approval = await client.rpc("approve_league_payout", { p_payout_id: r.id });
                if (approval.error || approval.data !== true) {
                  btn.textContent = "Approval failed";
                  btn.disabled = false;
                  return;
                }
              }
              btn.textContent = "Sending…";
              const sent = await leaguePost<{ transferred?: boolean }>("/api/league-payout", { payoutId: r.id });
              btn.textContent = sent.ok && sent.data?.transferred
                ? "Sent to Stripe"
                : sent.status === 503 && r.status === "computed"
                  ? "Approved, transfers locked"
                  : sent.data?.error ?? "Failed, retry";
              if (!sent.ok) btn.disabled = false;
            };
          });
        };
      });
    }

    // Lifecycle changes are RPCs because direct writes cannot freeze counts and
    // settlement in one transaction.
    mount.querySelectorAll<HTMLButtonElement>("[data-sprint-activate]").forEach((b) => {
      b.onclick = async () => {
        const { data, error } = await client.rpc("activate_league_sprint", { p_sprint_id: b.dataset.sprintActivate! });
        if (error || data !== true) return window.alert(error?.message ?? "Sprint was not activated.");
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-sprint-close]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const { error } = await client.rpc("finalize_league_sprint", { p_sprint_id: b.dataset.sprintClose! });
        if (error) {
          b.disabled = false;
          return window.alert(error.message);
        }
        refresh();
      };
    });
    {
      const err = mount.querySelector<HTMLElement>("#sp-err")!;
      const num = (id: string) => Number(mount.querySelector<HTMLInputElement>(`#${id}`)?.value || 0);
      const str = (id: string) => mount.querySelector<HTMLInputElement>(`#${id}`)?.value.trim() ?? "";
      const create = mount.querySelector<HTMLButtonElement>("#sp-create");
      if (create) create.onclick = async () => {
        err.textContent = "";
        const name = str("sp-name");
        const starts = str("sp-start");
        const ends = str("sp-end");
        if (!name || !starts || !ends) {
          err.textContent = "Name and both dates.";
          return;
        }
        if (new Date(ends) <= new Date(starts)) {
          err.textContent = "The end has to come after the start.";
          return;
        }
        const tag = campaignTag(str("sp-tag"));
        if (str("sp-currency").toLowerCase() !== "usd" || !tag) {
          err.textContent = "Launch sprints use USD and one hashtag such as #truemax.";
          return;
        }
        const { error } = await client.rpc("create_league_sprint", {
          p_name: name,
          p_pool_cents: Math.round(num("sp-pool") * 100),
          p_currency: str("sp-currency").toLowerCase(),
          p_campaign_tag: tag,
          p_formula: {
            rpmCents: Math.round(num("sp-rpm") * 100),
            parCommentsPer1k: DEFAULT_FORMULA.parCommentsPer1k,
            eMin: DEFAULT_FORMULA.eMin,
            eMax: num("sp-emax"),
            thresholdViews: num("sp-tviews"),
            thresholdComments: num("sp-tcomments"),
            videoCapCents: Math.round(num("sp-vcap") * 100),
            creatorCapCents: Math.round(num("sp-ccap") * 100),
          },
          p_starts_at: new Date(starts).toISOString(),
          p_ends_at: new Date(ends).toISOString(),
        });
        if (error) {
          err.textContent = error.message;
          return;
        }
        refresh();
      };
    }

    mount.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => {
      b.onclick = async () => {
        const pre = mount.querySelector<HTMLElement>(`#lg-script-${b.dataset.copy}`);
        if (!pre) return;
        await navigator.clipboard.writeText(pre.textContent ?? "").catch(() => {});
        b.textContent = "Copied";
        window.setTimeout(() => (b.textContent = "Copy"), 1200);
      };
    });

    const refresh = () => void PAGES.admin(mount, undefined as never);

    // Both halves of a decision in one call.
    //
    // Placing a tier is two writes and they have to both land: the tier row is
    // upserted and the proof is marked accepted. As two requests from here
    // they could not, and only the first was even checked - a dropped second
    // request left a creator rated with their proof still pending, which the
    // one-pending-proof index then makes a state they cannot submit their way
    // out of. The RPC does both inside one transaction and takes the
    // reviewer's identity from the session rather than from this page.
    const review = async (
      b: HTMLButtonElement,
      proofId: string,
      accept: boolean,
      tier?: string,
      note?: string,
    ): Promise<void> => {
      b.disabled = true;
      const { error } = await client.rpc("league_review_audience_proof", {
        p_proof_id: proofId,
        p_accept: accept,
        p_tier: tier ?? null,
        p_note: note ?? null,
      });
      if (error) {
        b.disabled = false;
        window.alert(`Not saved: ${error.message}`);
        return;
      }
      refresh();
    };

    mount.querySelectorAll<HTMLButtonElement>("[data-aud-ok]").forEach((b) => {
      b.onclick = () => void review(b, b.dataset.audOk!, true, b.dataset.audTier!);
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-aud-no]").forEach((b) => {
      b.onclick = () => {
        // A reason, always. A rejection with no note is what makes a creator
        // programme feel arbitrary, and the creator can read this back. An
        // empty box still gets a sentence, supplied by the function.
        const note = window.prompt("Why is this being rejected? The creator sees this.");
        if (note === null) return;
        void review(b, b.dataset.audNo!, false, undefined, note);
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-approve]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const row = b.closest(".lg-row")!;
        const grants: Record<string, boolean> = {};
        row.querySelectorAll<HTMLInputElement>("[data-grant]").forEach((g) => (grants[g.dataset.grant!] = g.checked));
        const quota = Number(row.querySelector<HTMLInputElement>("[data-quota]")?.value || 30);
        const { error } = await client.from("league_creators").update({
          status: "approved", pillar_grants: grants, monthly_render_quota: quota,
          approved_at: new Date().toISOString(),
        }).eq("user_id", b.dataset.approve!);
        if (error) {
          b.disabled = false;
          return window.alert(`Creator was not approved: ${error.message}`);
        }
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-reject]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const { error } = await client.from("league_creators").update({ status: "rejected" }).eq("user_id", b.dataset.reject!);
        if (error) {
          b.disabled = false;
          return window.alert(`Creator was not rejected: ${error.message}`);
        }
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-sub-approve]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const id = b.dataset.subApprove!;
        const viewed = mount.querySelector<HTMLInputElement>(`[data-sub-viewed="${id}"]`)?.checked === true;
        const disclosure = mount.querySelector<HTMLInputElement>(`[data-sub-disclosure="${id}"]`)?.checked === true;
        const caption = mount.querySelector<HTMLInputElement>(`[data-sub-caption="${id}"]`)?.checked === true;
        const cta = mount.querySelector<HTMLSelectElement>(`[data-sub-cta="${id}"]`)?.value || null;
        const { error } = await client.rpc("review_league_submission", {
          p_submission_id: id,
          p_approved: true,
          p_cta_variant: cta,
          p_disclosure_verified: disclosure,
          p_caption_verified: caption,
          p_content_viewed: viewed,
          p_note: null,
        });
        if (error) {
          b.disabled = false;
          return window.alert(`Submission was not approved: ${error.message}. Open the post and complete every verification first.`);
        }
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-sub-reject]").forEach((b) => {
      b.onclick = async () => {
        const note = window.prompt("Why is this post being rejected? The creator sees this.");
        if (note === null) return;
        b.disabled = true;
        const { error } = await client.rpc("review_league_submission", {
          p_submission_id: b.dataset.subReject!,
          p_approved: false,
          p_cta_variant: null,
          p_disclosure_verified: false,
          p_caption_verified: false,
          p_content_viewed: false,
          p_note: note,
        });
        if (error) {
          b.disabled = false;
          return window.alert(`Submission was not rejected: ${error.message}`);
        }
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-snap]").forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.snap!;
        const num = (sel: string) => {
          const value = Number(mount.querySelector<HTMLInputElement>(`[data-${sel}="${id}"]`)?.value || 0);
          return Number.isSafeInteger(value) && value >= 0 ? value : null;
        };
        const views = num("v");
        const likes = num("l");
        const comments = num("c");
        if (views === null || likes === null || comments === null) {
          window.alert("Counts must be whole, non-negative numbers.");
          return;
        }
        b.disabled = true;
        const { error } = await client.from("league_stat_snapshots").insert({
          submission_id: id, views, likes, comments, source: "manual",
        });
        if (error) {
          b.disabled = false;
          b.textContent = "Record counts";
          return window.alert(`Counts were not recorded: ${error.message}`);
        }
        b.textContent = "Recorded";
        window.setTimeout(() => {
          b.textContent = "Record counts";
          b.disabled = false;
        }, 1400);
      };
    });
  },
};

// --- boot --------------------------------------------------------------------

async function boot(): Promise<void> {
  const user = await currentUser().catch(() => null);
  if (!user) return renderGate();

  // Back from TikTok: the redirect lands on /league?code=…&state=…. The state
  // must match the one this browser stashed before leaving — a redirect
  // carrying anything else is ignored, not exchanged — and the code is spent
  // server-side against the signed-in user before the URL is cleaned.
  const params = new URLSearchParams(location.search);
  const oauthCode = params.get("code");
  if (oauthCode) {
    const expectedState = sessionStorage.getItem("lg-tt-state");
    sessionStorage.removeItem("lg-tt-state");
    if (params.get("state") && params.get("state") === expectedState) {
      const exchanged = await apiTikTok("exchange", { code: oauthCode }).catch(() => null);
      if (!exchanged || exchanged.error) {
        sessionStorage.setItem("lg-tt-error", exchanged?.error ?? "TikTok could not be connected. Try again.");
      }
    } else {
      sessionStorage.setItem("lg-tt-error", "TikTok sign-in expired or did not match this browser. Try again.");
    }
    history.replaceState(null, "", location.pathname + location.hash);
  }

  const client = await getSupabaseClient();
  const [{ data: me }, { data: staffRow }] = await Promise.all([
    client.from("league_creators").select("*").eq("user_id", user.id).maybeSingle(),
    client.from("app_admins").select("user_id").maybeSingle(),
  ]);
  const staff = Boolean(staffRow);
  const row = me as CreatorRow | null;
  if (!row) {
    // Staff without a creator row still gets the dashboard — the founder needs
    // Admin without applying to their own league.
    if (staff) {
      return renderDash(
        { user_id: user.id, handle: "founder", display_name: "Founder", niche: null, status: "approved", pillar_grants: { cta: true, clips: true, polisher: true, studio: true }, monthly_render_quota: 9999 },
        true,
      );
    }
    return renderApply();
  }
  if (row.status !== "approved") return renderStatus(row);
  return renderDash(row, staff);
}

void boot();
