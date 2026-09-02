import { getSupabaseAdmin } from "./_shared.js";

// ---------------------------------------------------------------------------
// The TikTok client both callers share.
//
// /api/tiktok-auth is the interactive lifecycle (a creator connecting their
// own account); /api/league-track is the nightly walk over every linked
// account. Both need the same three things — a token exchange, a refresh
// that persists what it learned, and the video listing — and two copies of
// token-refresh logic is how one of them quietly stops refreshing.
// ---------------------------------------------------------------------------

export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

// Env values arrive however they were pasted. A key copied with a trailing
// newline produced client_key=%0Asbaw... in the authorize URL and TikTok
// refused the whole flow with "correct the following: client_key" — an error
// that reads like a portal misconfiguration and cost a debugging session.
// Trimming here fixes every paste of that shape at once.
export const tiktokClientKey = (): string => (process.env.TIKTOK_CLIENT_KEY || "").trim();
export const tiktokClientSecret = (): string => (process.env.TIKTOK_CLIENT_SECRET || "").trim();
const TRACKING_VIDEO_FIELDS =
  "id,title,video_description,view_count,like_count,comment_count,share_count,create_time,share_url";
const DISPLAY_VIDEO_FIELDS = `${TRACKING_VIDEO_FIELDS},duration,cover_image_url,embed_link`;
const videosUrl = (includeDisplay: boolean): string =>
  `https://open.tiktokapis.com/v2/video/list/?fields=${includeDisplay ? DISPLAY_VIDEO_FIELDS : TRACKING_VIDEO_FIELDS}`;

export interface TikTokTokenPayload {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
  error?: string;
  error_description?: string;
}

export async function tiktokTokenRequest(fields: Record<string, string>): Promise<TikTokTokenPayload> {
  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: tiktokClientKey(),
      client_secret: tiktokClientSecret(),
      ...fields,
    }).toString(),
  });
  const payload = (await response.json().catch(() => ({}))) as TikTokTokenPayload;
  return response.ok ? payload : { error: payload.error || "upstream_error" };
}

export interface LinkedTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

/**
 * A usable access token for a linked account, refreshing (and persisting the
 * refresh) when the stored one is within a minute of expiry. Null means the
 * link is dead — the creator has to reconnect — and the caller decides how
 * loudly to say so.
 */
export async function freshTikTokAccess(userId: string, row: LinkedTokens): Promise<string | null> {
  if (Date.parse(row.expires_at) >= Date.now() + 60_000) return row.access_token;
  const refreshed = await tiktokTokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token });
  const persistedWinner = async (): Promise<string | null> => {
    const { data, error } = await getSupabaseAdmin()
      .from("league_tiktok_accounts")
      .select("access_token,refresh_token,expires_at")
      .eq("user_id", userId)
      .maybeSingle<LinkedTokens>();
    if (error || !data || data.refresh_token === row.refresh_token) return null;
    return Date.parse(data.expires_at) >= Date.now() + 30_000 ? data.access_token : null;
  };
  if (!refreshed.access_token) return persistedWinner();
  const { data: updated, error } = await getSupabaseAdmin().from("league_tiktok_accounts").update({
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? row.refresh_token,
    expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(),
  })
    .eq("user_id", userId)
    // Only the request holding the refresh token it used may rotate the row.
    // A concurrent loser reads the persisted winner below.
    .eq("refresh_token", row.refresh_token)
    .select("access_token");
  if (error) return null;
  const saved = (updated as Array<{ access_token: string }> | null)?.[0]?.access_token;
  return saved || persistedWinner();
}

export interface TikTokVideo {
  id: string;
  title: string;
  description: string;
  duration: number;
  coverImageUrl: string;
  embedLink: string;
  createdAt: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  url: string;
}

/**
 * The account's own public videos, newest first, following the cursor up to
 * `max` items. Bounded on purpose: the League cares about recent submissions,
 * and walking a five-hundred-video back catalogue nightly is cost with no
 * customer.
 */
export async function listOwnTikTokVideos(
  access: string,
  max = 40,
  wantedIds?: ReadonlySet<string>,
  includeDisplay = false,
): Promise<TikTokVideo[] | null> {
  const out: TikTokVideo[] = [];
  const seen = new Set<string>();
  let cursor: number | undefined;
  for (let page = 0; page < Math.ceil(max / 20); page++) {
    const response = await fetch(videosUrl(includeDisplay), {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "content-type": "application/json" },
        body: JSON.stringify({ max_count: 20, ...(cursor !== undefined ? { cursor } : {}) }),
      });
    if (!response.ok) return page === 0 ? null : out;
    const listing = (await response.json().catch(() => ({}))) as {
      data?: {
        videos?: Array<{
          id?: string;
          title?: string;
          video_description?: string;
          duration?: number;
          cover_image_url?: string;
          embed_link?: string;
          create_time?: number;
          view_count?: number;
          like_count?: number;
          comment_count?: number;
          share_count?: number;
          share_url?: string;
        }>;
        cursor?: number;
        has_more?: boolean;
      };
      error?: { code?: string; message?: string };
    };
    const videos = listing.data?.videos;
    if (!videos) return page === 0 ? null : out;
    for (const v of videos) {
      if (!v.id || seen.has(v.id) || out.length >= max) continue;
      seen.add(v.id);
      out.push({
        id: v.id,
        title: v.title ?? "",
        description: v.video_description ?? "",
        duration: typeof v.duration === "number" && Number.isFinite(v.duration) ? Math.max(0, v.duration) : 0,
        coverImageUrl: v.cover_image_url ?? "",
        embedLink: v.embed_link ?? "",
        createdAt: typeof v.create_time === "number" && Number.isFinite(v.create_time) ? Math.max(0, v.create_time) : 0,
        views: v.view_count ?? 0,
        likes: v.like_count ?? 0,
        comments: v.comment_count ?? 0,
        shares: v.share_count ?? 0,
        url: v.share_url ?? "",
      });
    }
    if (wantedIds?.size && [...wantedIds].every((id) => out.some((video) => video.id === id))) break;
    if (!listing.data?.has_more || out.length >= max) break;
    const nextCursor = listing.data.cursor;
    if (typeof nextCursor !== "number" || !Number.isFinite(nextCursor) || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return out;
}

/**
 * The video id inside a TikTok URL, or null.
 *
 * Full links carry it as /video/<digits>; that is what the submission form
 * shows as its placeholder and what the share sheet produces on desktop.
 * Short vm.tiktok.com links do not carry the id and stay manually tracked —
 * resolving them would mean following redirects on someone else's domain
 * every night, which is a scraper, not an API client.
 */
export function tiktokVideoIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/(^|\.)tiktok\.com$/i.test(parsed.hostname)) return null;
    const match = /\/video\/(\d{6,})/.exec(parsed.pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
