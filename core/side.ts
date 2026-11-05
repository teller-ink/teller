// Which side of the table an entity is handled on — the one fact the
// public boundary, the roster, the runner and the clear all hang off.
//
// This settles CORE-NEXT's question C ("does an entity have a TYPE, and
// whose is it?") the way TEL-126 asked: `type` is FLAVOUR — a trade
// name, a bestiary category, a plugin's own word — and the handling
// class is a fact of its own. For three months every branch asked
// `type === 'foe'` and read a label as a side; the 2026-08-24 audit
// found that put a full sheet of numbers on the table TV the moment a
// foe arrived with no label at all. The interim rule asked from the
// party's end (declared trades) and failed closed. This is that rule,
// with the stored answer a human can set over it (rule 1).
//
// Three sides, not two, because `pc | npc` was already too coarse when
// question C was written: a horse a player owns, a vendor the store
// stamped, a windmill wearing a token (TEL-127) — none of them is in the
// posse and none is an enemy. `none` is a side the way "nobody's" is an
// owner: off the public roster, spared by the clear, never offered a
// turn, numbers withheld the way a foe's are (fail closed, as ever).
//
// WHERE IT LIVES: a `side` entry in the `meta` list, beside the draft
// mark — teller's own marks share that list, written through the
// ordinary entry door, logged and undone like any other edit. Nothing is
// migrated: a stored side wins the moment one exists, and until then the
// derivation below is the default a human overrules by setting one.
// Baking a derived guess into every row would have frozen the guess
// (and written a thousand events to say so).
//
// The host fills `entity.side` on every READING it hands out so a client
// never derives — the roster and the public snapshot can't drift into
// two definitions of "party", which is exactly what they had done.

import { findEntry, type Entity, type Entry, type Side } from './entity.ts';

export type { Side } from './entity.ts';

export const SIDES: readonly Side[] = ['party', 'foe', 'none'];
export const SIDE_LIST = 'meta';
export const SIDE_MARK = 'side';

const EMPTY: ReadonlySet<string> = new Set();

/** A side, if the value is one; anything else is nobody's claim. */
export function toSide(raw: unknown): Side | undefined {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (SIDES as readonly string[]).includes(s) ? (s as Side) : undefined;
}

/** The side a human set — the stored fact; absent when nobody has. */
export function storedSide(
  entity: Pick<Entity, 'lists'> | { lists?: Record<string, Entry[]> } | undefined,
): Side | undefined {
  return toSide(findEntry(entity?.lists?.[SIDE_LIST] ?? [], SIDE_MARK)?.value);
}

/**
 * The side, stored first and derived otherwise.
 *
 * The derivation is the audit's fail-closed rule, unchanged: furniture
 * (the words a plugin's bookkeeping entities wear) is on no side; the
 * declared word `pc` or a declared trade is the party; everything else
 * — `npc`, `foe`, a word nobody recognises, no word at all — is a foe,
 * because over-stripping is the safe direction. A system that declares
 * no trades leaves `pc` and the stored mark as the ways in.
 */
export function sideOf(
  entity: { type?: string; lists?: Record<string, Entry[]> },
  trades: ReadonlySet<string>,
  furniture: ReadonlySet<string> = EMPTY,
): Side {
  const stored = storedSide(entity);
  if (stored) return stored;
  const type = (entity.type ?? '').trim().toLowerCase();
  if (!type) return 'foe';
  if (furniture.has(type)) return 'none';
  if (type === 'pc' || trades.has(type)) return 'party';
  return 'foe';
}
