// The turn order — rule 5, ported: an ordered list and a current
// index, which is universal whether a system rolls, deals cards or
// passes popcorn. The DM can always drag, and dragging beats anything
// teller worked out (rule 1).
//
// The op set is the old world's, moved not rebuilt — every case here
// was found by a real fight arguing with the code (the v0 runner). The
// home changed: state lives in the campaign file and every op lands in
// the event log, which the old DO never did.
//
// An entry LINKS an entity and derives its name at render (§5), or
// carries a bare label for the ad-hoc row ("3 coyotes"). `score` is
// what someone rolled: null means "hasn't rolled yet", which is what
// the console counts to know who it's waiting on — distinct from a
// genuine 0.

import { newId } from '../core/id.ts';

export type TurnEntry = {
  id: string;
  entityId?: string;
  label?: string;
  score?: number | null;
};

export type TurnState = {
  order: TurnEntry[];
  /** Index into `order`, or null between fights. */
  turn: number | null;
  round: number;
  /** The rolling phase: scores arriving one at a time, list re-sorting. */
  rolling?: boolean;
};

export type TurnOp =
  | { op: 'set'; order: TurnEntry[] }
  | { op: 'add'; entityId?: string; label?: string }
  | { op: 'remove'; entryId: string }
  | { op: 'next' }
  | { op: 'prev' }
  | { op: 'end' }
  | { op: 'rolling'; on: boolean }
  | { op: 'score'; entryId: string; score: number | null };

export const EMPTY_TURN: TurnState = { order: [], turn: null, round: 1 };

/** The forgiving read for whatever the store handed back. */
export function toTurnState(raw: unknown): TurnState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_TURN, order: [] };
  const r = raw as Record<string, unknown>;
  const order = Array.isArray(r.order)
    ? r.order.flatMap((item): TurnEntry[] => {
        if (!item || typeof item !== 'object') return [];
        const e = item as Record<string, unknown>;
        const out: TurnEntry = { id: typeof e.id === 'string' && e.id ? e.id : newId('trn') };
        if (typeof e.entityId === 'string') out.entityId = e.entityId;
        if (typeof e.label === 'string' && e.label.trim()) out.label = e.label;
        if (typeof e.score === 'number' || e.score === null) out.score = e.score;
        return out.entityId || out.label ? [out] : [];
      })
    : [];
  const turn =
    typeof r.turn === 'number' && r.turn >= 0 && r.turn < order.length
      ? Math.floor(r.turn)
      : null;
  const round = typeof r.round === 'number' && r.round >= 1 ? Math.floor(r.round) : 1;
  const state: TurnState = { order, turn, round };
  if (r.rolling === true) state.rolling = true;
  return state;
}

const scored = (e: TurnEntry) => (typeof e.score === 'number' ? e.score : null);

/** The ops a caller may send — `applyTurnOp`'s switch, as a list a sentence can name. */
const OPS = ['set', 'add', 'remove', 'next', 'prev', 'end', 'rolling', 'score'];

/**
 * What is wrong with an op, in a sentence — or nothing, when it can be
 * applied as sent.
 *
 * The door used to take anything (audit 2026-11-16): an op nobody knows
 * logged a step that changed nothing, a row for an entity that doesn't
 * exist became a ghost the runner couldn't name, the same foe could be
 * added twice, and `score: "12"` was stored as a string that sorted as
 * unrolled and vanished on the next read. None of that is a ruling a
 * human made, so refusing it overrules nobody (rule 1): the DM can still
 * put anything in the order that EXISTS, in any order, with any number.
 */
