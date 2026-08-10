import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2020",
    rollupOptions: {
      // Three entry points, both extras unlisted and both sharing the engine
      // rather than approximating it — that shared import is what keeps the
      // numbers they show identical to the real ones.
      //
      //   quick.html  the fifteen-second breakdown, built for filming
      //   calib.html  the calibration bench, which measures one face many
      //               times so the spread can be seen. It exists because that
      //               spread cannot be measured without a set of photographs
      //               of one person, and running it in the browser is what
      //               makes handing over such a set unnecessary.
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        quick: resolve(import.meta.dirname, "quick.html"),
        calib: resolve(import.meta.dirname, "calib.html"),
      },
    },
  },
  // MediaPipe's wasm loader fetches sibling files at runtime; keep them
  // out of the bundle pipeline (they live in public/wasm).
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
});
