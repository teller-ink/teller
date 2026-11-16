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
// CLEARING THE TABLE is that row with its stamping half missing, and
// undoes through the same lines: the fight is over is one thing the
// Warden decided, so putting it back is one press (`Session.clearTable`).
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
//     without a before — those last are STATE nobody can step back,
//     so the walk names each one it passes (`skipped`, below).
//   - anything whose payload can't state the before (a turn op logged
//     by an older build, a template delete that never learned its
//     slot). Reported as not-undoable rather than guessed at.
//
// The inversion goes through the same doors an ordinary edit does, so
// the store logs it and the room repaints — and then the `revert` row
// is appended pointing at what it undid (rule 1: an undo is a
// mutation like any other, and a human can undo the undo).
//
// STEPPING OVER IS SAID OUT LOUD (audit 2026-11-16). A board write that
// can't be stepped back is newer than the thing undo will take, so a
// Warden who misclicks the fog and presses undo was silently losing
// some older edit instead — eleven days old, in one run. Board writes
// stay un-undoable (CORE-NEXT's fold-gate Tier 3, unchanged); what
// changed is that the peek names every newer change the walk passes
// over, and says who did the thing it will take and when, in names a
// Warden reads mid-fight rather than ids.
//
// And a restore is TARGETED. A deletion, a deploy and a sweep all carry
// the boards and the order as they were, and putting those back whole
// rewound every token move and fog change made since — itself a write
// nobody could undo. Now only the placements and turn rows that the
// action took come back, merged into the table as it stands.

import { refIn, type Entity, type Entry, type Ref } from '../core/entity.ts';
import type { EventRow } from '../core/store.ts';
import type { Session } from './session.ts';
import { toTurnState, type TurnState } from './turn.ts';

/**
 * How far back a walk looks. Deep enough that a night's play is
 * reachable, bounded so a long campaign's log never becomes the cost
 * of pressing undo.
 */
export const UNDO_WINDOW = 500;

/** The kind of the one row undo never walks past — see `markFloor`. */
export const FLOOR = 'undo.floor';

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

/**
 * Notes that ride BESIDE an undoable row rather than standing for a
 * change of their own: showing a handout is the manifest's ref, which
 * undo puts back; a note passed is a thing the table already read. They
 * are not stepped back, and they are not reported as stepped OVER
 * either — the row they describe is the one undo is about to take, or
 * there was never any state to take.
 */
const NOTES = new Set([
  'handout.shown',
  'handout.cleared',
  'note.passed',
  'campaign.created',
  // Exporting a story writes the campaign's own identity row (its `sto_`
  // id and the export count) — bookkeeping about the file, not a change
  // to the table. It used to log as an ordinary template edit, so the
  // next thing undo offered to take back was "the export".
  'story.exported',
  FLOOR,
]);

// -- the floor -----------------------------------------------------------
//
// Undo walks BACK, and there are two places it must never walk past.
//
// A new campaign's own setup: the host writes the system ref into the
// manifest the moment the campaign is minted, and one press on a
// pristine table used to take it away — after the next sweep the party
// read as foes (audit 2026-11-16). That write is the campaign being
// born, not a thing anybody did at the table.
//
// A campaign restored from a `.story`: its history arrives as history,
// and the rows that put the roster in place arrive after it. Stepping
// those back deleted the party one press at a time, and stepping into
// the imported log restored things under a root that doesn't exist on
// this host until the host fell over. The import is where this table's
// undo begins; what came before it stays readable in the log, as
// history, and nothing reaches into it.
//
// Both are one row, written once, that the walk stops at.

/**
 * Write the floor: nothing at or below this row is ever stepped back.
 * `why` is what the peek says — "since this campaign was restored".
 */
