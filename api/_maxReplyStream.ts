import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { maxReplyText } from "../src/engine/maxReplyText.js";
import { MAX_REPLY_EMPTY, MAX_REPLY_UNAVAILABLE, MAX_REPLY_INTERRUPTED, MAX_REPLY_LIMIT, MAX_REPLY_NOT_SAVED } from "../src/engine/maxReplyStatus.js";
export { MAX_REPLY_EMPTY, MAX_REPLY_UNAVAILABLE, MAX_REPLY_INTERRUPTED, MAX_REPLY_LIMIT, MAX_REPLY_NOT_SAVED } from "../src/engine/maxReplyStatus.js";

interface ReplySource extends AsyncIterable<RawMessageStreamEvent> { abort(): void }

export interface MaxReplyOutcome {
  /** The visible reply, including any interruption notice. Never just whitespace. */
  text: string;
  delivered: boolean;
  cancelled: boolean;
}

interface ReplyLifecycle {
  settle(outcome: MaxReplyOutcome): Promise<void>;
  cancel(): void;
  error(stage: "provider" | "persistence", error: unknown): void;
}

function hasReply(raw: string): boolean {
  return maxReplyText(raw).replace(/[\s\u200b-\u200f\u2060\ufeff]/gu, "").length > 0;
}

/** Provider completion, cancellation and persistence must all settle the HTTP body. */
export function createMaxReplyStream(source: ReplySource, lifecycle: ReplyLifecycle): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = "";
      let completed = false;
      let stopReason: string | null = null;
      let providerError: unknown;
      const append = (part: string): void => {
        if (cancelled) return;
        text += part;
        controller.enqueue(encoder.encode(part));
      };
      try {
        for await (const event of source) {
          if (cancelled) break;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") append(event.delta.text);
          else if (event.type === "message_delta") stopReason = event.delta.stop_reason;
          else if (event.type === "message_stop") completed = true;
        }
      } catch (error) {
        if (!cancelled) {
          providerError = error;
          lifecycle.error("provider", error);
        }
      }
      const delivered = hasReply(text);
      if (!cancelled) {
        if (!delivered) append(`${text ? "\n\n" : ""}${providerError ? MAX_REPLY_UNAVAILABLE : MAX_REPLY_EMPTY}`);
        else if (providerError || !completed) append(`\n\n${MAX_REPLY_INTERRUPTED}`);
        else if (stopReason === "max_tokens") append(`\n\n${MAX_REPLY_LIMIT}`);
      }
      try {
        await lifecycle.settle({ text: maxReplyText(text).trim(), delivered, cancelled });
      } catch (error) {
        lifecycle.error("persistence", error);
        // The reply is still useful when its history write fails. Do not leave
        // the client waiting forever or pretend that it was safely stored.
        if (!cancelled) append(`\n\n${MAX_REPLY_NOT_SAVED}`);
      } finally {
        // cancel() has already closed this controller. Enqueueing or closing it
        // afterwards throws and used to turn a deliberate stop into a failure.
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      lifecycle.cancel();
      source.abort();
    },
  });
}
