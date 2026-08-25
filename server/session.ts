// The session — what `CampaignDO` was, as a plain class (§16).
//
// One campaign, loaded once (§11), plus the set of screens listening.
// The Durable Object existed to give the table a single authority with
// live subscribers; on the host that's just... an object. State that
// more than one screen argues about lives here; everything else lives
// as close to the person as possible (rule 9).
//
// Every mutation goes through this class so that one `changed()` call
// is impossible to forget: the store logs the event (rule 3), the
// session tells the room. Subscribers get a nudge, not a snapshot —
// the minimal loop refetches on change, and pushing richer deltas is a
// later optimisation with this exact seam already in place.

import { exportProblems, loadCampaign, type Loaded } from '../core/boot.ts';
import type { LoadedPlugin, PluginProblem } from '../core/plugins.ts';
import {
  findEntry,
  isDraft,
  refIn,
  sameName,
  withoutEntry,
  type Entity,
} from '../core/entity.ts';
import { kindFor, setEntry, toKindDef, type KindDef } from '../core/kind.ts';
import { resolve, stamp } from '../core/stamp.ts';
import {
  campaignSummaries,
  createCampaign,
  openCampaign,
  slugFor,
  type Campaign,
  type CampaignSummary,
  type EntityDraft,
  type Shelf,
} from '../core/store.ts';
import type { Ref } from '../core/entity.ts';
import { applyTurnOp, toTurnState, type TurnOp, type TurnState } from './turn.ts';
// The window an undo walks — the same bound the rows of one deploy are
// collected under, because they are collected for exactly that walk.
import { UNDO_WINDOW } from './undo.ts';
import {
  countEntities,
  migrateBoardFog,
  withDeployed,
  withoutEntities,
  type Deploying,
} from './boards.ts';
// The clearing rule is the REDACTOR'S rule, imported rather than
// restated: one answer to "who was the fight", so the door that sweeps
// them off the table and the door that hides their numbers can never
// come to disagree (`server/public.ts`).
import { isParty, tradeNames } from './public.ts';
import { movesBetween, type MoveRecord } from './geometry.ts';

/**
 * One foe in a prepared fight, as the recipe writes it down.
 *
 * A template reference and a count, plus — when the fight was staged on
 * a map — where this one starts and whether it's waiting out of sight.
 * The position is map space (`u`, `v` ∈ 0..1, docs/BATTLEMAP.md), never
 * cells, so correcting a board's `widthInches` later leaves everyone
 * glued to the painted feature they were standing on.
 */
export type EncounterFoe = {
  templateId?: string;
  name?: string;
  count?: number;
  u?: number;
  v?: number;
  hidden?: boolean;
};

/**
 * A foe the recipe names that this host can't stamp — the template
 * isn't in the merged stack, because the pack that carries it isn't
 * installed (or the campaign's own copy was deleted).
 */
export type MissingFoe = { templateId: string; name?: string };

/**
 * What a deploy did. `placed` and `unplaced` are the loud half: a fight
 * that wrote down positions and found no board must say that, because
 * silence reads as "the map is fine" and the Warden finds out mid-fight.
 * `missing` is the same half again, one step earlier — a foe with no
 * template used to come up short in a count nobody was counting.
 */
export type DeployResult = {
  deployed: Entity[];
  turn: TurnState;
  /** The board the tokens went on, or null when the table has none up. */
  board: string | null;
  placed: number;
  /** Why nothing was placed, when the recipe expected somewhere to place it. */
  unplaced?: string;
  /** How many of this fight's LAST generation this deploy cleared away first. */
  cleared: number;
  /** Foes named by the recipe and absent from this host — by name (rule 9). */
  missing: MissingFoe[];
};

/**
 * What one press of "clear the table" took off it — counted, because
 * the console says it out loud and a sweep that reported nothing would
 * be indistinguishable from a sweep that did nothing.
 */
