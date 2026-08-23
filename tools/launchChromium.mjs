import { existsSync } from "node:fs";
import { chromium } from "playwright";

// Where these tools get their browser.
//
// Every tool in here used to hardcode executablePath: "/opt/pw-browsers/chromium",
// which is the path inside the sandbox they were written in. On any other
// machine — including the laptop that has to run the ones needing real network
// access — Playwright reports "executable doesn't exist" and the tool stops
// before doing anything.
//
// Order of preference:
//   1. TM_CHROMIUM, for a machine that wants to name its own binary.
//   2. The sandbox's shared build, when it is actually there.
//   3. Playwright's own downloaded browser — the normal case on a laptop, and
//      the one the hardcoded path was hiding.
export function chromiumPath() {
  if (process.env.TM_CHROMIUM) return process.env.TM_CHROMIUM;
  if (existsSync("/opt/pw-browsers/chromium")) return "/opt/pw-browsers/chromium";
  return null; // let Playwright resolve it
}

export async function launchChromium(options = {}) {
  const executablePath = chromiumPath();
  try {
    return await chromium.launch(executablePath ? { ...options, executablePath } : options);
  } catch (err) {
    // The default failure here is a stack trace about a missing file, which
    // reads like a broken tool rather than a browser that was never installed.
    throw new Error(
      `Could not start Chromium.\n` +
      (executablePath
        ? `Tried: ${executablePath}\nSet TM_CHROMIUM to a different binary, or unset it to use Playwright's own.\n`
        : `Playwright has no browser installed. Run:\n\n    npx playwright install chromium\n\n`) +
      `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
