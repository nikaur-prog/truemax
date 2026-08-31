import { currentAccessToken } from "../engine/auth.js";
import { maxCharacterMarkup, reactMax, wireMaxInteractions } from "./maxCharacter.js";
import { OPENING_SUGGESTIONS, suggestFollowUps } from "./maxSuggestions.js";
import type { MaxChatContext } from "../engine/maxContext.js";
import { requestedActionPlan } from "./maxActionBridge.js";

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

// How long the stream may go quiet mid-answer before Max visibly goes back to
// thinking. Short enough to cover a real stall, long enough that ordinary
// token-rate jitter — which is easily a few hundred milliseconds between
// chunks — never makes the dots flicker on and off under the text.
const STALL_MS = 1400;

// And the outer limit. Nothing on the other end promises to ever close the
// stream, and a request that hangs forever leaves a thought bubble pulsing
// over an answer that is not coming. At this point he says so instead.
const GIVE_UP_MS = 90_000;

let host: HTMLElement | null = null;
let transcript: Turn[] = [];
let inFlight: AbortController | null = null;
let chatGeneration = 0;
// Every question put to him this session, so the follow-up chips never offer
// one back.
let askedThisSession: string[] = [];

export function isMaxChatOpen(): boolean {
  return Boolean(host);
}

export function closeMaxChat(): void {
  chatGeneration += 1;
  inFlight?.abort();
  inFlight = null;
  host?.remove();
  host = null;
  transcript = [];
  askedThisSession = [];
}

// The opener a person sees before they have typed anything. Deterministic and
// written here rather than generated, because paying a model to say hello is
// paying for the least interesting sentence in the conversation.
function greeting(context: MaxChatContext | null): string {
  if (!context) {
    return "Hey. Run a scan first and I will have some numbers to work with. Then ask me anything about them.";
  }
  const weakest = context.focus[0]?.split(",")[0]?.replace(/\s*:\s*/g, " to ").toLowerCase();
  return weakest
    ? `Hey, I'm Max. I've got your scan. I'd start with ${weakest}, but ask me whatever you want.`
    : "Hey, I'm Max. I've got your scan in front of me. Ask me anything about it.";
}

export function openMaxChat(
  context: MaxChatContext | null,
  options: { greeting?: string; onOpenPlan?: () => void } = {},
): void {
  if (host) return;
  const generation = ++chatGeneration;
  transcript = [];

  host = document.createElement("div");
  host.className = "maxchat";
  host.innerHTML = `
    <div class="maxchat-sheet" role="dialog" aria-modal="true" aria-label="Chat with Coach Max">
      <header class="maxchat-head">
        <span class="maxchat-face">${maxCharacterMarkup({ mood: "happy" })}</span>
        <span class="maxchat-who">
          <b>Coach Max</b>
          <small>Reads your numbers. Does not make them up.</small>
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
    </div>`;
  document.body.appendChild(host);
  wireMaxInteractions(host.querySelector(".maxchat-face"));

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
    action.hidden = !show || !options.onOpenPlan;
    if (action.hidden) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Choose habits to track";
    button.onclick = () => {
      const openPlan = options.onOpenPlan;
      closeMaxChat();
      openPlan?.();
    };
    action.appendChild(button);
  };

  // He says hello, and no longer waves about it.
  //
  // Opening the chat used to get a full big-wave entrance on the reasoning
  // that somebody had just decided to talk to him. In practice it fires on
  // every single open, which is the tic that greet() itself caps at two
  // everywhere else — and the cap was explicitly waived here, so the one place
  // he waves most often is the one place he never stops. An arm going up
  // before a word appears also delays the thing the reader actually came for.
  //
  // The mouth still moves for exactly as long as the line takes to type;
  // without that the greeting is a subtitle rather than somebody speaking. He
  // earns attention with the idle repertoire instead (ui/maxIdle.ts), and a
  // tap still gets a wave.
  const face = host.querySelector<SVGSVGElement>(".maxchat-face .mx-svg");
  // He LANDS rather than appears: the settle bounce on mount is the same
  // follow-through every act ends with, and it is what makes opening the
  // panel read as him arriving to talk rather than a header painting in.
  if (face && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    face.classList.add("mx-settle");
    window.setTimeout(() => face.classList.remove("mx-settle"), 600);
  }
  face?.classList.add("speaking");
  speakGreeting(log, options.greeting ?? greeting(context), () => {
    face?.classList.remove("speaking");
  });
  renderChips(OPENING_SUGGESTIONS);

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
    askedThisSession.push(question);
    renderPlanAction(false);
    renderChips([]);
    void ask(log, form, question, context, generation).then((reply) => {
      if (generation !== chatGeneration || !host) return;
      renderPlanAction(Boolean(reply) && requestedActionPlan(question));
      renderChips(reply ? suggestFollowUps(context, reply, askedThisSession) : []);
    });
  };

  // Not on touch: focusing an input pops the keyboard over the character the
  // person just tapped to meet, which is a poor hello.
  if (window.matchMedia("(pointer: fine)").matches) input.focus();
}