export type ClearResult = {
  /** Entities swept — the fight, its children not counted separately. */
  cleared: number;
  /** Tokens their sweep took off every board, not just the active one. */
  tokens: number;
  /** Rows the turn order held, all of which went. */
  order: number;
};

/** Which slots resolution stamps through — the stampable ones this loop knows. */
export const STAMP_SLOTS = ['bestiary', 'catalog'];

/** One touched entry — everything a seat may say about a list. */
export type EntryEdit = {
  list: string;
  name: string;
  value?: number | string;
  max?: number | null;
  remove?: boolean;
};

/**
 * The room's listeners, hoisted OUT of the session on purpose.
 *
 * A screen subscribes to the table, not to one campaign — the whole
 * point of the campaign switch is that every screen follows without
 * reconnecting (rule 9: displays live on the shelf and survive it). So
 * the subscriber set belongs to the machine and the Session borrows
 * it; swapping the campaign underneath leaves every stream in place.
 */
export class Room {
  /** Each listener, keyed by its send fn; the value is the screen's handle (or undefined for the DM's own console). */
  #subscribers = new Map<(msg: string) => void, string | undefined>();

  subscribe(send: (msg: string) => void, handle?: string): () => void {
    this.#subscribers.set(send, handle);
    return () => this.#subscribers.delete(send);
  }

  get size(): number {
    return this.#subscribers.size;
  }

  changed(what: string): void {
    for (const send of this.#subscribers.keys()) send(what);
  }

  /**
   * One screen, not the room — how an assignment or an identify reaches
   * a passive surface (rule 6: console-driven over SSE is the
   * sanctioned way anything reaches one).
   */
  notify(handle: string, what: string): void {
    for (const [send, h] of this.#subscribers) {
      if (h === handle) send(what);
    }
  }

  clear(): void {
    this.#subscribers.clear();
  }
}

export class Session {
  readonly shelf: Shelf;
  readonly campaign: Campaign;
  /** The resolved content stack — system, packs, campaign's own — from boot. */
  loaded: Loaded;
  /** Enabled plugins, wired at boot by the caller (loadPlugins is async; the constructor is not). */
  plugins: LoadedPlugin[] = [];
  pluginProblems: PluginProblem[] = [];
  /** The machine's listeners, borrowed — see `Room`. */
  readonly room: Room;

  /** Where this host's data lives — plugin discovery needs the path. */
  dataDir?: string;

  constructor(shelf: Shelf, campaign: Campaign, dataDir?: string, room?: Room) {
    this.shelf = shelf;
    this.campaign = campaign;
    this.dataDir = dataDir;
    this.room = room ?? new Room();
    this.loaded = loadCampaign(shelf, campaign, dataDir);
    // The structural migrations a state serializer can't do for itself:
    // a fog region is named geography and belongs on the board row, and
    // a world that was DARK has no cells written down until something
    // knows how big the map is. Both are only reachable from here
    // (`server/boards.ts`). A no-op on every campaign that has already
    // opened once.
    migrateBoardFog(shelf, campaign, dataDir);
  }

  /** Re-run the resolution law — after a pack upgrade, on the sweep's signal. */
  reload(): void {
    this.loaded = loadCampaign(this.shelf, this.campaign, this.dataDir);
    this.changed('reload');
  }

  subscribe(send: (msg: string) => void, handle?: string): () => void {
    return this.room.subscribe(send, handle);
  }

  get watching(): number {
    return this.room.size;
  }

  changed(what: string): void {
    this.room.changed(what);
  }

  notify(handle: string, what: string): void {
    this.room.notify(handle, what);
  }

  // -- mutations, each one store-write + room-nudge ---------------------

  create(draft: EntityDraft, actor: string, parentId?: string): Entity {
    const entity = this.campaign.create(draft, actor, parentId);
    this.changed('entities');
    return entity;
  }