export function markFloor(
  campaign: { append(entityId: string | null, actor: string, kind: string, payload?: unknown): unknown },
  actor: string,
  why: 'created' | 'restored',
  extra: Record<string, unknown> = {},
): void {
  campaign.append(null, actor, FLOOR, { why, ...extra });
}

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
  /** Who did it, by name — "the console", "Beau Tillman's seat". */
  who: string;
  /** What it was, by name — "Beau Tillman — Health 9 → 10", "deployed The Lake". */
  what: string;
  /** Roughly when — "just now", "4 min ago". */
  ago: string;
  /**
   * Newer changes this undo walks PAST because they can't be stepped
   * back (board writes, notices, shelf edits). Absent when the thing
   * undo takes is the latest change at the table.
   */
  skipped?: { count: number; what: string[] };
  /**
   * What else the press does that the Warden would not guess — said in
   * words when a restore has to fall back to putting a whole board or
   * order back as it was.
   */
  also?: string[];
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
  /**
   * Every entity the deletion took (it and what hung under it) — whose
   * tokens a targeted restore puts back. Absent on rows from before it
   * was written down, where the deleted thing alone is the answer.
   */
  entities?: string[];
  turn?: unknown;
  boards?: { boardId: string; data: unknown }[];
  /**
   * Which map the table was aimed at before, when the action aimed it
   * somewhere else (a deploy whose recipe named its own board). Present
   * and null means "it was showing nothing"; absent means the action
   * never touched the aim, and undo must leave it alone.
   */
  showing?: Ref | null;
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
    case 'table.cleared':
      // The same row with the stamping half missing: a sweep only ever
      // took things away (`Session.clearTable`).
      return Array.isArray(p.cleared);
    default:
      return false;
  }
}

// -- saying it in words ------------------------------------------------
//
// The peek used to hand back a kind, an actor string and an entity id,
// and a Warden can't read `seat:ent_be62f091eff7 entity.updated` across
// a table mid-fight. Everything below turns a row into the sentence the
// button wears: who, what, roughly when — names always, and an honest
// phrase when the name has gone with the thing.

/** An entity's name as the log or the table still knows it. */
function nameOf(session: Session, id: unknown): string | undefined {
  return typeof id === 'string' ? session.campaign.get(id)?.name : undefined;
}

/** Who did it, as a Warden reads it — never a raw id. */
function whoDid(session: Session, actor: string): string {
  // `dm` is what the story doors file under — the console, by key.
  if (actor === 'console' || actor === 'dm') return 'the console';
  if (actor === 'host') return 'teller itself';
  if (actor === 'anon') return 'an unpaired screen';
  if (actor.startsWith('seat:')) {
    const held = actor.slice('seat:'.length);
    const name = nameOf(session, held);
    if (name) return `${name}'s seat`;
    // A seat names its character by id when it has one, so an id that
    // no longer resolves is a character since deleted; anything else is
    // the screen's own name and already words.
    return held.startsWith('ent_') ? 'a seat whose character is gone' : `the seat ${held}`;
  }
  if (actor.startsWith('display:')) return `the ${actor.slice('display:'.length)} screen`;
  if (actor.startsWith('plugin:')) {
    // By the name on its manifest, when it is still on the shelf — "the
    // plg_57012c4ab8e3 plugin" is the raw id this function exists not to
    // print. A plugin that has since gone keeps the only word there is.
    const id = actor.slice('plugin:'.length);
    const named = session.plugins.find((p) => p.manifest.id === id)?.manifest.name;
    return named ? `${named} (a plugin)` : `the ${id} plugin`;
  }
  // A name the console gave itself in the request body is already words.
  return actor;
}

/** Roughly when — the button's last word, so "the console, 11 days ago" can't hide. */
export function agoOf(at: string, now: number = Date.now()): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return 'at some point';
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const shown = (v: unknown) => (v === undefined ? 'nothing' : String(v));

/** One entry's move in the direction it was MADE — "Health 10 → 9". */
function entryWords(c: NonNullable<Undoable['changes']>[number]): string {
  if (c.from === undefined) return `${c.name} added`;
  if (c.to === undefined) return `${c.name} removed`;
  return `${c.name} ${shown(c.from)} → ${shown(c.to)}`;
}

