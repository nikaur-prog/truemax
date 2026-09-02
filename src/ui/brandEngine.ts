const PALETTE = [
  ["Ink", "#141518"],
  ["Paper", "#F4F3EF"],
  ["True green", "#0E7A68"],
  ["Digital mint", "#56E6C7"],
  ["Max gold", "#F2C94C"],
] as const;

export interface BrandEngineActions {
  onBack: () => void;
}

export function openBrandEngine(host: HTMLElement, actions: BrandEngineActions): void {
  host.innerHTML = `
    <div class="q-modebar">
      <button type="button" class="linkish" id="q-brand-back">← All tools</button>
      <span class="q-modebar-name">Brand Engine</span>
      <span class="q-owner-chip">OWNER</span>
    </div>
    <div class="q-brand-hero">
      <span class="q-klabel">TRUEMAX MASTER SYSTEM</span>
      <h1>One source for every export.</h1>
      <p>Approved marks, exact colours, and the visual rules used by the Creator League.</p>
      <a class="btn pri" href="/brand/truemax-logo-pack.zip" download>Download logo pack</a>
    </div>
    <section class="q-brand-section">
      <div class="q-library-title"><div><span>LOCKUPS</span><small>Use the mark, wordmark, or complete lockup without redrawing it</small></div></div>
      <div class="q-brand-lockups">
        <article class="light"><img src="/brand/truemax-lockup.svg" alt="TrueMax logo" /><a href="/brand/truemax-lockup.svg" download>SVG</a></article>
        <article class="dark"><img src="/brand/truemax-lockup-reverse.svg" alt="TrueMax logo in white" /><a href="/brand/truemax-lockup-reverse.svg" download>SVG</a></article>
        <article class="glyph"><img src="/brand/truemax-glyph.svg" alt="TrueMax glyph" /><a href="/brand/truemax-glyph.svg" download>SVG</a></article>
      </div>
    </section>
    <section class="q-brand-section">
      <div class="q-library-title"><div><span>HOUSE PALETTE</span><small>Tap a value to copy it</small></div></div>
      <div class="q-brand-palette">${PALETTE.map(([name, value]) => `<button type="button" data-colour="${value}"><i style="background:${value}"></i><b>${name}</b><span>${value}</span></button>`).join("")}</div>
      <p class="q-library-status" id="q-brand-status" role="status"></p>
    </section>
    <section class="q-brand-section q-brand-rules">
      <div class="q-library-title"><div><span>EXPORT CONTRACT</span><small>The details that make separate creator outputs feel like one product</small></div></div>
      <div><b>Type</b><span>Editorial serif for scores. Neutral sans for controls and captions.</span></div>
      <div><b>Motion</b><span>Short eased reveals, no elastic bounce, no decorative movement over a face.</span></div>
      <div><b>Marks</b><span>Keep clear space around the glyph and never stretch, recolour, or rebuild the lockup.</span></div>
      <div><b>Claims</b><span>Use measured language. Keep the reference-population line on rating exports.</span></div>
    </section>`;
  host.querySelector<HTMLButtonElement>("#q-brand-back")!.onclick = actions.onBack;
  const status = host.querySelector<HTMLElement>("#q-brand-status")!;
  for (const button of host.querySelectorAll<HTMLButtonElement>("[data-colour]")) {
    button.onclick = async () => {
      const value = button.dataset.colour ?? "";
      try {
        await navigator.clipboard.writeText(value);
        status.textContent = `${value} copied.`;
      } catch {
        status.textContent = value;
      }
    };
  }
}
