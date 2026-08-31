import { getSupabaseAdmin, json, safeMessage } from "./_shared.js";
import { freshTikTokAccess, listOwnTikTokVideos, tiktokVideoIdFromUrl } from "./_tiktok.js";
import { captionIncludesCampaignTag, submissionCanAccrue } from "../src/league/compliance.js";

// ---------------------------------------------------------------------------
// The nightly count walk — Phase 2 tracking, closed.
//
// Once an hour (vercel.json crons), this walks every linked TikTok account,
// lists that account's own recent videos through the Display API, and does
// two things with the result:
//
//   1. MATCHES submitted URLs to the account's own video ids and stores the
//      match on the submission (tiktok_video_id). A match is proof the video
//      lives on the account the creator authorised — the ownership half of
//      review. The content half stays human: matching never auto-approves.
//
//   2. CHECKS the sprint hashtag from TikTok's own caption field. A linked
//      account proves ownership, but it does not prove a creator submitted
//      TrueMax content. A missing tag places the submission on compliance
//      hold and stops new counts.
//
//   3. SNAPSHOTS the counts only after a human has watched the actual video
//      and verified the embedded short, optional long, or an approved custom
//      TrueMax CTA plus the commercial-content disclosure. The database
//      repeats this gate, so this job cannot bypass it accidentally.
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
  caption_compliant: boolean;
  cta_verified_at: string | null;
  disclosure_verified_at: string | null;
  league_sprints?: { status?: string; starts_at?: string; ends_at?: string; campaign_tag?: string } | null;
}

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Not found." }, 404);
  }

  try {
    const admin = getSupabaseAdmin();
    const [linkResult, submissionResult] = await Promise.all([
      admin.from("league_tiktok_accounts").select("user_id, access_token, refresh_token, expires_at"),
      // Pending rows are matched (ownership evidence for review); paying rows
      // are matched AND snapshotted. paid_out is settled history and rejected
      // is a decision — neither needs another number.
      admin
        .from("league_submissions")
        .select("id, creator_id, url, status, tiktok_video_id, caption_compliant, cta_verified_at, disclosure_verified_at, league_sprints!inner(status,starts_at,ends_at,campaign_tag)")
        .in("status", ["pending", "approved", "earning"])
        .eq("platform", "tiktok")
        .eq("league_sprints.status", "active")
        .lte("league_sprints.starts_at", new Date().toISOString()),
    ]);
    if (linkResult.error) throw new Error(`TikTok account lookup failed: ${linkResult.error.message}`);
    if (submissionResult.error) throw new Error(`League submission lookup failed: ${submissionResult.error.message}`);

    const linked = (linkResult.data ?? []) as LinkedRow[];
    const submissions = (submissionResult.data ?? []) as SubmissionRow[];
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
    let complianceHolds = 0;

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
        if (!video) {
          if (sub.tiktok_video_id) {
            const { error } = await admin.from("league_submissions").update({
              caption_checked_at: new Date().toISOString(),
              caption_compliant: false,
              compliance_hold_reason: "The linked TikTok video is unavailable. Restore it before the sprint closes.",
            }).eq("id", sub.id);
            if (error) console.error("league-track unavailable hold failed", error.code);
            else complianceHolds += 1;
          }
          continue;
        }
        const compliant = captionIncludesCampaignTag(video.description, sub.league_sprints?.campaign_tag);
        const { error: complianceError } = await admin.from("league_submissions").update({
          tiktok_video_id: video.id,
          caption_snapshot: video.description,
          caption_checked_at: new Date().toISOString(),
          caption_compliant: compliant,
          compliance_hold_reason: compliant
            ? null
            : `The caption must keep ${sub.league_sprints?.campaign_tag ?? "the sprint tag"} until settlement.`,
        }).eq("id", sub.id);
        if (complianceError) {
          console.error("league-track compliance update failed", complianceError.code);
          continue;
        }
        if (!sub.tiktok_video_id) matched += 1;
        if (!compliant) complianceHolds += 1;

        const beforeDeadline = new Date(sub.league_sprints?.ends_at ?? 0).getTime() >= Date.now();
        if (beforeDeadline && submissionCanAccrue({
          status: sub.status,
          captionCompliant: compliant,
          ctaVerifiedAt: sub.cta_verified_at,
          disclosureVerifiedAt: sub.disclosure_verified_at,
        })) {
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

    return json({ accounts, deadLinks, matched, complianceHolds, snapshots });
  } catch (error) {
    console.error("league-track failed", safeMessage(error));
    return json({ error: "Tracking failed." }, 500);
  }
}
