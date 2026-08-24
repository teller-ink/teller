// Declared EFFECTS — what a system says one of its advancement
// purchases does, interpreted into ordinary writes.
//
// This is `core/kind.ts`'s sibling: a system declares, core interprets,
// and core knows nothing about what any of it MEANS. A `spends`
// declaration names a counter to debit, an optional lifetime counter, a
// tier scale and a menu; each menu item may carry an `effect` whose
// `kind` this file understands. Nothing here names a counter, a skill,
// a rung or a tier — every word arrives from the declaration at
// runtime, which is the whole reason the interpreter can live in core
// at all (§L: data-generic is not the same as belongs-to-teller, but a
// file that never sees a vocabulary word is genuinely neutral).
//
// Rule 1 is the shape of the whole file: an effect PROPOSES. It comes
// back as a list of writes a human confirms, applied through the
// ordinary sparse-entry door, so every number it touches is one a
// person can find and type over afterwards, and the event log gets each
// one for free (rule 3). Nothing here writes anything; nothing here
// enforces a limit the book states (Improve Health "up to five times"
// is reminder text, not a check — the counter stays the authority).
//
// An effect kind this build doesn't know is REFUSED OUT LOUD, never
// skipped: a purchase that silently debits and does nothing is the
// worst outcome available (the registry posture, applied to spending).

import {
  findEntry,
  numberOf,
  type Entity,
  type Entry,
} from './entity.ts';

// ---------------------------------------------------------------------
// The declaration.

/** A named rung on the tier scale — display only, derived from the total. */
export type SpendTier = { name: string; at: number };

/**
 * What a purchase does. Every variant is shape-only: `group` names a
 * declared group of entries, `counter` names an entry, `itemKind` names
 * a template type — all of them the system's words, none of them ours.
 */
export type SpendEffect =
  | { kind: 'pool'; group: string; op: 'add'; dice: string }
  | {
      kind: 'pool';
      group: string;
      op: 'convert';
      from: string;
      to: string;
      count: number;
    }
  | { kind: 'max'; counter: string; amount: number }
  | { kind: 'mark' }
  | { kind: 'item'; itemKind?: string }
  /** Parsed but not understood — carried so the refusal can name it. */
  | { kind: string };

export type SpendItem = {
  name: string;
  cost: number;
  /** The book's own words about the purchase. Pack content; shown, never parsed. */
  text?: string;
  effect?: SpendEffect;
};

export type SpendsDecl = {
  /** The wallet a purchase debits. */
  counter: string;
  /** The lifetime figure the tiers are read off, when the system keeps one. */
  total?: string;
  /**
   * Spending CLAIMS the points: a purchase credits `total` by the same
   * amount it debits `counter`, so an award only ever touches one box
   * and the lifetime figure keeps itself. Off for a system whose total
   * is bumped at award time — crediting again on spend double-counts.
   */
  claims?: boolean;
  /** How the affordance reads; `counter` if absent. */
  label?: string;
  tiers?: SpendTier[];
  menu: SpendItem[];
};

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function toEffect(raw: unknown): SpendEffect | undefined {
  const r = asRecord(raw);
  const kind = String(r.kind ?? '').trim();
  if (!kind) return undefined;
  // Kept whole and coerced per-kind at the point of use: a shape this
  // build half-recognises must still reach `planFor` so the refusal can
  // say which kind it was.
  return { ...(r as object), kind } as SpendEffect;
}

