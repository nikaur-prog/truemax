// Soft key-tick for the typewriter. Muteable; lazily creates the context.
let muted = false;
let ctx: AudioContext | null = null;

export function tick(): void {
  if (muted) return;
  try {
    ctx = ctx ?? new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1350 + Math.random() * 500;
    g.gain.value = 0.016;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
    o.stop(ctx.currentTime + 0.035);
  } catch {
    /* audio unavailable — stay silent */
  }
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}
