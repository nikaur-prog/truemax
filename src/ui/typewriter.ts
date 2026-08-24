// The text arrives whole.
//
// This used to type out at ~60 chars/sec, and the argument for it was that the
// effect paces reading. On a page whose entire claim is that it shows you real
// measurements, it does something worse: it withholds a number you have already
// been given, so the first instinct is to tap to skip — and an animation whose
// best outcome is being skipped is not pacing anything. It also put the region
// summary behind a two-second wait on every single tab change.
//
// The functions are kept, and still own their element, so callers do not need
// to care that the pacing is gone. `stopTypewriter` stays because callers use
// it to tear down before re-rendering.

export function typewrite(box: HTMLElement, text: string): void {
  stopTypewriter();
  box.textContent = text;
}

// Nothing is running any more, so there is nothing to cancel. Kept because
// callers tear down with it before re-rendering, and a no-op is a smaller
// change than hunting down every one of them.
export function stopTypewriter(): void {}

// ---------------------------------------------------------------------------
// Typing out a whole block, markup and all.
//
// `typewrite` above takes a plain string and owns the element it types into,
// which is fine for the region summary and useless for the overview: that
// block is a paragraph, a bolded callout, three score cards and a footnote,
// and blanking it to retype character by character would throw the markup
// away. This walks the text nodes that are already there instead, so <b>,
// the cards and every class survive untouched.
//
// Nothing is paced any more — see the note at the top of this file. The
// function stays so the two funnel callers do not have to know that, and so
// the reserved-height trick is not reinvented if pacing ever comes back.
export function typewriteBlock(root: HTMLElement): void {
  // The markup already contains the text; there is nothing to reveal.
  void root;
}
