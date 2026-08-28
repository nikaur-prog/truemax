import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";
import { freshTikTokAccess, listOwnTikTokVideos, tiktokTokenRequest } from "./_tiktok.js";

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
const USERINFO_URL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name";
const SCOPES = "user.info.basic,video.list";

function redirectUri(): string {
  // Must byte-match the URI registered in the TikTok app's Login Kit config.
  return process.env.TIKTOK_REDIRECT_URI || "https://www.truemax.app/league";
}

async function memberOrStaff(userId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const [{ data: staff }, { data: creator }] = await Promise.all([
    admin.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle<{ user_id: string }>(),
    admin.from("league_creators").select("status").eq("user_id", userId).maybeSingle<{ status: string }>(),
  ]);
  return Boolean(staff) || creator?.status === "approved";
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin calls are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    if (!(await memberOrStaff(user.id))) return json({ error: "Not found." }, 404);

    if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
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
        `${AUTH_URL}?client_key=${encodeURIComponent(process.env.TIKTOK_CLIENT_KEY)}` +
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
      const info = (await (
        await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token.access_token}` } })
      ).json().catch(() => ({}))) as { data?: { user?: { open_id?: string; display_name?: string } } };
      const tiktokUser = info.data?.user;
      const { error } = await admin.from("league_tiktok_accounts").upsert({
        user_id: user.id,
        open_id: tiktokUser?.open_id ?? token.open_id ?? "",
        display_name: tiktokUser?.display_name ?? null,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
      });
      if (error) throw new Error(error.message);
      return json({ displayName: tiktokUser?.display_name ?? null });
    }

    if (body?.action === "videos") {
      const { data: row } = await admin
        .from("league_tiktok_accounts")
        .select("access_token, refresh_token, expires_at")
        .eq("user_id", user.id)
        .maybeSingle<{ access_token: string; refresh_token: string; expires_at: string }>();
      if (!row) return json({ error: "No TikTok account is linked." }, 400);

      // Refresh-and-persist lives in _tiktok.ts, shared with the nightly
      // tracker — two copies of refresh logic is how one stops refreshing.
      const access = await freshTikTokAccess(user.id, row);
      if (!access) return json({ error: "The TikTok link has expired — connect it again." }, 401);

      const videos = await listOwnTikTokVideos(access, 10);
      if (!videos) {
        return json({ error: "TikTok would not list videos just now. Try again shortly." }, 502);
      }
      return json({ videos });
    }

    if (body?.action === "disconnect") {
      await admin.from("league_tiktok_accounts").delete().eq("user_id", user.id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("tiktok-auth failed", safeMessage(error));
    return json({ error: safeMessage(error) }, 500);
  }
}
