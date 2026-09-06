import type { User } from "@supabase/supabase-js";

interface SettingsModule {
  openSettings(user: User): Promise<void>;
  closeSettings(): void;
}

export type SettingsOpenResult = "opened" | "stale" | "failed";

/** The account screen should not be part of the first scan's download. */
export function createLazySettingsBoundary(load: () => Promise<SettingsModule>) {
  let loaded: SettingsModule | null = null;
  let pending: Promise<SettingsModule> | null = null;
  let generation = 0;

  function loadOnce(): Promise<SettingsModule> {
    if (loaded) return Promise.resolve(loaded);
    if (!pending) {
      pending = load().then((module) => {
        loaded = module;
        return module;
      }).finally(() => {
        pending = null;
      });
    }
    return pending;
  }

  return {
    async open(user: User, isCurrent: () => boolean): Promise<SettingsOpenResult> {
      const attempt = ++generation;
      const ownsOpen = () => attempt === generation && isCurrent();
      if (!ownsOpen()) return "stale";
      try {
        const module = await loadOnce();
        // The module may finish loading after logout, account replacement or
        // a new scan. None of those may reopen the old account's Settings.
        if (!ownsOpen()) return "stale";
        await module.openSettings(user);
        return ownsOpen() ? "opened" : "stale";
      } catch {
        // A failed download can be retried by the next profile-button click.
        return ownsOpen() ? "failed" : "stale";
      }
    },
    close(): void {
      generation++;
      // Closing an unused account screen must not download it on logout.
      loaded?.closeSettings();
    },
  };
}

const settings = createLazySettingsBoundary(() => import("./settings.js"));
export const openLazySettings = settings.open;
export const closeLazySettings = settings.close;