/** What one turn op did, named — the order's rows link entities by id. */
function turnWords(session: Session, p: Payload): string {
  const before = toTurnState(p.before);
  const after = toTurnState(p.after);
  const row = (e: { entityId?: string; label?: string } | undefined) =>
    !e
      ? 'a row'
      : e.entityId
        ? (nameOf(session, e.entityId) ?? 'someone no longer at the table')
        : (e.label ?? 'a row');
  const had = new Set(before.order.map((e) => e.id));
  const has = new Set(after.order.map((e) => e.id));
  switch (p.op) {
    case 'next':
      return after.turn === null ? 'next turn' : `next turn — ${row(after.order[after.turn])} up`;
    case 'prev':
      return after.turn === null ? 'back a turn' : `back a turn — ${row(after.order[after.turn])} up`;
    case 'add':
      return `added ${row(after.order.find((e) => !had.has(e.id)))} to the order`;
    case 'remove':
      return `took ${row(before.order.find((e) => !has.has(e.id)))} out of the order`;
    case 'score': {
      const moved = after.order.find(
        (e) => before.order.find((b) => b.id === e.id)?.score !== e.score,
      );
      return moved ? `${row(moved)} rolled ${shown(moved.score ?? undefined)}` : 'a score in the order';
    }
    case 'set':
      return 'rearranged the turn order';
    case 'end':
      return 'ended the turn order';
    case 'rolling':
      return after.rolling ? 'started rolling for the order' : 'stopped rolling for the order';
    case 'restore':
      return 'put the turn order back';
    case 'cascade':
      return 'took the deleted out of the order';
    case 'clear':
      return 'emptied the turn order';
    case 'deploy':
      return 'added a fight to the order';
    default:
      return 'changed the turn order';
  }
}

/** What a stepped-back row WAS, in the direction it happened. */
function whatOf(session: Session, event: EventRow, name: string | undefined): string {
  const p = payloadOf(event);
  const thing = name ?? 'something no longer at the table';
  switch (event.kind) {
    case 'entity.updated': {
      const before = entityOf(p.before);
      const after = entityOf(p.after);
      if (!before || !after) return `${thing} — edited`;
      const changes = changesBetween(before, after) ?? [];
      if (changes.length) {
        const more = changes.length > 2 ? ` +${changes.length - 2} more` : '';
        return `${thing} — ${changes.slice(0, 2).map(entryWords).join(', ')}${more}`;
      }
      // The manifest's refs are what showing a board or a handout
      // writes, and "The Unlikely Duo — edited" would hide which.
      const keys = new Set([...Object.keys(before.refs ?? {}), ...Object.keys(after.refs ?? {})]);
      const refs: string[] = [];
      for (const key of keys) {
        const was = before.refs?.[key];
        const now = after.refs?.[key];
        if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) continue;
        const word = (r: unknown) => {
          const one = Array.isArray(r) ? r[0] : r;
          return one && typeof one === 'object'
            ? String((one as Ref).name ?? (one as Ref).id ?? 'something')
            : 'nothing';
        };
        refs.push(`${key}: ${word(was)} → ${word(now)}`);
      }
      if (refs.length) return `${thing} — ${refs.join(', ')}`;
      if (before.name !== after.name) return `renamed ${before.name} → ${after.name}`;
      return `${thing} — edited`;
    }
    case 'entity.created':
      return `created ${thing}`;
    case 'entity.deleted':
      return `deleted ${thing}`;
    case 'entity.moved': {
      const root = session.campaign.root().id;
      const where = (id: unknown) =>
        id === root ? 'the table' : (nameOf(session, id) ?? 'something since deleted');
      return `handed ${thing} from ${where(p.from)} to ${where(p.to)}`;
    }
    case 'template.updated':
    case 'template.deleted': {
      const held = (p.after ?? p.before) as { name?: unknown } | undefined;
      const tname =
        held && typeof held === 'object' && typeof held.name === 'string' ? held.name : 'a template';
      const slot = typeof p.slot === 'string' ? p.slot : 'templates';
      if (event.kind === 'template.deleted') return `removed ${tname} from ${slot}`;
      return p.before === undefined ? `added ${tname} to ${slot}` : `edited ${tname} in ${slot}`;
    }
    case 'turn.updated':
      return turnWords(session, p);
    case 'encounter.deployed':
      return `deployed ${typeof p.name === 'string' ? p.name : 'a fight'}`;
    case 'table.cleared': {
      const n = Array.isArray(p.cleared) ? p.cleared.length : 0;
      return `cleared the table (${n} taken off)`;
    }
    default:
      return event.kind;
  }
}

/** A board's name, or the honest phrase when it's gone from the shelf. */
function boardName(session: Session, id: unknown): string {
  return (typeof id === 'string' ? session.shelf.board(id)?.name : undefined) ?? 'a board no longer on the shelf';
}

