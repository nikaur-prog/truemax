// The Goal preview consent, as one string shared by the client and the
// server, so the dialog, the route and the migration's check constraint
// cannot drift apart. Its own version, never merged with the cloud-pass
// choice or the feedback consent: agreeing to one is never agreeing to
// another (docs/FACIAL_MORPH_PLAN.md, section 5a).
export const GOAL_PREVIEW_CONSENT_VERSION = "goal-preview-v1";

/** The caption every rendered preview carries, in its pixels and beside it. */
export const GOAL_PREVIEW_CAPTION = "A synthetic visual direction based on your selected goals, not a forecast.";