export function turnOpProblem(
  state: TurnState,
  raw: Record<string, unknown>,
  exists: (entityId: string) => boolean,
): string | undefined {
  const op = raw.op;
  if (typeof op !== 'string' || !OPS.includes(op)) {
    return `"${String(op)}" isn't a turn op — one of ${OPS.join(', ')}`;
  }
  const row = (id: unknown) =>
    typeof id === 'string' ? state.order.find((e) => e.id === id) : undefined;
  const score = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
  switch (op) {
    case 'add': {
      const { entityId, label } = raw;
      if (entityId !== undefined && typeof entityId !== 'string') return 'entityId is an id';
      if (label !== undefined && typeof label !== 'string') return 'a label is words';
      if (!entityId && !(label as string | undefined)?.trim()) {
        return 'add needs an entity or a label';
      }
      if (entityId) {
        if (!exists(entityId)) return `no entity ${entityId} to add`;
        if (state.order.some((e) => e.entityId === entityId)) {
          return 'that one is already in the order';
        }
      }
      return undefined;
    }
    case 'remove':
      return row(raw.entryId) ? undefined : `no row ${String(raw.entryId)} in the order`;
    case 'score':
      if (!row(raw.entryId)) return `no row ${String(raw.entryId)} in the order`;
      return score(raw.score) ? undefined : 'a score is a number, or null for "not rolled yet"';
    case 'rolling':
      return typeof raw.on === 'boolean' ? undefined : 'rolling is on or off — true or false';
    case 'set': {
      if (!Array.isArray(raw.order)) return 'set needs the whole order, as a list';
      const seen = new Set<string>();
      for (const item of raw.order) {
        if (!item || typeof item !== 'object') return 'every row in the order is an object';
        const e = item as Record<string, unknown>;
        if (e.entityId !== undefined && typeof e.entityId !== 'string') return 'entityId is an id';
        if (e.label !== undefined && typeof e.label !== 'string') return 'a label is words';
        if (!e.entityId && !(e.label as string | undefined)?.trim()) {
          return 'every row names an entity or carries a label';
        }
        if (e.score !== undefined && !score(e.score)) {
          return 'a score is a number, or null for "not rolled yet"';
        }
        if (typeof e.entityId === 'string') {
          if (!exists(e.entityId)) return `no entity ${e.entityId} for the order`;
          if (seen.has(e.entityId)) return 'the same one is in that order twice';
          seen.add(e.entityId);
        }
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Apply one op. Pure — the caller stores what comes back. */
export function applyTurnOp(state: TurnState, op: TurnOp): TurnState {
  const s: TurnState = { ...state, order: [...state.order] };
  switch (op.op) {
    case 'set': {
      // Whose turn it is follows the ROW, not the slot (Brian,
      // 2026-08-20). Rearranging the list is bookkeeping; who is acting
      // is table truth, and a drag past the pointer must not quietly
      // hand the turn to somebody else. `next`/`prev`/`end` are the
      // verbs that pass a turn, and they stay the only ones.
      const acting = s.turn === null ? undefined : s.order[s.turn];
      const was = s.turn;
      s.order = toTurnState({ order: op.order }).order;
      if (was !== null) {
        const still = acting ? s.order.findIndex((e) => e.id === acting.id) : -1;
        if (still !== -1) s.turn = still;
        // Dropped out of the new order — fall back the way `remove`
        // does: the row that slid into that slot, or nobody at all.
        else if (!s.order.length) s.turn = null;
        else if (was >= s.order.length) s.turn = 0;
        else s.turn = was;
      }
      break;
    }
    case 'add': {
      if (!op.entityId && !op.label?.trim()) break;
      const entry: TurnEntry = { id: newId('trn'), score: null };
      if (op.entityId) entry.entityId = op.entityId;
      if (op.label?.trim()) entry.label = op.label.trim();
      s.order.push(entry);
      break;
    }
    case 'remove': {
      const at = s.order.findIndex((e) => e.id === op.entryId);
      if (at === -1) break;
      s.order.splice(at, 1);
      if (s.turn !== null) {
        if (!s.order.length) s.turn = null;
        else if (at < s.turn) s.turn -= 1;
        else if (s.turn >= s.order.length) s.turn = 0;
      }
      break;
    }
    case 'next':
      if (!s.order.length) break;
      if (s.turn === null) {
        s.turn = 0;
        s.round = 1;
        // The fight starting is the rolls being over. Left on, the
        // banner said "taking rolls" all fight, and a seat could still
        // send a score that re-sorted an order already in play (the
        // 2026-11-16 audit found both). A late roll is the Warden's to
        // type in — the DM may always score — so nothing is locked
        // (rule 1); reopening the phase would wipe every score, which
        // is not what anybody late wants.
        delete s.rolling;
      } else if (s.turn + 1 >= s.order.length) {
        s.turn = 0;
        s.round += 1;
      } else {
        s.turn += 1;
      }
      break;
    case 'prev':
      if (!s.order.length || s.turn === null) break;
      if (s.turn === 0) {
        s.turn = s.order.length - 1;
        s.round = Math.max(1, s.round - 1);
      } else {
        s.turn -= 1;
      }
      break;
    case 'end':
      s.turn = null;
      s.round = 1;
      delete s.rolling;
      break;
    case 'rolling':
      // Opening the phase wipes every score: a new fight is a new
      // roll, and a stale number would silently sort someone wrong.
      if (op.on) {
        s.rolling = true;
        s.order = s.order.map((e) => ({ ...e, score: null }));
        s.turn = null;
      } else {
        delete s.rolling;
      }
      break;
    case 'score': {
      // Scores arrive one at a time, from whichever seat rolled — the
      // list re-sorts on every arrival. Nobody has to be last: nobody
      // who hasn't rolled outranks somebody who has, and among the
      // unrolled, arrival order is kept.
      s.order = s.order.map((e) =>
        e.id === op.entryId ? { ...e, score: op.score } : e,
      );
      s.order = [...s.order].sort((a, b) => {
        const x = scored(a);
        const y = scored(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return y - x;
      });
      break;
    }
  }
  return s;
}
