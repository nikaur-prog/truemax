/**
 * Whether this device should be offered a physical-keyboard shutter shortcut.
 *
 * A touch-first phone may still report hover support in an embedded browser,
 * so maxTouchPoints is the stronger signal. The media query covers devices
 * whose browser does not expose that count reliably.
 */
export function hasTouchFirstInput(
  maxTouchPoints = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
  coarsePointer = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)").matches
    : false,
): boolean {
  return maxTouchPoints > 0 || coarsePointer;
}

export function automaticCaptureDetail(touchFirst = hasTouchFirstInput()): string {
  return touchFirst
    ? "Taking it automatically"
    : "Taking it automatically · space to take it now";
}

export function sideCaptureInstruction(touchFirst = hasTouchFirstInput()): string {
  const base = "<b>You will not be able to see this screen.</b> Turn until you hear the countdown, then hold still. Two beeps, then a higher shutter beep.";
  return touchFirst ? base : `${base} Space bar takes it immediately.`;
}
