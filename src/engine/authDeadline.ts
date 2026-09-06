// A DNS/TLS stall must not hold first sign-in behind a custom-domain probe.
// Keep the deadline around the whole operation, including JSON when needed.
// The explicit race also releases callers if a fetch adapter ignores abort.
export const AUTH_SETTINGS_DEADLINE_MS = 3_000;

export async function withAuthDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  timeoutMs = AUTH_SETTINGS_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Auth settings request timed out"));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => read(controller.signal)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
