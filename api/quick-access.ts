import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";
import { isQuickOwner, normalizedQuickGrants } from "./_quickAccess.js";

interface AdminRow {
  user_id: string;
  note: string | null;
}

interface CreatorAccessRow {
  status: string;
  pillar_grants: Record<string, unknown> | null;
}

/**
 * The server-authoritative door for /quick.
 *
 * The previous gate read two RLS-protected tables directly in the browser.
 * That kept honest visitors out, but also made owner-only rooms synonymous
 * with any staff account. This endpoint resolves the role once with the
 * service client and returns only the four grant booleans the page needs.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin calls are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ allowed: false }, 401);

    const admin = getSupabaseAdmin();
    const [adminResult, creatorResult] = await Promise.all([
      admin
        .from("app_admins")
        .select("user_id,note")
        .eq("user_id", user.id)
        .maybeSingle<AdminRow>(),
      admin
        .from("league_creators")
        .select("status,pillar_grants")
        .eq("user_id", user.id)
        .maybeSingle<CreatorAccessRow>(),
    ]);
    const error = adminResult.error || creatorResult.error;
    if (error) throw new Error(error.message);

    const staff = Boolean(adminResult.data);
    const approved = creatorResult.data?.status === "approved";
    if (!staff && !approved) return json({ allowed: false }, 404);

    return json({
      allowed: true,
      staff,
      owner: isQuickOwner(adminResult.data?.note),
      userId: user.id,
      grants: normalizedQuickGrants(creatorResult.data?.pillar_grants, staff),
    });
  } catch (error) {
    console.error("quick-access failed", safeMessage(error));
    return json({ allowed: false }, 503);
  }
}