/**
 * A change undo walks PAST, in a few words. A board write carries no
 * payload at all, so what it did is read off the `token.moved` notes the
 * same PUT filed beside it — and where there are none, the honest answer
 * is the three things a board write can be, not a guess at one.
 */
function skippedWord(session: Session, event: EventRow, moves: EventRow[]): string {
  const p = payloadOf(event);
  switch (event.kind) {
    case 'board.updated': {
      const board = boardName(session, event.entityId);
      const names = [
        ...new Set(
          // Oldest first, the order the PUT filed them in.
          [...moves]
            .reverse()
            .map((m) => payloadOf(m))
            .filter((m) => m.boardId === event.entityId)
            .map((m) => String(m.byName ?? 'a token')),
        ),
      ];
      if (!names.length) return `fog, tokens or zones on ${board}`;
      const more = names.length > 2 ? ` +${names.length - 2}` : '';
      return `moved ${names.slice(0, 2).join(', ')}${more} on ${board}`;
    }
    case 'board.cleared':
      return `wiped ${boardName(session, event.entityId)}`;
    case 'board.added':
      return `added the board ${String(p.name ?? '')}`.trim();
    case 'board.edited':
      return `edited the board ${String(p.name ?? '')}`.trim();
    case 'board.removed':
      return `removed the board ${String(p.name ?? '')}`.trim();
    case 'notice.posted': {
      const text = String(p.text ?? '');
      return `posted the notice "${text.length > 30 ? `${text.slice(0, 30)}…` : text}"`;
    }
    case 'notice.cleared':
      return 'took the notice down';
    case 'turn.updated':
      // Only an op written without its before lands here.
      return 'a turn order change';
    case 'panel.copied':
      return `copied the panel ${String(p.name ?? '')}`.trim();
    default:
      // A plugin's own kind, or a row an older build wrote without its
      // before: named by what the log calls it, which is the most anyone
      // can honestly say.
      return `${event.kind} by ${whoDid(session, event.actor)}`;
  }
}

/** "fog on The Lake ×3" — the same change made over and over reads as one line. */
function grouped(words: string[]): string[] {
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].map(([w, n]) => (n > 1 ? `${w} ×${n}` : w));
}

// -- the walk ------------------------------------------------------------

type Walk = {
  events: EventRow[];
  target?: EventRow;
  /** The changes newer than the target that it walks past, newest first. */
  skipped: string[];
  /**
   * With no target: WHY there is nothing, in words. An empty history, a
   * floor, and a window that ran out all looked alike before — a
   * disabled button — and only the first of them means nothing is there.
   */
  nothing?: string;
};

/** What the button says when the walk found nothing, per floor. */
const FLOOR_WORDS: Record<string, string> = {
  created: 'nothing since this campaign was made',
  restored: 'nothing since this campaign was restored',
};

/**
 * The walk: newest first, past everything already reverted, past the
 * records, to the first row whose before the log actually holds — and
 * WRITING DOWN what it passed on the way, because a step over a change
 * nobody can undo is exactly the thing a Warden must see before pressing.
 */
function walk(session: Session): Walk {
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
  const skipped: string[] = [];
  // The step notes a board write filed beside itself land just ABOVE it
  // in the log, so newest-first they arrive first and wait here for the
  // board row they describe.
  let moves: EventRow[] = [];
  for (const event of events) {
    // The floor, and the campaign's birth (the floor of a campaign made
    // before floors were written down). Nothing below either is reached.
    if (event.kind === FLOOR) {
      const why = String(payloadOf(event).why ?? '');
      return { events, skipped, nothing: FLOOR_WORDS[why] ?? FLOOR_WORDS.created };
    }
    if (event.kind === 'campaign.created') {
      return { events, skipped, nothing: FLOOR_WORDS.created };
    }
    if (event.kind === 'revert' || done.has(event.id)) continue;
    if (event.kind === 'token.moved') {
      moves.push(event);
      continue;
    }
    if (invertible(event)) return { events, target: event, skipped };
    if (!RECORDS.has(event.kind) && !NOTES.has(event.kind)) {
      skipped.push(skippedWord(session, event, moves));
    }
    moves = [];
  }
  // Ran out of window, not out of history: there are older rows, and
  // undo deliberately doesn't read that far. Saying "nothing to undo"
  // here was a lie of omission (audit 2026-11-16).
  if (events.length >= UNDO_WINDOW) {
    return {
      events,
      skipped,
      nothing: `nothing undo can reach — it looks back ${UNDO_WINDOW} changes, and none of those can be stepped back`,
    };
  }
  return { events, skipped, nothing: 'nothing behind this table yet' };
}

