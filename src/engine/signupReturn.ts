import { track } from "./track.js";

const KEY = "truemax:signup-return:v1";
const MAX_AGE_MS = 30 * 60 * 1000;
interface Attempt { scanId: string; startedAt: number }
interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** Local correlation only. The event sender receives a name, never this record. */
export function createSignupReturnTracker(
  local: () => Store,
  session: () => Store,
  emit: (event: "signup-return-analysis" | "signup-return-lost") => void,
  now = Date.now,
) {
  let memory: Attempt | null = null;
  let persistedLocally = false;
  const read = (store: () => Store): Attempt | null => {
    try {
      const raw = store().getItem(KEY);
      if (!raw) return null;
      const value = JSON.parse(raw) as Attempt;
      const age = now() - value.startedAt;
      if (typeof value.scanId !== "string" || !value.scanId || !Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) {
        store().removeItem(KEY);
        return null;
      }
      return value;
    } catch { return null; }
  };
  const clear = () => {
    memory = null;
    for (const store of [local, session]) {
      try { store().removeItem(KEY); } catch { /* storage is optional */ }
    }
  };
  return {
    begin(scanId: string) {
      memory = { scanId, startedAt: now() };
      persistedLocally = false;
      for (const store of [local, session]) {
        try {
          store().setItem(KEY, JSON.stringify(memory));
          if (store === local) persistedLocally = true;
        } catch { /* keep the in-memory attempt */ }
      }
    },
    // An email may open a new tab. Only the existing authenticated scan-claim
    // boundary may bind that tab to the stored intent; an ordinary login cannot.
    bindClaim(scanId: string) {
      const attempt = read(local);
      if (attempt?.scanId === scanId) {
        memory = attempt;
        persistedLocally = true;
        try { session().setItem(KEY, JSON.stringify(attempt)); } catch { /* memory remains */ }
      }
    },
    finish(analysisShown: boolean, scanId?: string) {
      const attempt = memory ?? read(session);
      if (!attempt || now() - attempt.startedAt > MAX_AGE_MS) return;
      if (scanId !== undefined && attempt.scanId !== scanId) return;
      // An email-return tab may have already consumed the shared attempt.
      // Its old opener must not turn the same success into a second loss.
      try {
        const shared = read(local);
        if ((persistedLocally || !memory) && (shared?.scanId !== attempt.scanId || shared.startedAt !== attempt.startedAt)) {
          memory = null;
          try { session().removeItem(KEY); } catch { /* no retry needed */ }
          return;
        }
      } catch { /* an in-memory attempt still works with blocked storage */ }
      clear();
      emit(analysisShown ? "signup-return-analysis" : "signup-return-lost");
    },
    clear,
  };
}

export const signupReturn = createSignupReturnTracker(
  () => localStorage,
  () => sessionStorage,
  track,
);
