import Anthropic from "@anthropic-ai/sdk";
import { ageOnDate } from "../src/engine/age.js";
import {
  MAX_DAILY_MESSAGES,
  MAX_OUTPUT_TOKENS,
  buildSystemBlocks,
  sanitiseContext,
  sanitiseHistory,
} from "./_maxPersona.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

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

interface ProfileRow {
  date_of_birth: string;
}

interface EntitlementRow {
  tier: string;
  status: string;
}

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing server environment variable: ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey });
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin chat is not allowed." }, 403);

    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to talk to Max." }, 401);

    const admin = getSupabaseAdmin();
    const [{ data: profile }, { data: entitlement }, { data: staff }] = await Promise.all([
      admin.from("profiles").select("date_of_birth").eq("user_id", user.id).maybeSingle<ProfileRow>(),
      admin.from("entitlements").select("tier,status").eq("user_id", user.id).maybeSingle<EntitlementRow>(),
      admin.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle<{ user_id: string }>(),
    ]);

    // No date of birth means the pathway questions were never finished, and
    // without an age there is no way to know which set of rules applies. Fail
    // closed: the under-18 rules exist precisely for the case where you cannot
    // tell, so refusing is the only safe answer.
    if (!profile) return json({ error: "Finish your pathway questions before chatting to Max." }, 409);
    const age = ageOnDate(profile.date_of_birth);
    if (age === null) return json({ error: "Your date of birth needs fixing before Max can help." }, 409);

    const isStaff = Boolean(staff);
    const live = Boolean(entitlement && ["active", "trialing"].includes(entitlement.status));
    const hasMax = isStaff || (live && entitlement?.tier === "max");
    if (!hasMax) {
      return json(
        {
          error: "Max coaching is part of the Max plan.",
          upgrade: "max",
        },
        402,
      );
    }

    // Max the SUBSCRIPTION is 18+, which the checkout already enforces. So an
    // account reaching here under 18 is a staff account or a pre-existing
    // subscription, not a teenager who paid. The under-18 rules still apply,
    // because the gate that matters is who is reading the reply.
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const context = sanitiseContext(body?.context, age);
    if (!context) return json({ error: "Max could not read your scan." }, 400);

    const history = sanitiseHistory(body?.messages);
    if (!history.length) return json({ error: "Say something to Max first." }, 400);
    if (history[history.length - 1].role !== "user") {
      return json({ error: "Max is already answering." }, 400);
    }

    // Claimed before the model is called, and the claim is the whole rate
    // limit: it increments and tests in one statement, so two requests racing
    // cannot both pass the ceiling.
    const { data: remaining, error: claimError } = await admin.rpc("claim_max_chat_turn", {
      p_user_id: user.id,
      p_limit: MAX_DAILY_MESSAGES,
    });
    if (claimError) throw new Error(`Chat allowance is unavailable: ${claimError.message}`);
    if (typeof remaining === "number" && remaining < 0) {
      return json(
        {
          error: `That is ${MAX_DAILY_MESSAGES} messages today, which is the daily limit. Max is back tomorrow.`,
          retryAfter: "tomorrow",
        },
        429,
      );
    }

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
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
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
          controller.close();
        }
      },
      cancel() {
        // The reader went away, usually because the person navigated off or hit
        // stop. Abort the generation rather than paying for tokens nobody will
        // ever see.
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
      },
    });
  } catch (error) {
    console.error("max-chat", safeMessage(error));
    return json({ error: "Max is not available right now. Try again shortly." }, 503);
  }
}
