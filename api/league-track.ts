import {
  authenticatedUser,
  getSupabaseAdmin,
  json,
  requestOrigin,
  safeMessage,
} from "./_shared.js";
import { freshTikTokAccess, listOwnTikTokVideos, tiktokVideoIdFromUrl } from "./_tiktok.js";

// ---------------------------------------------------------------------------
// The nightly count walk — Phase 2 tracking, closed.
//
// Once a night (vercel.json crons), this walks every linked TikTok account,
// lists that account's own recent videos through the Display API, and does
// two things with the result:
//
//   1. MATCHES submitted URLs to the account's own video ids and stores the
//      match on the submission (tiktok_video_id). A match is proof the video
//      lives on the account the creator authorised — the ownership half of
//      review. The content half stays human: matching never auto-approves.
//
//   2. SNAPSHOTS the counts for every matched submission already in a paying
//      status (approved / earning), as league_stat_snapshots rows with
//      source 'api'. These are the exact numbers the pay formula reads, so
//      views and comments flow into accruals nightly with nobody typing.
//
// Privacy shape unchanged: each account's tokens read only that account's
// own videos, and what is learned lands only on that creator's own
// submissions. Nothing cross-user moves here.
//
// Failure posture: one dead link (expired refresh token, revoked consent)
// must not stop the walk — it is counted, skipped, and the creator's card
// on /league will tell them to reconnect the next time TikTok refuses their
// token interactively. The response body is a summary for the cron log.
// ---------------------------------------------------------------------------

interface LinkedRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface SubmissionRow {
  id: string;
  sprint_id: string;
  creator_id: string;
  url: string;
  platform: string;
  status: string;
  tiktok_video_id: string | null;
  league_sprints?: { status?: string; starts_at?: string; ends_at?: string } | null;
}

interface TrackingSummary {
  accounts: number;
  deadLinks: number;
  matched: number;
  snapshots: number;
  unresolved: number;
  pending: number;
}

async function track(sprintId?: string): Promise<TrackingSummary> {
  const admin = getSupabaseAdmin();
  let submissionQuery = admin
    .from("league_submissions")
    .select("id, sprint_id, creator_id, url, platform, status, tiktok_video_id, league_sprints!inner(status,starts_at,ends_at)")
    .in("status", ["pending", "approved", "earning"])
    .eq("league_sprints.status", "active")
    .lte("league_sprints.starts_at", new Date().toISOString());
  if (sprintId) submissionQuery = submissionQuery.eq("sprint_id", sprintId);

  const [linksResult, subsResult] = await Promise.all([
      admin.from("league_tiktok_accounts").select("user_id, access_token, refresh_token, expires_at"),
      // Pending rows are matched (ownership evidence for review); paying rows
      // are matched AND snapshotted. paid_out is settled history and rejected
      // is a decision — neither needs another number.
      // Ended-but-not-closed sprints remain eligible. The final staff close
      // calls this same walk before freezing settlement, so the last counts
      // cannot disappear in the gap between ends_at and the nightly cron.
      submissionQuery,
    ]);
  if (linksResult.error) throw new Error(`TikTok links query failed (${linksResult.error.code})`);
  if (subsResult.error) throw new Error(`League submissions query failed (${subsResult.error.code})`);

    const linked = (linksResult.data ?? []) as LinkedRow[];
    const submissions = (subsResult.data ?? []) as SubmissionRow[];
    const byCreator = new Map<string, SubmissionRow[]>();
    for (const s of submissions) {
      const list = byCreator.get(s.creator_id) ?? [];
      list.push(s);
      byCreator.set(s.creator_id, list);
    }

    let accounts = 0;
    let deadLinks = 0;
    let matched = 0;
    let snapshots = 0;
    let unresolved = 0;
    const pending = submissions.filter((sub) => sub.status === "pending").length;
    const payable = (sub: SubmissionRow) => sub.status === "approved" || sub.status === "earning";
    const linkedCreators = new Set(linked.map((link) => link.user_id));

    // Non-TikTok platforms are manual. Refuse a final close if an earning row
    // has never had counts recorded at all; otherwise settlement silently pays
    // it as zero.
    const manualSubmissions = submissions.filter((sub) => sub.platform !== "tiktok" && payable(sub));
    if (manualSubmissions.length) {
      const { data, error } = await admin
        .from("league_stat_snapshots")
        .select("submission_id, at")
        .in("submission_id", manualSubmissions.map((sub) => sub.id));
      if (error) throw new Error(`League snapshot query failed (${error.code})`);
      const latest = new Map<string, number>();
      for (const row of (data ?? []) as Array<{ submission_id: string; at: string }>) {
        latest.set(row.submission_id, Math.max(latest.get(row.submission_id) ?? 0, Date.parse(row.at) || 0));
      }
      unresolved += manualSubmissions.filter((sub) => {
        const endedAt = Date.parse(sub.league_sprints?.ends_at ?? "");
        return !Number.isFinite(endedAt) || (latest.get(sub.id) ?? 0) < endedAt;
      }).length;
    }

    // An earning TikTok submission with no linked account cannot be refreshed.
    unresolved += submissions.filter(
      (sub) => sub.platform === "tiktok" && payable(sub) && !linkedCreators.has(sub.creator_id),
    ).length;

    for (const link of linked) {
      const own = byCreator.get(link.user_id)?.filter((sub) => sub.platform === "tiktok");
      // No live submissions: nothing to match, nothing to pay on — skip the
      // API call entirely rather than spending quota walking an empty list.
      if (!own?.length) continue;
      accounts += 1;

      const access = await freshTikTokAccess(link.user_id, link);
      if (!access) {
        deadLinks += 1;
        unresolved += own.filter(payable).length;
        continue;
      }
      const wantedIds = new Set(
        own.map((sub) => sub.tiktok_video_id ?? tiktokVideoIdFromUrl(sub.url)).filter((id): id is string => Boolean(id)),
      );
      // Continue through recent pages until every submitted ID is found (or a
      // bounded 200-video ceiling), instead of silently forgetting submissions
      // older than the newest forty posts.
      const videos = await listOwnTikTokVideos(access, 200, wantedIds);
      if (!videos) {
        deadLinks += 1;
        unresolved += own.filter(payable).length;
        continue;
      }
      const byId = new Map(videos.map((v) => [v.id, v]));

      for (const sub of own) {
        const videoId = sub.tiktok_video_id ?? tiktokVideoIdFromUrl(sub.url);
        const video = videoId ? byId.get(videoId) : undefined;
        if (!video) {
          if (payable(sub)) unresolved += 1;
          continue;
        }
        if (!sub.tiktok_video_id) {
          const { error } = await admin.from("league_submissions").update({ tiktok_video_id: video.id }).eq("id", sub.id);
          if (error) {
            console.error("league-track match failed", error.code);
            continue;
          }
          matched += 1;
        }
        if (payable(sub)) {
          const { error } = await admin.from("league_stat_snapshots").insert({
            submission_id: sub.id,
            views: video.views,
            likes: video.likes,
            comments: video.comments,
            shares: video.shares,
            source: "api",
          });
          if (error) {
            console.error("league-track snapshot failed", error.code);
            unresolved += 1;
          }
          else snapshots += 1;
        }
      }
    }

    return { accounts, deadLinks, matched, snapshots, unresolved, pending };
}

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Not found." }, 404);
  }

  try {
    return json(await track());
  } catch (error) {
    console.error("league-track failed", safeMessage(error));
    return json({ error: "Tracking failed." }, 500);
  }
}

