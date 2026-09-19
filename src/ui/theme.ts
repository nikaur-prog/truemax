export type AppTheme = "light" | "dark";
export const THEME_STORAGE_KEY = "truemax-theme";

export function readTheme(value: unknown): AppTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

/** A device preference, never part of a profile or a facial measurement. */
export function createThemePreference(storage: ThemeStorage | null, apply: (theme: AppTheme) => void) {
  let theme: AppTheme = "light";
  try { theme = readTheme(storage?.getItem(THEME_STORAGE_KEY)) ?? "light"; } catch { /* Storage can be blocked. */ }
  apply(theme);
  return {
    get current(): AppTheme { return theme; },
    set(next: AppTheme): void {
      theme = next;
      try { storage?.setItem(THEME_STORAGE_KEY, theme); } catch { /* Keep the switch usable for this visit. */ }
      apply(theme);
    },
    sync(value: unknown): void {
      theme = readTheme(value) ?? "light";
      apply(theme);
    },
  };
}

let preference: ReturnType<typeof createThemePreference> | null = null;
const controls = new Set<HTMLButtonElement>();

/** Restore the explicit choice. No preference preserves the existing light UI. */
export function initializeTheme(): void {
  if (preference) return;
  let storage: ThemeStorage | null = null;
  try { storage = localStorage; } catch { /* Safari private contexts may reject storage access. */ }
  preference = createThemePreference(storage, (theme) => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#131716" : "#f4f3ef");
    controls.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme)));
  });
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) preference?.sync(event.newValue);
  });
}

/** The only theme control lives in Settings. It applies and saves immediately. */
export function mountThemeSetting(host: HTMLElement | null): () => void {
  if (!host) return () => {};
  initializeTheme();
  host.innerHTML = `<div class="set-theme-choices" role="group" aria-label="Colour mode">
    <button type="button" data-theme-choice="light">Light</button>
    <button type="button" data-theme-choice="dark">Dark</button>
  </div>`;
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")];
  const choose = (event: Event) => {
    const theme = readTheme((event.currentTarget as HTMLButtonElement).dataset.themeChoice);
    if (theme) preference!.set(theme);
  };
  buttons.forEach((button) => {
    controls.add(button);
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preference!.current));
    button.addEventListener("click", choose);
  });
  return () => {
    buttons.forEach((button) => {
      controls.delete(button);
      button.removeEventListener("click", choose);
    });
  };
}
