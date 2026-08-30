// Which headline the landing page opens with.
//
// One fixed headline is the safe answer and it is also the wrong one here,
// because this page gets visited far more than once. The same eight words on
// every return stop being read at all, and the clearest product promise is
// worth more when it is not wallpaper. So the page rotates, and it rotates in order rather than at
// random: random repeats, and a headline that repeats twice in a row reads as
// a page that failed to load rather than a page with more than one thing to
// say.
//
// The harder rule is on the signed-in copy. It is tempting to greet someone
// with "let's see this week's improvements", and that is a claim about their
// face made before anything has been measured — the same class of mistake as
// printing a percentile the sample cannot support. Every signed-in line here
// is therefore either a question or an invitation, never a report. What has
// changed is something the scan says, not something the greeting says.

export interface Headline {
  /** Text before the emphasised span. */
  lead: string;
  /** The emphasised span. Empty when the line carries no emphasis. */
  em: string;
  /** Text after the emphasised span. */
  tail: string;
}

export interface HeadlineContext {
  /** First name of the signed-in user, or null when signed out. */
  name: string | null;
  /** How many comparable scans this owner already has. */
  scanCount: number;
  /** Whole days since the most recent scan, or null when there is none. */
  daysSinceLastScan: number | null;
  /** Monotonic visit counter — see nextVisit(). */
  visit: number;
}

// Signed out. Three factual ways into the same product, strongest first,
// because visit 0 is the one that has to carry a stranger. None turns a
// measurement tool into a universal verdict about attractiveness.
const ANONYMOUS: Headline[] = [
  { lead: "Your face score, ", em: "measurement by measurement", tail: "." },
  { lead: "See what works, ", em: "and what can move", tail: "." },
  { lead: "Understand your face, ", em: "without the guesswork", tail: "." },
];

// A week is the shortest gap over which this instrument can tell a change from
// its own noise, so it is also the shortest gap over which asking "what's
// changed" is an honest question rather than a prompt to re-measure the same
// face.
const RESCAN_DAYS = 7;

function rotate(list: Headline[], visit: number): Headline {
  // Guard the modulo against a corrupted counter rather than trusting storage.
  const i = Number.isFinite(visit) ? Math.abs(Math.trunc(visit)) : 0;
  return list[i % list.length]!;
}

export function pickHeadline(ctx: HeadlineContext): Headline {
  const name = ctx.name?.trim();
  if (!name) return rotate(ANONYMOUS, ctx.visit);

  // Signed in but nothing measured yet: the promise still has to be made, and
  // the name is the only thing worth adding to it.
  if (ctx.scanCount === 0) {
    return rotate(
      [
        { lead: `${name}, let's get your `, em: "first read", tail: "." },
        { lead: `${name}, start with your `, em: "measurements", tail: "." },
      ],
      ctx.visit,
    );
  }

  // Long enough since the last scan that a rescan could actually resolve a
  // move. An open question, not a promise that there is one.
  if (ctx.daysSinceLastScan !== null && ctx.daysSinceLastScan >= RESCAN_DAYS) {
    return rotate(
      [
        { lead: `${name}, let's see `, em: "what's changed", tail: "." },
        { lead: `${name}, time for `, em: "another read", tail: "." },
      ],
      ctx.visit,
    );
  }

  // Recently scanned. Nothing to ask for, so the line stops selling and just
  // says the door is open.
  return rotate(
    [
      { lead: `${name}'s dream glowup, `, em: "one scan at a time", tail: "." },
      { lead: `${name}, scan again `, em: "whenever you're ready", tail: "." },
    ],
    ctx.visit,
  );
}

/** Render a headline into an h1, keeping the emphasis span the design expects. */
export function paintHeadline(h1: HTMLElement, headline: Headline): void {
  h1.textContent = headline.lead;
  if (headline.em) {
    const em = document.createElement("em");
    em.textContent = headline.em;
    h1.append(em);
  }
  if (headline.tail) h1.append(document.createTextNode(headline.tail));
}
