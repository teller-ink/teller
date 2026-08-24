// The entity — the one thing Core stores. `docs/CORE-NEXT.md` §2, §9, §10.
//
// Core has no semantics: it stores named lists of named values, prose,
// nested entities and references, and that is ALL it stores. The system
// declares what a list means (`kind.ts`); the panel decides how it
// looks. A discriminator like "does zero mean absent or mean zero?"
// belongs on the declaration, never on the stored value — a value doing
// two jobs is the recurring bug this model exists to end.
//
// `fields`, `counters`, `tags` and `kinds` all collapsed into `lists`.
// Counter and Tag were always one spine — a name and a value — differing
// only in what zero means, and that difference moved to the declaration.
//
// An entity is an INSTANCE: a thing in play at this table, usually
// stamped from a template (`stamp.ts`), never required to be. The
// monster in a bestiary is not an entity; the foe on the board at
// Health 5 is.
//
// Reading is forgiving and writing is strict, permanently: a file
// authored against any past shape can arrive at any time, and a
// database migration cannot reach a file that doesn't exist yet. The
// coercers here eat the old spellings — a legacy tag string, a
// counter's `current` — and everything written back comes out
// structured.
//
// Imports in `core/` carry explicit `.ts` extensions, unlike the rest
// of the repo: node strips types natively, so the core runs headless —
// `node core/anything.ts` — with no build step between a test and the
// truth.

import { newId } from './id.ts';

/**
 * A reference to another thing, wherever it lives.
 *
 * The id resolves; the cached name degrades. A dangling ref renders its
 * name, marked missing — never dropped ("you don't have this" beats
 * forgetting it existed), never a bare id (nobody at a table reads
 * `pak_9f3a`). The shape was found, not invented: encounter foes were
 * already `{ blueprintId, name }`.
 *
 * A slot holds one ref, or an ORDERED list of them — a campaign's packs
 * are refs in precedence order, and order is the whole point of that
 * list. (Contact finding, H step 1: the drafted `Record<string, Ref>`
 * had no home for an ordered multi-ref.)
 */
export type Ref = { id: string; name: string };

/**
 * A named value — the leaf, strictly. Anything richer than a name, a
 * value and a ceiling was an entity all along (§9).
 *
 * Absent `value` is a plain held thing — Prone, Ally, Gunslinger. A
 * NUMBER is a count; a STRING is a named position on a scale the system
 * declares. Arithmetic goes through `numberOf`, never `.value` raw.
 * `max` is this instance's own ceiling; a per-kind cap lives on the
 * declaration.
 */
export type Entry = {
  name: string;
  value?: number | string;
  max?: number;
};

export type Entity = {
  id: string;
  name: string;
  /** Question C — deliberately loose. Nothing in Core branches on it. */
  type?: string;
  /** 'skills' · 'resources' · 'conditions' · 'marks' · … the system's words, not Core's. */
  lists: Record<string, Entry[]>;
  notes?: string;
  /** Entities inside entities — inline until something outside needs to address one (rule 8, applied to entities). */
  children?: Entity[];
  /** 'from' · 'loaded' · 'system' · 'packs' · … */
  refs?: Record<string, Ref | Ref[]>;
};

// ---------------------------------------------------------------------
// Reading the leaf.

/** `"Afraid 3"` and `"Afraid [3]"` both parse; anything else is a name. */
function fromString(raw: string): Entry {
  const m = raw.match(/^(.*?)\s+\[?(\d+)\]?$/);
  return m ? { name: m[1].trim(), value: Number(m[2]) } : { name: raw.trim() };
}

/**
 * Whatever shape it arrived in, as an entry — or nothing.
 *
 * Accepts the current shape, a bare legacy string, and the counter
 * spelling (`current`/`max`). Garbage is dropped rather than guessed
 * at, but a name someone typed by hand is a fact about their table and
 * is kept verbatim.
 */
export function toEntry(raw: unknown): Entry | undefined {
  if (typeof raw === 'string') {
    return raw.trim() ? fromString(raw) : undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? '').trim();
  if (!name) return undefined;
  const out: Entry = { name };
  const value = o.value !== undefined ? o.value : o.current; // counter spelling
  if (typeof value === 'number' && Number.isFinite(value)) out.value = value;
  else if (typeof value === 'string' && value.trim()) out.value = value.trim();
  if (typeof o.max === 'number' && Number.isFinite(o.max)) out.max = o.max;
  return out;
}

