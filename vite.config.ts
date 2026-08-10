import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2020",
    rollupOptions: {
      // Two entry points. `quick.html` is the unlisted breakdown page — it
      // shares the engine, so listing it here rather than duplicating anything
      // is what keeps the score it shows identical to the real one.
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        quick: resolve(import.meta.dirname, "quick.html"),
      },
    },
  },
  // MediaPipe's wasm loader fetches sibling files at runtime; keep them
  // out of the bundle pipeline (they live in public/wasm).
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
});
