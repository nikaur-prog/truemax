import type { Sex } from "../engine/types.js";

// ---------------------------------------------------------------------------
// The reference-population chooser.
//
// This replaces a small "Score against: Men / Women" toggle that sat low on the
// landing where people did not see it — and not seeing it is how a man got told
// he was in the top third "of women". The choice moves the score by a median of
// 0.70 points and up to 4.50, so it is too large to make quietly.
//
// So it is a full-screen split shown the moment a scan is started: man on the
// left under a cool blue wash, woman on the right under a warm pink one, one tap
// to choose, and only then does capture proceed. It is asked once and
// remembered; a returning visitor never sees it again.
// ---------------------------------------------------------------------------

let el: HTMLDivElement | null = null;

const escapeHTML = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// `preselect` marks the previous answer when this is asked repeatedly, as it is
// on /quick. It is a hint, not a default that can be tabbed past: the whole
// point of asking again is that the last answer was about a different person.
//
// `onCancel` exists because this screen had no way out. It covers the whole
// viewport and the only two things on it commit you to a scan, so opening it by
// accident — or opening it, thinking better of it, and dismissing the file
// picker behind it — left you on a capture screen you had not asked for with
// the question already answered. During a calibration session that is twenty
// faces of friction. Escape, the backdrop and an explicit Cancel all take it
// back, and the caller decides where "back" goes.
// `subjectName` names the person being scanned when it is not the account
// holder. "First, what gender is being analysed?" is the right question when
// the app has no idea whose face is coming; once somebody has said "I'm
// scanning Sam", asking it in the abstract reads as though the previous answer
// was not heard.
export function openSexChooser(
  onPick: (sex: Sex) => void,
  preselect?: Sex,
  onCancel?: () => void,
  subjectName?: string,
): void {
  close();
  el = document.createElement("div");
  el.className = "sexpick";
  el.innerHTML = `
    <!-- The paragraph that used to sit under this heading explained that the
         choice moves the score by up to 4.5 points. True, and the reason the
         question is asked at all rather than guessed, but it is an argument
         with somebody who has not disagreed yet, on a screen whose whole job is
         to take one tap. The two buttons already say what each one scores you
         against, which is the part that changes what someone picks. -->
    <div class="sexpick-head">
      <h2>${subjectName ? `What gender is ${escapeHTML(subjectName)}?` : "First, what gender is being analysed?"}</h2>
    </div>
    <button class="sexpick-cancel" type="button" aria-label="Cancel">Cancel</button>
    <div class="sexpick-split">
      <button class="sexpick-side man${preselect === "male" ? " was" : ""}" data-sex="male">
        <span class="sexpick-glow"></span>
        <span class="sexpick-ic">♂</span>
        <b>Man</b>
        <span class="sexpick-sub">Scored against men</span>
      </button>
      <button class="sexpick-side woman${preselect === "female" ? " was" : ""}" data-sex="female">
        <span class="sexpick-glow"></span>
        <span class="sexpick-ic">♀</span>
        <b>Woman</b>
        <span class="sexpick-sub">Scored against women</span>
      </button>
    </div>`;

  for (const side of el.querySelectorAll<HTMLButtonElement>(".sexpick-side")) {
    side.onclick = () => {
      const sex = side.dataset.sex as Sex;
      close();
      onPick(sex);
    };
  }
  const cancel = () => {
    close();
    onCancel?.();
  };
  el.querySelector<HTMLButtonElement>(".sexpick-cancel")!.onclick = cancel;
  // The backdrop, but only the backdrop. A click that started on a choice and
  // drifted off it is a mis-click on the choice, not a request to leave.
  el.onclick = (event) => { if (event.target === el) cancel(); };
  onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
  document.addEventListener("keydown", onEscape);

  document.body.appendChild(el);
  // Fade/scale in on the next frame so the transition runs.
  requestAnimationFrame(() => el?.classList.add("in"));
}

let onEscape: ((event: KeyboardEvent) => void) | null = null;

export function close(): void {
  if (onEscape) document.removeEventListener("keydown", onEscape);
  onEscape = null;
  el?.remove();
  el = null;
}
