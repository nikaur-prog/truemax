import { currentAccessToken, onAuthChange } from "../engine/auth.js";
import { maxCharacterMarkup, reactMax } from "./maxCharacter.js";
import { mountMaxAvatar3D, type MaxAvatar3DHandle } from "./maxAvatar3d.js";
import { OPENING_SUGGESTIONS, suggestFollowUps } from "./maxSuggestions.js";
import type { MaxChatContext } from "../engine/maxContext.js";
import { buildCoachingSnapshot } from "../engine/maxContext.js";
import { loadProfile } from "../engine/goals.js";
import { readProtocols } from "../engine/protocol.js";
import { activeScanOwner } from "../engine/scanScope.js";
import "./maxRoutinePicker.css";
import { allowanceLine } from "../engine/maxAllowance.js";
import { requestedActionPlan } from "./maxActionBridge.js";
import { drainMaxStream, maxStreamErrorMessage } from "./maxStream.js";
import { maxReplyText } from "../engine/maxReplyText.js";
import {
  announceMaxConversationChanged,
  loadMaxConversation,
} from "../engine/maxConversations.js";

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
// Photos remain on-device. Bounded measurements, selected preferences and
// routine evidence are sent to Max with the question; chats and routine notes
// are stored for the signed-in account.
// ---------------------------------------------------------------------------

interface Turn {
  role: "user" | "assistant";
  content: string;
}

// And the outer limit. Nothing on the other end promises to ever close the
// stream, and a request that hangs forever leaves a thought bubble pulsing
// over an answer that is not coming. At this point he says so instead.
const GIVE_UP_MS = 90_000;

let host: HTMLElement | null = null;
let transcript: Turn[] = [];
let inFlight: AbortController | null = null;
let chatGeneration = 0;
let keydownListener: ((event: KeyboardEvent) => void) | null = null;
let chatAvatar: MaxAvatar3DHandle | null = null;
let stopAuthWatch: (() => void) | null = null;
let returnFocus: HTMLElement | null = null;
// Every question put to him this session, so the follow-up chips never offer
// one back.
let askedThisSession: string[] = [];

export function isMaxChatOpen(): boolean {
  return Boolean(host);
}

export function closeMaxChat(): void {
  chatGeneration += 1;
  stopAuthWatch?.();
  stopAuthWatch = null;
  document.querySelector<HTMLDialogElement>(".max-routine-picker")?.close();
  inFlight?.abort();
  inFlight = null;
  chatAvatar?.destroy();
  chatAvatar = null;
  if (keydownListener) {
    document.removeEventListener("keydown", keydownListener);
    keydownListener = null;
  }
  host?.remove();
  host = null;
  transcript = [];
  askedThisSession = [];
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}

