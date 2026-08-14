import { currentAccessToken } from "../engine/auth.js";
import { maxCharacterMarkup, wireMaxInteractions } from "./maxCharacter.js";
import type { MaxChatContext } from "../engine/maxContext.js";

// ---------------------------------------------------------------------------
// Talking to Max.
//
// The one screen in TrueMax where a language model is on the other end, and it
// is built to feel like the character rather than like a chat window that
// happens to be blue. He is at the top, his mouth moves while he is talking,
// and the words arrive at reading speed instead of in bursts.
//
// That last part is deliberate and is not decoration. A streamed reply arrives
// in clumps of whatever the network felt like delivering, which reads as
// stuttering. So the stream fills a buffer and a separate clock drains it at a
// steady rate: the text lands smoothly, the mouth has something continuous to
// animate against, and if the network stalls mid-sentence the buffer covers it.
//
// Nothing is stored. The transcript lives in this module while the panel is
// open and is gone when it closes, which matches every other thing this product
// does with what it learns about somebody's face. Sending it back on each
// request is what gives Max a memory of the conversation, and it costs nothing
// to keep because there is nothing to keep.
// ---------------------------------------------------------------------------

interface Turn {
  role: "user" | "assistant";
  content: string;
}

// Characters a second the buffer drains at. Fast enough not to be a wait,
// slow enough that the mouth animation and the reading pace agree.
const DRAIN_CPS = 55;

let host: HTMLElement | null = null;
let transcript: Turn[] = [];
let inFlight: AbortController | null = null;

export function isMaxChatOpen(): boolean {
  return Boolean(host);
}

export function closeMaxChat(): void {
  inFlight?.abort();
  inFlight = null;
  host?.remove();
  host = null;
}

// The opener a person sees before they have typed anything. Deterministic and
// written here rather than generated, because paying a model to say hello is
// paying for the least interesting sentence in the conversation.
function greeting(context: MaxChatContext | null): string {
  if (!context) {
    return "Hey. Run a scan first and I will have some numbers to work with. Then ask me anything about them.";
  }
  const weakest = context.focus[0]?.split(",")[0];
  return weakest
    ? `Hey, I'm Max. I've got your scan in front of me. ${weakest} is the one I'd look at first, but ask me whatever you like.`
    : "Hey, I'm Max. I've got your scan in front of me. Ask me anything about it.";
}

const SUGGESTIONS = [
  "What should I do first?",
  "Why is that number low?",
  "What can I actually change?",
  "How long until it moves?",
];

export function openMaxChat(context: MaxChatContext | null): void {
  if (host) return;
  transcript = [];

  host = document.createElement("div");
  host.className = "maxchat";
  host.innerHTML = `
    <div class="maxchat-sheet" role="dialog" aria-modal="true" aria-label="Chat with Max">
      <header class="maxchat-head">
        <span class="maxchat-face">${maxCharacterMarkup({ mood: "happy" })}</span>
        <span class="maxchat-who">
          <b>Max</b>
          <small>Reads your numbers. Does not make them up.</small>
        </span>
        <button type="button" class="maxchat-close" aria-label="Close chat">&times;</button>
      </header>
      <div class="maxchat-log" role="log" aria-live="polite"></div>
      <div class="maxchat-chips"></div>
      <form class="maxchat-composer">
        <input type="text" name="q" autocomplete="off" placeholder="Ask Max something" maxlength="600" />
        <button type="submit" aria-label="Send">Send</button>
      </form>
    </div>`;
  document.body.appendChild(host);
  wireMaxInteractions(host.querySelector(".maxchat-face"));

  const log = host.querySelector<HTMLElement>(".maxchat-log")!;
  const chips = host.querySelector<HTMLElement>(".maxchat-chips")!;
  const form = host.querySelector<HTMLFormElement>(".maxchat-composer")!;
  const input = form.querySelector<HTMLInputElement>("input")!;

  say(log, greeting(context));
  for (const s of SUGGESTIONS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "maxchat-chip";
    chip.textContent = s;
    chip.onclick = () => {
      input.value = s;
      form.requestSubmit();
    };
    chips.appendChild(chip);
  }

  host.querySelector<HTMLButtonElement>(".maxchat-close")!.onclick = closeMaxChat;
  host.addEventListener("click", (event) => {
    if (event.target === host) closeMaxChat();
  });
  // Escape closes, which is the one keyboard affordance a modal genuinely owes
  // somebody. Self-removing so a closed panel leaves nothing behind.
  const onKey = (event: KeyboardEvent): void => {
    if (!host) {
      document.removeEventListener("keydown", onKey);
      return;
    }
    if (event.key === "Escape") closeMaxChat();
  };
  document.addEventListener("keydown", onKey);

  form.onsubmit = (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || inFlight) return;
    input.value = "";
    chips.remove();
    void ask(log, form, question, context);
  };

  // Not on touch: focusing an input pops the keyboard over the character the
  // person just tapped to meet, which is a poor hello.
  if (window.matchMedia("(pointer: fine)").matches) input.focus();
}

