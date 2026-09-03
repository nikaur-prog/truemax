import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./_anthropicKey.js";
import {
  MAX_DAILY_MESSAGES,
  MAX_OUTPUT_TOKENS,
  buildSystemBlocks,
  sanitiseContext,
  sanitiseHistory,
} from "./_maxPersona.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";
import { maxAccessForUser } from "./_maxAccess.js";
import { conversationTitle, parsePlanMemoryCommand } from "./_maxConversation.js";

// ---------------------------------------------------------------------------
// Talking to Max.
//
// The only part of TrueMax that calls a language model, and it is deliberately
// the only part. Every score, every percentile and every line of the plan is
// computed by deterministic code, because a face app whose numbers come from a
// model gives two people the same face and two different answers. Max sits on
// top of finished numbers and explains them. He never produces one.
//
// The key lives here and nowhere else. It is read from the environment on the
// server, never shipped to the browser, and there is no endpoint that echoes it
// back. A client-side call would put a billable credential in a public bundle.
//
// Order of the gates below matters and is not cosmetic:
//
//   1. origin      — no cross-site use of somebody else's session
//   2. signed in   — no anonymous traffic at all
//   3. age         — under 18 gets a different Max, never no Max
//   4. tier        — the plan this was sold with
//   5. rate limit  — claimed BEFORE the model call, so a failure cannot be
//                    retried into a free ride
//
// Putting the rate limit last, after the expensive checks but before the
// expensive call, is the point: an account that is over its ceiling costs a
// database round trip, not a generation.
// ---------------------------------------------------------------------------

// Sonnet rather than Opus, and it is a margin decision rather than a quality
// one. Max answers short questions about a fixed set of numbers with the rules
// and the data already in front of him, which is not the shape of problem that
// needs the larger model, and the plan he sits behind is $11.99 a month. The
// name is overridable from the environment so this can be raised for a week and
// measured rather than argued about.
const DEFAULT_MODEL = "claude-sonnet-5";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ConversationRow {
  id: string;
  title: string;
}

interface StoredMessageRow {
  role: "user" | "assistant";
  content: string;
}

interface PlanItemRow {
  title: string;
  status: string;
}


