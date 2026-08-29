import { getSupabaseClient, currentAccessToken, currentUser, signIn, signUp } from "../engine/auth.js";
import type { Tier } from "./tiers.js";
import { earnedCents, nextTier, fmtMoney, fmtCount } from "./tiers.js";
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
  /** Set by the nightly tracker when the URL matched a video on the
   *  creator's own linked TikTok — ownership proven, counts automatic. */
  tiktok_video_id: string | null;
}

const root = document.getElementById("league")!;

interface QueryError {
  code?: string;
  message: string;
}

function requireQuery(error: QueryError | null, operation: string): void {
  if (!error) return;
  console.error(`league ${operation} failed`, error.code ?? "query_failed");
  throw new Error(`${operation} could not be completed.`);
}

function showPageFailure(mount: HTMLElement): void {
  mount.innerHTML = `<h1 class="lg-h">Couldn't load this page</h1>
    <div class="lg-card"><p class="lg-error">Nothing was changed. Check the connection and try again.</p>
    <button class="lg-btn" id="lg-retry-page">Retry</button></div>`;
}

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
      <div class="lg-tier-req">per 1,000 views — every view counts</div>
    </div>
    <div class="lg-tier">
      <div class="lg-money">×${f.eMax.toFixed(1)}</div>
      <div class="lg-tier-req">engagement multiplier — real comments raise your rate</div>
    </div>
    <div class="lg-tier">
      <div class="lg-money">${fmtCount(f.thresholdViews)}</div>
      <div class="lg-tier-req">views to unlock — then every view you already have pays</div>
    </div>
    <div class="lg-tier">
      <div class="lg-money">7 days</div>
      <div class="lg-tier-req">from sprint close to payout</div>
    </div>
  </div>`;
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
    money — a flat rate per thousand, raised by real engagement.</p>
    <div class="lg-montage">
      <!-- The montage master drops in as /league/montage.mp4 when rendered; the
           poster keeps the box honest until then. -->
      <video src="/league/montage.mp4" poster="/og.png" autoplay muted loop playsinline></video>
    </div>
    ${formulaCardsHTML(DEFAULT_FORMULA)}
    <p class="lg-note">Views and comments combine across all your TrueMax videos — every post
    counts. No cliffs: 237k views is worth exactly what 237k views is worth. Comments are the
    bot filter — silent view farms earn half-rate.</p>
    <ol class="lg-how">
      <li><b>Apply.</b> Two minutes — handles, niche, why you.</li>
      <li><b>Get approved.</b> Every application is reviewed by the founder. You get the tools
      that fit what you make.</li>
      <li><b>Post and track.</b> Submit each video's link; your dashboard shows views, earnings
      and the sprint pool live.</li>
    </ol>
    <p style="margin-top:26px"><button class="lg-btn pri lg-cta" id="lg-apply">Apply to join</button></p>
    <div class="lg-form" id="lg-authbox" hidden>
      <h3 style="margin:0 0 2px">Sign in — or create your account</h3>
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
    err.textContent = su.message || si.message || "That didn't work — try again.";
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
      and earnings to other approved members — that's the game. Nothing else about your account
      is ever visible to anyone.</p>
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
    const { error } = await client.from("league_creators").insert({
      user_id: user.id,
      display_name: name,
      handle,
      niche: (document.getElementById("ap-niche") as HTMLSelectElement).value,
      links,
      pitch: (document.getElementById("ap-pitch") as HTMLTextAreaElement).value.trim() || null,
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
    ? { chip: "NOT THIS TIME", chipClass: "warn", body: "This application wasn't approved. That's sometimes about fit and timing rather than your content — you're welcome to reach out on the account email." }
    : row.status === "paused"
      ? { chip: "PAUSED", chipClass: "warn", body: "Your membership is paused. Reach out on the account email if that's unexpected." }
      : { chip: "IN REVIEW", chipClass: "ok", body: "Application received. Every one is read by the founder — you'll see the dashboard here the moment you're approved." };
  root.innerHTML = `${topBarHTML()}
  <div class="lg-gate">
    <span class="lg-chip ${copy.chipClass}">${copy.chip}</span>
    <h1 style="font-size:34px">Thanks, ${esc(row.display_name)}.</h1>
    <p class="lg-tagline">${copy.body}</p>
  </div>`;
}

// --- the dashboard -----------------------------------------------------------

type Page = "overview" | "submit" | "mine" | "ranks" | "money" | "tools" | "admin";

async function renderDash(me: CreatorRow, staff: boolean): Promise<void> {
  const pages: Array<[Page, string]> = [
    ["overview", "Overview"],
    ["submit", "Submit"],
    ["mine", "Submissions"],
    ["ranks", "Ranks"],
    ["money", "Money"],
    ["tools", "Tools"],
  ];
  if (staff) pages.push(["admin", "Admin"]);

  root.innerHTML = `${topBarHTML(`<span class="lg-chip ok">${esc(me.handle)}</span>`)}
  <div class="lg-shell">
    <nav class="lg-nav">${pages.map(([id, label]) => `<button data-page="${id}">${label}</button>`).join("")}</nav>
    <main class="lg-main" id="lg-page"></main>
  </div>`;

  const mount = document.getElementById("lg-page")!;
  const nav = [...root.querySelectorAll<HTMLButtonElement>(".lg-nav button")];
  const go = (page: Page) => {
    for (const b of nav) b.classList.toggle("on", b.dataset.page === page);
    location.hash = page;
    void Promise.resolve(PAGES[page](mount, me)).catch((error) => {
      console.error("league page failed", error);
      showPageFailure(mount);
      document.getElementById("lg-retry-page")?.addEventListener("click", () => go(page));
    });
  };
  for (const b of nav) b.onclick = () => go(b.dataset.page as Page);
  const initial = (location.hash.slice(1) || "overview") as Page;
  go(pages.some(([id]) => id === initial) ? initial : "overview");
}

async function loadSprints(): Promise<SprintRow[]> {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("league_sprints")
    .select("*")
    .in("status", ["active", "closed"])
    .order("starts_at", { ascending: false });
  requireQuery(error, "sprints load");
  return (data ?? []) as SprintRow[];
}

async function loadMySubmissions(userId: string): Promise<SubmissionRow[]> {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("league_submissions")
    .select("*")
    .eq("creator_id", userId)
    .order("created_at", { ascending: false });
  requireQuery(error, "submissions load");
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
  const { data: subs, error: submissionsError } = await client
    .from("league_submissions")
    .select("id")
    .eq("creator_id", userId)
    .eq("sprint_id", sprint.id)
    .in("status", ["approved", "earning", "paid_out"]);
  requireQuery(submissionsError, "earning submissions load");
  const ids = (subs ?? []).map((s: { id: string }) => s.id);
  if (!ids.length) return [];
  const { data: snaps, error: snapshotsError } = await client
    .from("league_stat_snapshots")
    .select("submission_id, at, views, comments")
    .in("submission_id", ids);
  requireQuery(snapshotsError, "earning snapshots load");
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
  const { data, error } = await client
    .from("league_tiktok_accounts")
    .select("display_name, open_id")
    .eq("user_id", me.user_id)
    .maybeSingle<{ display_name: string | null; open_id: string }>();
  if (error) {
    console.error("league TikTok link load failed", error.code);
    el.innerHTML = `<p class="lg-error">TikTok connection status couldn't be loaded. Try again shortly.</p>`;
    return;
  }
  const oauthError = sessionStorage.getItem("lg-tt-error");
  if (oauthError) sessionStorage.removeItem("lg-tt-error");

  if (!data) {
    el.innerHTML = `<div class="lg-row" style="border:none;padding:0">
      <div><h3>TikTok</h3><p class="lg-sub" style="margin:4px 0 0">Link your own account and the
      views and comments on your submitted videos count themselves — no screenshots, no waiting
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


const PAGES: Record<Page, (mount: HTMLElement, me: CreatorRow) => Promise<void> | void> = {
  async overview(mount, me) {
    mount.innerHTML = `<h1 class="lg-h">Overview</h1><p class="lg-sub">Loading…</p>`;
    const sprints = (await loadSprints()).filter((s) => sprintIsLive(s));
    if (!sprints.length) {
      mount.innerHTML = `<h1 class="lg-h">Overview</h1>
        <div class="lg-card"><h3>No live sprint right now</h3>
        <p class="lg-sub">The next pool opens soon — anything you post in the meantime can be
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
            ${f.thresholdComments} comments, combined — then it counts every view you already have.</div>
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
          its own ${factorText} engagement factor — locks at sprint close, paid within 7 days.</div>
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
    mount.innerHTML = `<h1 class="lg-h">Submit a video</h1>
      <p class="lg-sub">Paste the link the moment it's live. Only submitted, approved links count
      toward your totals — if we can't see it, we can't pay on it.</p>
      <div class="lg-card lg-form" style="max-width:520px;margin-left:0">
        <label for="sb-sprint">Sprint</label>
        <select id="sb-sprint">${sprints.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>
        <label for="sb-url">Video link</label>
        <input id="sb-url" type="url" placeholder="https://www.tiktok.com/@you/video/…" />
        <label for="sb-platform">Platform</label>
        <select id="sb-platform">
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
          <option value="youtube">YouTube</option>
        </select>
        <p style="margin-top:16px"><button class="lg-btn pri" id="sb-go" ${sprints.length ? "" : "disabled"}>Submit</button></p>
        <p class="lg-error" id="sb-err"></p>
      </div>`;
    document.getElementById("sb-go")!.onclick = async () => {
      const err = document.getElementById("sb-err")!;
      err.textContent = "";
      const url = (document.getElementById("sb-url") as HTMLInputElement).value.trim();
      const platform = (document.getElementById("sb-platform") as HTMLSelectElement).value;
      const validated = platformUrl(url, platform);
      if (!validated) {
        err.textContent = `That needs to be a full ${platform} https:// link.`;
        return;
      }
      const client = await getSupabaseClient();
      const { error } = await client.from("league_submissions").insert({
        creator_id: me.user_id,
        sprint_id: (document.getElementById("sb-sprint") as HTMLSelectElement).value,
        url: validated.href,
        platform,
      });
      if (error) {
        err.textContent = /duplicate/i.test(error.message)
          ? "That video is already submitted — every video counts once."
          : error.message;
        return;
      }
      void Promise.resolve(PAGES.mine(mount, me)).catch((loadError) => {
        console.error("league submissions refresh failed", loadError);
        showPageFailure(mount);
      });
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
            ${chip(s.status)}
          </span>
        </div>`).join("")}</div>`
      : `<div class="lg-card"><h3>Nothing yet</h3><p class="lg-sub">Post, then submit the link. Every video counts.</p></div>`}`;
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
      <p class="lg-sub">Paid-out totals, all time. Real money that actually moved — nothing on
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
    const { data, error } = await client
      .from("league_payouts")
      .select("amount_cents, note, status, created_at")
      .eq("creator_id", me.user_id)
      .order("created_at", { ascending: false });
    requireQuery(error, "payout history load");
    const rows = (data ?? []) as Array<{ amount_cents: number; note: string | null; status: string; created_at: string }>;
    const total = rows.filter((r) => r.status === "paid").reduce((a, r) => a + r.amount_cents, 0);
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
          ${totals.comments} / ${f.thresholdComments} comments — cross both and every view you
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
      ${accrualCards.join("")}
      <div class="lg-card"><div class="lg-row"><span>Paid out, all time</span>
      <span class="lg-money">${fmtMoney(total)}</span></div></div>
      ${rows.length ? `<div class="lg-card">${rows.map((r) => `
        <div class="lg-row">
          <span>${new Date(r.created_at).toLocaleDateString()} ${r.note ? `· ${esc(r.note)}` : ""}</span>
          <span class="lg-money">${fmtMoney(r.amount_cents)}</span>
        </div>`).join("")}</div>` : `<p class="lg-sub">Payouts land here once a sprint settles.</p>`}`;
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
        body: "Score videos, ratio videos, breakdowns and the outro — rendered in the house style, voiced, ready to post.",
        needs: "One photo · a face worth talking about", href: "/league/tools#cta",
      },
      {
        id: "polisher", n: "03", name: "The Polisher",
        body: "Clean up a soft clip on this device: sharpen, colour — and a 4K upscale for the ones worth it.",
        needs: "Your clips or photos · nothing uploaded", href: "/league/tools#polisher",
      },
      {
        id: "clips", n: "04", name: "Clips Library",
        body: "Saved faces, celebrity references and demo exports to cut from — scored instantly, no rescan.",
        needs: "Nothing · it's all in the library", href: "/league/tools#clips",
      },
    ];
    mount.innerHTML = `<h1 class="lg-h">Tools</h1>
      <p class="lg-sub">What you see here is what your membership includes. Renders are the
      calls that cost us money (a voiceover, a 4K pass) — everything else is unmetered.</p>
      <div class="lg-card" id="lg-quota-card">
        <div class="lg-row" style="border:none;padding:0 0 8px"><h3>Renders this month</h3>
        <b class="lg-num" id="lg-quota-num">— / ${me.monthly_render_quota}</b></div>
        <div class="lg-bar"><i id="lg-quota-fill" style="width:0%"></i></div>
        <div class="lg-bar-note">Resets on the 1st. Need more? Ask — quotas are set per creator.</div>
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
        <div class="lg-tool-kicker">05</div>
        <div class="lg-row" style="border:none;padding:0">
          <div><h3>Brand Engine</h3><p class="lg-sub" style="margin:4px 0 6px">Logos, marks and
          the house palette — how every TrueMax video gets its look.</p>
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
      const { count, error } = await client
        .from("league_render_log")
        .select("id", { count: "exact", head: true })
        .eq("creator_id", me.user_id)
        .gte("created_at", monthStart);
      requireQuery(error, "render usage load");
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
    const [appsResult, pendingResult, sprintsResult] = await Promise.all([
      client.from("league_creators").select("*").eq("status", "applied").order("created_at"),
      client.from("league_submissions").select("*").eq("status", "pending").order("created_at"),
      // Every status, drafts included — loadSprints deliberately hides drafts
      // from creators, and the admin is exactly who drafts exist for.
      client.from("league_sprints").select("*").order("starts_at", { ascending: false }),
    ]);
    requireQuery(appsResult.error, "applications load");
    requireQuery(pendingResult.error, "pending submissions load");
    requireQuery(sprintsResult.error, "admin sprints load");
    const applications = (appsResult.data ?? []) as (CreatorRow & { links: string[]; pitch: string | null })[];
    const subs = (pendingResult.data ?? []) as SubmissionRow[];
    const sprints = (sprintsResult.data ?? []) as SprintRow[];
    const f = DEFAULT_FORMULA;

    const sprintChip = (s: string) =>
      s === "active" ? `<span class="lg-chip ok">ACTIVE</span>`
      : s === "closed" ? `<span class="lg-chip">CLOSED</span>`
      : `<span class="lg-chip warn">DRAFT</span>`;
    const day = (iso: string) => new Date(iso).toLocaleDateString();

    mount.innerHTML = `<h1 class="lg-h">Admin</h1>
      <div class="lg-card"><h3>Sprints · ${sprints.length}</h3>
        ${sprints.map((s) => `<div class="lg-row" style="flex-wrap:wrap">
          <span><b>${esc(s.name)}</b> <span class="lg-note">${day(s.starts_at)} → ${day(s.ends_at)} ·
          pool ${fmtMoney(s.pool_cents)} · ${sprintFormula(s) ? "formula" : "tier ladder"}</span></span>
          <span style="display:flex;gap:8px;align-items:center">
            ${sprintChip(s.status)}
            ${s.status === "draft" ? `<button class="lg-btn pri" data-sprint-activate="${s.id}">Activate</button>` : ""}
            ${s.status === "active" ? `<button class="lg-btn danger" data-sprint-close="${s.id}">Close</button>` : ""}
          </span>
        </div>`).join("") || `<p class="lg-sub">No sprints yet — the league starts when the first one goes active.</p>`}
        <div class="lg-sprint-new">
          <h3 style="margin-top:18px">New sprint</h3>
          <p class="lg-sub">Created as a DRAFT — creators see nothing until you activate it. The
          formula fields are the deal the gate advertises; change them here and this sprint pays
          differently, story included.</p>
          <div class="lg-sprint-grid">
            <label>Name <input id="sp-name" maxlength="60" placeholder="Sprint 1 — September" /></label>
            <label>Pool ($) <input id="sp-pool" type="number" min="0" step="50" value="2000" /></label>
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
            <label>Quota <input type="number" data-quota value="30" style="width:70px" /></label>
          </div>
          <div style="display:flex;gap:10px">
            <button class="lg-btn pri" data-approve="${a.user_id}">Approve</button>
            <button class="lg-btn danger" data-reject="${a.user_id}">Reject</button>
          </div>
        </div>`).join("") || `<p class="lg-sub">Inbox zero.</p>`}</div>

      <div class="lg-card"><h3>Submissions to review · ${subs.length}</h3>
        <p class="lg-sub">ON LINKED ACCOUNT means the nightly tracker found this exact video on
        the creator's own connected TikTok — ownership is proven. Approval is still your call:
        it says the video is actually TrueMax content, which no API can check.</p>
        ${subs.map((s) => `
        <div class="lg-row" style="flex-wrap:wrap">
          <span style="display:flex;gap:10px;align-items:center;min-width:0">
            ${externalLink(s.url, s.url.slice(0, 52))}
            ${s.tiktok_video_id ? `<span class="lg-chip ok">ON LINKED ACCOUNT</span>` : ""}
          </span>
          <span style="display:flex;gap:8px;align-items:center">
            <button class="lg-btn pri" data-sub-approve="${s.id}">Approve</button>
            <button class="lg-btn danger" data-sub-reject="${s.id}">Reject</button>
          </span>
          <span class="lg-counts">
            <input type="number" placeholder="views" data-v="${s.id}" />
            <input type="number" placeholder="likes" data-l="${s.id}" />
            <input type="number" placeholder="comments" data-c="${s.id}" />
            <button class="lg-btn" data-snap="${s.id}">Record counts</button>
          </span>
        </div>`).join("") || `<p class="lg-sub">Nothing waiting.</p>`}</div>

      <div class="lg-card"><h3>Outreach</h3>
        <p class="lg-sub">The daily engine: 100 DMs and 50 emails, sent by hand, tracked by hand.
        The scripts are the proven structure — "Paid promo?" gets answered where a pitch gets
        scrolled past. Never lead with the deal; it's message two.</p>
        <div class="lg-scripts">
          ${[
            {
              t: "DM · message 1 (the opener)",
              s: "Paid promo?",
            },
            {
              t: "DM · message 2 (they replied)",
              s: "We run TrueMax — you scan your face, it scores it against real measurements, and a coach tells you what to actually work on. The scan looks insane on camera.\n\nWe pay $2 per 1,000 views on any video you make with it, engagement can raise that up to 1.3×, and it unlocks at 25k combined views — then every view you already have counts. Want the link to apply?",
            },
            {
              t: "DM · follow-up (48h silence)",
              s: "Still open if you want it — creators are getting paid per view this sprint, not per post. Two minutes to apply: truemax.app/league",
            },
            {
              t: "Email (from their bio / Linktree / YouTube About)",
              s: "Subject: Paid promo — your {niche} content\n\nHey {name},\n\nSaw {video} — that's exactly the style we pay for. We run TrueMax (truemax.app): a face-scan app that scores real facial measurements and coaches what to work on. The scan itself is the most filmable thing in the niche.\n\nThe deal: $2 per 1,000 views on videos made with the app, engagement raises the rate up to 1.3×, unlocks at 25k combined views and then counts everything retroactively. Pool is capped per sprint and paid within 7 days of close.\n\nApply at truemax.app/league — two minutes. Happy to answer anything on here first.\n",
            },
            {
              t: "Referral bounty (to anyone signed)",
              s: "$100 if you send a mate who gets approved and unlocks. Number or email is enough — we'll do the rest.",
            },
          ].map((x, i) => `<div class="lg-row" style="align-items:flex-start">
            <div style="flex:1;min-width:0"><b style="font-size:13.5px">${x.t}</b>
            <pre class="lg-script" id="lg-script-${i}">${esc(x.s)}</pre></div>
            <button class="lg-btn" data-copy="${i}">Copy</button>
          </div>`).join("")}
        </div>
        <p class="lg-note" style="margin-top:12px">Where the addresses come from: TikTok/IG bios
        and Linktrees first, YouTube About tabs second (most mirror to Shorts). Clippers live in
        Whop clipping communities, clipping Discords, and under #clips #edits in the niche — the
        /league link is the whole pitch. Fill {name}, {video}, {niche} before sending; a script
        sent unfilled reads as spam because it is.</p>
      </div>

      <div class="lg-card"><h3>Settlement</h3>
        <p class="lg-sub">Every approved creator's accrual under the sprint's formula, from the
        latest snapshots — with the pro-rata factor if the pool is oversubscribed. The suggested
        numbers ARE the payouts; recording them is still a decision you make per row.</p>
        <div id="lg-settle-sprints"></div>
        <div id="lg-settle-out"></div>
      </div>`;

    // Settlement: staff-only arithmetic over data staff can already read.
    // Client-side on purpose — the same earnings.ts the creators' own
    // dashboards use produces these numbers, so what a creator watched
    // accrue all month and what settlement offers can never disagree.
    {
      const sprints = (await loadSprints()).filter((s) => s.status === "closed" && sprintFormula(s));
      const box = mount.querySelector<HTMLElement>("#lg-settle-sprints")!;
      const out = mount.querySelector<HTMLElement>("#lg-settle-out")!;
      box.innerHTML = sprints.length
        ? sprints.map((s) => `<button class="lg-btn" data-settle="${s.id}" style="margin:6px 8px 0 0">Compute · ${esc(s.name)}</button>`).join("")
        : `<p class="lg-sub">No closed formula sprint ready to settle.</p>`;
      mount.querySelectorAll<HTMLButtonElement>("[data-settle]").forEach((b) => {
        b.onclick = async () => {
          try {
            const sprint = sprints.find((s) => s.id === b.dataset.settle)!;
            const f = sprintFormula(sprint)!;
            out.innerHTML = `<p class="lg-sub">Computing…</p>`;
            const { data: creators, error: creatorsError } = await client
            .from("league_creators").select("user_id, display_name, handle").eq("status", "approved");
            requireQuery(creatorsError, "settlement creators load");
            const rows = await Promise.all(((creators ?? []) as CreatorRow[]).map(async (c) => {
              const videos = await myVideoTotalsFor(sprint, c.user_id);
              return { c, accrued: creatorAccruedCents(f, videos), totals: sumTotals(videos) };
            }));
            const earning = rows.filter((r) => r.accrued > 0).sort((a, b2) => b2.accrued - a.accrued);
            const totalAccrued = earning.reduce((a, r) => a + r.accrued, 0);
            const scale = poolScale(sprint.pool_cents, totalAccrued);
            const { data: paidRows, error: paidError } = await client
              .from("league_payouts")
              .select("creator_id")
              .eq("sprint_id", sprint.id);
            requireQuery(paidError, "settlement payouts load");
            const paid = new Set((paidRows ?? []).map((row: { creator_id: string }) => row.creator_id));
            out.innerHTML = `
            <div class="lg-row"><span>Total accrued</span><b class="lg-num">${fmtMoney(totalAccrued)}</b></div>
            <div class="lg-row"><span>Pool</span><b class="lg-num">${fmtMoney(sprint.pool_cents)}</b></div>
            <div class="lg-row"><span>Pro-rata factor</span><b class="lg-num">${scale === 1 ? "1.00 — pool covers everyone" : scale.toFixed(3)}</b></div>
            ${earning.map((r, i) => `<div class="lg-row">
              <span>${esc(r.c.display_name)} <span class="lg-note">${esc(r.c.handle)} ·
              ${fmtCount(r.totals.views)} views</span></span>
              <span style="display:flex;gap:10px;align-items:center">
                <span class="lg-money">${fmtMoney(Math.round(r.accrued * scale))}</span>
                <button class="lg-btn" data-pay="${i}" ${paid.has(r.c.user_id) ? "disabled" : ""}>${paid.has(r.c.user_id) ? "Recorded" : "Record paid"}</button>
              </span>
            </div>`).join("") || `<p class="lg-sub">Nobody over the threshold yet.</p>`}`;
          // Recording a payout is the LAST step, pressed after the money has
          // actually moved — the row is what feeds the leaderboard and the
          // creator's own Money page, and both promise "real money that
          // actually moved". Per row rather than one big button, because each
          // transfer is its own decision and its own bank action.
            out.querySelectorAll<HTMLButtonElement>("[data-pay]").forEach((btn) => {
              btn.onclick = async () => {
                const r = earning[Number(btn.dataset.pay)];
                if (!r) return;
                btn.disabled = true;
                const { data: recorded, error } = await client.rpc("record_league_payout", {
                  p_sprint_id: sprint.id,
                  p_creator_id: r.c.user_id,
                  p_amount_cents: Math.round(r.accrued * scale),
                  p_note: sprint.name,
                });
                btn.textContent = error ? "Failed — retry" : recorded === false ? "Already recorded" : "Recorded";
                if (error) btn.disabled = false;
              };
            });
          } catch (error) {
            console.error("league settlement computation failed", error);
            out.innerHTML = `<p class="lg-error">Settlement could not be computed. Nothing was changed; retry when the connection is stable.</p>`;
          }
        };
      });
    }

    // Sprint lifecycle. Draft → active is the launch; active → closed freezes
    // the counts settlement reads. Both are staff-only writes RLS already
    // enforces — these buttons are the convenience, not the boundary.
    mount.querySelectorAll<HTMLButtonElement>("[data-sprint-activate]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const { error } = await client.from("league_sprints").update({ status: "active" }).eq("id", b.dataset.sprintActivate!);
        if (error) {
          console.error("league sprint activation failed", error.code);
          b.textContent = "Failed — retry";
          b.disabled = false;
          return;
        }
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-sprint-close]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = "Refreshing final counts…";
        const token = await currentAccessToken().catch(() => null);
        const response = await fetch("/api/league-track", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sprintId: b.dataset.sprintClose }),
        }).catch(() => null);
        const result = response
          ? await response.json().catch(() => null) as { error?: string } | null
          : null;
        if (!response?.ok) {
          b.textContent = result?.error ?? "Close failed — retry";
          b.disabled = false;
          return;
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
        const { error } = await client.from("league_sprints").insert({
          name,
          pool_cents: Math.round(num("sp-pool") * 100),
          // tiers is the legacy ladder column and NOT NULL; a formula sprint
          // carries an empty ladder and the formula does the paying.
          tiers: [],
          formula: {
            rpmCents: Math.round(num("sp-rpm") * 100),
            eMax: num("sp-emax"),
            thresholdViews: num("sp-tviews"),
            thresholdComments: num("sp-tcomments"),
            videoCapCents: Math.round(num("sp-vcap") * 100),
            creatorCapCents: Math.round(num("sp-ccap") * 100),
          },
          starts_at: new Date(starts).toISOString(),
          ends_at: new Date(ends).toISOString(),
          status: "draft",
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

    const refresh = () => void Promise.resolve(PAGES.admin(mount, undefined as never)).catch((error) => {
      console.error("league admin refresh failed", error);
      showPageFailure(mount);
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
          console.error("league creator approval failed", error.code);
          b.textContent = "Failed — retry";
          b.disabled = false;
          return;
        }
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-reject]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const { error } = await client.from("league_creators").update({ status: "rejected" }).eq("user_id", b.dataset.reject!);
        if (error) {
          console.error("league creator rejection failed", error.code);
          b.textContent = "Failed — retry";
          b.disabled = false;
          return;
        }
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-sub-approve]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const { error } = await client.from("league_submissions").update({ status: "approved" }).eq("id", b.dataset.subApprove!);
        if (error) {
          console.error("league submission approval failed", error.code);
          b.textContent = "Failed — retry";
          b.disabled = false;
          return;
        }
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-sub-reject]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const { error } = await client.from("league_submissions").update({ status: "rejected" }).eq("id", b.dataset.subReject!);
        if (error) {
          console.error("league submission rejection failed", error.code);
          b.textContent = "Failed — retry";
          b.disabled = false;
          return;
        }
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-snap]").forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.snap!;
        const num = (sel: string) =>
          Math.max(0, Number(mount.querySelector<HTMLInputElement>(`[data-${sel}="${id}"]`)?.value || 0));
        b.disabled = true;
        const { error } = await client.from("league_stat_snapshots").insert({
          submission_id: id, views: num("v"), likes: num("l"), comments: num("c"), source: "manual",
        });
        if (error) {
          console.error("league manual snapshot failed", error.code);
          b.textContent = "Failed — retry";
          b.disabled = false;
          return;
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
  const [creatorResult, staffResult] = await Promise.all([
    client.from("league_creators").select("*").eq("user_id", user.id).maybeSingle(),
    client.from("app_admins").select("user_id").maybeSingle(),
  ]);
  requireQuery(creatorResult.error, "creator account load");
  requireQuery(staffResult.error, "staff access load");
  const me = creatorResult.data;
  const staffRow = staffResult.data;
  const staff = Boolean(staffRow);
  const row = me as CreatorRow | null;
  if (!row) {
    // Staff without a creator row still gets the dashboard — the founder needs
    // Admin without applying to their own league.
    if (staff) {
      return renderDash(
        { user_id: user.id, handle: "founder", display_name: "Founder", niche: null, status: "approved", pillar_grants: { cta: true, clips: true, polisher: true }, monthly_render_quota: 9999 },
        true,
      );
    }
    return renderApply();
  }
  if (row.status !== "approved") return renderStatus(row);
  return renderDash(row, staff);
}

void boot().catch((error) => {
  console.error("league boot failed", error);
  root.innerHTML = `${topBarHTML()}<div class="lg-gate"><h1>Couldn't load the League</h1>
    <p class="lg-error">Nothing was changed. Check the connection and reload this page.</p></div>`;
});