export function nextUndoable(session: Session): EventRow | undefined {
  return walk(session).target;
}

/** How the walk describes a row to whoever is about to press the button. */
/** The thing a row is about, by name, from wherever the log or the table still holds it. */
function rowName(session: Session, event: EventRow): string | undefined {
  const p = payloadOf(event);
  const before = entityOf(p.before);
  const after = entityOf(p.after);
  const stored = event.entityId ? session.campaign.get(event.entityId) : undefined;
  const named = (p.before ?? p.after) as { name?: unknown } | undefined;
  return (
    before?.name ??
    after?.name ??
    stored?.name ??
    (named && typeof named === 'object' && typeof named.name === 'string'
      ? named.name
      : undefined) ??
    // A row about something that isn't an entity at all — a deployed
    // fight names itself, because "undo the deploy" wants the fight's
    // word and there's no stored row to read it off.
    (typeof p.name === 'string' ? p.name : undefined)
  );
}

function describe(session: Session, event: EventRow, seen: Walk): Undoable {
  const p = payloadOf(event);
  const before = entityOf(p.before);
  const after = entityOf(p.after);
  const name = rowName(session, event);
  const out: Undoable = {
    event: event.id,
    kind: event.kind,
    actor: event.actor,
    at: event.createdAt,
    entityId: event.entityId,
    who: whoDid(session, event.actor),
    what: whatOf(session, event, name),
    ago: agoOf(event.createdAt),
  };
  if (name) out.name = name;
  if (before && after) {
    const changes = changesBetween(after, before);
    if (changes) out.changes = changes;
  }
  if (seen.skipped.length) {
    out.skipped = { count: seen.skipped.length, what: grouped(seen.skipped) };
  }
  const plan = planRestore(session, event, seen.events);
  const also = plan ? alsoOf(session, plan) : [];
  const gone = event.kind === 'entity.updated' && before ? aimGone(session, before) : undefined;
  if (gone) {
    also.push(`${gone.name || 'that board'} is no longer on the shelf — the table stays as it is`);
  }
  if (also.length) out.also = also;
  return out;
}

/**
 * The board an undo would re-aim the table at, when that board is no
 * longer on the shelf. Only the manifest carries the aim.
 */
function aimGone(session: Session, before: Entity): Ref | undefined {
  if (!session.campaign.isRoot(before.id)) return undefined;
  const aim = refIn(before.refs, 'board');
  return aim && !session.shelf.board(aim.id) ? aim : undefined;
}

/** What `/undo` WOULD undo — the same walk, nothing written. */
export function peekUndo(session: Session): Undoable | null {
  return peek(session).undoable;
}

/**
 * The peek as the door answers it: what would go, or — when nothing
 * would — why, in words. A floor and an exhausted window are different
 * answers from an empty history, and a Warden should be told which.
 */
export function peek(session: Session): { undoable: Undoable | null; nothing?: string } {
  const seen = walk(session);
  if (seen.target) return { undoable: describe(session, seen.target, seen) };
  return { undoable: null, nothing: seen.nothing ?? 'nothing behind this table yet' };
}

// -- the log, in the same words ------------------------------------------
//
// The console's Log tool listed `enc_… — encounter.deployed` and
// `ent_… was edited` right under an undo button that said "deployed The
// Lake". Same rows, two vocabularies. So the events door words each row
// with the describers above — once, on the host, in the one request
// that fetched the list — and the client shows what it is handed.

/** Kinds the client words better itself (its payloads describe a fight, not a row). */
const SELF_WORDED = new Set([
  'dice.rolled',
  'turn.resolved',
  'handout.shown',
  'handout.cleared',
  'note.passed',
  'campaign.created',
]);

/** What an undo's row says it put back, when the row itself is out of sight. */
const REVERTED: Record<string, string> = {
  'entity.created': 'a creation',
  'entity.updated': 'an edit',
  'entity.deleted': 'a deletion',
  'entity.moved': 'a hand-over',
  'template.updated': 'a prep edit',
  'template.deleted': 'a prep removal',
  'turn.updated': 'a turn order change',
  'encounter.deployed': 'a deploy',
  'table.cleared': 'a cleared table',
};