export function openMaxChat(
  context: MaxChatContext | null,
  options: {
    greeting?: string;
    onOpenPlan?: () => void;
    initialQuestion?: string;
    source?: "dashboard" | "post_analysis";
    conversationId?: string;
  } = {},
): boolean {
  if (host) return false;
  const generation = ++chatGeneration;
  const owner = activeScanOwner();
  returnFocus = document.activeElement as HTMLElement | null;
  transcript = [];
  let conversationId = options.conversationId ?? null;
  let loadingConversation = Boolean(conversationId);

  host = document.createElement("div");
  host.className = "maxchat";
  host.innerHTML = `
    <div class="maxchat-sheet" role="dialog" aria-modal="true" aria-label="Chat with Coach Max">
      <header class="maxchat-head">
        <span class="maxchat-face">${maxCharacterMarkup({ mood: "happy" })}</span>
        <span class="maxchat-who">
          <b>Coach Max</b>
          <small>Your goals, routine and available scan readings.</small>
        </span>
        <button type="button" class="maxchat-close" aria-label="Close chat">&times;</button>
      </header>
      <div class="maxchat-log" role="log" aria-live="polite"></div>
      <div class="maxchat-action" hidden></div>
      <div class="maxchat-chips"></div>
      <form class="maxchat-composer">
        <input type="text" name="q" autocomplete="off" placeholder="Ask Coach Max something" maxlength="600" />
        <button type="submit" aria-label="Send">Send</button>
      </form>
      <p class="maxchat-allowance" aria-live="polite" hidden></p>
      <p class="maxchat-privacy">Your selected preferences, routine notes and available measurements are shared with Max. Photos are not sent in chat.</p>
    </div>`;
  document.body.appendChild(host);
  stopAuthWatch = onAuthChange(() => { if (activeScanOwner() !== owner) closeMaxChat(); });
  chatAvatar = mountMaxAvatar3D(host.querySelector(".maxchat-face"), { state: "idle", playful: false });

  const log = host.querySelector<HTMLElement>(".maxchat-log")!;
  const action = host.querySelector<HTMLElement>(".maxchat-action")!;
  const chips = host.querySelector<HTMLElement>(".maxchat-chips")!;
  const form = host.querySelector<HTMLFormElement>(".maxchat-composer")!;
  const input = form.querySelector<HTMLInputElement>("input")!;

  // The suggestions are rebuilt after every answer rather than shown once and
  // thrown away, so there is always a way forward for somebody who does not
  // know what the next question is called. Cleared while he is answering: a
  // row of things to ask under a reply still being written invites a second
  // question on top of the first.
  const renderChips = (lines: readonly string[]): void => {
    chips.innerHTML = "";
    chips.hidden = lines.length === 0;
    for (const line of lines) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "maxchat-chip";
      chip.textContent = line;
      chip.onclick = () => {
        if (inFlight) return;
        input.value = line;
        form.requestSubmit();
      };
      chips.appendChild(chip);
    }
  };

  const renderPlanAction = (show: boolean): void => {
    action.innerHTML = "";
    action.hidden = !show;
    if (action.hidden) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Choose routines for your goals";
    button.onclick = async () => {
      button.disabled = true;
      try {
        const { openMaxRoutinePicker } = await import("./maxRoutinePicker.js");
        if (generation !== chatGeneration || !host || activeScanOwner() !== owner) return;
        openMaxRoutinePicker(options.onOpenPlan ? () => { closeMaxChat(); options.onOpenPlan!(); } : undefined);
      } catch {
        if (generation === chatGeneration && host) say(log, "Routine options could not load. Try again.", "err");
      } finally { button.disabled = false; }
    };
    action.appendChild(button);
  };

  // New conversations start with a static context note, not another greeting.
  if (conversationId) {
    form.classList.add("busy");
    input.disabled = true;
    void loadMaxConversation(conversationId)
      .then((detail) => {
        if (generation !== chatGeneration || !host || activeScanOwner() !== owner) return;
        transcript = detail.messages.map((message) => ({ role: message.role, content: message.content }));
        askedThisSession = transcript.filter((turn) => turn.role === "user").map((turn) => turn.content);
        log.innerHTML = "";
        for (const turn of transcript) say(log, turn.content, turn.role === "user" ? "you" : "max");
        renderChips(suggestFollowUps(
          context ? { ...context, coaching: buildCoachingSnapshot(loadProfile(), readProtocols()) } : null,
          transcript[transcript.length - 1]?.content ?? "",
          askedThisSession,
        ));
      })
      .catch((error) => {
        if (generation !== chatGeneration || !host) return;
        say(log, error instanceof Error ? error.message : "That chat could not be loaded.", "err");
        // Do not silently append to a transcript the user could not inspect.
        conversationId = null;
      })
      .finally(() => {
        if (generation !== chatGeneration || !host) return;
        loadingConversation = false;
        input.disabled = false;
        form.classList.remove("busy");
        if (options.initialQuestion?.trim() && input.value.trim()) form.requestSubmit();
      });
  } else {
    say(log, options.greeting ?? (context ? "Ask about this scan or your current routine." : "Choose a goal or ask a question to get started."), "note");
    renderChips(OPENING_SUGGESTIONS);
  }

  host.querySelector<HTMLButtonElement>(".maxchat-close")!.onclick = closeMaxChat;
  host.addEventListener("click", (event) => {
    if (event.target === host) closeMaxChat();
  });
  // Escape closes, which is the one keyboard affordance a modal genuinely owes
  // somebody. closeMaxChat removes this exact listener on every close path.
  keydownListener = (event: KeyboardEvent): void => {
    // A native child dialog owns Escape until it closes. Dismissing the routine
    // picker must not also destroy the conversation behind it.
    if (event.key === "Escape" && !document.querySelector("dialog[open]")) closeMaxChat();
    if (event.key === "Tab" && host && !document.querySelector("dialog[open]")) {
      const focusable = [...host.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")]
        .filter((node) => node.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !host.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !host.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    }
  };
  document.addEventListener("keydown", keydownListener);

  form.onsubmit = (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || inFlight || loadingConversation) return;
    input.value = "";
    askedThisSession.push(question);
    renderPlanAction(false);
    renderChips([]);
    void ask(log, form, question, context, generation, {
      conversationId,
      owner,
      source: options.source ?? (context ? "post_analysis" : "dashboard"),
      onConversation: (id) => {
        conversationId = id;
      },
    }).then((reply) => {
      if (generation !== chatGeneration || !host) return;
      renderPlanAction(Boolean(reply) && requestedActionPlan(question));
      renderChips(reply ? suggestFollowUps(context ? { ...context, coaching: buildCoachingSnapshot(loadProfile(), readProtocols()) } : null, reply, askedThisSession) : []);
    });
  };
  input.addEventListener("input", () => { if (!inFlight) chatAvatar?.setState(input.value.trim() ? "listening" : "idle"); });

  if (options.initialQuestion?.trim()) {
    input.value = options.initialQuestion.trim().slice(0, 600);
    queueMicrotask(() => {
      if (generation === chatGeneration && host) form.requestSubmit();
    });
  }

  // Not on touch: focusing an input pops the keyboard over the character the
  // person just tapped to meet, which is a poor hello.
  if (window.matchMedia("(pointer: fine)").matches) input.focus();
  return true;
}

