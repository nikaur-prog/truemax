import { readFileSync } from "node:fs";
import { CONVERSATION_QUALITY_CASES } from "../api/_maxConversationQuality.fixtures.js";
import { reviewConversationReply } from "../api/_maxConversationQualityEval.js";

// Local captured-text review only. This command has no provider or credential access.
const file = process.argv[2];
if (!file || file === "--help") {
  console.log("Usage: npx tsx tools/max-conversation-quality-eval.ts replies.json\nInput: [{\"id\":\"measurement_direct\",\"reply\":\"captured assistant reply\"}]\nNo provider calls are made. All outputs require human review against the supplied criteria.");
} else {
  try {
    const captured: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(captured) || !captured.length) throw new Error("Expected a non-empty array of captured replies");
    const seen = new Set<string>();
    const reviews = captured.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") throw new Error("Each captured reply must be an object");
      const row = entry as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.reply !== "string") throw new Error("Each captured reply needs string id and reply fields");
      if (seen.has(row.id)) throw new Error(`Duplicate case: ${row.id}`);
      seen.add(row.id);
      const scenario = CONVERSATION_QUALITY_CASES.find((candidate) => candidate.id === row.id);
      if (!scenario) throw new Error(`Unknown case: ${row.id}`);
      return reviewConversationReply(scenario, row.reply);
    });
    const missingCases = CONVERSATION_QUALITY_CASES.filter((scenario) => !seen.has(scenario.id)).map((scenario) => scenario.id);
    console.log(JSON.stringify({ coverage: `${reviews.length}/${CONVERSATION_QUALITY_CASES.length}`, missingCases, humanReviewRequired: true, reviews }, null, 2));
    if (reviews.some((review) => review.mechanicalFlags.length)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not review captured replies");
    process.exitCode = 2;
  }
}
