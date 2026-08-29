import { getSupabaseAdmin, json, safeMessage } from "./_shared.js";
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
  creator_id: string;
  url: string;
  status: string;
  tiktok_video_id: string | null;
  league_sprints?: { status?: string; starts_at?: string; ends_at?: string } | null;
}

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Not found." }, 404);
  }

  try {
    const admin = getSupabaseAdmin();
    const [{ data: links }, { data: subs }] = await Promise.all([
      admin.from("league_tiktok_accounts").select("user_id, access_token, refresh_token, expires_at"),
      // Pending rows are matched (ownership evidence for review); paying rows
      // are matched AND snapshotted. paid_out is settled history and rejected
      // is a decision — neither needs another number.
      admin
        .from("league_submissions")
        .select("id, creator_id, url, status, tiktok_video_id, league_sprints!inner(status,starts_at,ends_at)")
        .in("status", ["pending", "approved", "earning"])
        .eq("league_sprints.status", "active")
        .lte("league_sprints.starts_at", new Date().toISOString())
        .gt("league_sprints.ends_at", new Date().toISOString()),
    ]);

    const linked = (links ?? []) as LinkedRow[];
    const submissions = (subs ?? []) as SubmissionRow[];
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

    for (const link of linked) {
      const own = byCreator.get(link.user_id);
      // No live submissions: nothing to match, nothing to pay on — skip the
      // API call entirely rather than spending quota walking an empty list.
      if (!own?.length) continue;
      accounts += 1;

      const access = await freshTikTokAccess(link.user_id, link);
      if (!access) {
        deadLinks += 1;
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
        continue;
      }
      const byId = new Map(videos.map((v) => [v.id, v]));

      for (const sub of own) {
        const videoId = sub.tiktok_video_id ?? tiktokVideoIdFromUrl(sub.url);
        const video = videoId ? byId.get(videoId) : undefined;
        if (!video) continue;
        if (!sub.tiktok_video_id) {
          const { error } = await admin.from("league_submissions").update({ tiktok_video_id: video.id }).eq("id", sub.id);
          if (error) {
            console.error("league-track match failed", error.code);
            continue;
          }
          matched += 1;
        }
        if (sub.status === "approved" || sub.status === "earning") {
          const { error } = await admin.from("league_stat_snapshots").insert({
            submission_id: sub.id,
            views: video.views,
            likes: video.likes,
            comments: video.comments,
            shares: video.shares,
            source: "api",
          });
          if (error) console.error("league-track snapshot failed", error.code);
          else snapshots += 1;
        }
      }
    }

    return json({ accounts, deadLinks, matched, snapshots });
  } catch (error) {
    console.error("league-track failed", safeMessage(error));
    return json({ error: "Tracking failed." }, 500);
  }
}
