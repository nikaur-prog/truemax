import { json } from "./_shared.js";

/** Deployment opt-in for new renders only; saved-preview access stays available. */
export function previewGenerationUnavailable(env: NodeJS.ProcessEnv = process.env): Response | null {
  if (env.GOAL_PREVIEW_RENDER_ENABLED === "1") return null;
  return json({
    error: "Goal preview rendering is not available yet. Your plan is still available.",
    requestRejected: true,
  }, 503);
}
