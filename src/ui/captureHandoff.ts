/** A stopped camera is expected during handoff; scan ownership governs recovery. */
export async function runCaptureHandoff(options: {
  isCurrent(): boolean;
  run(): Promise<void>;
  onError(): void;
}): Promise<void> {
  if (!options.isCurrent()) return;
  try { await options.run(); }
  catch { if (options.isCurrent()) options.onError(); }
}
