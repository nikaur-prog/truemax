import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";
import { maxAccessForUser } from "./_maxAccess.js";
import { loadRoutineMemory, syncRoutineMemory } from "./_maxRoutineSync.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Cross-origin chat access is not allowed." }, 403);
  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to see your Max chats." }, 401);
    const access = await maxAccessForUser(user.id);
    if (!access.ok) return json({ error: access.error, upgrade: access.upgrade }, access.status);

    const admin = getSupabaseAdmin();
    const id = new URL(request.url).searchParams.get("id");
    const { data: planItems, error: planError } = await admin
      .from("max_plan_items")
      .select("id,title,category,status,notes,created_at,updated_at")
      .eq("user_id", user.id)
      .not("normalized_title", "like", "protocol:%")
      .in("status", ["active", "paused", "not_working"])
      .order("updated_at", { ascending: false })
      .limit(40);
    if (planError) throw new Error(`Max plan memory is unavailable: ${planError.message}`);
    const routines = await loadRoutineMemory(admin, user.id);

    if (id) {
      if (!UUID.test(id)) return json({ error: "That Max chat could not be found." }, 404);
      const { data: conversation, error: conversationError } = await admin
        .from("max_conversations")
        .select("id,title,source,created_at,updated_at,last_message_at")
        .eq("id", id)
        .eq("user_id", user.id)
        .is("archived_at", null)
        .maybeSingle();
      if (conversationError) throw new Error(`Max chat is unavailable: ${conversationError.message}`);
      if (!conversation) return json({ error: "That Max chat could not be found." }, 404);
      const { data: newestMessages, error: messagesError } = await admin
        .from("max_messages")
        .select("id,role,content,created_at")
        .eq("conversation_id", id)
        .eq("user_id", user.id)
        .order("id", { ascending: false })
        .limit(80);
      if (messagesError) throw new Error(`Max messages are unavailable: ${messagesError.message}`);
      return json({ conversation, messages: [...(newestMessages ?? [])].reverse(), planItems: planItems ?? [], routines });
    }

    const { data: conversations, error: conversationsError } = await admin
      .from("max_conversations")
      .select("id,title,source,created_at,updated_at,last_message_at")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("last_message_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (conversationsError) throw new Error(`Max chats are unavailable: ${conversationsError.message}`);
    return json({ conversations: conversations ?? [], planItems: planItems ?? [], routines });
  } catch (error) {
    console.error("max-conversations", safeMessage(error));
    return json({ error: "Your Max chats are not available right now." }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Cross-origin plan updates are not allowed." }, 403);
  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to update your Max plan." }, 401);
    const access = await maxAccessForUser(user.id);
    if (!access.ok) return json({ error: access.error, upgrade: access.upgrade }, access.status);
    const body = await request.json().catch(() => null) as { items?: unknown } | null;
    const synced = await syncRoutineMemory(getSupabaseAdmin(), user.id, body?.items);
    return json({ synced: synced.length, routines: synced });
  } catch (error) {
    console.error("max-conversations sync", safeMessage(error));
    return json({ error: "Your Max plan could not be synced right now." }, 503);
  }
}