  /** Stamp an instance from the merged stack — thin unless the caller says thick (§14). */
  stampFrom(
    slot: string,
    templateId: string,
    actor: string,
    opts: {
      name?: string;
      thick?: boolean;
      parentId?: string;
      refs?: Record<string, Ref | Ref[]>;
    } = {},
  ): Entity | undefined {
    const template = this.loaded.templateOf(slot)(templateId);
    if (!template) return undefined;
    const entity = this.campaign.create(
      stamp(template, { name: opts.name, thick: opts.thick, refs: opts.refs }),
      actor,
      opts.parentId,
    );
    this.changed('entities');
    return entity;
  }

  save(entity: Entity, actor: string): Entity {
    const saved = this.campaign.save(entity, actor);
    this.changed('entities');
    return saved;
  }

  /**
   * Delete an entity, and take its place at the table with it.
   *
   * A row in the turn order and a token on a board both POINT at an
   * entity by id (rule 5, §5), and a pointer at a deleted thing is a
   * ghost: the runner counts four foes it can't name and the map holds
   * four tokens that resolve to nothing. Deleting is one action, so the
   * cascade rides with it — the order and every board are edited FIRST,
   * each write logged as itself (rule 3), and then the deletion is
   * appended naming what it took. `/undo` reads that one row and puts
   * all of it back in a single press (`server/undo.ts`).
   *
   * Which entities: this one AND everything promoted under it, because
   * the store deletes those too and a pistol's token would outlive its
   * owner otherwise. Only placements that name them — a marker, a rock,
   * somebody else's token, all untouched.
   */
  remove(id: string, actor: string): void {
    const gone = new Set<string>();
    const walk = (at: string) => {
      if (gone.has(at)) return;
      gone.add(at);
      for (const child of this.campaign.children(at)) walk(child.id);
    };
    walk(id);

    const events: number[] = [];
    const lastEvent = () => this.campaign.events({ limit: 1 })[0]?.id;
    const cascade: {
      events: number[];
      turn?: TurnState;
      boards?: { boardId: string; data: unknown }[];
    } = { events };

    // The order. Row by row through the ordinary `remove` op, so whose
    // turn it is falls back exactly the way it does when the DM lifts a
    // row out by hand — the row that slid into that slot, or nobody.
    const turnBefore = this.turnState();
    let turn = turnBefore;
    for (const entry of turnBefore.order) {
      if (entry.entityId && gone.has(entry.entityId)) {
        turn = applyTurnOp(turn, { op: 'remove', entryId: entry.id });
      }
    }
    if (turn !== turnBefore) {
      this.campaign.putTurnState(turn, actor, {
        op: 'cascade',
        before: turnBefore,
        after: turn,
      });
      const at = lastEvent();
      if (at !== undefined) events.push(at);
      cascade.turn = turnBefore;
      this.changed('turn');
    }

    // Every board, not just the active one: a foe deleted between
    // scenes still has to leave the map it was standing on.
    const boards: { boardId: string; data: unknown }[] = [];
    for (const { boardId, data } of this.campaign.boardStates()) {
      const next = withoutEntities(data, gone);
      if (next === undefined) continue;
      this.campaign.putBoardState(boardId, next, actor);
      const at = lastEvent();
      if (at !== undefined) events.push(at);
      boards.push({ boardId, data });
    }
    if (boards.length) {
      cascade.boards = boards;
      this.changed('board');
    }

    this.campaign.remove(id, actor, events.length ? { cascade } : undefined);
    this.changed('entities');
  }