/**
 * Who did one row, and what it was, as the Log tool shows it. `what` is
 * absent for the kinds whose own payload already reads as a sentence.
 * `rows` is the list being worded, so an undo's row can name what it
 * put back without a lookup of its own.
 */
export function logWords(
  session: Session,
  event: EventRow,
  rows: Map<number, EventRow>,
): { who: string; what?: string } {
  const who = whoDid(session, event.actor);
  if (SELF_WORDED.has(event.kind)) return { who };
  const p = payloadOf(event);
  switch (event.kind) {
    case 'entity.created':
    case 'entity.updated':
    case 'entity.deleted':
    case 'entity.moved':
    case 'template.updated':
    case 'template.deleted':
    case 'turn.updated':
    case 'encounter.deployed':
    case 'table.cleared':
      return { who, what: whatOf(session, event, rowName(session, event)) };
    case 'revert': {
      const was = typeof p.reverted === 'number' ? rows.get(p.reverted) : undefined;
      if (was) return { who, what: `put back — ${whatOf(session, was, rowName(session, was))}` };
      // The row it put back is older than this page of the log (or
      // arrived with a story and couldn't be re-aimed): say what kind.
      return { who, what: `put back — ${REVERTED[String(p.kind)] ?? 'an earlier change'}` };
    }
    case FLOOR:
      return {
        who,
        what:
          p.why === 'restored'
            ? 'restored from a story — undo starts here'
            : 'campaign set up — undo starts here',
      };
    case 'story.exported':
      return { who, what: `exported as a story${typeof p.version === 'number' ? ` (v${p.version})` : ''}` };
    case 'token.moved':
      return { who, what: `${String(p.byName ?? 'a token')} moved on ${boardName(session, p.boardId)}` };
    case 'board.updated':
    case 'board.cleared':
    case 'board.added':
    case 'board.edited':
    case 'board.removed':
    case 'notice.posted':
    case 'notice.cleared':
    case 'panel.copied':
      return { who, what: skippedWord(session, event, []) };
    default: {
      // A plugin's own kind: what the log calls it, beside the thing it
      // is about when that has a name — never a bare id.
      const name = rowName(session, event);
      return { who, what: name ? `${name} — ${event.kind}` : event.kind };
    }
  }
}

// -- the targeted restore ----------------------------------------------
//
// A deletion, a deploy and a sweep each carry the boards and the order
// AS THEY WERE. Writing those back whole was the old restore, and it
// discarded every token move and fog stroke made since — a second,
// silent, un-undoable rewind riding on the first. So the snapshot is now
// read for what the action TOOK: the placements naming the entities it
// removed, and the turn rows it lifted out. Those come back, into the
// board and the order as they stand NOW; everything else stays put.
//
// Two honest fallbacks, each said in words by the peek before anyone
// presses: a board whose current state isn't a board at all (wiped,
// or written as garbage) gets its snapshot whole, because there is
// nothing to merge into; and an order whose "after" has aged out of the
// window can't be told apart from a later edit, so it comes back whole.

type TurnPlan =
  | { mode: 'none' }
  /** Nothing has touched the order since — the snapshot IS the merge. */
  | { mode: 'same'; before: TurnState }
  | { mode: 'merge'; before: TurnState; left: TurnState }
  /** The fallback: put it back as it was, and the peek says so. */
  | { mode: 'whole'; before: TurnState };

type Restore = {
  /** Whose placements come back. */
  ids: Set<string>;
  turn: TurnPlan;
  boards: { boardId: string; then: unknown; whole: boolean }[];
};

const isState = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

type Placement = { id?: unknown; entityId?: unknown };

function placementsOf(state: unknown): Placement[] {
  const raw = isState(state) ? state.placements : undefined;
  return Array.isArray(raw) ? (raw as Placement[]) : [];
}

