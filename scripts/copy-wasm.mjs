// Copies MediaPipe's WASM runtime from node_modules into public/ so the app
// is fully self-hosted — no CDN fetch at runtime.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = join(root, "public", "wasm");

if (!existsSync(src)) {
  console.error("copy-wasm: @mediapipe/tasks-vision not installed yet");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("copy-wasm: copied MediaPipe WASM runtime to public/wasm");
