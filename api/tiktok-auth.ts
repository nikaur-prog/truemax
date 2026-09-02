import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";
import { freshTikTokAccess, listOwnTikTokVideos, tiktokClientKey, tiktokClientSecret, tiktokTokenRequest } from "./_tiktok.js";

// ---------------------------------------------------------------------------
// TikTok Login Kit + Display API, for League creators.
//
// One endpoint, four actions, because they are one lifecycle:
//
//   start      → the authorize URL (the server holds the client key, so the
//                client never needs it baked into a bundle)
//   exchange   → code → tokens, then the account's own display name; the row
//                is upserted with the SERVICE role and the tokens never
//                travel back to the browser
//   videos     → the creator's OWN videos with view/comment counts, via
//                video.list — the exact numbers the League pays on. Refreshes
//                the access token when it is near expiry.
//   disconnect → delete the row. Their tokens, their call.
//
// Access: staff or an approved League creator, same pair as every League
// door, same "Not found." to everybody else. The privacy shape is the
// product's standing rule: this reads only the AUTHENTICATED CREATOR'S OWN
// account (TikTok scopes it that way and so do we), and what it learns goes
// into their own submission tracking, never anywhere cross-user.
// ---------------------------------------------------------------------------

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const USERINFO_URL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url";
const SCOPES = "user.info.basic,video.list";

interface TikTokUserInfo {
  open_id?: string;
  display_name?: string;
  avatar_url?: string;
}

async function tiktokUserInfo(access: string): Promise<TikTokUserInfo | null> {
  const response = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access}` } });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => ({}))) as { data?: { user?: TikTokUserInfo } };
  return payload.data?.user ?? null;
}

function redirectUri(): string {
  // Must byte-match the URI registered in the TikTok app's Login Kit config.
  return process.env.TIKTOK_REDIRECT_URI || "https://www.truemax.app/league";
}

async function memberOrStaff(userId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const [{ data: staff, error: staffError }, { data: creator, error: creatorError }] = await Promise.all([
    admin.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle<{ user_id: string }>(),
    admin.from("league_creators").select("status").eq("user_id", userId).maybeSingle<{ status: string }>(),
  ]);
  if (staffError || creatorError) throw new Error(staffError?.message || creatorError?.message);
  return Boolean(staff) || creator?.status === "approved";
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin calls are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    if (!(await memberOrStaff(user.id))) return json({ error: "Not found." }, 404);

    if (!tiktokClientKey() || !tiktokClientSecret()) {
      return json({ error: "TikTok is not configured on this deployment." }, 503);
    }

    const body = (await request.json().catch(() => null)) as
      | { action?: string; code?: string }
      | null;
    const admin = getSupabaseAdmin();

    if (body?.action === "start") {
      // The state is generated here and verified by the CLIENT against the
      // copy it kept in sessionStorage — the standard CSRF pairing. The code
      // exchange below is additionally bound to the signed-in user, so a
      // forged redirect cannot attach an attacker's TikTok to someone else.
      const state = crypto.randomUUID();
      const url =
        `${AUTH_URL}?client_key=${encodeURIComponent(tiktokClientKey())}` +
        `&scope=${encodeURIComponent(SCOPES)}&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirectUri())}&state=${state}`;
      return json({ url, state });
    }

    if (body?.action === "exchange") {
      const code = typeof body.code === "string" ? body.code : "";
      if (!code) return json({ error: "No code to exchange." }, 400);
      const token = await tiktokTokenRequest({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(),
      });
      if (!token.access_token || !token.refresh_token) {
        console.error("TikTok exchange refused", token.error, token.error_description);
        return json({ error: "TikTok did not accept that sign-in. Try connecting again." }, 502);
      }
      const tiktokUser = await tiktokUserInfo(token.access_token);
      if (!tiktokUser) {
        console.error("TikTok user info refused");
        return json({ error: "TikTok account details could not be verified. Try connecting again." }, 502);
      }
      const openId = tiktokUser?.open_id?.trim() || token.open_id?.trim();
      if (!openId) {
        return json({ error: "TikTok account details could not be verified. Try connecting again." }, 502);
      }
      const { error } = await admin.from("league_tiktok_accounts").upsert({
        user_id: user.id,
        open_id: openId,
        display_name: tiktokUser?.display_name ?? null,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
      });
      if (error) throw new Error(error.message);
      return json({ displayName: tiktokUser?.display_name ?? null });
    }

    if (body?.action === "videos") {
      const { data: row, error: rowError } = await admin
        .from("league_tiktok_accounts")
        .select("access_token, refresh_token, expires_at, display_name")
        .eq("user_id", user.id)
        .maybeSingle<{ access_token: string; refresh_token: string; expires_at: string; display_name: string | null }>();
      if (rowError) throw new Error(rowError.message);
      if (!row) return json({ error: "No TikTok account is linked." }, 400);

      // Refresh-and-persist lives in _tiktok.ts, shared with the nightly
      // tracker — two copies of refresh logic is how one stops refreshing.
      const access = await freshTikTokAccess(user.id, row);
      if (!access) return json({ error: "The TikTok link has expired. Connect it again." }, 401);

      // Covers are intentionally fetched at view time. TikTok signs those CDN
      // URLs for only a few hours, so persisting them would create a gallery of
      // broken images. The player itself is also returned only as an embed URL;
      // TrueMax never downloads or re-hosts the creator's videos.
      const [videos, profile] = await Promise.all([
        listOwnTikTokVideos(access, 20, undefined, true),
        tiktokUserInfo(access),
      ]);
      if (!videos) {
        return json({ error: "TikTok would not list videos just now. Try again shortly." }, 502);
      }
      return json({
        videos,
        profile: {
          displayName: profile?.display_name ?? row.display_name,
          avatarUrl: profile?.avatar_url ?? null,
        },
        syncedAt: new Date().toISOString(),
      });
    }

    if (body?.action === "disconnect") {
      const { error } = await admin.from("league_tiktok_accounts").delete().eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("tiktok-auth failed", safeMessage(error));
    return json({ error: "TikTok could not be reached safely. Try again shortly." }, 500);
  }
}