/** The rows that clear entities name them; a delete names its own. */
function takenBy(event: EventRow, p: Payload): Set<string> {
  if (event.kind === 'entity.deleted') {
    const listed = cascadeOf(p)?.entities;
    if (Array.isArray(listed)) return new Set(listed.filter((id) => typeof id === 'string'));
    const before = entityOf(p.before);
    return new Set(before ? [before.id] : []);
  }
  const ids = new Set<string>();
  for (const row of (p.cleared as unknown[]) ?? []) {
    const entity = entityOf((row as { entity?: unknown } | null)?.entity);
    if (entity) ids.add(entity.id);
  }
  return ids;
}

function planRestore(session: Session, event: EventRow, events: EventRow[]): Restore | undefined {
  if (!['entity.deleted', 'encounter.deployed', 'table.cleared'].includes(event.kind)) {
    return undefined;
  }
  const p = payloadOf(event);
  const cascade = cascadeOf(p);
  const boards = (cascade?.boards ?? []).map(({ boardId, data }) => ({
    boardId,
    then: data,
    // Nothing to merge into — the snapshot is the only board there is.
    whole: !isState(session.campaign.boardState(boardId)),
  }));

  let turn: TurnPlan = { mode: 'none' };
  if (cascade?.turn !== undefined) {
    const before = toTurnState(cascade.turn);
    // How the action LEFT the order is the after of the last turn row
    // it claimed — every one of them carries the whole order both sides.
    const byId = new Map(events.map((e) => [e.id, e]));
    const claimed = (cascade.events ?? []).map((id) => byId.get(id));
    const turnRows = claimed.filter((e): e is EventRow => e?.kind === 'turn.updated');
    const last = turnRows.sort((a, b) => b.id - a.id)[0];
    const left = last ? payloadOf(last).after : undefined;
    if (claimed.some((e) => !e) || (last && left === undefined)) {
      turn = { mode: 'whole', before };
    } else if (last) {
      const leftState = toTurnState(left);
      const same = JSON.stringify(session.turnState()) === JSON.stringify(leftState);
      turn = same ? { mode: 'same', before } : { mode: 'merge', before, left: leftState };
    }
    // No turn row at all: the action never moved the order, so there is
    // nothing of the order's to put back.
  }
  return { ids: takenBy(event, p), turn, boards };
}

/** The fallbacks, in words — the peek's `also`. */
function alsoOf(session: Session, plan: Restore): string[] {
  const out: string[] = [];
  for (const board of plan.boards) {
    if (board.whole) {
      out.push(`also puts ${boardName(session, board.boardId)} back to how it was then`);
    }
  }
  if (plan.turn.mode === 'whole') out.push('also puts the turn order back to how it was then');
  return out;
}

/**
 * The order as it stands, with the rows the action lifted out put back
 * where they stood — after the nearest row that was above them then and
 * is still here now. Whose turn it is follows the ROW (the order's own
 * law), so slotting a row in above the acting one moves the index with
 * it. A row the action KEPT and somebody removed since is theirs, and
 * stays removed.
 */
function mergeTurn(before: TurnState, left: TurnState, now: TurnState): TurnState {
  const kept = new Set(left.order.map((e) => e.id));
  const order = [...now.order];
  let turn = now.turn;
  let anchor = -1;
  for (const row of before.order) {
    const at = order.findIndex((e) => e.id === row.id);
    if (at >= 0) {
      anchor = at;
      continue;
    }
    if (kept.has(row.id)) continue;
    const slot = anchor + 1;
    order.splice(slot, 0, row);
    if (turn !== null && slot <= turn) turn++;
    anchor = slot;
  }
  return { ...now, order, turn };
}

/**
 * A board as it stands, with the taken entities' tokens back on it as
 * they stood. `undefined` means nothing needs writing — every one of
 * them is already standing somewhere on it.
 */
function withReturned(now: unknown, then: unknown, ids: Set<string>): unknown | undefined {
  const current = placementsOf(now);
  const standing = new Set(current.map((pl) => pl.entityId));
  const placed = new Set(current.map((pl) => pl.id).filter((id) => id !== undefined));
  const back = placementsOf(then).filter(
    (pl) =>
      typeof pl.entityId === 'string' &&
      ids.has(pl.entityId) &&
      !standing.has(pl.entityId) &&
      !(pl.id !== undefined && placed.has(pl.id)),
  );
  if (!back.length) return undefined;
  return { ...(now as object), placements: [...current, ...back] };
}