export function toEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return [];
  const out: Entry[] = [];
  for (const item of raw) {
    const entry = toEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

/** Every list that survives coercion, empty ones dropped so a round-trip doesn't accumulate husks. */
export function toLists(raw: unknown): Record<string, Entry[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, Entry[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.trim();
    if (!name) continue;
    const entries = toEntries(value);
    if (entries.length) out[name] = entries;
  }
  return out;
}

export function toRef(raw: unknown): Ref | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '').trim();
  if (!id) return undefined;
  return { id, name: String(o.name ?? '').trim() };
}

export function toRefs(raw: unknown): Record<string, Ref | Ref[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, Ref | Ref[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const slot = key.trim();
    if (!slot) continue;
    if (Array.isArray(value)) {
      const refs = value.map(toRef).filter((r): r is Ref => r !== undefined);
      if (refs.length) out[slot] = refs;
    } else {
      const ref = toRef(value);
      if (ref) out[slot] = ref;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Whatever shape it arrived in, as an entity.
 *
 * An inline child without an id is given one: an id has to exist for
 * the child to ever be addressed, minting one at read is the tolerant
 * path, and the next write makes it real. This is the one place a
 * coercer invents anything.
 */
export function toEntity(raw: unknown): Entity | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? '').trim();
  if (!name) return undefined;
  const out: Entity = {
    id: String(o.id ?? '').trim() || newId('ent'),
    name,
    lists: toLists(o.lists),
  };
  const type = String(o.type ?? '').trim();
  if (type) out.type = type;
  if (typeof o.notes === 'string' && o.notes.trim()) out.notes = o.notes;
  if (Array.isArray(o.children)) {
    const children = o.children
      .map(toEntity)
      .filter((c): c is Entity => c !== undefined);
    if (children.length) out.children = children;
  }
  const refs = toRefs(o.refs);
  if (refs) out.refs = refs;
  return out;
}

// ---------------------------------------------------------------------
// Working with entries. Ported whole from `worker/tags.ts` — the shape
// generalised, the lessons kept.

/** How it reads to a human — and to a model, which wants the number. */
export function formatEntry(entry: Entry): string {
  return entry.value === undefined ? entry.name : `${entry.name} ${entry.value}`;
}

/**
 * The value as a NUMBER, when it is one.
 *
 * The single door for arithmetic. A rung is a string, so `value - 1` is
 * a real mistake the types can catch; `undefined` back means "not a
 * countable value", which is not the same as zero.
 */
export function numberOf(entry: Entry | undefined): number | undefined {
  return typeof entry?.value === 'number' ? entry.value : undefined;
}

/** Do these name the same thing, whatever values they carry? */
export function sameName(a: Entry | string, b: Entry | string): boolean {
  const nameOf = (x: Entry | string) =>
    (typeof x === 'string' ? x : x.name).trim().toLowerCase();
  return nameOf(a) === nameOf(b);
}

/** Does this list hold that name, at any value? */
export function hasEntry(entries: Entry[], name: Entry | string): boolean {
  return entries.some((e) => sameName(e, name));
}

/** That entry, if it's held. */
export function findEntry(
  entries: Entry[],
  name: Entry | string,
): Entry | undefined {
  return entries.find((e) => sameName(e, name));
}

/**
 * The DRAFT MARK — an entry called `draft` in the `meta` list, and the
 * only trace a half-made character carries.
 *
 * Creation writes it first and clears it at the last step, so anything
 * interrupted in between leaves an ORDINARY entity wearing an ordinary
 * entry: it's in the roster, it can be finished by hand, it can be
 * deleted like anything else, and a human can strike the mark off
 * itself (rule 1 — nothing hidden, nothing locked). teller reads it in
 * exactly one place, the seat's draft takeover (§M-4a's companion), and
 * a system that never writes one simply never has a drafting seat.
 */
export const DRAFT_LIST = 'meta';
export const DRAFT_MARK = 'draft';

/** Is this one still being made? */
export function isDraft(entity: Entity | undefined): boolean {
  return hasEntry(entity?.lists?.[DRAFT_LIST] ?? [], DRAFT_MARK);
}

/** Every entry except that one — whatever value it was wearing. */
export function withoutEntry(entries: Entry[], name: Entry | string): Entry[] {
  return entries.filter((e) => !sameName(e, name));
}

/** The single ref in a slot, whichever way the slot is spelled. */
export function refIn(
  refs: Record<string, Ref | Ref[]> | undefined,
  slot: string,
): Ref | undefined {
  const held = refs?.[slot];
  return Array.isArray(held) ? held[0] : held;
}

/** A slot's refs in declared order, one or many. */
export function refsIn(
  refs: Record<string, Ref | Ref[]> | undefined,
  slot: string,
): Ref[] {
  const held = refs?.[slot];
  if (!held) return [];
  return Array.isArray(held) ? held : [held];
}