// A finished line from Max, with no typing animation. Used for replies and for
// errors, where the delay would be theatre over a sentence nobody enjoys.
function say(log: HTMLElement, text: string, kind = "max"): HTMLElement {
  const row = document.createElement("p");
  row.className = `maxchat-msg maxchat-${kind}`;
  row.textContent = kind === "max" ? maxReplyText(text) : text;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

async function ask(
  log: HTMLElement,
  form: HTMLFormElement,
  question: string,
  context: MaxChatContext | null,
  generation: number,
  persistence: {
    conversationId: string | null;
    owner?: string | null;
    source: "dashboard" | "post_analysis";
    onConversation: (id: string) => void;
  },
): Promise<string | null> {
  const isCurrent = (): boolean => generation === chatGeneration && log.isConnected && form.isConnected && (persistence.owner === undefined || persistence.owner === activeScanOwner());
  say(log, question, "you");
  transcript.push({ role: "user", content: question });

  const bubble = say(log, "", "max");
  bubble.classList.add("thinking");
  bubble.innerHTML = `<i></i><i></i><i></i>`;
  form.classList.add("busy");

  const face = form.closest(".maxchat")?.querySelector<SVGSVGElement>(".maxchat-face .mx-svg");
  // He thinks while you wait. The character has always had the pose — flat
  // mouth, raised brow, eyes up-left, a thought bubble of messenger dots — but
  // nothing ever switched him into it, so the only sign anything was happening
  // was three dots in the transcript. A face that keeps smiling through a
  // four-second wait reads as frozen.
  face?.classList.remove("mx-mood-happy");
  face?.classList.add("mx-mood-thinking");
  chatAvatar?.setState("thinking");

  const controller = new AbortController();
  inFlight = controller;
  // Nothing on the other end guarantees the stream ever ends. Without this a
  // hung request leaves him thinking until the panel is closed.
  const giveUp = window.setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), GIVE_UP_MS);

  // Out of the thought and into the answer. Called by the drain on the first
  // character that actually reaches the screen — NOT when the response
  // arrives.
  //
  // That distinction is the whole bug. Response headers come back the moment
  // the server accepts the request, which for a model that reasons before it
  // writes can be many seconds before the first token. The old code cleared
  // the dots and set the mouth to happy right there, so Max sat behind an
  // empty bubble with a smile on, looking broken, for the entire time he was
  // in fact working. He now stays visibly thinking until there is something
  // to read.
  let speaking = false;
  const beginSpeaking = (): void => {
    if (speaking || !isCurrent()) return;
    speaking = true;
    bubble.classList.remove("thinking");
    bubble.innerHTML = `<span class="mc-text"></span><span class="mc-wait" hidden><i></i><i></i><i></i></span>`;
    face?.classList.remove("mx-mood-thinking");
    face?.classList.add("mx-mood-happy");
    face?.classList.add("speaking");
    chatAvatar?.setState("speaking");
  };

  try {
    const token = await currentAccessToken();
    if (!isCurrent()) return null;
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!token) {
      fail(bubble, "Sign in to continue this chat.");
      transcript.pop();
      return null;
    }

    const response = await fetch("/api/max-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // An empty object is a valid "no scan yet" context. Sending null made
      // the dashboard chat look available and then fail every first message at
      // the server's malformed-client boundary.
      body: JSON.stringify({
        context: { ...(context ?? {}), coaching: buildCoachingSnapshot(loadProfile(), readProtocols()), planActionAvailable: true },
        messages: transcript,
        conversationId: persistence.conversationId,
        source: persistence.source,
        turnId: crypto.randomUUID(),
      }),
      signal: controller.signal,
    });
    if (!isCurrent()) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    if (controller.signal.aborted) throw controller.signal.reason;

    if (!response.ok || !response.body) {
      const detail = (await response.json().catch(() => null)) as { error?: string; resetsAt?: string } | null;
      if (!isCurrent()) return null;
      // The daily wall, said in the reader's own clock rather than the
      // server's "tomorrow", which is a UTC day boundary.
      const wall = response.status === 429 ? allowanceLine(0, detail?.resetsAt) : null;
      if (wall) showAllowance(wall);
      fail(bubble, wall ?? detail?.error ?? "The reply could not load. Please try again.");
      // A refusal is not part of the conversation, and leaving the question in
      // the transcript would send it again on the next message as though Max
      // had already seen it.
      transcript.pop();
      return null;
    }

    const savedConversation = response.headers.get("X-Max-Conversation");
    if (savedConversation) {
      persistence.onConversation(savedConversation);
      announceMaxConversationChanged();
    }
    if (!isCurrent()) {
      void response.body.cancel().catch(() => {});
      return null;
    }
    // How many are left today, said only once it matters (see maxAllowance).
    const remainingHeader = Number(response.headers.get("X-Max-Remaining"));
    showAllowance(allowanceLine(
      Number.isFinite(remainingHeader) ? remainingHeader : null,
      response.headers.get("X-Max-Resets-At"),
    ));

    const said = await drainMaxStream(response.body, {
      signal: controller.signal,
      isCurrent: () => isCurrent() && bubble.isConnected,
      begin: beginSpeaking,
      write: (text) => {
        // Measure before adding text: a large chunk must not make a reader
        // who was at the bottom appear to have scrolled away from it.
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        write(bubble, text);
        if (atBottom) log.scrollTop = log.scrollHeight;
      },
      waiting: (on) => {
        const dots = bubble.querySelector<HTMLElement>(".mc-wait");
        if (dots) dots.hidden = !on;
        if (isCurrent()) chatAvatar?.setState(on ? "thinking" : "speaking");
      },
    });
    if (!isCurrent()) return null;
    // A stream that closed having said nothing. Rare, but it used to land as
    // an empty bubble that stayed empty for good, and an empty assistant turn
    // in the transcript that every later message would carry along.
    if (!said.trim()) {
      fail(bubble, "No reply came through. Please try again.");
      transcript.pop();
      return null;
    }
    transcript.push({ role: "assistant", content: said });
    // Said his piece: a small nod as the reply lands. Follow-through, not
    // celebration — the reply is the content, the nod is the punctuation.
    reactMax(form.closest(".maxchat")?.querySelector<HTMLElement>(".maxchat-face") ?? null, "nod");
    return said;
  } catch (error) {
    if (isCurrent()) {
      const message = maxStreamErrorMessage(error, controller.signal);
      if (message) fail(bubble, message);
      transcript.pop();
    }
    return null;
  } finally {
    window.clearTimeout(giveUp);
    // Every exit, not just the successful one. A failed or aborted request
    // that left the thinking class on would strand him mid-thought with a
    // thought bubble over an error message, and nothing would ever clear it.
    if (generation === chatGeneration) {
      chatAvatar?.setState("idle");
      if (face?.isConnected) {
        face.classList.remove("speaking", "mx-mood-thinking");
        face.classList.add("mx-mood-happy");
      }
      if (form.isConnected) form.classList.remove("busy");
    }
    if (inFlight === controller) inFlight = null;
  }
}

// The line under the composer. Null clears it: a count that was low
// yesterday must not sit under a fresh day's first message.
function showAllowance(line: string | null): void {
  const slot = host?.querySelector<HTMLElement>(".maxchat-allowance");
  if (!slot) return;
  slot.textContent = line ?? "";
  slot.hidden = !line;
}

function fail(bubble: HTMLElement, message: string): void {
  bubble.classList.remove("thinking");
  bubble.classList.add("maxchat-err");
  bubble.textContent = message;
  // He minds that it broke — with you, briefly, and then back to normal.
  reactMax(bubble.closest(".maxchat")?.querySelector<HTMLElement>(".maxchat-face") ?? null, "shake");
}

// The answer lives in a child span, not in the bubble's own text, because the
// bubble also carries the waiting dots and writing textContent on the parent
// would delete them on the next frame.
function write(bubble: HTMLElement, text: string): void {
  const slot = bubble.querySelector<HTMLElement>(".mc-text");
  if (slot) slot.textContent = text;
  else bubble.textContent = text;
}