/**
 * Put the places back — the order, then the boards — once every entity
 * they name exists again (the deletion cascade's law: no reader ever
 * sees a turn row or a token naming a thing that isn't there).
 */
function restorePlaces(session: Session, plan: Restore, actor: string): void {
  const { turn } = plan;
  if (turn.mode === 'same' || turn.mode === 'whole') {
    session.restoreTurn(turn.before, actor);
  } else if (turn.mode === 'merge') {
    const now = session.turnState();
    const next = mergeTurn(turn.before, turn.left, now);
    if (JSON.stringify(next) !== JSON.stringify(now)) session.restoreTurn(next, actor);
  }
  for (const board of plan.boards) {
    if (board.whole) {
      session.putBoardState(board.boardId, board.then, actor);
      continue;
    }
    const next = withReturned(session.campaign.boardState(board.boardId), board.then, plan.ids);
    if (next !== undefined) session.putBoardState(board.boardId, next, actor);
  }
}

/** Put one event back, through the ordinary doors. */
function invert(session: Session, event: EventRow, actor: string, plan: Restore | undefined): void {
  const p = payloadOf(event);
  switch (event.kind) {
    case 'entity.created': {
      const after = entityOf(p.after);
      if (after) session.remove(after.id, actor);
      return;
    }
    case 'entity.updated': {
      const before = entityOf(p.before);
      if (!before) return;
      // Re-aiming the table at a board that has since left the shelf
      // would point every passive screen at nothing — the board door
      // clears the aim when it removes one, and undoing that clear
      // used to bring back a dangling ref. The aim stays as it stands;
      // the peek said so before the press (`aimGone`).
      if (aimGone(session, before)) {
        const refs = { ...(before.refs ?? {}) };
        const now = session.campaign.root().refs?.board;
        if (now) refs.board = now;
        else delete refs.board;
        session.save({ ...before, refs }, actor);
        return;
      }
      session.save(before, actor);
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
      if (plan) restorePlaces(session, plan, actor);
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
      restoreCleared(session, p, actor, plan);
      return;
    }
    case 'table.cleared': {
      // A sweep is the deploy's second half alone: nothing was stamped,
      // so the fight simply comes back — entities first, then the order
      // and the boards that pointed at them (`Session.clearTable`).
      restoreCleared(session, p, actor, plan);
      return;
    }
  }
}

/**
 * Put a cleared generation back: the entities as they were, parents
 * first, and only THEN the places that name them.
 *
 * Both rows that clear things — a deploy's reset and a table sweep —
 * carry the same `{cleared, cascade}` shape, so they undo through the
 * same few lines. The order is the deletion cascade's law: no reader
 * ever sees a turn row or a token naming a thing that isn't there.
 */
function restoreCleared(
  session: Session,
  p: Payload,
  actor: string,
  plan: Restore | undefined,
): void {
  for (const row of (p.cleared as unknown[]) ?? []) {
    const held = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const entity = entityOf(held.entity);
    if (!entity) continue;
    const parent = typeof held.parent === 'string' ? held.parent : undefined;
    session.create(entity, actor, parent);
  }
  if (plan) restorePlaces(session, plan, actor);
  // And the aim, LAST — every board it names exists again by now, so
  // the table is never pointed at a map whose state is still mid-restore.
  // The aim is one ref, not a board's contents: putting it back is the
  // whole of what the deploy did to it.
  const cascade = cascadeOf(p);
  if (cascade?.showing !== undefined) session.setShowingBoard(cascade.showing, actor);
}

/**
 * Step the table back one mutation. Nothing to undo is a plain answer,
 * not an error — a fresh campaign has nothing behind it and pressing
 * the button is not a mistake.
 */
export function undo(session: Session, actor: string): Undoable | null {
  const seen = walk(session);
  const event = seen.target;
  if (!event) return null;
  const undone = describe(session, event, seen);
  // Read BEFORE anything is written: whether the order has moved since
  // the action is a question about the table as the Warden left it,
  // and a deploy's own first step (taking its foes off) moves it.
  const plan = planRestore(session, event, seen.events);

  // What the inverse itself writes has to be marked, or the next undo
  // would simply redo this one. The rowid is a high-water mark: every
  // row above it is this undo's own work.
  const mark = session.campaign.events({ limit: 1 })[0]?.id ?? 0;
  invert(session, event, actor, plan);
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
