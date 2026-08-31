import type { MaxChatContext } from "../engine/maxContext.js";

// ---------------------------------------------------------------------------
// What to ask Coach Max next.
//
// The chat opened with four fixed chips and then threw them away for good on
// the first message, which is exactly backwards. The person who needs a
// prompt is not the one who has just arrived and has an obvious question —
// it is the one three answers deep who has read something interesting and
// does not know what the follow-up is called.
//
// So these are computed after every reply, from two things: the scan, which
// says what is actually worth asking about on THIS face, and the last thing
// Max said, which is where the thread already is. Nothing here calls a model.
// Paying for a round trip to guess at four short questions would cost more
// than the answer they lead to, and a deterministic list has the property
// that it can never suggest asking about a measurement the report does not
// contain.
//
// They are suggestions, not a menu. The text box is always there and always
// first in the DOM order for a screen reader; these sit under it for the
// thumb that would rather tap than type.
// ---------------------------------------------------------------------------

const MAX_CHIPS = 3;

// Openers, before anything has been said. Broad on purpose: at this point the
// only thing known about the reader is that they have a scan and no question.
export const OPENING_SUGGESTIONS = [
  "What's strong and what needs work?",
  "What should I do first?",
  "Create a plan for me.",
];

// The leading noun of a focus entry — "Nose : intercanthal width, currently
// 1.31, essentially fixed..." becomes "Nose : intercanthal width". The focus
// strings are built in maxContext.ts as `${name}, currently ...`, so the split
// is on the first comma and nothing else depends on the tail.
function focusName(entry: string | undefined): string | null {
  if (!entry) return null;
  const name = entry.split(",")[0]?.trim();
  return name ? name : null;
}

function lowestRegion(context: MaxChatContext | null): string | null {
  let worst: { label: string; percentile: number } | null = null;
  for (const r of context?.regions ?? []) {
    if (!worst || r.percentile < worst.percentile) worst = r;
  }
  return worst ? worst.label : null;
}

function bestRegion(context: MaxChatContext | null): string | null {
  let best: { label: string; percentile: number } | null = null;
  for (const r of context?.regions ?? []) {
    if (!best || r.percentile > best.percentile) best = r;
  }
  return best ? best.label : null;
}

// Did Max end on an offer? Models like to close with one, and "yes" is by far
// the most likely next message — it should not require typing it.
function offeredSomething(reply: string): boolean {
  const tail = reply.slice(-260).toLowerCase();
  return (
    /\bwant me to\b/.test(tail) ||
    /\bshall i\b/.test(tail) ||
    /\bshould i (?:build|write|put|draw|lay)\b/.test(tail) ||
    /\bwould you like me to\b/.test(tail)
  );
}

/**
 * Follow-ups to offer after a reply from Max.
 *
 * `asked` is every question already put to him this session, so a chip is
 * never offered twice — a suggestion the reader has already taken reads as
 * the app having forgotten the last minute of the conversation.
 */
export function suggestFollowUps(
  context: MaxChatContext | null,
  reply: string,
  asked: readonly string[],
): string[] {
  const out: string[] = [];
  const spent = new Set(asked.map((q) => q.trim().toLowerCase()));
  const push = (line: string | null | undefined): void => {
    if (!line) return;
    if (spent.has(line.trim().toLowerCase())) return;
    if (out.includes(line)) return;
    out.push(line);
  };

  const said = reply.toLowerCase();

  // 1. The thread Max himself opened. An unanswered offer outranks anything
  //    computed from the scan, because it is the only chip that continues the
  //    conversation rather than starting a new one.
  if (offeredSomething(reply)) push("Yes, do that.");

  // 2. Something he raised that has an obvious second question.
  if (/\bbody ?fat|leanness|lean\b/.test(said)) push("How would I test whether that matters?");
  else if (/\bsurgery|surgical|procedure\b/.test(said)) push("What can I do without surgery?");
  else if (/\blighting|angle|camera|photo\b/.test(said)) push("How should I shoot the next one?");

  if (/\bweeks?\b|\bmonths?\b|\btime\b/.test(said)) push("How long until it shows on a rescan?");

  // 3. The scan. The weakest measurement is what people came to ask about,
  //    and the strongest region is the question nobody thinks to ask and
  //    everybody wants answered.
  const weakest = focusName(context?.focus[0]);
  if (weakest && !said.includes(weakest.toLowerCase())) push(`Why is ${weakest.toLowerCase()} low?`);

  const low = lowestRegion(context);
  if (low) push(`Which measurements lower my ${low.toLowerCase()}?`);

  const high = bestRegion(context);
  if (high) push(`What is my ${high.toLowerCase()} doing right?`);

  // 4. Generic backstops, so the row is never short on a terse answer.
  push("What would move my score the most?");
  push("Is that my face or the photograph?");
  push("Create a plan for me.");

  return out.slice(0, MAX_CHIPS);
}
