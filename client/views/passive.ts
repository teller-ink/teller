// How the passive surfaces read the snapshot — the one piece of
// judgement the table, the board and the badge share.
//
// The question every one of them asks is "is this entry a NUMBER on a
// sheet, or a thing hanging on somebody?", and the answer must come
// from the same place the server's redaction took it from: the system's
// kind declarations (§2), never from a list's name. A kind declaring
// `zero: 'clears'` is tag-like — easing it to nothing removes it, which
// is what a condition does; everything else is the sheet's own
// business. That is `server/public.ts`'s `tagLike`, and it is repeated
// here rather than shared because the module isn't in the client's
// graph — the LAW is one sentence and it lives in `core/kind.ts`, which
// both sides call.
//
// Declarations are open to any adopted screen for exactly this reason
// ("the table's vocabulary — every passive surface renders from them",
// server/index.ts). Nothing here fetches numbers: with no declarations
// at all every list reads as the sheet's, which draws a bar and no
// chips, and is the conservative miss.

import { kindFor, toKindDef, type KindDef } from '../../core/kind.ts';
import { api, type PublicEntity, type PublicEntry } from '../lib/api.ts';

export type { KindDef };

export function kinds(): Promise<KindDef[]> {
  return api<unknown[]>('/api/stack/declarations/kinds').then((raw) =>
    raw.map(toKindDef).filter((k): k is KindDef => k !== undefined),
  );
}

/** Held things rather than the sheet's numbers — the server's own test. */
export function tagLike(defs: KindDef[] | undefined, list: string): boolean {
  const domain = kindFor(defs, list)?.domain;
  return domain?.kind === 'count' && domain.zero === 'clears';
}

/** Every tag-like entry on this thing, flattened for a row of chips. */
export function chipsOf(entity: PublicEntity, defs: KindDef[]): PublicEntry[] {
  return Object.entries(entity.lists ?? {}).flatMap(([list, entries]) =>
    tagLike(defs, list) ? entries : [],
  );
}

/**
 * The bars a passive screen draws: capped entries, in list order.
 *
 * Capped and nothing else, deliberately — a passive surface is read
 * across a room, and the editorial question (rule 6) has one honest
 * answer at that distance: the things with a ceiling, which are the
 * things running out. Money and tallies are a sheet's business and stay
 * on the seat.
 */
export function barsOf(entity: PublicEntity, defs: KindDef[]): PublicEntry[] {
  return Object.entries(entity.lists ?? {}).flatMap(([list, entries]) =>
    tagLike(defs, list)
      ? []
      : entries.filter(
          (e) => typeof e.max === 'number' && e.max > 0 && typeof e.value === 'number',
        ),
  );
}

/** A chip's text: the name, plus its severity when it carries one. */
export function chipLabel(entry: PublicEntry): string {
  return typeof entry.value === 'number' && entry.value > 1
    ? `${entry.name} ${entry.value}`
    : entry.name;
}
