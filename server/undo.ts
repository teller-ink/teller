// `/undo` — rule 3's payoff, and deliberately not a feature.
//
// Every mutation already appends to the event log, and the log was
// shaped so the inverse is READABLE off it: updates carry
// `{before, after}`, deletes carry `{before}` (plus the parent they
// hung under), a cascade logs one event per row, and a turn op carries
// the whole order both sides. So undo is a WALK, newest-first, and one
// inversion — no shadow state, no snapshots, nothing to keep in sync.
//
// Three kinds of row the walk steps over:
//
//   - a `revert` itself, and anything a revert already pointed at —
//     this is what makes repeated undos step FURTHER back instead of
//     fighting each other (undo, undo, undo walks three edits back).
//     A revert also names the rows its own inverse write produced, so
//     the second undo doesn't simply redo the first.
// A DEPLOY is the other one, and the same shape: deploying a fight is
// a RESET (clear what this encounter stamped last time, stamp it
// fresh), which is many writes and exactly one thing the Warden did.
// So `encounter.deployed` carries the table as it was — the generation
// it cleared, the order, the boards — and names every row it wrote, and
// one press peels the whole generation back (`Session.deployEncounter`).
//
// A DELETION is the one row that undoes more than itself. An entity's
// place at the table — its row in the order, its token on a board —
// points at it by id, so deleting takes those with it (`Session.remove`)
// and the deletion's payload carries them back. One press, one restore:
// a foe that came back without its place in the fight would be a second
// thing for the Warden to notice and fix.
//
//   - RECORDS, which changed no state: `dice.rolled` and
//     `turn.resolved` say what happened at the table (what the dice
//     showed, what the arithmetic was). Undoing one would mean
//     un-rolling a die the table watched land — the values a turn
//     MOVED went through the ordinary entry door and each has its own
//     undoable row. `token.moved` is the same shape: it is a note
//     BESIDE the board write that carried the placement, not the write
//     itself. So records are skipped, not inverted. Same for
//     `campaign.created`, and for board writes, which log the fact
//     without a before.
//   - anything whose payload can't state the before (a turn op logged
//     by an older build, a template delete that never learned its
//     slot). Reported as not-undoable rather than guessed at.
//
// The inversion goes through the same doors an ordinary edit does, so
// the store logs it and the room repaints — and then the `revert` row
// is appended pointing at what it undid (rule 1: an undo is a
// mutation like any other, and a human can undo the undo).

import type { Entity, Entry } from '../core/entity.ts';
import type { EventRow } from '../core/store.ts';
import type { Session } from './session.ts';
import { toTurnState } from './turn.ts';

/**
 * How far back a walk looks. Deep enough that a night's play is
 * reachable, bounded so a long campaign's log never becomes the cost
 * of pressing undo.
 */
export const UNDO_WINDOW = 500;

/**
 * Records: they say what happened, they didn't change anything.
 *
 * The shop's three are here by INTENT, not by accident of their payload
 * shape. Opening and closing a shop store nothing at all — they're
 * table history, logged so a Warden can read back where the posse spent
 * the afternoon. `shop.sold` is the receipt, and everything the sale
 * MOVED — the vendor going live, its stock coming down, the money and
 * the goods on the buyer — has its own invertible row beside it, so
 * undoing the receipt would either do nothing or undo the sale twice.
 */
const RECORDS = new Set([
  'dice.rolled',
  'turn.resolved',
  // A step's own note. Where the token ACTUALLY is lives in the board's
  // row, written by the same PUT, so stepping this back would either do
  // nothing or claim to have moved a mini nobody touched.
  'token.moved',
  'shop.opened',
  'shop.closed',
  'shop.sold',
]);

/** What `/undo` would do, or just did — enough for a console to say it. */
export type Undoable = {
  /** The event being stepped back — the rowid. */
  event: number;
  kind: string;
  actor: string;
  at: string;
  entityId: string | null;
  /** The thing's name, when the payload or the store can say it. */
  name?: string;
  /** For an edit: which entries moved, so a toast can read "Health 5 → 7". */
  changes?: { list: string; name: string; from?: number | string; to?: number | string }[];
};

type Payload = Record<string, unknown>;

/**
 * What else one deletion took with it — the turn order it was standing
 * in and the boards it was standing on, both as they were BEFORE
 * (`Session.remove`). It rides on the deletion's own row rather than on
 * rows of its own so that one press puts the whole thing back; the
 * `events` list names the cascade's log rows so the NEXT press steps
 * past them instead of re-undoing what this one already restored.
 */