// Max's opening line types itself out, ONCE.
//
// Everything else in this app that used to type has stopped, and for a good
// reason: withholding a measurement you have already produced, one character
// at a time, is theatre at the reader's expense. Max's greeting is the
// exception because it is not a measurement — it is somebody speaking, and
// speech arriving as a finished block is the thing that makes a chat window
// feel like a form.
//
// Once. Closing the panel and opening it again shows the line already said,
// because the second performance of a greeting is not a greeting, and having
// to sit through it to get back to a conversation is worse than never having
// had it. The flag is set when typing STARTS, so ducking out halfway does not
// buy a replay either.
let spokenGreeting: string | null = null;

const SPEAK_MS_PER_CHAR = 16;

function speakGreeting(log: HTMLElement, text: string, onDone: () => void = () => {}): void {
  const row = say(log, "", "max");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reduced || spokenGreeting === text) {
    row.textContent = text;
    spokenGreeting = text;
    onDone();
    return;
  }
  spokenGreeting = text;

  // Height is claimed up front so the composer below does not get shoved down
  // a line at a time while he talks.
  row.style.minHeight = "0px";
  const measure = say(log, text, "max");
  measure.style.visibility = "hidden";
  measure.style.position = "absolute";
  row.style.minHeight = `${measure.offsetHeight}px`;
  measure.remove();

  const start = performance.now();
  const total = text.length * SPEAK_MS_PER_CHAR;
  const step = (now: number) => {
    if (!row.isConnected) {
      onDone();
      return;
    }
    const p = Math.min(1, (now - start) / total);
    row.textContent = text.slice(0, Math.round(text.length * p));
    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      row.style.minHeight = "";
      onDone();
    }
  };
  requestAnimationFrame(step);
}

