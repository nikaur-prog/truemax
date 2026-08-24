import { SIDE_POINTS } from "../engine/sideMetrics.js";

// ---------------------------------------------------------------------------
// How much confirmation one step of the walkthrough still needs.
//
// The rule is that MOVING THE POINT IS THE ANSWER. Somebody who has just
// dragged a ring onto their jaw hinge has already said where it goes; putting
// a "confirm?" in front of them afterwards asks the same question twice, and
// thirteen times over that is most of why the walkthrough felt long.
//
// Touching nothing is not an answer. On a seed that landed badly — which is
// the case the walkthrough exists for — tapping straight through thirteen
// points is precisely the accident to prevent, and one deliberate press is the
// smallest thing that can prevent it. So an untouched point asks once, in
// black: "In the right spot?". Say yes and it turns green and names what comes
// next, and the same button advances.
//
// The answer is scoped to the step. Going back to a point you already passed
// asks again, because it is being looked at again.
//
// THREE states, not two. While a finger is actually down on the ring the button
// stops asking anything and shows three bouncing dots instead: mid-drag is the
// one moment the question "in the right spot?" is guaranteed to be wrong, and a
// button that reads as pressable under a finger that is busy elsewhere invites a
// second thumb. The dots say "still listening" and nothing else.
// ---------------------------------------------------------------------------

export interface AdvanceView {
  /** Green and advancing, rather than blue and asking. */
  ready: boolean;
  /** Mid-drag: show bouncing dots rather than any label. */
  busy: boolean;
  text: string;
}

export class GuidedAdvance {
  private index = 0;
  private total: number = SIDE_POINTS.length;
  private moved = false;
  private confirmed = false;
  private dragging = false;

  /**
   * The walkthrough moved, or the current point did. `moved` false means a
   * navigation (a fresh step, unanswered); true means this step's point has
   * been placed or dragged.
   */
  step(index: number, total: number, moved: boolean): void {
    this.index = index;
    this.total = total;
    this.moved = moved;
    // A navigation clears the answer. A move within the same step must not:
    // having confirmed and THEN nudged the ring should not un-confirm it.
    if (!moved) this.confirmed = false;
  }

  /** A pointer is down on the ring, or has just come off it. */
  setDragging(dragging: boolean): void {
    this.dragging = dragging;
  }

  /** What the press did. "confirm" repaints; "advance" moves the walk on. */
  press(): "confirm" | "advance" {
    // A press cannot land mid-drag — the button is not offering anything then.
    if (this.dragging) return "confirm";
    if (this.view().ready) return "advance";
    this.confirmed = true;
    return "confirm";
  }

  view(): AdvanceView {
    if (this.dragging) return { ready: false, busy: true, text: "" };
    const ready = this.moved || this.confirmed;
    if (!ready) return { ready: false, busy: false, text: "In the right spot?" };
    // The chevrons are there so the button reads as the way onward rather than
    // as a statement about the point.
    if (this.index >= this.total - 1) return { ready: true, busy: false, text: "Finish »" };
    return { ready: true, busy: false, text: `Next point: ${SIDE_POINTS[this.index + 1].label} »` };
  }

  /** Whether this step has been answered — drives the marker turning green. */
  answered(): boolean {
    return this.moved || this.confirmed;
  }
}
