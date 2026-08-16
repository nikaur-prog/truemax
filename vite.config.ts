import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // The build a browser is actually running, stamped into the bundle and shown
  // in the footer. Twice now a fix has been reported as missing when it was
  // deployed and the browser was holding an older bundle, and there was no way
  // to tell those two cases apart except by reading minified JavaScript off
  // production. Seven characters in the footer answers it from a screenshot.
  define: {
    __BUILD__: JSON.stringify(
      (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "dev",
    ),
  },
  build: {
    target: "es2020",
    rollupOptions: {
      // Four entry points: two unlisted engine tools, the product, and the
      // dedicated account portal. The tools share the engine rather than
      // approximating it — that shared import is what keeps the
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
        auth: resolve(import.meta.dirname, "auth.html"),
        quick: resolve(import.meta.dirname, "quick.html"),
        calib: resolve(import.meta.dirname, "calib.html"),
        // Static, indexable, and carrying no script at all. The privacy policy
        // in particular has to be readable by someone who has not accepted
        // anything and by an app-store reviewer following a bare URL.
        privacy: resolve(import.meta.dirname, "privacy.html"),
        terms: resolve(import.meta.dirname, "terms.html"),
        // The logo pack has been sitting in public/brand since launch with
        // nothing linking to it. This is the page that hands it over.
        brand: resolve(import.meta.dirname, "brand.html"),
      },
    },
  },
  // MediaPipe's wasm loader fetches sibling files at runtime; keep them
  // out of the bundle pipeline (they live in public/wasm).
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
});
