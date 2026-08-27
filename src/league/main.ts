import { getSupabaseClient, currentUser, signIn, signUp } from "../engine/auth.js";
import type { Tier } from "./tiers.js";
import { DEFAULT_TIERS, earnedCents, nextTier, combineLatest, fmtMoney, fmtCount } from "./tiers.js";

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
  starts_at: string;
  ends_at: string;
  status: string;
}

interface SubmissionRow {
  id: string;
  sprint_id: string;
  creator_id: string;
  url: string;
  platform: string;
  status: string;
  created_at: string;
}

const root = document.getElementById("league")!;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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

function topBarHTML(right = ""): string {
  return `<div class="lg-top">
    <div class="lg-mark"><img src="/brand/truemax-mark-512.png" alt="" />TRUEMAX <span class="lg-league">CREATOR LEAGUE</span></div>
    <div>${right}</div>
  </div>`;
}

// --- the gate ---------------------------------------------------------------

function renderGate(): void {
  document.title = "TrueMax Creator League";
  root.innerHTML = `${topBarHTML(`<button class="lg-btn" id="lg-signin">Sign in</button>`)}
  <div class="lg-gate">
    <span class="lg-chip ok">PAID ON VIEWS · APPLICATION ONLY</span>
    <h1>Make TrueMax videos.<br/>Get paid when they hit.</h1>
    <p class="lg-tagline">The face scan is the most filmable thing on this app. We hand you the
    tools that make the videos, you post in your own style, and the ladder below pays on the
    combined views across everything you post.</p>
    <div class="lg-montage">
      <!-- The montage master drops in as /league/montage.mp4 when rendered; the
           poster keeps the box honest until then. -->
      <video src="/league/montage.mp4" poster="/og.png" autoplay muted loop playsinline></video>
    </div>
    ${tierCardsHTML(DEFAULT_TIERS)}
    <p class="lg-note">Views and comments combine across all your TrueMax videos — every post
    counts. Comment floors keep it human. Paid at the highest rung you reach.</p>
    <ol class="lg-how">
      <li><b>Apply.</b> Two minutes — handles, niche, why you.</li>
      <li><b>Get approved.</b> Every application is reviewed by the founder. You get the tools
      that fit what you make.</li>
      <li><b>Post and track.</b> Submit each video's link; your dashboard shows views, earnings
      and the sprint pool live.</li>
    </ol>
    <p style="margin-top:26px"><button class="lg-btn pri" id="lg-apply">Apply to join</button></p>
    <div class="lg-form" id="lg-authbox" hidden>
      <label for="lg-email">Email</label>
      <input id="lg-email" type="email" autocomplete="email" />
      <label for="lg-pass">Password</label>
      <input id="lg-pass" type="password" autocomplete="new-password" />
      <p style="margin-top:16px"><button class="lg-btn pri" id="lg-auth-go">Continue</button></p>
      <p class="lg-error" id="lg-auth-err"></p>
      <p class="lg-note">One account for the app and the League. Signing up agrees to the
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
    if (!email || pass.length < 8) {
      err.textContent = "Email and a password of at least 8 characters.";
      return;
    }
    // Try sign-in first; a fresh visitor falls through to sign-up. One button,
    // because "do I already have an account?" is not the applicant's problem.
    const si = await signIn(email, pass);
    if (si.ok) return void boot();
    const su = await signUp(email, pass);
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
      .split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
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
    void PAGES[page](mount, me);
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

async function myTotalsFor(sprint: SprintRow, userId: string): Promise<{ views: number; comments: number }> {
  const client = await getSupabaseClient();
  const { data: subs } = await client
    .from("league_submissions")
    .select("id")
    .eq("creator_id", userId)
    .eq("sprint_id", sprint.id)
    .in("status", ["approved", "earning", "paid_out"]);
  const ids = (subs ?? []).map((s: { id: string }) => s.id);
  if (!ids.length) return { views: 0, comments: 0 };
  const { data: snaps } = await client
    .from("league_stat_snapshots")
    .select("submission_id, at, views, comments")
    .in("submission_id", ids);
  return combineLatest(
    (snaps ?? []).map((s: { submission_id: string; at: string; views: number; comments: number }) => ({
      submissionId: s.submission_id,
      at: Date.parse(s.at),
      views: s.views,
      comments: s.comments,
    })),
  );
}

const PAGES: Record<Page, (mount: HTMLElement, me: CreatorRow) => Promise<void> | void> = {
  async overview(mount, me) {
    mount.innerHTML = `<h1 class="lg-h">Overview</h1><p class="lg-sub">Loading…</p>`;
    const sprints = (await loadSprints()).filter((s) => s.status === "active");
    if (!sprints.length) {
      mount.innerHTML = `<h1 class="lg-h">Overview</h1>
        <div class="lg-card"><h3>No live sprint right now</h3>
        <p class="lg-sub">The next pool opens soon — anything you post in the meantime can be
        submitted once it does.</p></div>`;
      return;
    }
    const cards = await Promise.all(sprints.map(async (s) => {
      const totals = await myTotalsFor(s, me.user_id);
      const earned = earnedCents(s.tiers, totals);
      const next = nextTier(s.tiers, totals);
      return `<div class="lg-card">
        <div class="lg-row" style="border:none;padding:0 0 8px">
          <h3>${esc(s.name)}</h3><span class="lg-chip ok">POOL ${fmtMoney(s.pool_cents)}</span>
        </div>
        <div class="lg-row"><span>Your combined views</span><b class="lg-num">${fmtCount(totals.views)}</b></div>
        <div class="lg-row"><span>Your combined comments</span><b class="lg-num">${fmtCount(totals.comments)}</b></div>
        <div class="lg-row"><span>Earned so far</span><span class="lg-money">${fmtMoney(earned)}</span></div>
        ${next
          ? `<div class="lg-bar"><i style="width:${Math.round(next.progress * 100)}%"></i></div>
             <div class="lg-bar-note">Next rung: ${fmtMoney(next.tier.cents)} at ${fmtCount(next.tier.views)} views · ${next.tier.comments} comments</div>`
          : `<div class="lg-bar-note">Top rung reached. Well played.</div>`}
      </div>`;
    }));
    mount.innerHTML = `<h1 class="lg-h">Overview</h1>${cards.join("")}${tierCardsHTML(sprints[0].tiers)}`;
  },

  async submit(mount, me) {
    const sprints = (await loadSprints()).filter((s) => s.status === "active");
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
      if (!/^https:\/\//.test(url)) {
        err.textContent = "That needs to be a full https:// link.";
        return;
      }
      const client = await getSupabaseClient();
      const { error } = await client.from("league_submissions").insert({
        creator_id: me.user_id,
        sprint_id: (document.getElementById("sb-sprint") as HTMLSelectElement).value,
        url,
        platform: (document.getElementById("sb-platform") as HTMLSelectElement).value,
      });
      if (error) {
        err.textContent = /duplicate/i.test(error.message)
          ? "That video is already submitted — every video counts once."
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
          <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https:\/\/(www\.)?/, "").slice(0, 48))}</a>
          ${chip(s.status)}
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
    const { data } = await client
      .from("league_payouts")
      .select("amount_cents, note, status, created_at")
      .eq("creator_id", me.user_id)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Array<{ amount_cents: number; note: string | null; status: string; created_at: string }>;
    const total = rows.filter((r) => r.status === "paid").reduce((a, r) => a + r.amount_cents, 0);
    mount.innerHTML = `<h1 class="lg-h">Money</h1>
      <div class="lg-card"><div class="lg-row"><span>Paid out, all time</span>
      <span class="lg-money">${fmtMoney(total)}</span></div></div>
      ${rows.length ? `<div class="lg-card">${rows.map((r) => `
        <div class="lg-row">
          <span>${new Date(r.created_at).toLocaleDateString()} ${r.note ? `· ${esc(r.note)}` : ""}</span>
          <span class="lg-money">${fmtMoney(r.amount_cents)}</span>
        </div>`).join("")}</div>` : `<p class="lg-sub">Payouts land here once a sprint settles.</p>`}`;
  },

  tools(mount, me) {
    const granted = (id: string) => me.pillar_grants?.[id] === true;
    const tools = [
      { id: "cta", name: "CTA Generator", body: "Score videos, ratio videos, breakdowns and the outro — rendered in the house style, ready to post.", href: "/quick" },
      { id: "polisher", name: "The Polisher", body: "Clean up a soft clip: sharpen, colour, and a 4K upscale for the ones worth it.", href: "/quick" },
      { id: "clips", name: "Clips Library", body: "Celebrity and demo exports to cut from.", href: "/quick" },
    ];
    mount.innerHTML = `<h1 class="lg-h">Tools</h1>
      <p class="lg-sub">What you see here is what your membership includes — ${me.monthly_render_quota}
      renders a month across the lot.</p>
      ${tools.map((t) => `<div class="lg-card">
        <div class="lg-row" style="border:none;padding:0">
          <div><h3>${t.name}</h3><p class="lg-sub" style="margin:4px 0 0">${t.body}</p></div>
          ${granted(t.id)
            ? `<a class="lg-btn pri" href="${t.href}">Open</a>`
            : `<span class="lg-chip">NOT IN YOUR PLAN</span>`}
        </div></div>`).join("")}`;
  },

  async admin(mount) {
    mount.innerHTML = `<h1 class="lg-h">Admin</h1><p class="lg-sub">Loading…</p>`;
    const client = await getSupabaseClient();
    const [{ data: apps }, { data: pending }] = await Promise.all([
      client.from("league_creators").select("*").eq("status", "applied").order("created_at"),
      client.from("league_submissions").select("*").eq("status", "pending").order("created_at"),
    ]);
    const applications = (apps ?? []) as (CreatorRow & { links: string[]; pitch: string | null })[];
    const subs = (pending ?? []) as SubmissionRow[];

    mount.innerHTML = `<h1 class="lg-h">Admin</h1>
      <div class="lg-card"><h3>Applications · ${applications.length}</h3>${applications.map((a) => `
        <div class="lg-row" style="align-items:flex-start;flex-direction:column">
          <div style="width:100%"><b>${esc(a.display_name)}</b> <span class="lg-note">${esc(a.handle)} · ${esc(a.niche ?? "")}</span>
          ${a.pitch ? `<p class="lg-sub" style="margin:6px 0">${esc(a.pitch)}</p>` : ""}
          ${(a.links ?? []).map((l) => `<div><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.slice(0, 60))}</a></div>`).join("")}</div>
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

      <div class="lg-card"><h3>Submissions to review · ${subs.length}</h3>${subs.map((s) => `
        <div class="lg-row" style="flex-wrap:wrap">
          <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.slice(0, 52))}</a>
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
        </div>`).join("") || `<p class="lg-sub">Nothing waiting.</p>`}</div>`;

    const refresh = () => void PAGES.admin(mount, undefined as never);
    mount.querySelectorAll<HTMLButtonElement>("[data-approve]").forEach((b) => {
      b.onclick = async () => {
        const row = b.closest(".lg-row")!;
        const grants: Record<string, boolean> = {};
        row.querySelectorAll<HTMLInputElement>("[data-grant]").forEach((g) => (grants[g.dataset.grant!] = g.checked));
        const quota = Number(row.querySelector<HTMLInputElement>("[data-quota]")?.value || 30);
        await client.from("league_creators").update({
          status: "approved", pillar_grants: grants, monthly_render_quota: quota,
          approved_at: new Date().toISOString(),
        }).eq("user_id", b.dataset.approve!);
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-reject]").forEach((b) => {
      b.onclick = async () => {
        await client.from("league_creators").update({ status: "rejected" }).eq("user_id", b.dataset.reject!);
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-sub-approve]").forEach((b) => {
      b.onclick = async () => {
        await client.from("league_submissions").update({ status: "approved" }).eq("id", b.dataset.subApprove!);
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-sub-reject]").forEach((b) => {
      b.onclick = async () => {
        await client.from("league_submissions").update({ status: "rejected" }).eq("id", b.dataset.subReject!);
        refresh();
      };
    });
    mount.querySelectorAll<HTMLButtonElement>("[data-snap]").forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.snap!;
        const num = (sel: string) =>
          Math.max(0, Number(mount.querySelector<HTMLInputElement>(`[data-${sel}="${id}"]`)?.value || 0));
        await client.from("league_stat_snapshots").insert({
          submission_id: id, views: num("v"), likes: num("l"), comments: num("c"), source: "manual",
        });
        b.textContent = "Recorded";
        window.setTimeout(() => (b.textContent = "Record counts"), 1400);
      };
    });
  },
};

// --- boot --------------------------------------------------------------------

async function boot(): Promise<void> {
  const user = await currentUser().catch(() => null);
  if (!user) return renderGate();
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
        { user_id: user.id, handle: "founder", display_name: "Founder", niche: null, status: "approved", pillar_grants: { cta: true, clips: true, polisher: true }, monthly_render_quota: 9999 },
        true,
      );
    }
    return renderApply();
  }
  if (row.status !== "approved") return renderStatus(row);
  return renderDash(row, staff);
}

void boot();