// A finished line from Max, with no typing animation. Used for the greeting and
// for errors, where the delay would be theatre over a sentence nobody enjoys.
function say(log: HTMLElement, text: string, kind = "max"): HTMLElement {
  const row = document.createElement("p");
  row.className = `maxchat-msg maxchat-${kind}`;
  row.textContent = text;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

async function ask(
  log: HTMLElement,
  form: HTMLFormElement,
  question: string,
  context: MaxChatContext | null,
): Promise<void> {
  say(log, question, "you");
  transcript.push({ role: "user", content: question });

  const bubble = say(log, "", "max");
  bubble.classList.add("thinking");
  bubble.innerHTML = `<i></i><i></i><i></i>`;
  form.classList.add("busy");

  const face = document.querySelector<SVGSVGElement>(".maxchat-face .mx-svg");
  const controller = new AbortController();
  inFlight = controller;

  try {
    const token = await currentAccessToken();
    if (!token) {
      fail(bubble, "Sign in and I'll be right here.");
      return;
    }

    const response = await fetch("/api/max-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ context, messages: transcript }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const detail = (await response.json().catch(() => null)) as { error?: string } | null;
      fail(bubble, detail?.error || "I could not get through just then. Try me again?");
      // A refusal is not part of the conversation, and leaving the question in
      // the transcript would send it again on the next message as though Max
      // had already seen it.
      transcript.pop();
      return;
    }

    bubble.classList.remove("thinking");
    bubble.textContent = "";
    face?.classList.add("speaking");
    const said = await drain(response.body, bubble, log);
    transcript.push({ role: "assistant", content: said });
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      fail(bubble, "I lost the connection there. Ask me again?");
      transcript.pop();
    }
  } finally {
    face?.classList.remove("speaking");
    form.classList.remove("busy");
    if (inFlight === controller) inFlight = null;
  }
}

function fail(bubble: HTMLElement, message: string): void {
  bubble.classList.remove("thinking");
  bubble.classList.add("maxchat-err");
  bubble.textContent = message;
}

// Read the stream into a buffer, and let a steady clock move characters from
// the buffer onto the screen. The two rates are independent on purpose: the
// network delivers in clumps, the reader wants an even pace, and the gap
// between them is what the buffer is for.
async function drain(body: ReadableStream<Uint8Array>, bubble: HTMLElement, log: HTMLElement): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let shown = 0;
  let done = false;

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const pump = (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
    }
    buffered += decoder.decode();
    done = true;
  })();

  if (reduced) {
    // Somebody who asked for less motion gets the whole answer the moment it
    // finishes. The pacing is an effect, and effects are the thing that setting
    // turns off.
    await pump;
    bubble.textContent = buffered;
    log.scrollTop = log.scrollHeight;
    return buffered;
  }

  await new Promise<void>((resolve) => {
    let last = performance.now();
    // Fractional characters are CARRIED between frames rather than floored
    // away. At sixty frames a second one frame earns 0.9 of a character, so
    // rounding each frame down on its own drops the remainder every time and
    // the text crawls out at roughly half the rate this constant asks for.
    let carry = 0;
    const step = (now: number): void => {
      carry += ((now - last) / 1000) * DRAIN_CPS;
      last = now;
      const take = Math.floor(carry);
      if (take > 0) {
        carry -= take;
        shown = Math.min(buffered.length, shown + take);
        bubble.textContent = buffered.slice(0, shown);
        // Only follow the text down if the reader has not scrolled up to
        // re-read something. Yanking them back to the bottom mid-sentence is
        // the most annoying thing a chat window can do.
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        if (atBottom) log.scrollTop = log.scrollHeight;
      }
      // Caught up with a stream that has not finished. Drop the carry rather
      // than letting it bank during the wait, or a network stall of two
      // seconds would be followed by a hundred characters appearing at once.
      if (shown >= buffered.length) carry = 0;
      if (done && shown >= buffered.length) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  await pump;
  bubble.textContent = buffered;
  return buffered;
}