  /**
   * Sweep the fight off the table — one press, and the between-fights
   * state is back (TEL-111).
   *
   * The old world had this and the rebuild lost it, which turned "the
   * fight is over" into archaeology: delete eleven foes one at a time,
   * then find the rows they left in the order. It is one thing the
   * Warden decided, so it is one action here.
   *
   * WHO GOES is asked with the redactor's own question, and deliberately
   * not with a second one. `isParty` is the fail-closed rule the public
   * snapshot already keys on (`server/public.ts`) — a `pc`, or one of
   * the trades the system declares — so the two can never disagree about
   * who the fight was: anything player-facing glass was hiding numbers
   * for is exactly what this takes off the table. Three things survive
   * on top of that, each for its own reason:
   *
   *   - the CAMPAIGN ROOT, which isn't at the table at all — it's the
   *     table (party resources hang off it, §2).
   *   - a VENDOR, which is set dressing rather than a combatant: the
   *     store keeps standing after the shooting stops.
   *   - a DRAFT, which is prep. A half-made character interrupted
   *     mid-creation is somebody's evening, not this fight's litter.
   *
   * And only the root's own children are judged. What a character
   * CARRIES is promoted underneath them (a pistol is an entity), wears
   * no party word of its own, and would be swept out from under its
   * owner by a walk that recursed. A cleared entity's own children go
   * with it the way they always do — through the deletion cascade.
   *
   * The ORDER goes whole, party rows included. An empty order IS the
   * between-fights state (rule 5: a list and an index), and leaving the
   * posse standing in a fight that's over is the thing this replaces.
   *
   * One row in the log for all of it, deploy's exact trick: every write
   * goes through the ordinary doors and is logged as itself (rule 3),
   * and then `table.cleared` claims them all and carries the table as it
   * was — so `/undo` puts the fight back in one press (`server/undo.ts`).
   */
  clearTable(actor: string): ClearResult {
    const trades = tradeNames(this);
    const root = this.campaign.root();
    const doomed = this.campaign
      .children(root.id)
      .filter(
        (child) =>
          !isParty(child, trades) &&
          (child.type ?? '').trim().toLowerCase() !== 'vendor' &&
          !isDraft(child),
      );

    // Everything below this rowid is this sweep's own work.
    const mark = this.campaign.events({ limit: 1 })[0]?.id ?? 0;
    const turnAtStart = this.turnState();
    const boardsAtStart = this.campaign.boardStates();

    // Parents before children, so a restore can put them back in that
    // order and nothing ever points at a thing that isn't there yet.
    const cleared: { entity: Entity; parent?: string }[] = [];
    const gone = new Set<string>();
    const walk = (parentId: string, entity: Entity) => {
      cleared.push({ entity, parent: parentId });
      gone.add(entity.id);
      for (const child of this.campaign.children(entity.id)) walk(entity.id, child);
    };
    for (const entity of doomed) walk(root.id, entity);

    const tokens = boardsAtStart.reduce(
      (n, { data }) => n + countEntities(data, gone),
      0,
    );

    for (const entity of doomed) {
      if (this.campaign.get(entity.id)) this.remove(entity.id, actor);
    }

    // What the cascade left standing: the party's rows, and whatever
    // label somebody typed in by hand. Round back to one, because the
    // next fight starts at the top.
    const before = this.turnState();
    const emptied: TurnState = { order: [], turn: null, round: 1 };
    if (before.order.length || before.turn !== null || before.round !== 1 || before.rolling) {
      this.campaign.putTurnState(emptied, actor, {
        op: 'clear',
        before,
        after: emptied,
      });
      this.changed('turn');
    }

    const events = this.campaign
      .events({ limit: UNDO_WINDOW })
      .filter((e) => e.id > mark)
      .map((e) => e.id);
    const boardsBefore = boardsAtStart.filter(({ boardId: id, data }) => {
      const now = this.campaign.boardState(id);
      return JSON.stringify(now ?? null) !== JSON.stringify(data ?? null);
    });
    this.campaign.append(null, actor, 'table.cleared', {
      cleared,
      cascade: {
        events,
        turn: turnAtStart,
        ...(boardsBefore.length ? { boards: boardsBefore } : {}),
      },
    });
    this.changed('events');

    return { cleared: doomed.length, tokens, order: turnAtStart.order.length };
  }

  /**
   * The board the table is looking at, by id — one ordinary manifest
   * ref (`refs.board`). Null means the table sits idle, which is an
   * ordinary state and not a fault.
   */
  activeBoardId(): string | null {
    const ref = this.campaign.root().refs?.board;
    const id = Array.isArray(ref) ? ref[0]?.id : ref?.id;
    return id ?? null;
  }

