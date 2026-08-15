import { handleEvent } from "./_events.js";

// The counter's old address, kept alive only for browsers still running a
// cached bundle that posts here. New traffic goes to /api/e, because filter
// lists block anything matching "/track" — see e.ts.
export const POST = handleEvent;
