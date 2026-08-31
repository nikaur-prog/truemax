export interface AccruedShare {
  id: string;
  accruedCents: number;
}

/**
 * Allocate an oversubscribed pool using largest remainders. Integer arithmetic
 * keeps the total exact; stable ID ordering makes equal remainders deterministic.
 */
export function allocatePoolCents(poolCents: number, shares: readonly AccruedShare[]): Map<string, number> {
  const pool = Math.max(0, Math.trunc(poolCents));
  const clean = shares.map((share) => ({
    id: share.id,
    accrued: Math.max(0, Math.trunc(share.accruedCents)),
  }));
  const total = clean.reduce((sum, share) => sum + share.accrued, 0);
  if (total <= pool) return new Map(clean.map((share) => [share.id, share.accrued]));
  if (total === 0 || pool === 0) return new Map(clean.map((share) => [share.id, 0]));

  const totalBig = BigInt(total);
  const poolBig = BigInt(pool);
  const ranked = clean.map((share) => {
    const numerator = BigInt(share.accrued) * poolBig;
    return {
      ...share,
      amount: Number(numerator / totalBig),
      remainder: numerator % totalBig,
    };
  });
  let left = pool - ranked.reduce((sum, share) => sum + share.amount, 0);
  ranked.sort((a, b) => a.remainder === b.remainder
    ? a.id.localeCompare(b.id)
    : a.remainder > b.remainder ? -1 : 1);
  for (const share of ranked) {
    if (left <= 0) break;
    share.amount += 1;
    left -= 1;
  }
  return new Map(ranked.map((share) => [share.id, share.amount]));
}
