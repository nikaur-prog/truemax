// Copies MediaPipe's WASM runtime from node_modules into public/ so the app
// is fully self-hosted — no CDN fetch at runtime.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

// The face model cannot distinguish a hood from hair. Google's multiclass
// selfie segmenter can: its output separates hair, face skin, clothing and
// accessories. Keep the 16 MB binary out of git but pin and verify it during
// install so production serves it from TrueMax rather than sending user pixels
// to any third party or depending on a runtime CDN.
const segmenter = {
  url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
  sha256: "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0",
  file: join(root, "public", "models", "selfie_multiclass_256x256.tflite"),
};
const hash = (data) => createHash("sha256").update(data).digest("hex");
let segmenterData = existsSync(segmenter.file) ? readFileSync(segmenter.file) : null;
if (!segmenterData || hash(segmenterData) !== segmenter.sha256) {
  const response = await fetch(segmenter.url);
  if (!response.ok) throw new Error(`copy-wasm: segmenter download failed (${response.status})`);
  segmenterData = Buffer.from(await response.arrayBuffer());
  if (hash(segmenterData) !== segmenter.sha256) {
    throw new Error("copy-wasm: segmenter checksum did not match the pinned Google model");
  }
  mkdirSync(dirname(segmenter.file), { recursive: true });
  writeFileSync(segmenter.file, segmenterData);
  console.log("copy-wasm: downloaded verified multiclass selfie segmenter");
}