  move(id: string, parentId: string, actor: string): void {
    this.campaign.move(id, parentId, actor);
    this.changed('entities');
  }

  /** The entity as a player reads it — template underneath, stored on top. */
  reading(entity: Entity): Entity {
    return resolve(entity, this.loaded.templateOf(...STAMP_SLOTS));
  }

  /**
   * Resolve-with-sparse-write — the seat's one door (§7's grammar with
   * §14's economy). The player edits the READING; the store keeps only
   * what was touched. Touching an entry that lives only in the template
   * copies exactly that entry down first, so its max and its spelling
   * survive without the whole template thickening in. The write itself
   * goes through `setEntry`, so a declared kind's zero-rule applies the
   * same here as everywhere.
   */
  writeEntry(entityId: string, edit: EntryEdit, actor: string): Entity | undefined {
    const entity = this.campaign.get(entityId);
    if (!entity) return undefined;
    const lists = { ...entity.lists };
    let stored = [...(lists[edit.list] ?? [])];

    if (edit.remove) {
      stored = withoutEntry(stored, edit.name);
    } else {
      if (!findEntry(stored, edit.name)) {
        const read = this.reading(entity);
        const prior = findEntry(read.lists[edit.list] ?? [], edit.name);
        if (prior) stored = [...stored, { ...prior }];
      }
      const kinds = this.loaded
        .declarations('kinds')
        .map(toKindDef)
        .filter((k): k is KindDef => k !== undefined);
      stored = setEntry(stored, edit.name, edit.value, kindFor(kinds, edit.list));
      if (edit.max !== undefined) {
        stored = stored.map((e) => {
          if (!sameName(e, edit.name)) return e;
          const { max: _dropped, ...rest } = e;
          return edit.max === null ? rest : { ...rest, max: edit.max };
        });
      }
    }

    if (stored.length) lists[edit.list] = stored;
    else delete lists[edit.list];
    const saved = this.campaign.save({ ...entity, lists }, actor);
    this.changed('entities');
    return saved;
  }

  // -- the turn order (rule 5) ------------------------------------------

  turnState(): TurnState {
    return toTurnState(this.campaign.turnState());
  }

  turnOp(op: TurnOp, actor: string): TurnState {
    const before = this.turnState();
    const next = applyTurnOp(before, op);
    // The whole state, both sides — an accidental "next turn" mid-fight
    // is the headline thing a DM undoes, and an op name alone can't be
    // inverted (rule 3's payoff: `/undo` reads the log, it doesn't
    // replay the ops).
    this.campaign.putTurnState(next, actor, { op: op.op, before, after: next });
    this.changed('turn');
    return next;
  }

  /** Put the order back the way it was — how `/undo` steps a turn op back. */
  restoreTurn(state: TurnState, actor: string): TurnState {
    const before = this.turnState();
    this.campaign.putTurnState(state, actor, { op: 'restore', before, after: state });
    this.changed('turn');
    return state;
  }

  /**
   * Everything this fight put on the table last time — the entities
   * carrying its `refs.encounter` mark, parents before children so a
   * restore can put them back in that order.
   *
   * The mark is what makes the reset possible at all: `refs.from` says
   * which MONSTER a foe is, and four Bark Watchers from four different
   * fights are indistinguishable by it. Anything stamped before the
   * mark existed carries none and is therefore nobody's to clear —
   * correct, and the only honest reading of a foe whose deploy nobody
   * wrote down.
   */
  #deployedBy(encounterId: string): { entity: Entity; parent?: string }[] {
    const out: { entity: Entity; parent?: string }[] = [];
    const walk = (parentId: string, marked: boolean) => {
      for (const child of this.campaign.children(parentId)) {
        const mine =
          marked || refIn(child.refs, 'encounter')?.id === encounterId;
        if (mine) out.push({ entity: child, parent: parentId });
        walk(child.id, mine);
      }
    };
    walk(this.campaign.root().id, false);
    return out;
  }

