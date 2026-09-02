// The Coach Max chat allowance, as the client states it.
//
// The ceiling itself is enforced by the server (api/_maxPersona.ts holds the
// copy the endpoint reads, and claim_max_chat_turn counts against it in a UTC
// day). This is the number the product PRINTS, and a test pins the two
// together so the paywall can never again sell "unlimited" over a wall of
// thirty: the benefit line and the limit are one figure or the test fails.
export const MAX_DAILY_MESSAGES = 30;

// Below this many left, the chat says so under the composer. Above it the
// count is noise: nobody needs to be told they have twenty-two messages.
export const ALLOWANCE_WARN_AT = 5;

// When the server's day rolls over, as an ISO stamp: the next UTC midnight
// after `now`. Mirrors claim_max_chat_turn, which keys usage on the UTC date.
export function nextUtcMidnight(now = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

// "back at 11:00 am" or "back tomorrow at 11:00 am", in the reader's own
// clock. The server says when its day ends; the person reads it where they
// are. `locale` and `timeZone` are injectable so a test can pin the output.
export function formatMaxReturn(
  resetsAt: string | null | undefined,
  now = Date.now(),
  locale?: string,
  timeZone?: string,
): string {
  const at = resetsAt ? new Date(resetsAt).getTime() : NaN;
  if (!Number.isFinite(at)) return "back tomorrow";
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(at);
  const dayOf = (t: number) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric", timeZone }).format(t);
  const sameDay = dayOf(at) === dayOf(now);
  return sameDay ? `back at ${time}` : `back tomorrow at ${time}`;
}

// The line under the composer once the count is low, or null while it is not
// worth saying. The plural is spelt out because "1 messages" is the kind of
// thing that makes a product look unattended.
export function allowanceLine(remaining: number | null, resetsAt: string | null | undefined, now = Date.now()): string | null {
  if (remaining === null || !Number.isFinite(remaining) || remaining > ALLOWANCE_WARN_AT) return null;
  if (remaining <= 0) return `That is ${MAX_DAILY_MESSAGES} messages today, which is the daily limit. Max is ${formatMaxReturn(resetsAt, now)}.`;
  const noun = remaining === 1 ? "message" : "messages";
  return `${remaining} ${noun} left today. Max is ${formatMaxReturn(resetsAt, now)}.`;
}
