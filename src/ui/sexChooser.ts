import type { Sex } from "../engine/types.ts";

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

export function openSexChooser(onPick: (sex: Sex) => void): void {
  close();
  el = document.createElement("div");
  el.className = "sexpick";
  el.innerHTML = `
    <div class="sexpick-head">
      <h2>Who should we score you against?</h2>
      <p>Every percentile is measured against this group, and it moves the number a lot. Pick one to start.</p>
    </div>
    <div class="sexpick-split">
      <button class="sexpick-side man" data-sex="male">
        <span class="sexpick-glow"></span>
        <span class="sexpick-ic">♂</span>
        <b>Man</b>
        <span class="sexpick-sub">Scored against men</span>
      </button>
      <button class="sexpick-side woman" data-sex="female">
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
  document.body.appendChild(el);
  // Fade/scale in on the next frame so the transition runs.
  requestAnimationFrame(() => el?.classList.add("in"));
}

export function close(): void {
  el?.remove();
  el = null;
}
