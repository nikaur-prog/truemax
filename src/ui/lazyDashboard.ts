import type * as Dashboard from "./dashboard.js";

/** Loading alone cannot open a surface or retain a previous account's options. */
export function createLazyDashboard(load: () => Promise<typeof Dashboard>) {
  let loaded: typeof Dashboard | null = null;
  let pending: Promise<void> | null = null;
  return {
    ready(): Promise<void> {
      if (loaded) return Promise.resolve();
      if (!pending) pending = load().then((module) => { loaded = module; })
        .finally(() => { pending = null; });
      return pending;
    },
    close(): void { loaded?.close(); },
    openDashboard(...args: Parameters<typeof Dashboard.openDashboard>): void {
      if (!loaded) throw new Error("Prepare the dashboard before opening it");
      loaded.openDashboard(...args);
    },
  };
}

const dashboard = createLazyDashboard(() => import("./dashboard.js"));
export const prepareDashboard = dashboard.ready;
export const { close, openDashboard } = dashboard;
