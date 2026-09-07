import {
  dayAccepted, isDayString, nextStreak, STREAK_REASONS,
  type StreakCountResult, type StreakReason, type StreakSnapshot,
} from "./dailyStreak.js";

export type StreakCache = Pick<StreakSnapshot, "state" | "balances">;
type PendingDay = { day: string; reason: StreakReason };

interface Dependencies {
  owner(): string | null;
  token(userId: string): Promise<string | null>;
  storage(): Pick<Storage, "getItem" | "setItem">;
  now(): Date;
  read(token: string): Promise<StreakSnapshot | null>;
  count(token: string, reason: StreakReason, day: string): Promise<StreakCountResult | null>;
  enable(token: string, enabled: boolean): Promise<StreakSnapshot | null>;
  changed(cache: StreakCache | null): void;
}

function validCache(value: unknown): value is StreakCache {
  const cache = value as StreakCache | null;
  const s = cache?.state;
  const b = cache?.balances;
  const nonnegative = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  return Boolean(s && b && nonnegative(s.current) && nonnegative(s.best)
    && nonnegative(s.graceBanked) && typeof s.enabled === "boolean"
    && (s.lastCountedDay === null || isDayString(s.lastCountedDay))
    && (s.graceSpentOn === null || s.graceSpentOn === undefined || isDayString(s.graceSpentOn))
    && nonnegative(b.consistency));
}

/** Owner-bound requests, serial writes, and a small retry queue for real actions.
 * Optimistic counts are display-only. A failed request must not become a saved
 * "counted" day, or a later account's balance, just because its response was slow.
 */
export function createDailyStreakStore(deps: Dependencies) {
  const memory = new Map<string, string>();
  const queues = new Map<string, Promise<unknown>>();
  const key = (owner: string) => `truemax:dailyStreak:${owner}`;
  const ownerNow = () => {
    const owner = deps.owner();
    return owner?.startsWith("user:") ? owner : null;
  };
  const get = (name: string): unknown => {
    try { return JSON.parse(memory.get(name) ?? deps.storage().getItem(name) ?? "null"); }
    catch { try { return JSON.parse(memory.get(name) ?? "null"); } catch { return null; } }
  };
  const put = (name: string, value: unknown) => {
    const json = JSON.stringify(value);
    memory.set(name, json);
    try { deps.storage().setItem(name, json); } catch { /* retry in this session */ }
  };
  const cached = (owner: string): StreakCache | null => {
    const value = get(key(owner));
    if (!validCache(value)) return null;
    // A cache written before grace was recorded has no such field. Normalise
    // rather than reject: the run itself is still true, and only the one-day
    // explanation is missing.
    return { ...value, state: { ...value.state, graceSpentOn: value.state.graceSpentOn ?? null } };
  };
  const pending = (owner: string): PendingDay[] => {
    const value = get(`${key(owner)}:pending`);
    return Array.isArray(value) ? value.filter((entry): entry is PendingDay => Boolean(entry
      && dayAccepted(entry.day, deps.now()) && STREAK_REASONS.includes(entry.reason))).slice(-3) : [];
  };
  const show = (owner: string, cache: StreakCache | null) => {
    if (ownerNow() === owner) deps.changed(cache);
  };
  const accept = (owner: string, snapshot: StreakCache | null) => {
    if (!validCache(snapshot) || ownerNow() !== owner) return false;
    put(key(owner), { state: snapshot.state, balances: snapshot.balances });
    show(owner, snapshot);
    return true;
  };
  const serial = <T>(owner: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(owner) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    queues.set(owner, result);
    void result.finally(() => { if (queues.get(owner) === result) queues.delete(owner); }).catch(() => undefined);
    return result;
  };
  const tokenFor = async (owner: string) => {
    if (ownerNow() !== owner) return null;
    const token = await deps.token(owner.slice(5)).catch(() => null);
    return ownerNow() === owner ? token : null;
  };
  const flush = async (owner: string, token: string): Promise<void> => {
    for (const action of pending(owner)) {
      if (ownerNow() !== owner) return;
      const before = cached(owner);
      if (before) show(owner, { ...before, state: nextStreak(before.state, action.day).state });
      const result = await deps.count(token, action.reason, action.day).catch(() => null);
      if (!accept(owner, result)) {
        show(owner, cached(owner));
        return;
      }
      // Read again: another action may have been queued while this request ran.
      put(`${key(owner)}:pending`, pending(owner).filter((item) => item.day !== action.day));
    }
  };
  return {
    cached(): StreakCache | null { const owner = ownerNow(); return owner ? cached(owner) : null; },
    refresh(expectedUserId?: string): Promise<StreakCache | null> {
      const owner = ownerNow();
      if (expectedUserId && owner !== `user:${expectedUserId}`) return Promise.resolve(null);
      if (!owner) { deps.changed(null); return Promise.resolve(null); }
      return serial(owner, async () => {
        const token = await tokenFor(owner);
        if (!token) return null;
        await flush(owner, token);
        if (ownerNow() !== owner) return null;
        const snapshot = await deps.read(token).catch(() => null);
        return accept(owner, snapshot) ? snapshot : null;
      });
    },
    record(reason: StreakReason, day: string): Promise<void> {
      const owner = ownerNow();
      if (!owner || !dayAccepted(day, deps.now())) return Promise.resolve();
      // A settled counted day needs no second request. Failed attempts remain
      // queued and can retry on another action, dashboard open, or reconnect.
      if (cached(owner)?.state.lastCountedDay === day) return Promise.resolve();
      const waiting = pending(owner);
      if (!waiting.some((item) => item.day === day)) put(`${key(owner)}:pending`, [...waiting, { day, reason }]);
      return serial(owner, async () => {
        const token = await tokenFor(owner);
        if (token) await flush(owner, token);
      });
    },
    setEnabled(enabled: boolean, expectedUserId: string): Promise<StreakCache | null> {
      const owner = ownerNow();
      if (owner !== `user:${expectedUserId}`) return Promise.resolve(null);
      return serial(owner, async () => {
        const token = await tokenFor(owner);
        if (!token) return null;
        const snapshot = await deps.enable(token, enabled).catch(() => null);
        return accept(owner, snapshot) ? snapshot : null;
      });
    },
  };
}