// A finished line from Max, with no typing animation. Used for replies and for
// errors, where the delay would be theatre over a sentence nobody enjoys.
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
  generation: number,
): Promise<string | null> {
  say(log, question, "you");
  transcript.push({ role: "user", content: question });

  const bubble = say(log, "", "max");
  bubble.classList.add("thinking");
  bubble.innerHTML = `<i></i><i></i><i></i>`;
  form.classList.add("busy");

  const face = document.querySelector<SVGSVGElement>(".maxchat-face .mx-svg");
  // He thinks while you wait. The character has always had the pose — flat
  // mouth, raised brow, eyes up-left, a thought bubble of messenger dots — but
  // nothing ever switched him into it, so the only sign anything was happening
  // was three dots in the transcript. A face that keeps smiling through a
  // four-second wait reads as frozen.
  face?.classList.remove("mx-mood-happy");
  face?.classList.add("mx-mood-thinking");

  const controller = new AbortController();
  inFlight = controller;
  // Nothing on the other end guarantees the stream ever ends. Without this a
  // hung request leaves him thinking until the panel is closed.
  const giveUp = window.setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), GIVE_UP_MS);

  // Out of the thought and into the answer. Called by drain() on the first
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
    if (speaking) return;
    speaking = true;
    bubble.classList.remove("thinking");
    bubble.innerHTML = `<span class="mc-text"></span><span class="mc-wait" hidden><i></i><i></i><i></i></span>`;
    face?.classList.remove("mx-mood-thinking");
    face?.classList.add("mx-mood-happy");
    face?.classList.add("speaking");
  };

  try {
    const token = await currentAccessToken();
    if (generation !== chatGeneration) return null;
    if (!token) {
      fail(bubble, "Sign in and I'll be right here.");
      return null;
    }

    const response = await fetch("/api/max-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ context, messages: transcript }),
      signal: controller.signal,
    });
    if (generation !== chatGeneration) return null;

    if (!response.ok || !response.body) {
      const detail = (await response.json().catch(() => null)) as { error?: string } | null;
      if (generation !== chatGeneration) return null;
      fail(bubble, detail?.error || "I could not get through just then. Try me again?");
      // A refusal is not part of the conversation, and leaving the question in
      // the transcript would send it again on the next message as though Max
      // had already seen it.
      transcript.pop();
      return null;
    }

    const said = await drain(response.body, bubble, log, beginSpeaking);
    if (generation !== chatGeneration) return null;
    // A stream that closed having said nothing. Rare, but it used to land as
    // an empty bubble that stayed empty for good, and an empty assistant turn
    // in the transcript that every later message would carry along.
    if (!said.trim()) {
      fail(bubble, "I went blank there, which is on me. Ask me that again?");
      transcript.pop();
      return null;
    }
    transcript.push({ role: "assistant", content: said });
    // Said his piece: a small nod as the reply lands. Follow-through, not
    // celebration — the reply is the content, the nod is the punctuation.
    reactMax(document.querySelector<HTMLElement>(".maxchat-face"), "nod");
    return said;
  } catch (error) {
    const name = (error as Error)?.name;
    if (generation === chatGeneration && name !== "AbortError") {
      fail(bubble, "I lost the connection there. Ask me again?");
      transcript.pop();
    } else if (generation === chatGeneration && controller.signal.reason instanceof DOMException
      && controller.signal.reason.name === "TimeoutError") {
      fail(bubble, "That took too long to come back. Ask me again?");
      transcript.pop();
    }
    return null;
  } finally {
    window.clearTimeout(giveUp);
    face?.classList.remove("speaking");
    // Every exit, not just the successful one. A failed or aborted request
    // that left the thinking class on would strand him mid-thought with a
    // thought bubble over an error message, and nothing would ever clear it.
    face?.classList.remove("mx-mood-thinking");
    face?.classList.add("mx-mood-happy");
    form.classList.remove("busy");
    if (inFlight === controller) inFlight = null;
  }
}

function fail(bubble: HTMLElement, message: string): void {
  bubble.classList.remove("thinking");
  bubble.classList.add("maxchat-err");
  bubble.textContent = message;
  // He minds that it broke — with you, briefly, and then back to normal.
  reactMax(document.querySelector<HTMLElement>(".maxchat-face"), "shake");
}