/** The forgiving read, same posture as `toKindDef` — keep what parses, never throw at content. */
export function toSpends(raw: unknown): SpendsDecl | undefined {
  const r = asRecord(raw);
  const counter = String(r.counter ?? '').trim();
  if (!counter) return undefined;
  const out: SpendsDecl = { counter, menu: [] };
  const total = String(r.total ?? '').trim();
  if (total) out.total = total;
  if (r.claims === true) out.claims = true;
  const label = String(r.label ?? '').trim();
  if (label) out.label = label;
  if (Array.isArray(r.tiers)) {
    const tiers = r.tiers
      .map((t) => {
        const tr = asRecord(t);
        const name = String(tr.name ?? '').trim();
        const at = Number(tr.at);
        return name && Number.isFinite(at) ? { name, at } : undefined;
      })
      .filter((t): t is SpendTier => t !== undefined);
    if (tiers.length) out.tiers = tiers;
  }
  if (Array.isArray(r.menu)) {
    for (const item of r.menu) {
      const ir = asRecord(item);
      const name = String(ir.name ?? '').trim();
      const cost = Number(ir.cost);
      if (!name || !Number.isFinite(cost)) continue;
      const spend: SpendItem = { name, cost };
      const text = String(ir.text ?? '').trim();
      if (text) spend.text = text;
      const effect = toEffect(ir.effect);
      if (effect) spend.effect = effect;
      out.menu.push(spend);
    }
  }
  return out;
}

/**
 * Which tier a total stands on — the highest threshold it has reached.
 *
 * Derived at the point of use and never stored (§8): a written-down
 * tier goes stale the moment the counter moves, which is the
 * `bundleKind` lesson wearing different clothes.
 */
export function tierAt(
  tiers: SpendTier[] | undefined,
  total: number,
): SpendTier | undefined {
  return [...(tiers ?? [])]
    .sort((a, b) => a.at - b.at)
    .filter((t) => total >= t.at)
    .pop();
}

// ---------------------------------------------------------------------
// Finding what an effect names. An effect says "Health", never "the
// entry called Health in the list called resources" — a system groups
// its lists however it likes, so a name is looked for everywhere.

