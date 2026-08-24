// A printed POOL, read — "3B2G" as five dice, and the arithmetic on it.
//
// The notation itself is a system's ("2B1G" means what the `dice` record
// says it means, and nothing here knows what a letter is worth). What
// core owns is the SHAPE: how many of each letter, and what happens when
// one printing adds to or subtracts from another.
//
// It lives in core rather than beside the roller because two things now
// read a pool and neither is the dice table: a frenzy that says "all
// attacks by 1G" is pool arithmetic with nobody rolling. `client/lib/
// dice.ts` re-exports these so there is exactly ONE parser for the
// notation — a second one is how a printing starts meaning two things.

/** "3B2G" → ['B','B','B','G','G'] — a printed pool as individual dice. */
export function expandPool(pool: string): string[] {
  const out: string[] = [];
  for (const [, n, letter] of String(pool ?? '').matchAll(/(\d+)([A-Za-z])/g)) {
    for (let i = 0; i < Number(n); i++) out.push(letter.toUpperCase());
  }
  return out;
}

/** A letter→count tally back into printed notation, empty for nothing. */
function printPool(counts: Map<string, number>): string {
  return [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, n]) => `${n}${letter}`)
    .join('');
}

/**
 * Several pools as one — ported unchanged from the old app. Defense is
 * additive wherever a system says it is, and a target holding two of
 * them rolls one handful, not two.
 */
export function combinePools(pools: string[]): string {
  const counts = new Map<string, number>();
  for (const pool of pools) {
    for (const letter of expandPool(pool)) {
      counts.set(letter, (counts.get(letter) ?? 0) + 1);
    }
  }
  return printPool(counts);
}

/** Whether a string is a pool at all — "2B1G" yes, "Normal" no. */
export function isPool(text: string): boolean {
  return /^(?:\d+[A-Za-z])+$/.test(String(text ?? '').replace(/\s+/g, ''));
}

/**
 * One pool taken off another, per letter, floored at nothing — "5G"
 * minus "2B" is still "5G", because a die you never had is not a debt.
 */
export function subtractPools(base: string, taken: string): string {
  const counts = new Map<string, number>();
  for (const letter of expandPool(base)) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  for (const letter of expandPool(taken)) {
    counts.set(letter, Math.max(0, (counts.get(letter) ?? 0) - 1));
  }
  return printPool(counts);
}
