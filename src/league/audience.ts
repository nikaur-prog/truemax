// ---------------------------------------------------------------------------
// Audience tiers: where the views come from, not just how many.
//
// The pay formula in earnings.ts answers "how many people watched" and says
// nothing about who. That is the hole every creator programme falls into:
// a million views from a country with no card on file costs the same as a
// million views from the country the app actually sells in, and the second
// one is worth an order of magnitude more. A competitor in this exact niche
// gates on it explicitly, and they are right to.
//
// So a creator's account is placed in a tier from its audience geography, and
// the tier scales the rate. Two things this file is careful about:
//
//   IT IS NOT ETHNICITY, AND IT IS NOT ABOUT THE CREATOR. This reads the
//   country breakdown of an ACCOUNT'S VIEWERS, self-reported by the creator
//   from their own platform analytics and checked by a human. It says nothing
//   about the creator, and nothing about any face. The scanner's rule that
//   ethnicity is never inferred from a photograph is untouched and unrelated:
//   nothing here goes anywhere near a scan.
//
//   THE DEFAULTS CHANGE NOBODY'S MONEY. Every multiplier below is 1.0 out of
//   the box, so shipping this pays every existing creator exactly what it paid
//   them yesterday. The rates are a per-sprint setting; turning them on is a
//   deliberate act by the owner on a new sprint, not a silent repricing of a
//   deal somebody already accepted.
// ---------------------------------------------------------------------------

export type AudienceTier = "unrated" | "basic" | "elite";

/**
 * The countries a view is worth full rate from.
 *
 * Not a judgement about anywhere: it is where TrueMax can currently take a
 * subscription, in the currencies and stores it supports. It will grow as the
 * product does, which is why it is a list here rather than a constant baked
 * into a query.
 */
export const TIER_1 = [
  "US", "CA", "GB", "AU", "NZ", "IE",
  "DE", "FR", "NL", "SE", "DK", "NO", "FI", "CH", "AT", "BE", "IT", "ES", "PL",
] as const;

export type Tier1Country = (typeof TIER_1)[number];

/** What a creator reports from their own platform analytics, for review. */
export interface AudienceStats {
  /** Share of views from TIER_1 countries, 0 to 1. */
  tier1Share: number;
  /** Share of views from the United States specifically, 0 to 1. */
  usaShare: number;
  /** Views in the trailing 28 days, across the account. */
  views28d: number;
  /** How many videos those views are spread across. */
  videos28d: number;
}

export interface TierRule {
  id: AudienceTier;
  label: string;
  /** Minimum share of TIER_1 views. */
  minTier1Share: number;
  /** Minimum share of US views specifically. Elite only. */
  minUsaShare: number;
  minViews28d: number;
  minVideos28d: number;
  /**
   * What this tier multiplies the sprint's RPM by.
   *
   * 1.0 everywhere by default, deliberately: see the header. A sprint that
   * wants geography to matter sets its own numbers and says so on the offer
   * card before anyone posts under it.
   */
  rate: number;
  blurb: string;
}

export const TIER_RULES: readonly TierRule[] = [
  {
    id: "unrated",
    label: "Unrated",
    minTier1Share: 0,
    minUsaShare: 0,
    minViews28d: 0,
    minVideos28d: 0,
    rate: 1,
    blurb: "Every approved creator starts here and is paid the sprint's base rate. Send your audience breakdown to be placed.",
  },
  {
    id: "basic",
    label: "Basic",
    minTier1Share: 0.2,
    minUsaShare: 0,
    minViews28d: 10_000,
    minVideos28d: 1,
    rate: 1,
    blurb: "A fifth of your views come from countries TrueMax can sell in, on an account with real traffic behind it.",
  },
  {
    id: "elite",
    label: "Elite",
    minTier1Share: 0.4,
    minUsaShare: 0.4,
    minViews28d: 500_000,
    minVideos28d: 5,
    rate: 1,
    blurb: "Two fifths of your views come from the United States, at scale, and spread across a body of work rather than one hit.",
  },
];

export const ruleFor = (id: AudienceTier): TierRule =>
  TIER_RULES.find((r) => r.id === id) ?? TIER_RULES[0];

/**
 * The highest tier these stats qualify for.
 *
 * Every floor of a tier must be met, and the tiers are checked in order, so a
 * huge account with the wrong geography lands in Basic rather than Elite and a
 * small account with perfect geography lands in Unrated. Both are correct: the
 * tier is a statement about the audience AND its size, and one without the
 * other is not the thing being paid for.
 */
export function tierFor(stats: AudienceStats): AudienceTier {
  let best: AudienceTier = "unrated";
  for (const rule of TIER_RULES) {
    if (meets(rule, stats)) best = rule.id;
  }
  return best;
}

function meets(rule: TierRule, s: AudienceStats): boolean {
  return (
    s.tier1Share >= rule.minTier1Share &&
    s.usaShare >= rule.minUsaShare &&
    s.views28d >= rule.minViews28d &&
    s.videos28d >= rule.minVideos28d
  );
}

/**
 * Why these stats fall short of a tier, in the creator's own terms.
 *
 * "Rejected" with no reason is the thing that makes a creator programme feel
 * arbitrary, and an arbitrary programme does not get posted in. Empty means
 * the tier is met.
 */
export function shortfall(rule: TierRule, s: AudienceStats): string[] {
  const out: string[] = [];
  if (s.tier1Share < rule.minTier1Share) {
    out.push(
      `${pct(rule.minTier1Share)} of views from Tier 1 countries, you are at ${pct(s.tier1Share)}`,
    );
  }
  if (s.usaShare < rule.minUsaShare) {
    out.push(`${pct(rule.minUsaShare)} of views from the US, you are at ${pct(s.usaShare)}`);
  }
  if (s.views28d < rule.minViews28d) {
    out.push(`${rule.minViews28d.toLocaleString()} views in 28 days, you are at ${s.views28d.toLocaleString()}`);
  }
  if (s.videos28d < rule.minVideos28d) {
    out.push(`${rule.minVideos28d} videos in 28 days, you have ${s.videos28d}`);
  }
  return out;
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Are these numbers even possible?
 *
 * A creator types these off their own analytics screen, and the review is a
 * person reading a screen recording, so the guard is against a typo reaching
 * the reviewer as a plausible-looking claim rather than against fraud. The US
 * is inside Tier 1, so its share can never exceed the Tier 1 share, and that
 * one catches the commonest mistake: reading the wrong row.
 */
export function statsArePossible(s: Partial<AudienceStats>): s is AudienceStats {
  const { tier1Share, usaShare, views28d, videos28d } = s;
  if (![tier1Share, usaShare, views28d, videos28d].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return false;
  }
  if (tier1Share! < 0 || tier1Share! > 1) return false;
  if (usaShare! < 0 || usaShare! > 1) return false;
  if (usaShare! > tier1Share! + 1e-9) return false;
  if (views28d! < 0 || videos28d! < 0) return false;
  if (!Number.isInteger(views28d!) || !Number.isInteger(videos28d!)) return false;
  // Views with no videos behind them, or videos with no views, are a misread
  // screen rather than an account.
  if (views28d! > 0 && videos28d! === 0) return false;
  return true;
}
