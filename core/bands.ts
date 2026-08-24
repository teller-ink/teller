// The system's RANGE LADDER, and what a carried thing reaches on it.
//
// The ladder itself moved here from `server/geometry.ts` unchanged (it
// re-exports these, so every caller kept its import): a rung has a name,
// a span in the board's true inches, and the words for that reach in the
// fiction. Nothing here knows any game's rungs.
//
// What's NEW is the other direction. Geometry asks "how far is that, in
// the system's words"; a sheet asks "what does this thing DO at each
// rung" — and the answer was already printed on the thing, as one stat
// per band. Matching the two is the same name-matching an effect
// already does (`effectTarget`), which is why a ladder saying `Short`
// finds a weapon whose stat says `Short Range` without either side
// being edited to suit the other.
//
// One consequence worth stating, because a whole control hangs off it:
// **a rung that BEGINS away from you is a rung you reach across.** The
// ladder already says so — the first rung starts at zero and the rest
// start at a distance — so nothing needs to declare which bands are
// which, and no thing needs a flag saying it shoots. A knife printed
// only for the rung that starts at zero is a knife.

import type { Entry } from './entity.ts';
import { effectTarget } from './effects.ts';

/**
 * ONE RUNG OF THE SYSTEM'S RANGE LADDER, as it declares one.
 *
 * `from` is inclusive, `to` exclusive, both in the board's true
 * inches; `world` is what that reach is in the fiction.
 */
export type Band = { name: string; from?: number; to?: number; world?: string };

function num(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** The declared rungs, read forgivingly out of whatever the layer wrote. */
export function bandsIn(raw: unknown): Band[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item): Band[] => {
    const b = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return [];
    const band: Band = { name };
    if (num(b.from) !== undefined) band.from = num(b.from);
    if (num(b.to) !== undefined) band.to = num(b.to);
    if (typeof b.world === 'string' && b.world.trim()) band.world = b.world.trim();
    return [band];
  });
}

/** What a measurement IS, in the system's own words. */
export function bandOf(inches: number, bands: Band[]): Band | undefined {
  for (const b of bands) {
    if (inches >= (b.from ?? 0) && (b.to === undefined || inches < b.to)) return b;
  }
  return undefined;
}

/** A rung reached ACROSS ground, rather than the one you're standing in. */
export function acrossGround(band: Band): boolean {
  return (band.from ?? 0) > 0;
}

/**
 * What this thing does at each rung it's printed for, in the ladder's
 * own order — the stat, beside the band it answers.
 *
 * A stat that matches no rung (a price, a quality, a paragraph) is not
 * here, and a rung the thing doesn't reach is not here either: the list
 * IS what this thing can be used to do, which is what makes it a row of
 * buttons rather than a table anyone has to read.
 */
export function bandsOn(stats: Entry[], bands: Band[]): { band: Band; entry: Entry }[] {
  const out: { band: Band; entry: Entry }[] = [];
  for (const band of bands) {
    const entry = effectTarget(stats, band.name);
    // One stat answers one rung: a ladder whose two rungs both match
    // the same printed stat would otherwise price the same handful
    // twice under two names.
    if (entry && !out.some((held) => held.entry === entry)) out.push({ band, entry });
  }
  return out;
}
