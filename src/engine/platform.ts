// ---------------------------------------------------------------------------
// Where is this code running: the web, or inside the wrapped native app?
//
// The distinction exists for exactly one reason, and it is a legal one, not a
// technical one. Apple's rules require digital subscriptions bought INSIDE an
// iOS app to go through In-App Purchase, and (outside the US storefront) an
// app may not even link out to a web checkout. The web keeps Stripe exactly
// as it is; the native build shows no purchase surface at all until IAP is
// implemented. An account that already subscribed on the web works everywhere
// — entitlements are read from the server and know nothing about platforms.
//
// Detection: Capacitor injects window.Capacitor into the wrapped WebView. The
// optional chaining matters — on the plain web that global does not exist,
// and this must return false there without throwing.
// ---------------------------------------------------------------------------

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

export function isNativeApp(): boolean {
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

// One class on <html>, so CSS can hide purchase chrome without every surface
// needing its own platform check. Called once at boot.
export function markPlatform(): void {
  if (isNativeApp()) document.documentElement.classList.add("native-app");
}
