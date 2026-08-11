import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));

export const APP_DIR = resolve(TOOLS_DIR, "..");
export const DATA_DIR = process.env.TM_DATA
  ? resolve(process.env.TM_DATA)
  : resolve(APP_DIR, ".calib");

export function dataFile(name) {
  return resolve(DATA_DIR, name);
}

export async function startVite(port) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const server = spawn(
    command,
    ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: APP_DIR, stdio: "ignore" },
  );
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`Vite exited with code ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return { server, url };
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  server.kill();
  throw new Error(`Timed out waiting for Vite on port ${port}`);
}

export async function launchChromium(chromium) {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => existsSync(candidate));
  return chromium.launch(executablePath ? { executablePath } : {});
}
