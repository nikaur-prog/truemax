import { openMaxChat, closeMaxChat } from "./maxChat.js";
import { maxCharacterMarkup } from "./maxCharacter.js";
import { mountMaxAvatar3D, type MaxAvatar3DState } from "./maxAvatar3d.js";
import { mountMaxSpeechBubble } from "./maxSpeechBubble.js";
import { maxTextMouthLevel } from "./maxSpeechText.js";

/** Development fixture using the real production chat layout and avatar bridge. */
export function mountMaxCoachPreview(container: HTMLElement = document.body): () => void {
  if (!import.meta.env.DEV) return () => {};
  const host = document.createElement("section");
  host.dataset.maxCoachPreview = "true";
  host.style.cssText = "max-width:600px;margin:32px auto;padding:20px";
  host.innerHTML = `<p class="label">LOCAL COACH PREVIEW</p>
    <p>No account required. The chat below uses a scripted reply. No message, plan, photo or measurement is saved or sent.</p>
    <div class="maxtab-stage">
      <span class="maxtab-face">${maxCharacterMarkup()}</span>
      <h2>Coach Max</h2><p>The original blue character, on the live Coach stage.</p>
    </div>
    <button type="button" class="btn primary" data-preview-open-chat>Open the real chat layout</button>
    <p>Close the chat to check that this character resumes. Reduced motion or data saver keeps the original static art.</p>`;
  container.appendChild(host);
  const coach = mountMaxAvatar3D(host.querySelector(".maxtab-face"));
  let chat: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watch: MutationObserver | null = null;
  let busy = false;
  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null; busy = false;
    watch?.disconnect(); watch = null;
  };
  host.querySelector<HTMLButtonElement>("[data-preview-open-chat]")!.onclick = () => {
    stop();
    closeMaxChat();
    openMaxChat(null, { greeting: "Local preview: this is the live chat layout with a scripted reply. Nothing is saved or sent." });
    chat = document.querySelector<HTMLElement>(".maxchat");
    if (!chat) return;
    const current = chat;
    current.dataset.localFixture = "true";
    const avatar = mountMaxAvatar3D(current.querySelector(".maxchat-face"));
    const speech = mountMaxSpeechBubble(current.querySelector<HTMLElement>(".maxchat-speech")!);
    const form = current.querySelector<HTMLFormElement>(".maxchat-composer")!;
    const input = form.querySelector<HTMLInputElement>("input")!;
    const log = current.querySelector<HTMLElement>(".maxchat-log")!;
    const chips = current.querySelector<HTMLElement>(".maxchat-chips")!;
    chips.replaceChildren();
    const states: MaxAvatar3DState[] = ["idle", "listening", "thinking", "speaking", "celebrating", "quiet", "wave", "mirror", "skate", "guitar", "shocked", "angry"];
    for (const state of states) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "maxchat-chip";
      button.dataset.previewCoachState = state; button.textContent = state;
      button.onclick = () => { if (!busy) avatar.setState(state); };
      chips.appendChild(button);
    }
    // Replace only this fixture's form callback, never fetch/auth/production
    // transports. No conversationId or initialQuestion can trigger a request.
    form.onsubmit = (event) => {
      event.preventDefault();
      const question = input.value.trim();
      if (busy || !question || !current.isConnected) return;
      input.value = ""; busy = true; input.disabled = true;
      const questionRow = document.createElement("p");
      questionRow.className = "maxchat-msg maxchat-you"; questionRow.textContent = question;
      const reply = document.createElement("p");
      reply.className = "maxchat-msg maxchat-max"; reply.textContent = "Thinking...";
      log.append(questionRow, reply); speech.clear(); avatar.setState("thinking");
      timer = setTimeout(() => {
        if (!current.isConnected) { stop(); return; }
        avatar.setState("speaking");
        const words = "This is a local animation preview. In your real chat, I use your selected goals, current routine and available scan readings. Nothing from this preview is sent or saved.".split(" ");
        let count = 0;
        const reveal = (): void => {
          if (!current.isConnected) { stop(); return; }
          count++; reply.textContent = words.slice(0, count).join(" "); log.scrollTop = log.scrollHeight;
          speech.update(reply.textContent, { animate: false, complete: count === words.length });
          avatar.setSpeechLevel(maxTextMouthLevel(words[count - 1].charAt(0)));
          if (count < words.length) timer = setTimeout(reveal, 95);
          else { timer = null; busy = false; input.disabled = false; avatar.setSpeechLevel(null); avatar.setState("idle"); }
        };
        reveal();
      }, 1000);
    };
    watch = new MutationObserver(() => { if (!current.isConnected) stop(); });
    watch.observe(document.documentElement, { childList: true, subtree: true });
  };
  return () => { stop(); if (chat?.isConnected) closeMaxChat(); coach.destroy(); host.remove(); };
}
