// Browser leave protection is for accidental exits. OAuth and the account
// portal are deliberate navigations that preserve a pending scan, so they
// must not trigger the browser's "changes may not be saved" prompt.
let intentional = false;

export function beginIntentionalNavigation(): void {
  intentional = true;
}

export function cancelIntentionalNavigation(): void {
  intentional = false;
}

export function isIntentionalNavigation(): boolean {
  return intentional;
}

export function resetIntentionalNavigationForTests(): void {
  intentional = false;
}