/** An entry by name, and the list it was found in — the sparse door needs both. */
export function locate(
  entity: Entity | undefined,
  name: string,
): { list: string; entry: Entry } | undefined {
  for (const [list, entries] of Object.entries(entity?.lists ?? {})) {
    const entry = findEntry(entries, name);
    if (entry) return { list, entry };
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Pool arithmetic. A "pool" is a printed handful of dice — `3B1G` —
// and the letters are whatever the system's `dice` record declares.
// Ported from the old app's `amendPool` (worker/items.ts) with its two
// rules intact: a value that isn't a pool comes back untouched rather
// than mangled, and a convert can only exchange what is actually there.

type Counts = Record<string, number>;

/**
 * The pool as counts per die letter, or nothing if it isn't one.
 *
 * **Zero IS a pool — the empty one** (2026-08-24). A stat printed `0`
 * is a handful of no dice, not a value that failed to parse, and the
 * difference decides whether a person's own stat can be amended at all:
 * a Defense of 0 with a breastplate on reads `1G`, and before this it
 * read 0 with the armour silently doing nothing. Same rule as §M-8's
 * "absent is zero" one rung down — the base value of a thing counted in
 * dice is no dice.
 *
 * Everything else that isn't a printed pool still comes back untouched:
 * `Used`, `$12.00` and a paragraph of prose are not empty pools, they
 * are not pools.
 */
export function poolCounts(
  value: unknown,
  faces: Record<string, string[]>,
): Counts | undefined {
  if (value === 0) return {};
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, '');
  if (/^0+$/.test(text)) return {};
  if (!/^(?:\d+[A-Za-z])+$/.test(text)) return undefined;
  const counts: Counts = {};
  for (const [, n, letter] of text.matchAll(/(\d+)([A-Za-z])/g)) {
    const die = letter.toUpperCase();
    // A letter the system never declared is not this system's die, and
    // guessing at it would invent dice nobody owns.
    if (!(die in faces)) return undefined;
    counts[die] = (counts[die] ?? 0) + Number(n);
  }
  return counts;
}

/** Counts back to a printed pool, in the order the system declared its dice. */
export function poolText(counts: Counts, faces: Record<string, string[]>): string {
  return Object.keys(faces)
    .filter((die) => (counts[die] ?? 0) > 0)
    .map((die) => `${counts[die]}${die}`)
    .join('');
}

/**
 * What one effect DOES to one handful of dice, as counts.
 *
 * The two rules are the old app's and they are both about not inventing
 * anything: an `add` whose dice this system doesn't own does nothing,
 * and a `convert` only ever exchanges what is actually THERE — "3B to
 * 3G" against a pool holding two Blacks converts two.
 */
function applyCounts(
  counts: Counts,
  effect: PoolOp,
  faces: Record<string, string[]>,
): Counts | undefined {
  const next = { ...counts };
  if (effect.op === 'add') {
    const added = poolCounts(effect.dice, faces);
    if (!added) return undefined;
    for (const [die, n] of Object.entries(added)) next[die] = (next[die] ?? 0) + n;
    return next;
  }
  const available = next[effect.from] ?? 0;
  const moved = Math.min(available, effect.count);
  if (moved <= 0) return undefined;
  next[effect.from] = available - moved;
  next[effect.to] = (next[effect.to] ?? 0) + moved;
  return next;
}

/** One pool effect against one pool string. Unchanged if it can't apply. */
export function amendPool(
  value: unknown,
  effect: Extract<SpendEffect, { kind: 'pool' }>,
  faces: Record<string, string[]>,
): string | undefined {
  const counts = poolCounts(value, faces);
  if (!counts) return undefined;
  const next = applyCounts(counts, effect, faces);
  if (!next) return undefined;
  const text = poolText(next, faces);
  return text === value ? undefined : text;
}

// ---------------------------------------------------------------------
// FITTINGS — what a thing bolted onto another thing does to its dice.
//
// The same arithmetic as a purchase's, arriving from the other end: an
// upgrade fitted to a rifle and a round chambered in it each carry
// `effects`, and the pool the table reads is the printed one with all
// of them folded in, per range band (ported from the old app's
// `resolveItem`, worker/items.ts:82-148).
//
// It is a READING, computed at the point of use and stored nowhere
// (§8) — the printed value stays the stored value, so a pack correction
// reaches a gun somebody bought a month ago, and rule 1 is untouched:
// what comes back is a PROPOSAL a person can type over in the ordinary
// slot. Nothing here writes.

/** The arithmetic half of an effect — what it does, without saying where. */
type PoolOp =
  | { op: 'add'; dice: string }
  | { op: 'convert'; from: string; to: string; count: number };

/**
 * One effect an author wrote on a fitting: the arithmetic, plus the
 * pool it lands on. `range` is the AUTHOR's word for that pool — a
 * weapon that hasn't got one simply isn't modified.
 */
export type PoolEffect = PoolOp & { range?: string };

/** The forgiving read — keep what parses, never throw at content. */
export function toPoolEffects(raw: unknown): PoolEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: PoolEffect[] = [];
  for (const item of raw) {
    const r = asRecord(item);
    const range = String(r.range ?? '').trim();
    const op = String(r.op ?? '').trim();
    if (op === 'add') {
      const dice = String(r.dice ?? '').trim();
      if (dice) out.push({ op, dice, ...(range ? { range } : {}) });
      continue;
    }
    if (op === 'convert') {
      const from = String(r.from ?? '').trim();
      const to = String(r.to ?? '').trim();
      const count = Number(r.count);
      if (from && to && Number.isFinite(count)) {
        out.push({ op, from, to, count, ...(range ? { range } : {}) });
      }
    }
  }
  return out;
}

