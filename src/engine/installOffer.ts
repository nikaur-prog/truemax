export type InstallKind = "native" | "ios" | null;

export interface InstallEnvironment {
  standalone: boolean;
  nativeApp: boolean;
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  nativePromptAvailable: boolean;
}

export function installKind(env: InstallEnvironment): InstallKind {
  if (env.standalone || env.nativeApp) return null;
  if (env.nativePromptAvailable) return "native";
  const ios = /iPad|iPhone|iPod/.test(env.userAgent)
    || (env.platform === "MacIntel" && env.maxTouchPoints > 1);
  const safari = /Safari/.test(env.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(env.userAgent);
  return ios && safari ? "ios" : null;
}

export function canOfferInstall(
  signedIn: boolean,
  ownCompletedScan: boolean,
  alreadyShown: boolean,
  kind: InstallKind,
): boolean {
  return signedIn && ownCompletedScan && !alreadyShown && kind !== null;
}

/** Acceptance comes from the browser, never from opening the iOS instructions. */
export function acceptedNativeInstall(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && (value as { outcome?: unknown }).outcome === "accepted";
}
