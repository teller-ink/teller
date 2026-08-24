// How a thing is CARRIED — worn, held, put away — and what the system
// says about carrying too much of it.
//
// The states themselves are refs on the person (§K: containment is
// always refs, never nesting): `refs.worn` holds one carried child,
// `refs.wielded` an ordered list, `refs.holstered` one. Nothing here
// writes them; this file is the arithmetic a surface asks before it
// draws, and the one place the declaration is read.
//
// **Every rule in here arrives as DATA.** How many hands a person has,
// how many of a thing may be worn at once, what it costs to swap what's
// put away for what's in hand, and the sentence a table reads when it
// bends one of those — all of it comes off the system's `carry` record.
// Core knows only the shapes: a budget, a count, a price, a sentence.
// That is what lets one system say "one weapon unless you're dual
// wielding pistols" and another say nothing at all, without either
// sentence being written down in teller.
//
// And it ENFORCES NOTHING (rule 1). `overIn` reports; it never refuses.
// A person may put a third thing in two hands and the surface says so —
// visibly, in the system's own words — because the table's ruling beats
// the book's and teller does not get a vote.
//
// The hands budget is doing more work than it looks. "One weapon at a
// time, unless they're dual-wielding pistols" and "you cannot pair
// two-handed gear with one-handed gear" are the SAME arithmetic once a
// thing says how many hands it takes: two one-handed things fit, a
// two-handed thing and anything else does not. So the declaration needs
// no exception list — a budget and a per-thing cost say all of it.

import type { Entity, Entry } from './entity.ts';

/** One way a thing can be carried, and what the system says about it. */
export type CarryState = {
  /** The ref slot on the person — 'worn', 'wielded', 'holstered'. */
  name: string;
  /** What a surface calls it. Falls back to the slot's own word. */
  label?: string;
  /** How many things may sit here at once. Absent = uncounted. */
  limit?: number;
  /**
   * A budget spent by what each thing COSTS to hold (`handsStat`),
   * rather than by how many things there are. A state may declare
   * either; a state declaring both is held to both.
   */
  hands?: number;
  /** The book's own sentence, shown when this state is over its limit. */
  rule?: string;
  /** What moving a thing INTO this state costs, mid-fight. */
  swap?: { counter: string; amount: number; as?: string };
};

