// Source text, not a second implementation. The dev-only export remains
// reproducible even when a local dirty checkout still has build stamp "dev".
import scoring from "../engine/scoring.ts?raw";
import metrics from "../engine/metrics.ts?raw";
import geometry from "../engine/geometry.ts?raw";
import sideMetrics from "../engine/sideMetrics.ts?raw";
import sideVerify from "./sideVerify.ts?raw";
import consensus from "../engine/consensus.ts?raw";
import landmarker from "../engine/landmarker.ts?raw";
import sideMask from "../engine/sideMask.ts?raw";
import headCovering from "../engine/headCovering.ts?raw";
import sidePlacementQuality from "../engine/sidePlacementQuality.ts?raw";
import sidePrior from "../engine/sidePrior.ts?raw";
import reliability from "../engine/reliability.ts?raw";
import reliabilitySeed from "../engine/reliabilitySeed.ts?raw";
import shape from "../engine/shape.ts?raw";
import hairline from "../engine/hairline.ts?raw";
import quality from "../engine/quality.ts?raw";
import packageManifest from "../../package.json?raw";
import pipelineBias from "../engine/calibration/pipelineBias.ts?raw";
import optionalModel from "../engine/optionalModel.ts?raw";

export const PILOT_SOURCES: Record<string, string> = {
  "src/engine/scoring.ts": scoring, "src/engine/metrics.ts": metrics,
  "src/engine/geometry.ts": geometry, "src/engine/sideMetrics.ts": sideMetrics,
  "src/ui/sideVerify.ts": sideVerify, "src/engine/consensus.ts": consensus,
  "src/engine/landmarker.ts": landmarker, "src/engine/sideMask.ts": sideMask,
  "src/engine/headCovering.ts": headCovering, "src/engine/sidePlacementQuality.ts": sidePlacementQuality,
  "src/engine/sidePrior.ts": sidePrior, "src/engine/reliability.ts": reliability,
  "src/engine/reliabilitySeed.ts": reliabilitySeed, "src/engine/shape.ts": shape,
  "src/engine/hairline.ts": hairline, "src/engine/quality.ts": quality,
  "package.json": packageManifest,
  "src/engine/calibration/pipelineBias.ts": pipelineBias,
  "src/engine/optionalModel.ts": optionalModel,
};