  /**
   * Deploy a prepared fight (§13: the encounter is PREP — a campaign
   * template; deploying stamps instances, and the recipe stays
   * pristine so it can run again for another posse). Each foe stamps
   * THIN and joins the turn order by link; what the fight does to them
   * is theirs, not the recipe's.
   *
   * **Deploying is a RESET, not an append.** Running the same fight
   * again means "start this fight again", so whatever THIS encounter
   * stamped last time goes first — entities, their rows in the order,
   * their tokens on every board — and then the roster is stamped
   * fresh. Without it a second press doubles the roster and a fourth
   * gives the Warden four generations of the same four foes, which is
   * how this was found (at a table, mid-fight).
   *
   * Entities the DM edited since the last deploy are still THIS
   * encounter's and clear with the rest — that is what starting again
   * means, and the event log keeps their story either way (rule 3).
   *
   * The whole thing is ONE action in the log: every row it writes is
   * named by a single `encounter.deployed` event carrying the state it
   * replaced, so `/undo` peels the generation back in one press exactly
   * the way a delete's cascade does (`server/undo.ts`).
   */
  deployEncounter(
    encounterId: string,
    actor: string,
  ): DeployResult | undefined {
    const raw = this.campaign.templateRaw(encounterId);
    if (!raw || typeof raw !== 'object') return undefined;
    const enc = raw as { name?: string; foes?: EncounterFoe[] };

    // Everything below this rowid is this deploy's own work — the
    // high-water mark `/undo` uses, for the same reason.
    const mark = this.campaign.events({ limit: 1 })[0]?.id ?? 0;
    const turnAtStart = this.turnState();
    const boardsAtStart = this.campaign.boardStates();

    // -- the reset. The cascade machinery does the work: `remove` takes
    // each foe's turn row and its tokens with it, one logged write at a
    // time, and the payload below claims all of them.
    const cleared = this.#deployedBy(encounterId);
    for (const { entity } of cleared) {
      if (this.campaign.get(entity.id)) this.remove(entity.id, actor);
    }

    const deployed: Entity[] = [];
    const missing: MissingFoe[] = [];
    // Where each one starts, when the recipe said — collected as the
    // foes stamp so a token lands on the instance, not the template.
    const standing: Deploying[] = [];
    for (const foe of enc.foes ?? []) {
      if (!foe.templateId) continue;
      // A foe whose template is missing is REPORTED BY NAME. It used to
      // be skipped in silence and show up as the count coming up short,
      // which is a fact nobody was counting: "you don't have this" beats
      // an encounter that deploys half-empty at the table (rule 9).
      const template = this.loaded.templateOf('bestiary')(foe.templateId);
      if (!template) {
        const named = foe.name?.trim();
        missing.push({ templateId: foe.templateId, ...(named ? { name: named } : {}) });
        continue;
      }
      const count = Math.max(1, Math.min(50, Math.floor(foe.count ?? 1)));
      const base = foe.name?.trim() || template.name;
      for (let n = 1; n <= count; n++) {
        const entity = this.stampFrom('bestiary', foe.templateId, actor, {
          name: count > 1 ? `${base} ${n}` : base,
          refs: { encounter: { id: encounterId, name: enc.name?.trim() || 'a fight' } },
        });
        if (!entity) continue;
        deployed.push(entity);
        if (typeof foe.u === 'number' && typeof foe.v === 'number') {
          standing.push({
            entityId: entity.id,
            u: foe.u,
            v: foe.v,
            ...(foe.hidden === true ? { hidden: true } : {}),
          });
        }
      }
    }
    const before = this.turnState();
    let turn = before;
    for (const entity of deployed) {
      turn = applyTurnOp(turn, { op: 'add', entityId: entity.id });
    }
    this.campaign.putTurnState(turn, actor, { op: 'deploy', before, after: turn });
    this.changed('turn');

    // The other half of deploying: a fight that wrote down where
    // everyone stands should put them there. A foe with no `u`/`v`
    // simply joins the order, which is the mapless fight and not a
    // degraded one — but a fight that DID say where, on a table with no
    // board up, says so out loud rather than dropping the positions on
    // the floor.
    const boardId = this.activeBoardId();
    const board = boardId && this.shelf.board(boardId) ? boardId : null;
    const out: DeployResult = {
      deployed,
      turn,
      board,
      placed: 0,
      cleared: cleared.length,
      missing,
    };
    if (standing.length && !board) {
      out.unplaced = boardId
        ? `no board ${boardId} on this host — ${standing.length} foe(s) joined the order with nowhere to stand`
        : `no active board — ${standing.length} foe(s) joined the order with nowhere to stand`;
    } else if (standing.length && board) {
      const { data, placed } = withDeployed(this.campaign.boardState(board), standing);
      if (placed) this.putBoardState(board, data, actor);
      out.placed = placed;
    }

    // One row for the whole action. It carries the table as it was —
    // the generation that went, where everyone was standing, whose turn
    // it was — and claims every log row this deploy wrote, so the press
    // AFTER the undo steps past them instead of re-undoing what it
    // already put back (`server/undo.ts`, the delete cascade's law).
    const events = this.campaign
      .events({ limit: UNDO_WINDOW })
      .filter((e) => e.id > mark)
      .map((e) => e.id);
    const boardsBefore = boardsAtStart.filter(({ boardId: id, data }) => {
      const now = this.campaign.boardState(id);
      return JSON.stringify(now ?? null) !== JSON.stringify(data ?? null);
    });
    this.campaign.append(encounterId, actor, 'encounter.deployed', {
      name: enc.name?.trim() || undefined,
      created: deployed.map((e) => e.id),
      cleared,
      cascade: {
        events,
        turn: turnAtStart,
        ...(boardsBefore.length ? { boards: boardsBefore } : {}),
      },
    });
    this.changed('events');
    return out;
  }

