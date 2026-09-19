/**
 * Platform seams for a future bundled app. The website installs no native
 * bridge and keeps its existing browser behavior. A Capacitor bootstrap can
 * provide App/Share implementations without importing a native SDK on scans.
 * These hooks do not make auth, purchases or cross-origin API calls native-ready.
 */
export interface NativeAppPlugin {
  getState(): Promise<{ isActive: boolean }>;
  addListener(event: "appStateChange", listener: (state: { isActive: boolean }) => void):
    Promise<{ remove(): Promise<void> }>;
}

type ActivityListener = (active: boolean) => void;
const activityListeners = new Set<ActivityListener>();
let nativeActive = true;
let activeBinding: symbol | null = null;

export function isAppForeground(): boolean {
  return nativeActive && (typeof document === "undefined" ||
    (!document.hidden && document.visibilityState !== "hidden"));
}

export function subscribeNativeActivity(listener: ActivityListener): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

function publishActivity(value: boolean): void {
  if (nativeActive === value) return;
  nativeActive = value;
  // One consumer must not prevent camera/renderer consumers from pausing.
  for (const listener of activityListeners) {
    try { listener(value); } catch { /* each mounted surface owns its recovery */ }
  }
}

/** Register from native startup only; disposal is safe even during registration. */
export function bindNativeAppLifecycle(plugin: NativeAppPlugin): () => void {
  if (activeBinding) throw new Error("A native app lifecycle bridge is already installed.");
  const binding = Symbol("native-app");
  activeBinding = binding;
  let live = true;
  let eventVersion = 0;
  let remove: (() => Promise<void>) | undefined;
  const isCurrent = () => live && activeBinding === binding;
  let registered: ReturnType<NativeAppPlugin["addListener"]>;
  try {
    registered = plugin.addListener("appStateChange", ({ isActive }) => {
      if (!isCurrent() || typeof isActive !== "boolean") return;
      eventVersion++;
      publishActivity(isActive);
    });
  } catch (error) {
    registered = Promise.reject(error);
  }
  void registered.then(async (handle) => {
    if (!isCurrent()) { await handle.remove(); return; }
    remove = () => handle.remove();
    const version = eventVersion;
    try {
      const state = await plugin.getState();
      // A delayed getState response must not undo a newer pause/resume event.
      if (isCurrent() && eventVersion === version && typeof state.isActive === "boolean") {
        publishActivity(state.isActive);
      }
    } catch { /* event subscription still handles future state changes */ }
  }).catch(() => {
    // A rejected registration has no native listener to remove or retry.
    // Release its binding so the host can retry and browser activity resumes.
    if (!isCurrent()) return;
    live = false;
    activeBinding = null;
    publishActivity(true);
  });
  return () => {
    if (!live) return;
    live = false;
    if (activeBinding === binding) {
      activeBinding = null;
      publishActivity(true);
    }
    void remove?.().catch(() => { /* already removed by the native host */ });
  };
}

export type NativeShareOutcome = "shared" | "cancelled";
export interface NativeFileShare {
  /**
   * The native implementation owns temporary-file creation and cleanup.
   * Return cancelled for an explicit dismissal; throw on errors. Never upload.
   */
  share(file: File): Promise<NativeShareOutcome>;
}
let fileShare: NativeFileShare | null = null;

export function installNativeFileShare(adapter: NativeFileShare): () => void {
  if (fileShare) throw new Error("A native file share bridge is already installed.");
  fileShare = adapter;
  return () => { if (fileShare === adapter) fileShare = null; };
}

export function nativeFileSharingAvailable(): boolean { return fileShare !== null; }

/** Undefined means web; a native error is not permission to download instead. */
export function shareNativeFile(file: File): Promise<NativeShareOutcome> | undefined {
  return fileShare?.share(file);
}