/** Letters and digits only — what's left of a name once punctuation and case stop mattering. */
function plain(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The entry an effect lands on, by the author's own word for it.
 *
 * An exact name wins. Failing that, ONE entry whose name starts with
 * what the effect said — which is how a catalogue that names its bands
 * by a short key ("short", "arms") still finds the stat the sheet
 * prints ("Short Range", "Arm's Reach"). Ambiguity is not resolved by
 * guessing: two candidates means no match, because amending the wrong
 * range is worse than amending none (rule 1's floor — a number nobody
 * can account for).
 */
export function effectTarget(stats: Entry[], range: string | undefined): Entry | undefined {
  const want = plain(String(range ?? ''));
  if (!want) return undefined;
  const exact = stats.filter((s) => plain(s.name) === want);
  if (exact.length === 1) return exact[0];
  const starts = stats.filter((s) => plain(s.name).startsWith(want));
  return starts.length === 1 ? starts[0] : undefined;
}

/** One thing fitted to another, and what it does. `name` is what the reading credits. */
export type Fitting = {
  name: string;
  effects: PoolEffect[];
  /**
   * The pool a PERSON pointed this at, beating the effect's own word
   * for it — "Add 1B to Short or Long" is a decision the catalogue
   * can't make. Nothing stores such a choice yet; the door is here
   * because the old app's did and the arithmetic is the same.
   */
  range?: string;
};

/** One stat as it should be READ, and what made it differ from the print. */
export type Amendment = {
  /** The entry's own name, as the sheet prints it. */
  name: string;
  /** What the book says, untouched and still stored. */
  printed: string;
  /** What the fittings work out. */
  value: string;
  /** What amended it, in the order it was applied. */
  by: string[];
  /**
   * The working, one line per effect that landed — what it did and
   * what did it, in order. The chip says WHO at a glance (`by`); this
   * is the ledger behind it, so a surface can open "printed 0, +1G
   * Iron Breastplate" without re-deriving anything or knowing what an
   * effect is.
   */
  steps: { by: string; text: string }[];
};

/**
 * Every stat these fittings change, keyed by the entry's lower-cased
 * name — a stat nothing touched is absent, so a caller renders the
 * stored value and asks no questions.
 *
 * ORDER IS THE CALLER'S and it matters: the old app applied a weapon's
 * upgrades first and what's chambered LAST, the round being the final
 * thing that happens to a pool before it's rolled.
 */
export function amendStats(
  stats: Entry[],
  fittings: Fitting[],
  faces: Record<string, string[]>,
): Map<string, Amendment> {
  const working = new Map<
    string,
    { printed: string; counts: Counts; by: string[]; steps: { by: string; text: string }[] }
  >();
  for (const fitting of fittings) {
    for (const effect of fitting.effects) {
      const target = effectTarget(stats, fitting.range ?? effect.range);
      if (!target) continue;
      const held = working.get(target.name);
      const counts = held?.counts ?? poolCounts(target.value, faces);
      if (!counts) continue;
      const next = applyCounts(counts, effect, faces);
      if (!next) continue;
      working.set(target.name, {
        printed: held?.printed ?? String(target.value ?? ''),
        counts: next,
        by: [...(held?.by ?? []), fitting.name],
        steps: [
          ...(held?.steps ?? []),
          { by: fitting.name, text: describePoolEffect(effect, target.name) },
        ],
      });
    }
  }
  const out = new Map<string, Amendment>();
  for (const [name, held] of working) {
    const value = poolText(held.counts, faces);
    // A fitting that worked out to the printed number amended nothing,
    // and saying so would credit it with a change it didn't make.
    if (value === held.printed) continue;
    out.set(name.toLowerCase(), {
      name,
      printed: held.printed,
      value,
      by: held.by,
      steps: held.steps,
    });
  }
  return out;
}

/**
 * What one effect does, in the terms of the pool it lands on — "Long
 * Range +2B". Generated rather than written down, so it can name the
 * range a PERSON chose, which a description typed into a pack never
 * could.
 */
export function describePoolEffect(effect: PoolEffect, where: string): string {
  return effect.op === 'add'
    ? `${where} +${effect.dice}`
    : `${where} ${effect.count}${effect.from} → ${effect.count}${effect.to}`;
}

// ---------------------------------------------------------------------
// The plan — what a purchase would write, before anything is written.

/** One sparse entry write, the shape `POST /entities/:id/entry` takes. */
export type EntryWrite = {
  list: string;
  name: string;
  value?: number | string;
  max?: number | null;
  remove?: boolean;
};

/** One template stamped as a child, the shape `POST /stamp` takes. */
export type StampWrite = { slot: string; templateId: string; name: string };

/** Everything a purchase does, in the order it must happen. */
export type SpendPlan = {
  entries: EntryWrite[];
  stamps: StampWrite[];
};

/**
 * One thing a purchase could be spent ON, when the effect needs a
 * choice — which skill to practise, which category to mark, which
 * ability to unlock. `label` is built out of the declaration's own
 * words, so nothing here reads as teller's opinion.
 */
export type SpendOption = { key: string; label: string; plan: SpendPlan };

/** What the interpreter can't do, said out loud rather than skipped. */
export type Refusal = { refusal: string };

export function isRefusal(x: unknown): x is Refusal {
  return Boolean(x && typeof x === 'object' && 'refusal' in x);
}

/** What the effect kinds need to know about the table, all of it declared. */
export type SpendWorld = {
  entity: Entity | undefined;
  /** `groups` record: a group name → the entry names in it. */
  groups?: Record<string, string[]>;
  /** `dice` record's faces — which letters are dice at this table. */
  faces?: Record<string, string[]>;
  /** Which list marks live in, and what may be marked. */
  marks?: { list: string; categories: string[] };
  /**
   * Stampable templates a purchase may draw from, and the slot they
   * came from. `type` is matched against an item effect's `itemKind`.
   */
  catalog?: { slot: string; items: { id: string; name: string; type?: string }[] };
};

/** Is the wallet deep enough? Presented, never enforced — rule 1. */
export function affordable(
  spends: SpendsDecl,
  entity: Entity | undefined,
  cost: number,
): boolean {
  const held = locate(entity, spends.counter);
  const value = numberOf(held?.entry);
  // A wallet the sheet doesn't carry is not a refusal to sell — the
  // person may be about to type it in, and a counter nobody declared
  // is not evidence of zero.
  return value === undefined || value >= cost;
}

/**
 * The debit, and the credit that goes with it under `claims`.
 *
 * Only `counter` is ever decremented; `total` is never reduced by a
 * purchase, because the lifetime figure is a record of what was earned
 * and spending is not unearning.
 */
export function costWrites(
  spends: SpendsDecl,
  entity: Entity | undefined,
  cost: number,
): EntryWrite[] {
  const out: EntryWrite[] = [];
  const wallet = locate(entity, spends.counter);
  if (wallet) {
    out.push({
      list: wallet.list,
      name: wallet.entry.name,
      value: (numberOf(wallet.entry) ?? 0) - cost,
    });
  }
  if (spends.claims && spends.total) {
    const lifetime = locate(entity, spends.total);
    if (lifetime) {
      out.push({
        list: lifetime.list,
        name: lifetime.entry.name,
        value: (numberOf(lifetime.entry) ?? 0) + cost,
      });
    }
  }
  return out;
}

/** Does buying this need the person to pick something first? */
export function needsChoice(effect: SpendEffect | undefined): boolean {
  return (
    effect?.kind === 'pool' || effect?.kind === 'mark' || effect?.kind === 'item'
  );
}

/**
 * A neutral one-line summary of an effect, for a menu with no
 * system-supplied face. Every noun in it comes from the declaration;
 * the connecting words are teller's, and they describe SHAPE.
 */
export function describeEffect(effect: SpendEffect | undefined): string {
  if (!effect) return 'no automatic change — apply it by hand';
  if (effect.kind === 'pool') {
    const e = effect as Extract<SpendEffect, { kind: 'pool' }>;
    return e.op === 'add'
      ? `adds ${e.dice} to one of your ${e.group}`
      : `exchanges ${e.count}${e.from} for ${e.count}${e.to} on one of your ${e.group}`;
  }
  if (effect.kind === 'max') {
    const e = effect as Extract<SpendEffect, { kind: 'max' }>;
    return `raises ${e.counter}'s ceiling by ${e.amount}`;
  }
  if (effect.kind === 'mark') return 'marks one category';
  if (effect.kind === 'item') {
    const e = effect as Extract<SpendEffect, { kind: 'item' }>;
    return e.itemKind ? `adds one ${e.itemKind}` : 'adds one thing you carry';
  }
  return `an effect of kind '${effect.kind}' this build doesn't know`;
}

/**
 * Every way this purchase could be spent, each carrying the complete
 * plan — cost first, then the effect's own writes.
 *
 * An effect needing no choice comes back as exactly one option; an
 * effect with nothing left to pick comes back as an empty list, which
 * is a true answer and not an error. An effect kind this build doesn't
 * know comes back as a refusal, and the caller must not offer the buy.
 */
export function spendOptions(
  spends: SpendsDecl,
  spend: SpendItem,
  world: SpendWorld,
): SpendOption[] | Refusal {
  const cost = costWrites(spends, world.entity, spend.cost);
  const one = (entries: EntryWrite[] = [], stamps: StampWrite[] = []): SpendPlan => ({
    entries: [...cost, ...entries],
    stamps,
  });
  const effect = spend.effect;

  if (!effect) {
    // A purchase declared with no effect is a DEBIT and a reminder: the
    // person applies the improvement themselves. Still bookkept, still
    // logged, still undoable by hand.
    return [{ key: spend.name, label: spend.name, plan: one() }];
  }

  if (effect.kind === 'pool') {
    const e = effect as Extract<SpendEffect, { kind: 'pool' }>;
    const faces = world.faces ?? {};
    const names = world.groups?.[e.group] ?? [];
    const out: SpendOption[] = [];
    for (const name of names) {
      const held = locate(world.entity, name);
      if (!held) continue;
      const next = amendPool(held.entry.value, e, faces);
      if (next === undefined) continue;
      out.push({
        key: held.entry.name,
        label: `${held.entry.name} ${held.entry.value} → ${next}`,
        plan: one([{ list: held.list, name: held.entry.name, value: next }]),
      });
    }
    return out;
  }

  if (effect.kind === 'max') {
    const e = effect as Extract<SpendEffect, { kind: 'max' }>;
    const held = locate(world.entity, e.counter);
    if (!held) {
      return {
        refusal: `nothing here is called '${e.counter}' — this purchase has nothing to raise`,
      };
    }
    const max = (held.entry.max ?? numberOf(held.entry) ?? 0) + e.amount;
    const at = numberOf(held.entry);
    // Topped up only if it was already full: raising a ceiling above a
    // half-empty bar heals nobody.
    const write: EntryWrite = { list: held.list, name: held.entry.name, max };
    if (at !== undefined && held.entry.max !== undefined && at === held.entry.max) {
      write.value = at + e.amount;
    }
    return [{ key: e.counter, label: `${held.entry.name} → ${max}`, plan: one([write]) }];
  }

  if (effect.kind === 'mark') {
    const marks = world.marks;
    if (!marks) {
      return { refusal: 'no marks are declared, so there is nothing to mark' };
    }
    const owned = new Set(
      (world.entity?.lists[marks.list] ?? []).map((m) => m.name.trim().toLowerCase()),
    );
    return marks.categories
      .filter((c) => !owned.has(c.trim().toLowerCase()))
      .map((category) => ({
        key: category,
        label: category,
        plan: one([{ list: marks.list, name: category }]),
      }));
  }

  if (effect.kind === 'item') {
    const e = effect as Extract<SpendEffect, { kind: 'item' }>;
    const catalog = world.catalog;
    if (!catalog) {
      return { refusal: 'no catalogue is loaded, so there is nothing to draw from' };
    }
    const carried = new Set(
      (world.entity?.children ?? [])
        .map((c) => {
          const from = c.refs?.from;
          return Array.isArray(from) ? from[0]?.id : from?.id;
        })
        .filter((id): id is string => Boolean(id)),
    );
    return catalog.items
      .filter(
        (t) =>
          (!e.itemKind || (t.type ?? '').toLowerCase() === e.itemKind.toLowerCase()) &&
          !carried.has(t.id),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({
        key: t.id,
        label: t.name,
        plan: one([], [{ slot: catalog.slot, templateId: t.id, name: t.name }]),
      }));
  }

  return {
    refusal: `this build doesn't know the effect kind '${effect.kind}'`,
  };
}