type Cascade = {
  events?: number[];
  turn?: unknown;
  boards?: { boardId: string; data: unknown }[];
};

function cascadeOf(p: Payload): Cascade | undefined {
  const raw = p.cascade;
  return raw && typeof raw === 'object' ? (raw as Cascade) : undefined;
}

function payloadOf(event: EventRow): Payload {
  return event.payload && typeof event.payload === 'object'
    ? (event.payload as Payload)
    : {};
}

function entityOf(raw: unknown): Entity | undefined {
  return raw && typeof raw === 'object' && typeof (raw as Entity).id === 'string'
    ? (raw as Entity)
    : undefined;
}

/** Entries that differ between two readings of one entity — the toast's material. */
function changesBetween(before: Entity, after: Entity): Undoable['changes'] {
  const out: NonNullable<Undoable['changes']> = [];
  const lists = new Set([...Object.keys(before.lists ?? {}), ...Object.keys(after.lists ?? {})]);
  for (const list of lists) {
    const was = new Map((before.lists?.[list] ?? []).map((e: Entry) => [e.name, e]));
    const now = new Map((after.lists?.[list] ?? []).map((e: Entry) => [e.name, e]));
    for (const name of new Set([...was.keys(), ...now.keys()])) {
      const from = was.get(name)?.value;
      const to = now.get(name)?.value;
      if (was.has(name) && now.has(name) && from === to) continue;
      out.push({ list, name, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) });
    }
  }
  return out.length ? out : undefined;
}

/** Can this row be stepped back at all — is its before IN the log? */
function invertible(event: EventRow): boolean {
  const p = payloadOf(event);
  switch (event.kind) {
    case 'entity.created':
      return entityOf(p.after) !== undefined;
    case 'entity.updated':
      return entityOf(p.before) !== undefined;
    case 'entity.deleted':
      return entityOf(p.before) !== undefined;
    case 'entity.moved':
      return typeof event.entityId === 'string';
    case 'template.updated':
      return typeof p.slot === 'string';
    case 'template.deleted':
      return typeof p.slot === 'string' && p.before !== undefined;
    case 'turn.updated':
      // Only the rows that carried the whole order back; a bare `{op}`
      // (an older build's) is a record of a move nobody can replay.
      return p.before !== undefined;
    case 'encounter.deployed':
      // One press peels one generation: what it stamped, and what it
      // cleared to stamp it (`Session.deployEncounter`).
      return Array.isArray(p.created) && Array.isArray(p.cleared);
    default:
      return false;
  }
}

/** How the walk describes a row to whoever is about to press the button. */
function describe(session: Session, event: EventRow): Undoable {
  const p = payloadOf(event);
  const before = entityOf(p.before);
  const after = entityOf(p.after);
  const stored = event.entityId ? session.campaign.get(event.entityId) : undefined;
  const named = (p.before ?? p.after) as { name?: unknown } | undefined;
  const name =
    before?.name ??
    after?.name ??
    stored?.name ??
    (named && typeof named === 'object' && typeof named.name === 'string'
      ? named.name
      : undefined) ??
    // A row about something that isn't an entity at all — a deployed
    // fight names itself, because "undo the deploy" wants the fight's
    // word and there's no stored row to read it off.
    (typeof p.name === 'string' ? p.name : undefined);
  const out: Undoable = {
    event: event.id,
    kind: event.kind,
    actor: event.actor,
    at: event.createdAt,
    entityId: event.entityId,
  };
  if (name) out.name = name;
  if (before && after) {
    const changes = changesBetween(after, before);
    if (changes) out.changes = changes;
  }
  return out;
}

/**
 * The walk: newest first, past everything already reverted, past the
 * records, to the first row whose before the log actually holds.
 */
export function nextUndoable(session: Session): EventRow | undefined {
  const events = session.campaign.events({ limit: UNDO_WINDOW });
  const done = new Set<number>();
  for (const event of events) {
    if (event.kind !== 'revert') continue;
    const p = payloadOf(event);
    if (typeof p.reverted === 'number') done.add(p.reverted);
    if (Array.isArray(p.wrote)) {
      for (const id of p.wrote) if (typeof id === 'number') done.add(id);
    }
  }
  return events.find(
    (event) =>
      event.kind !== 'revert' &&
      !RECORDS.has(event.kind) &&
      !done.has(event.id) &&
      invertible(event),
  );
}

