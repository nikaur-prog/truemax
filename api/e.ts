import { handleEvent } from "./_events.js";

// ---------------------------------------------------------------------------
// The funnel counter's real address.
//
// It used to live at /api/track, and that name was costing real data: uBlock,
// AdGuard and Brave all block the URL pattern "/track" by default, so a
// meaningful share of visitors silently recorded nothing. On TikTok traffic —
// young, mobile, heavily ad-blocked — that is not a rounding error, and the
// failure is invisible: the numbers simply come back low and every conclusion
// drawn from them is wrong.
//
// A single letter carries no meaning for a filter list to match. The old path
// still answers (see track.ts) so a browser holding a cached bundle keeps
// counting.
// ---------------------------------------------------------------------------
export const POST = handleEvent;