  /**
   * The board as it stands — and, beside it, WHO MOVED to make it so.
   *
   * `board.updated` says a board changed and not one thing about the
   * fight, which is why a proposer asked who had closed on it could
   * only be told nothing. So every write is diffed against the state it
   * replaces and each genuine step gets its own record row (rule 3),
   * filed against whoever took it.
   *
   * It is a RECORD, in `server/undo.ts`'s exact sense: the placement it
   * describes is already in the board's own row, and undoing the note
   * would either do nothing or undo the move twice. And it is narrow on
   * purpose — a drag arrives as a whole-state PUT carrying fog, paint
   * and the table's aim as well, so a write that repainted a zone logs
   * no movement at all (`movesBetween`).
   */
  putBoardState(boardId: string, data: unknown, actor: string): void {
    const moved = movesBetween(this.campaign.boardState(boardId), data);
    this.campaign.putBoardState(boardId, data, actor);
    if (moved.length) {
      const round = this.turnState().round;
      for (const step of moved) {
        const named = step.entityId ? this.campaign.get(step.entityId)?.name : undefined;
        const record: MoveRecord = {
          boardId,
          ...(step.placementId ? { placementId: step.placementId } : {}),
          ...(step.entityId ? { by: step.entityId } : {}),
          byName: named ?? step.label ?? 'an unnamed token',
          ...(step.hidden ? { hidden: true } : {}),
          from: step.from,
          to: step.to,
          ...(round === undefined ? {} : { round }),
        };
        this.campaign.append(step.entityId ?? null, actor, 'token.moved', record);
      }
      this.changed('events');
    }
    this.changed('board');
  }

  close(): void {
    this.room.clear();
    this.campaign.close();
    this.shelf.close();
  }
}

// ---------------------------------------------------------------------
// The host — one machine, one ACTIVE campaign, and the door between.
//
// One active campaign per host, and every screen follows it (rule 9).
// That's why this is a holder rather than a map: the table has one
// story going at a time, and a display assigned to a seat is assigned
// on the SHELF, so it survives the switch and simply refetches.
//
// The switch order matters and is the whole trick: nudge the room
// FIRST, so every screen is already on its way back for fresh data,
// then swap the session under them. The listeners live on the Room,
// not on the Session, so nothing has to reconnect.