/** What `/undo` WOULD undo — the same walk, nothing written. */
export function peekUndo(session: Session): Undoable | null {
  const event = nextUndoable(session);
  return event ? describe(session, event) : null;
}

/** Put one event back, through the ordinary doors. */
function invert(session: Session, event: EventRow, actor: string): void {
  const p = payloadOf(event);
  switch (event.kind) {
    case 'entity.created': {
      const after = entityOf(p.after);
      if (after) session.remove(after.id, actor);
      return;
    }
    case 'entity.updated': {
      const before = entityOf(p.before);
      if (before) session.save(before, actor);
      return;
    }
    case 'entity.deleted': {
      const before = entityOf(p.before);
      if (!before) return;
      // The id is kept: history is keyed by it, and a restored thing
      // that came back under a new id would orphan its own log.
      const parent = typeof p.parent === 'string' ? p.parent : undefined;
      session.create(before, actor, parent);
      // And its place at the table, which went with it (`Session.remove`).
      // Order matters: the entity exists again BEFORE anything points
      // at it, so no reader ever sees a row naming a thing that isn't
      // there — the ghost this whole cascade exists to prevent.
      const cascade = cascadeOf(p);
      if (cascade?.turn !== undefined) session.restoreTurn(toTurnState(cascade.turn), actor);
      for (const board of cascade?.boards ?? []) {
        session.putBoardState(board.boardId, board.data, actor);
      }
      return;
    }
    case 'entity.moved': {
      if (!event.entityId) return;
      const from = typeof p.from === 'string' ? p.from : session.campaign.root().id;
      session.move(event.entityId, from, actor);
      return;
    }
    case 'template.updated': {
      const slot = String(p.slot);
      if (p.before === undefined) session.campaign.removeTemplate(String(event.entityId), actor);
      else session.campaign.putTemplate(slot, p.before, actor);
      session.changed('templates');
      return;
    }
    case 'template.deleted': {
      session.campaign.putTemplate(String(p.slot), p.before, actor);
      session.changed('templates');
      return;
    }
    case 'turn.updated': {
      session.restoreTurn(toTurnState(p.before), actor);
      return;
    }
    case 'encounter.deployed': {
      // The order is the deletion cascade's, twice over: take the new
      // generation off the table BEFORE putting the old one back, and
      // let nothing point at an entity that doesn't exist yet — so the
      // created foes go, then the cleared ones return (parents first,
      // as they were captured), and only then the order and the boards.
      for (const id of (p.created as unknown[]) ?? []) {
        if (typeof id === 'string' && session.campaign.get(id)) session.remove(id, actor);
      }
      for (const row of (p.cleared as unknown[]) ?? []) {
        const held = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
        const entity = entityOf(held.entity);
        if (!entity) continue;
        const parent = typeof held.parent === 'string' ? held.parent : undefined;
        session.create(entity, actor, parent);
      }
      const cascade = cascadeOf(p);
      if (cascade?.turn !== undefined) session.restoreTurn(toTurnState(cascade.turn), actor);
      for (const board of cascade?.boards ?? []) {
        session.putBoardState(board.boardId, board.data, actor);
      }
      return;
    }
  }
}

/**
 * Step the table back one mutation. Nothing to undo is a plain answer,
 * not an error — a fresh campaign has nothing behind it and pressing
 * the button is not a mistake.
 */
export function undo(session: Session, actor: string): Undoable | null {
  const event = nextUndoable(session);
  if (!event) return null;
  const undone = describe(session, event);

  // What the inverse itself writes has to be marked, or the next undo
  // would simply redo this one. The rowid is a high-water mark: every
  // row above it is this undo's own work.
  const mark = session.campaign.events({ limit: 1 })[0]?.id ?? 0;
  invert(session, event, actor);
  const wrote = session.campaign
    .events({ limit: UNDO_WINDOW })
    .filter((e) => e.id > mark)
    .map((e) => e.id);

  session.campaign.append(event.entityId, actor, 'revert', {
    reverted: event.id,
    // The cascade's own rows count as written by this undo: their
    // "before" is the state it just restored, so stepping one back
    // again would be a press that changes nothing and looks broken.
    wrote: [...(cascadeOf(payloadOf(event))?.events ?? []), ...wrote],
    kind: event.kind,
  });
  session.changed('events');
  return undone;
}