// When the allowance day rolls over. claim_max_chat_turn keys usage on the UTC
// date, so the answer is the next UTC midnight, sent as a stamp for the client
// to render in the reader's own time zone (src/engine/maxAllowance.ts).
function nextUtcMidnight(now = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

function client(): Anthropic {
  return new Anthropic({ apiKey: anthropicKey() });
}

export async function POST(request: Request): Promise<Response> {
  let claimedUserId: string | null = null;
  const releaseClaim = async () => {
    const userId = claimedUserId;
    claimedUserId = null;
    if (!userId) return;
    const { error } = await getSupabaseAdmin().rpc("release_max_chat_turn", { p_user_id: userId });
    if (error) throw new Error(error.message);
  };
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin chat is not allowed." }, 403);

    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to talk to Max." }, 401);

    const access = await maxAccessForUser(user.id);
    if (!access.ok) return json({ error: access.error, upgrade: access.upgrade }, access.status);
    const age = access.age;
    const admin = getSupabaseAdmin();

    // Max the SUBSCRIPTION is 18+, which the checkout already enforces. So an
    // account reaching here under 18 is a staff account or a pre-existing
    // subscription, not a teenager who paid. The under-18 rules still apply,
    // because the gate that matters is who is reading the reply.
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const context = sanitiseContext(body?.context, age);
    if (!context) return json({ error: "Max could not read your scan." }, 400);

    // The body profile comes from the account row, never from the payload:
    // an adult on Max without one gets the no-diet-plan line in the prompt,
    // a minor gets nothing here because the under-18 rules already bar it,
    // and staff reading the chat without a subscription are simply shown
    // what they entered, if anything.
    if (age >= 18) {
      const { data: bodyRow, error: bodyError } = await admin
        .from("body_profiles")
        .select("height_cm,weight_kg")
        .eq("user_id", user.id)
        .maybeSingle<{ height_cm: number | string | null; weight_kg: number | string | null }>();
      if (bodyError) throw new Error(`Body profile could not be read: ${bodyError.message}`);
      const h = bodyRow?.height_cm == null ? null : Number(bodyRow.height_cm);
      const w = bodyRow?.weight_kg == null ? null : Number(bodyRow.weight_kg);
      context.bodyProfile = h !== null && w !== null && Number.isFinite(h) && Number.isFinite(w)
        ? { heightCm: h, weightKg: w }
        : access.staff ? undefined : "missing";
    }

    const incoming = sanitiseHistory(body?.messages);
    if (!incoming.length) return json({ error: "Say something to Max first." }, 400);
    if (incoming[incoming.length - 1].role !== "user") {
      return json({ error: "Max is already answering." }, 400);
    }
    const latest = incoming[incoming.length - 1].content;

    // Claimed before the model is called, and the claim is the whole rate
    // limit: it increments and tests in one statement, so two requests racing
    // cannot both pass the ceiling.
    const { data: remaining, error: claimError } = await admin.rpc("claim_max_chat_turn", {
      p_user_id: user.id,
      p_limit: MAX_DAILY_MESSAGES,
    });
    if (claimError) throw new Error(`Chat allowance is unavailable: ${claimError.message}`);
    if (typeof remaining === "number" && remaining < 0) {
      // The stamp is what the client formats into the person's own clock;
      // "tomorrow" on its own was a UTC day boundary quoted to somebody in
      // Auckland at lunchtime.
      return json(
        {
          error: `That is ${MAX_DAILY_MESSAGES} messages today, which is the daily limit. Max is back tomorrow.`,
          retryAfter: "tomorrow",
          resetsAt: nextUtcMidnight(),
        },
        429,
      );
    }
    claimedUserId = user.id;

    // A conversation is created by the first real message, never by merely
    // opening the panel. Empty abandoned chats therefore never pollute the
    // history list. Existing ids are always re-scoped to the authenticated
    // owner before a message is read or written.
    const requestedConversationId = typeof body?.conversationId === "string" && UUID.test(body.conversationId)
      ? body.conversationId
      : null;
    let conversation: ConversationRow | null = null;
    if (requestedConversationId) {
      const result = await admin
        .from("max_conversations")
        .select("id,title")
        .eq("id", requestedConversationId)
        .eq("user_id", user.id)
        .is("archived_at", null)
        .maybeSingle<ConversationRow>();
      if (result.error) throw new Error(`Max conversation lookup failed: ${result.error.message}`);
      if (!result.data) {
        await releaseClaim();
        return json({ error: "That Max chat could not be found." }, 404);
      }
      conversation = result.data;
    } else {
      const source = body?.source === "post_analysis" ? "post_analysis" : "dashboard";
      const result = await admin
        .from("max_conversations")
        .insert({ user_id: user.id, source, title: conversationTitle(latest) })
        .select("id,title")
        .single<ConversationRow>();
      if (result.error || !result.data) {
        throw new Error(`Max conversation creation failed: ${result.error?.message ?? "no row returned"}`);
      }
      conversation = result.data;
    }

    const turnId = typeof body?.turnId === "string" && UUID.test(body.turnId)
      ? body.turnId
      : crypto.randomUUID();
    const now = new Date().toISOString();
    const userInsert = await admin.from("max_messages").insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: "user",
      content: latest,
      client_turn_id: turnId,
      created_at: now,
    });
    if (userInsert.error) throw new Error(`Max message could not be saved: ${userInsert.error.message}`);

    let planChange: "added" | "not_working" | null = null;
    const command = parsePlanMemoryCommand(latest);
    if (command?.kind === "add") {
      const result = await admin.from("max_plan_items").upsert({
        user_id: user.id,
        title: command.title,
        normalized_title: command.normalizedTitle,
        category: command.category,
        status: "active",
        source_conversation_id: conversation.id,
        updated_at: now,
      }, { onConflict: "user_id,normalized_title" });
      if (result.error) throw new Error(`Max plan memory could not be updated: ${result.error.message}`);
      planChange = "added";
    } else if (command?.kind === "not_working") {
      const existing = await admin.from("max_plan_items")
        .update({
          status: "not_working",
          notes: "Member said this is not currently working.",
          source_conversation_id: conversation.id,
          updated_at: now,
        })
        .eq("user_id", user.id)
        .eq("normalized_title", command.normalizedTitle)
        .select("id");
      if (existing.error) throw new Error(`Max plan memory could not be updated: ${existing.error.message}`);
      if (!existing.data?.length) {
        const inserted = await admin.from("max_plan_items").insert({
          user_id: user.id,
          title: command.title,
          normalized_title: command.normalizedTitle,
          category: "other",
          status: "not_working",
          notes: "Member said this is not currently working.",
          source_conversation_id: conversation.id,
          updated_at: now,
        });
        if (inserted.error) throw new Error(`Max plan memory could not be updated: ${inserted.error.message}`);
      }
      planChange = "not_working";
    }

    const conversationUpdate = await admin
      .from("max_conversations")
      .update({ updated_at: now, last_message_at: now })
      .eq("id", conversation.id)
      .eq("user_id", user.id);
    if (conversationUpdate.error) throw new Error(`Max conversation could not be updated: ${conversationUpdate.error.message}`);

    const [messageResult, planResult] = await Promise.all([
      admin
        .from("max_messages")
        .select("role,content")
        .eq("conversation_id", conversation.id)
        .eq("user_id", user.id)
        .order("id", { ascending: false })
        .limit(24),
      admin
        .from("max_plan_items")
        .select("title,status")
        .eq("user_id", user.id)
        .in("status", ["active", "paused", "not_working"])
        .order("updated_at", { ascending: false })
        .limit(16),
    ]);
    if (messageResult.error) throw new Error(`Max history could not be read: ${messageResult.error.message}`);
    if (planResult.error) throw new Error(`Max plan memory could not be read: ${planResult.error.message}`);
    const stored = [...((messageResult.data ?? []) as StoredMessageRow[])].reverse();
    const history = sanitiseHistory(stored);
    for (const item of (planResult.data ?? []) as PlanItemRow[]) {
      const state = item.status === "not_working" ? "not working, needs an alternative" : item.status;
      context.activePlan.push(`${item.title}: ${state}`);
    }
    context.activePlan = [...new Set(context.activePlan)].slice(0, 16);

    const { shared, scoped } = buildSystemBlocks(context);
    const stream = client().messages.stream({
      model: process.env.MAX_CHAT_MODEL || DEFAULT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [
        // The breakpoint sits after the persona and the rules, which are
        // identical for everybody in this tone and age band. The scan block
        // after it changes per account and is not worth caching.
        { type: "text", text: shared, cache_control: { type: "ephemeral" } },
        { type: "text", text: scoped },
      ],
      messages: history,
    });

    // Plain text, streamed. Not server-sent events: there is nothing to
    // multiplex, the client only ever wants the next few characters, and a
    // reader over a text stream is a third of the code an EventSource parser
    // is. The remaining allowance rides in a header so the UI can warn before
    // somebody types the message that gets refused.
    const encoder = new TextEncoder();
    let deliveredText = false;
    let assistantText = "";
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              deliveredText = deliveredText || event.delta.text.length > 0;
              assistantText += event.delta.text;
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (error) {
          // The stream has already started, so the status line is long gone and
          // there is no way to turn this into an HTTP error. Say so in the body
          // instead; a message that stops mid-sentence with no explanation
          // reads as the app being broken.
          console.error("max-chat stream", safeMessage(error));
          controller.enqueue(encoder.encode("\n\nSorry, I lost my train of thought there. Ask me again?"));
        } finally {
          // A provider that failed before delivering any answer did not provide
          // the turn the member paid for. Partial answers still count: tokens
          // were delivered and the retry request is a new generation.
          if (!deliveredText) {
            await releaseClaim().catch((releaseError) => {
              console.error("max-chat allowance release", safeMessage(releaseError));
            });
          } else {
            claimedUserId = null;
            const savedAt = new Date().toISOString();
            const assistantInsert = await admin.from("max_messages").insert({
              conversation_id: conversation.id,
              user_id: user.id,
              role: "assistant",
              content: assistantText.trim().slice(0, 8000),
              created_at: savedAt,
            });
            const updated = assistantInsert.error ? null : await admin
              .from("max_conversations")
              .update({ updated_at: savedAt, last_message_at: savedAt })
              .eq("id", conversation.id)
              .eq("user_id", user.id);
            if (assistantInsert.error || updated?.error) {
              console.error("max-chat persistence", assistantInsert.error?.message ?? updated?.error?.message);
            }
          }
          controller.close();
        }
      },
      cancel() {
        // The reader went away, usually because the person navigated off or hit
        // stop. Abort the generation rather than paying for tokens nobody will
        // ever see.
        // A user-cancelled response still consumed provider work, so it keeps
        // its turn; only provider/setup failures are refunded above.
        claimedUserId = null;
        stream.abort();
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        // no-transform is what actually makes this a stream in production.
        // Without it the CDN compresses the response, and compression buffers:
        // every chunk sits in the compressor until the model finishes, and the
        // whole answer lands on the client at once — which on screen looks
        // like a long silence and then a wall of text. X-Accel-Buffering says
        // the same thing to any nginx-style proxy in between.
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "X-Max-Remaining": String(typeof remaining === "number" ? remaining : MAX_DAILY_MESSAGES),
        "X-Max-Resets-At": nextUtcMidnight(),
        "X-Max-Conversation": conversation.id,
        ...(planChange ? { "X-Max-Plan-Change": planChange } : {}),
      },
    });
  } catch (error) {
    console.error("max-chat", safeMessage(error));
    await releaseClaim().catch((releaseError) => {
      console.error("max-chat allowance release", safeMessage(releaseError));
    });
    return json({ error: "Max is not available right now. Try again shortly." }, 503);
  }
}