/** The system's `carry` record — the whole vocabulary of carrying. */
export type CarryDecl = {
  states: CarryState[];
  /** The stat on a thing that says how many hands it takes. */
  handsStat?: string;
  /** What a thing takes when it doesn't say. */
  hands?: number;
};

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function countIn(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Reading is forgiving: a record teller doesn't recognise offers nothing. */
export function carryIn(raw: unknown): CarryDecl | undefined {
  const record = asRecord(raw);
  const rawStates = Array.isArray(record.states) ? record.states : [];
  const states: CarryState[] = [];
  for (const item of rawStates) {
    const r = asRecord(item);
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    const state: CarryState = { name };
    const label = String(r.label ?? '').trim();
    if (label) state.label = label;
    const limit = countIn(r.limit);
    if (limit !== undefined) state.limit = limit;
    const hands = countIn(r.hands);
    if (hands !== undefined) state.hands = hands;
    const rule = String(r.rule ?? '').trim();
    if (rule) state.rule = rule;
    const swap = asRecord(r.swap);
    const counter = String(swap.counter ?? '').trim();
    const amount = countIn(swap.amount);
    if (counter && amount) {
      const as = String(swap.as ?? '').trim();
      state.swap = { counter, amount, ...(as ? { as } : {}) };
    }
    states.push(state);
  }
  if (!states.length) return undefined;
  const out: CarryDecl = { states };
  const handsStat = String(record.handsStat ?? '').trim();
  if (handsStat) out.handsStat = handsStat;
  const hands = countIn(record.hands);
  if (hands !== undefined) out.hands = hands;
  return out;
}

/** The state by its slot name, or nothing. */
export function stateIn(decl: CarryDecl | undefined, name: string): CarryState | undefined {
  return decl?.states.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
}

function entryNamed(lists: Record<string, Entry[]>, name: string): Entry | undefined {
  const want = name.toLowerCase();
  for (const entries of Object.values(lists)) {
    const hit = entries.find((e) => e.name.toLowerCase() === want);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * How many hands this thing takes — its own stat if it carries one, the
 * declared default otherwise, and 1 if the system said nothing at all.
 *
 * The RESOLVED thing is what should be handed in: a thin stamp carries
 * nothing of its own, and what a rifle takes is printed in the
 * catalogue (§K, stamped thin, stored-wins on touch).
 */
export function handsOf(item: Entity | undefined, decl: CarryDecl | undefined): number {
  const stat = decl?.handsStat && item ? entryNamed(item.lists ?? {}, decl.handsStat) : undefined;
  const own = typeof stat?.value === 'number' ? stat.value : Number(stat?.value);
  if (Number.isFinite(own) && own > 0) return own;
  return decl?.hands && decl.hands > 0 ? decl.hands : 1;
}

/** Which carried things sit in a state, by id, reading the person's own refs. */
export function heldIn(person: Entity | undefined, state: string): string[] {
  const held = person?.refs?.[state];
  const refs = Array.isArray(held) ? held : held ? [held] : [];
  return refs.map((r) => r.id);
}

/** Where this thing is carried, by the person's refs — nothing means stored. */
export function stateOf(
  person: Entity | undefined,
  childId: string,
  decl: CarryDecl | undefined,
): string | undefined {
  for (const state of decl?.states ?? []) {
    if (heldIn(person, state.name).includes(childId)) return state.name;
  }
  return undefined;
}

/** One state's load, against whatever the system said bounds it. */
export type CarryLoad = {
  state: CarryState;
  /** What's in it, by id — refs that name nothing carried included. */
  ids: string[];
  /** Hands spent, when the state is budgeted in hands. */
  hands: number;
  /** True when this state holds more than the system said it holds. */
  over: boolean;
  /** The system's own sentence about it, when it's over. */
  rule?: string;
};

/**
 * What one state is carrying, and whether that's more than declared.
 *
 * `items` is every carried child by id, so a hands budget can ask each
 * one what it takes. A ref pointing at nothing carried still counts
 * toward a limit — "you don't have this" beats forgetting it existed
 * (rule 9's own line) — and takes the default hands.
 */
export function loadIn(
  person: Entity | undefined,
  state: CarryState,
  items: Map<string, Entity>,
  decl: CarryDecl | undefined,
): CarryLoad {
  const ids = heldIn(person, state.name);
  const hands = ids.reduce((n, id) => n + handsOf(items.get(id), decl), 0);
  const overCount = state.limit !== undefined && ids.length > state.limit;
  const overHands = state.hands !== undefined && hands > state.hands;
  const over = overCount || overHands;
  return { state, ids, hands, over, ...(over && state.rule ? { rule: state.rule } : {}) };
}

/**
 * Every state that's carrying too much, in declared order — what a
 * surface says out loud, beside the things that are saying it.
 */
export function overIn(
  person: Entity | undefined,
  items: Map<string, Entity>,
  decl: CarryDecl | undefined,
): CarryLoad[] {
  return (decl?.states ?? [])
    .map((state) => loadIn(person, state, items, decl))
    .filter((load) => load.over);
}

/**
 * What moving a thing from where it is to where it's going COSTS, if
 * the system priced it — the proposal a surface offers, never a debit
 * it takes (§K: "PROPOSE the Grit spend … a human confirms").
 *
 * Only the destination is priced, and only when the thing was already
 * being carried somewhere: taking a thing out of storage at the start
 * of a fight is not the swap the book charges for.
 */
export function swapIn(
  decl: CarryDecl | undefined,
  from: string | undefined,
  to: string | undefined,
): { counter: string; amount: number; as?: string } | undefined {
  if (!from || !to || from === to) return undefined;
  return stateIn(decl, to)?.swap;
}
