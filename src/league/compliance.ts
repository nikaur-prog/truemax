export const DEFAULT_CAMPAIGN_TAG = "#truemax";

export type CtaVariant = "short" | "long" | "custom";

/**
 * Campaign tags are deliberately boring. Keeping them to TikTok's ordinary
 * ASCII hashtag shape makes the browser, tracker and database agree on the
 * exact token a caption must contain.
 */
export function campaignTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().toLowerCase();
  return /^#[a-z0-9_]{3,32}$/.test(tag) ? tag : null;
}

/** Exact hashtag match, case-insensitive. `#truemax` must not accept the
 * unrelated `#truemaxgiveaway`; tokenising first avoids regex-boundary traps.
 */
export function captionIncludesCampaignTag(description: unknown, required: unknown): boolean {
  if (typeof description !== "string") return false;
  const tag = campaignTag(required);
  if (!tag) return false;
  const hashtags: string[] = description.toLowerCase().match(/#[a-z0-9_]+/g) ?? [];
  return hashtags.includes(tag);
}

export interface SubmissionCompliance {
  status: string;
  captionCompliant: boolean;
  ctaVerifiedAt: string | null;
  disclosureVerifiedAt: string | null;
}

/** One predicate for the tracker-facing and settlement-facing contract. The
 * database repeats this check as the security boundary; this copy keeps API
 * decisions and UI tests readable.
 */
export function submissionCanAccrue(value: SubmissionCompliance): boolean {
  return (value.status === "approved" || value.status === "earning")
    && value.captionCompliant
    && Boolean(value.ctaVerifiedAt)
    && Boolean(value.disclosureVerifiedAt);
}
