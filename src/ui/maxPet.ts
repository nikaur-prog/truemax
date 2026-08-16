import { maxCharacterMarkup } from "./maxCharacter.js";
import { openMaxChat, isMaxChatOpen } from "./maxChat.js";
import type { MaxChatContext } from "../engine/maxContext.js";

// ---------------------------------------------------------------------------
// Max the pet.
//
// For accounts that HOLD the Max plan, the way into the chat is not a button —
// it is him, peeking out from the edge of the screen like he is playing
// hide-and-seek, which is the whole personality of the product in one detail.
// Tap him and he pops out; the chat opens with a greeting about the scan on
// screen.
//
// Deliberately only for plan holders and only for adults. For everybody else
// the results screen carries the CTA card instead — the person who has not
// bought needs the advertisement, the person who has needs the access.
// ---------------------------------------------------------------------------

let host: HTMLButtonElement | null = null;
let context: MaxChatContext | null = null;

export function mountMaxPet(chatContext: MaxChatContext): void {
  context = chatContext;
  if (host) return;

  host = document.createElement("button");
  host.type = "button";
  host.className = "maxpet";
  host.setAttribute("aria-label", "Chat with Max");
  host.innerHTML = maxCharacterMarkup({ mood: "happy" });
  document.body.appendChild(host);

  // He waits a beat, then peeks. Arriving with the page would make him
  // furniture; arriving after it makes him a discovery.
  window.setTimeout(() => host?.classList.add("peeking"), 1200);

  host.addEventListener("click", () => {
    if (isMaxChatOpen()) return;
    // He hops out of hiding as the chat opens, and hides again when it is
    // this screen's turn again.
    host?.classList.add("out");
    openMaxChat(context, {
      greeting: "Hi, I'm Max, here to help. Got any questions from your last scan?",
    });
    // The chat covers him while open; when it closes he slips back to his
    // corner rather than standing in the middle of the page.
    const watcher = window.setInterval(() => {
      if (!host) {
        clearInterval(watcher);
        return;
      }
      if (!isMaxChatOpen()) {
        host.classList.remove("out");
        clearInterval(watcher);
      }
    }, 400);
  });
}

export function unmountMaxPet(): void {
  host?.remove();
  host = null;
  context = null;
}
