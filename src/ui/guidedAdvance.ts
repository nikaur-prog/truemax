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
// ---------------------------------------------------------------------------

export interface AdvanceView {
  /** Green and advancing, rather than black and asking. */
  ready: boolean;
  text: string;
}

export class GuidedAdvance {
  private index = 0;
  private total: number = SIDE_POINTS.length;
  private moved = false;
  private confirmed = false;

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

  /** What the press did. "confirm" repaints; "advance" moves the walk on. */
  press(): "confirm" | "advance" {
    if (this.view().ready) return "advance";
    this.confirmed = true;
    return "confirm";
  }

  view(): AdvanceView {
    const ready = this.moved || this.confirmed;
    if (!ready) return { ready: false, text: "In the right spot?" };
    if (this.index >= this.total - 1) return { ready: true, text: "Finish" };
    return { ready: true, text: `Next point: ${SIDE_POINTS[this.index + 1].label}` };
  }
}