/** The shelf key the active campaign's slug is remembered under. */
export const ACTIVE_CAMPAIGN = 'campaign';

export class Host {
  readonly shelf: Shelf;
  /** Where this host's data lives. Absent means a session built by hand (tests) — the campaign doors say 501. */
  readonly dataDir?: string;
  readonly room: Room;
  session?: Session;
  /** Loaded plugins ride the machine, not the campaign — a switch keeps them. */
  plugins: LoadedPlugin[] = [];
  pluginProblems: PluginProblem[] = [];

  constructor(shelf: Shelf, dataDir?: string, room?: Room) {
    this.shelf = shelf;
    this.dataDir = dataDir;
    this.room = room ?? new Room();
  }

  /** A host around a session someone already built — how the existing tests keep working. */
  static around(session: Session): Host {
    const host = new Host(session.shelf, session.dataDir, session.room);
    host.session = session;
    return host;
  }

  /** What this machine holds, the active one marked. */
  list(): (CampaignSummary & { active: boolean })[] {
    if (!this.dataDir) return [];
    const active = this.session?.campaign.slug;
    return campaignSummaries(this.dataDir).map((c) => ({
      ...c,
      active: c.slug === active,
    }));
  }

  setPlugins(plugins: LoadedPlugin[], problems: PluginProblem[]): void {
    this.plugins = plugins;
    // A pane that imports `system/<name>` asks the same question a
    // pack's presentation does (§M-4a), and gets the same answer in the
    // same words — asked HERE because this is the one seam where the
    // running plugins and the active campaign's system meet.
    const loaded = this.session?.loaded;
    const all = [
      ...problems,
      ...exportProblems(
        loaded?.system
          ? { name: loaded.system.name, exports: Object.keys(loaded.exports()) }
          : undefined,
        plugins.flatMap((p) =>
          p.panes
            .filter((pane) => pane.code.needs?.length)
            .map((pane) => ({ who: `pane '${pane.name}'`, needs: pane.code.needs! })),
        ),
      ),
    ];
    this.pluginProblems = all;
    if (this.session) {
      this.session.plugins = plugins;
      this.session.pluginProblems = all;
    }
  }

  /** Open an existing campaign and make it the table's. */
  activate(slug: string): Session {
    if (!this.dataDir) throw new Error('this host has no data dir');
    if (this.session?.campaign.slug === slug) return this.session;
    return this.#adopt(openCampaign(this.dataDir, slug));
  }

  /**
   * Mint one and play it — the DM just made it, so activating is what
   * they meant. The system ref is written into the manifest at birth
   * because a campaign with no system is a campaign that resolves
   * nothing; it stays editable afterwards like everything else.
   */
  start(name: string, system?: Ref): Session {
    if (!this.dataDir) throw new Error('this host has no data dir');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('a campaign needs a name');
    const campaign = createCampaign(this.dataDir, slugFor(this.dataDir, trimmed), trimmed);
    if (system) {
      const root = campaign.root();
      campaign.save({ ...root, refs: { ...root.refs, system } }, 'host');
    }
    return this.#adopt(campaign);
  }

  #adopt(campaign: Campaign): Session {
    // The room hears about it BEFORE the swap: a screen that refetches
    // early gets the old answer and refetches again on the second
    // nudge, where one that hears nothing sits on a stale table.
    this.room.changed('campaign');
    const previous = this.session;
    const session = new Session(this.shelf, campaign, this.dataDir, this.room);
    session.plugins = this.plugins;
    session.pluginProblems = this.pluginProblems;
    this.session = session;
    if (previous) previous.campaign.close();
    this.shelf.setSetting(ACTIVE_CAMPAIGN, campaign.slug);
    this.room.changed('campaign');
    return session;
  }
}