// Staff close is a server operation: refresh every payable video first, then
// freeze the sprint only when no pending review or missing final count remains.
export async function POST(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin calls are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    const admin = getSupabaseAdmin();
    const { data: staff, error: staffError } = await admin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle<{ user_id: string }>();
    if (staffError) throw new Error(`Staff query failed (${staffError.code})`);
    if (!staff) return json({ error: "Not found." }, 404);

    const body = (await request.json().catch(() => null)) as { sprintId?: unknown } | null;
    const sprintId = typeof body?.sprintId === "string" ? body.sprintId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sprintId)) {
      return json({ error: "A valid sprint is required." }, 400);
    }
    const { data: sprint, error: sprintError } = await admin
      .from("league_sprints")
      .select("id, status, ends_at")
      .eq("id", sprintId)
      .maybeSingle<{ id: string; status: string; ends_at: string }>();
    if (sprintError) throw new Error(`Sprint query failed (${sprintError.code})`);
    if (!sprint || sprint.status !== "active") return json({ error: "That sprint is not active." }, 409);
    if (Date.parse(sprint.ends_at) > Date.now()) {
      return json({ error: "The sprint is still running and cannot be closed yet." }, 409);
    }

    const summary = await track(sprintId);
    if (summary.pending || summary.deadLinks || summary.unresolved) {
      return json({
        error: "Final counts are incomplete. Review pending videos, reconnect dead TikTok links, and record missing manual counts before closing.",
        ...summary,
      }, 409);
    }

    const { data: closed, error: closeError } = await admin
      .from("league_sprints")
      .update({ status: "closed" })
      .eq("id", sprintId)
      .eq("status", "active")
      .select("id")
      .maybeSingle<{ id: string }>();
    if (closeError) throw new Error(`Sprint close failed (${closeError.code})`);
    if (!closed) return json({ error: "That sprint was already changed. Refresh and try again." }, 409);
    return json({ ok: true, ...summary });
  } catch (error) {
    console.error("league final close failed", safeMessage(error));
    return json({ error: "The sprint could not be closed safely." }, 500);
  }
}
