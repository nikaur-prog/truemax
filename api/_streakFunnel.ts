import { safeMessage } from "./_shared.js";

type StreakEvent = "streak-day-counted" | "streak-ended" | "streak-enabled" | "streak-disabled";

interface EventCounter {
  rpc(name: "bump_funnel_event", args: { p_event: StreakEvent }): PromiseLike<{ error: { message: string } | null }>;
}

/** Aggregate diagnostics only. The streak or setting has already been saved.
 * Supabase normally returns an error value instead of rejecting the promise.
 * Check both paths, and let an independent event proceed if one counter fails.
 * Do not retry here: a response lost after commit could otherwise count twice.
 */
export async function recordStreakFunnel(
  counter: EventCounter,
  events: readonly StreakEvent[],
  failed: (event: StreakEvent, error: unknown) => void = (event, error) => {
    console.error("streak funnel", event, safeMessage(error));
  },
): Promise<void> {
  for (const event of events) {
    try {
      const { error } = await counter.rpc("bump_funnel_event", { p_event: event });
      if (error) throw new Error(error.message);
    } catch (error) {
      failed(event, error);
    }
  }
}