// Max is told to write plain sentences for a plain bubble, but a model under
// instruction still occasionally reaches for markdown. The bubble renders
// textContent, where **bold** is four characters of asterisk noise around the
// word it meant to stress, so whatever slips through is stripped rather than
// shown. Runs over the whole buffer every frame — it is a handful of regexes
// on a few hundred characters, and re-running it means a marker split across
// two network chunks still disappears the moment its second half lands.
function scrub(raw: string): string {
  return raw
    .replace(/\*\*|__|`/g, "")
    .replace(/\*([^*\n]{1,80})\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^(\s*)[*•]\s+/gm, "$1- ");
}

// Read the stream into a buffer, and let a steady clock move characters from
// the buffer onto the screen. The two rates are independent on purpose: the
// network delivers in clumps, the reader wants an even pace, and the gap
// between them is what the buffer is for.
//
// The clock runs for everybody, reduced motion included. The pacing is not a
// motion effect, it is what lets a person follow the answer as it is said —
// dumping the whole reply at once is exactly the bug this exists to fix.
async function drain(
  body: ReadableStream<Uint8Array>,
  bubble: HTMLElement,
  log: HTMLElement,
  onFirstText: () => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let shown = 0;
  let done = false;

  const pump = (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
    }
    buffered += decoder.decode();
    done = true;
  })();

  await new Promise<void>((resolve) => {
    let last = performance.now();
    // When the buffer last grew. A stream that has caught up and gone quiet
    // for longer than STALL_MS puts the dots back — under the text this time,
    // not instead of it, so the half of the answer already written stays
    // readable while he works out the rest. This is the same bug as the one
    // before the first token, in the middle of a sentence.
    let grewAt = performance.now();
    let waiting = false;
    const setWaiting = (on: boolean): void => {
      if (on === waiting) return;
      waiting = on;
      const dots = bubble.querySelector<HTMLElement>(".mc-wait");
      if (dots) dots.hidden = !on;
    };
    // Fractional characters are CARRIED between frames rather than floored
    // away. At sixty frames a second one frame earns 0.9 of a character, so
    // rounding each frame down on its own drops the remainder every time and
    // the text crawls out at roughly half the rate this constant asks for.
    let carry = 0;
    let seen = 0;
    const step = (now: number): void => {
      const text = scrub(buffered);
      // Scrubbing can shorten the buffer after the fact — a lone * becomes a
      // pair when its twin arrives and both vanish — so the cursor is clamped
      // rather than trusted.
      shown = Math.min(shown, text.length);
      if (text.length !== seen) {
        seen = text.length;
        grewAt = now;
      }
      // Nothing has been written yet and nothing has arrived: hold the whole
      // thinking state, do not touch the bubble, and do not start the clock.
      // last is re-seated each frame so the wait cannot bank drain time and
      // then spray the opening of the answer out in one frame.
      if (shown === 0 && text.length === 0) {
        last = now;
        if (done) resolve();
        else requestAnimationFrame(step);
        return;
      }
      if (shown === 0) onFirstText();
      // Reading pace by default. When a big backlog appears at once — a proxy
      // buffered the stream, or the tab was hidden and frames stopped — speed
      // up in proportion so the replay takes a second or two, not a minute,
      // while still visibly typing.
      const backlog = text.length - shown;
      const cps = DRAIN_CPS + (backlog > 360 ? (backlog - 360) * 1.4 : 0);
      carry += ((now - last) / 1000) * cps;
      last = now;
      const take = Math.floor(carry);
      if (take > 0) {
        carry -= take;
        shown = Math.min(text.length, shown + take);
        write(bubble, text.slice(0, shown));
        // Only follow the text down if the reader has not scrolled up to
        // re-read something. Yanking them back to the bottom mid-sentence is
        // the most annoying thing a chat window can do.
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        if (atBottom) log.scrollTop = log.scrollHeight;
      }
      // Caught up with a stream that has not finished. Drop the carry rather
      // than letting it bank during the wait, or a network stall of two
      // seconds would be followed by a hundred characters appearing at once.
      if (shown >= text.length) carry = 0;
      setWaiting(!done && shown >= text.length && now - grewAt > STALL_MS);
      if (done && shown >= text.length) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  await pump;
  const said = scrub(buffered);
  if (said) {
    onFirstText();
    write(bubble, said);
    const dots = bubble.querySelector<HTMLElement>(".mc-wait");
    if (dots) dots.hidden = true;
  }
  return said;
}

// The answer lives in a child span, not in the bubble's own text, because the
// bubble also carries the waiting dots and writing textContent on the parent
// would delete them on the next frame.
function write(bubble: HTMLElement, text: string): void {
  const slot = bubble.querySelector<HTMLElement>(".mc-text");
  if (slot) slot.textContent = text;
  else bubble.textContent = text;
}
