// Where everything lives. `docs/CORE-NEXT.md` §11/§12.
//
// Two kinds of database, split exactly on rule 9's line:
//
//   * `shelf.db` — this MACHINE's assets: systems, packs, books,
//     boards, the room's displays. What a publisher wrote stays put.
//   * `campaigns/<slug>.db` — one campaign, whole: its entities, its
//     event log, its live board state. What you wrote travels — backup
//     is copying one file, and a campaign can live on a stick you
//     carry.
//
// The campaign is the FILE. There is no campaigns table, no `cmp_` id
// scoping every request, no root_id column anywhere — scoping IS the
// file, and boot-time loading is the resolution law finding its home.
// The manifest (name, system ref, pack order, party resources) is the
// root entity row, `parent_id IS NULL`.
//
// One runtime (§16): this is `node:sqlite` directly — no D1 interface,
// no boolean coercion shim, nothing pretending it might run somewhere
// else. Cloudflare is a brochure.
//
// Raw rows never cross this module's boundary (rule 8): everything out
// goes through the forgiving coercers, everything in is written strict.
// And every mutation appends to the event log (rule 3) — created,
// updated and deleted each carry enough of the before/after to walk
// backward from, because `/undo` is a reader of this table, not a
// feature bolted on later.

import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from './id.ts';
import { refIn, toEntity, type Entity, type Ref } from './entity.ts';
import { toAreas, type Area } from './fog.ts';

const now = () => new Date().toISOString();

/**
 * A campaign file's name on disk. Lowercase words and dashes only —
 * this is a FILENAME, and a slug that could walk out of `campaigns/`
 * is not a campaign, it's a path traversal.
 */
export function validSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

function assertSlug(slug: string): void {
  if (!validSlug(slug)) {
    throw new Error(
      `not a campaign slug: ${JSON.stringify(slug)} (lowercase letters, digits and dashes)`,
    );
  }
}

function open(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

// ---------------------------------------------------------------------
// The campaign file.

const CAMPAIGN_SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  type       TEXT,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entities_parent ON entities(parent_id);
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  entity_id  TEXT,
  actor      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_entity ON events(entity_id);
CREATE TABLE IF NOT EXISTS board_state (
  board_id   TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  slot       TEXT NOT NULL,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS templates_slot ON templates(slot);
CREATE TABLE IF NOT EXISTS turn_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export type EventRow = {
  id: number;
  entityId: string | null;
  actor: string;
  kind: string;
  payload: unknown;
  createdAt: string;
};

/** What goes into a fresh entity — everything but the minted id. */
export type EntityDraft = Omit<Entity, 'id'> & { id?: string };

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function rowToEntity(row: Row): Entity {
  const data = (parseJson(row.data) ?? {}) as Record<string, unknown>;
  const entity = toEntity({
    ...data,
    id: row.id,
    name: row.name,
    type: row.type ?? undefined,
  });
  // The row held a name, so coercion cannot refuse it; the fallback is
  // for the type system, not for a path that runs.
  return entity ?? { id: String(row.id), name: String(row.name), lists: {} };
}

function rowToEvent(row: Row): EventRow {
  return {
    id: Number(row.id),
    entityId: row.entity_id === null ? null : String(row.entity_id),
    actor: String(row.actor),
    kind: String(row.kind),
    payload: parseJson(row.payload),
    createdAt: String(row.created_at),
  };
}

/** The blob half of an entity — promoted columns stripped, never stored twice. */
function blobOf(entity: Entity): string {
  const { id: _id, name: _name, type: _type, ...data } = entity;
  return JSON.stringify(data);
}

export class Campaign {
  #db: DatabaseSync;
  readonly slug: string;

  constructor(db: DatabaseSync, slug: string) {
    this.#db = db;
    this.slug = slug;
  }

  /** The manifest — the root entity, `parent_id IS NULL`. */
  root(): Entity {
    const row = this.#db
      .prepare('SELECT * FROM entities WHERE parent_id IS NULL')
      .get() as Row | undefined;
    if (!row) throw new Error(`campaign ${this.slug} has no manifest row`);
    return rowToEntity(row);
  }

  get(id: string): Entity | undefined {
    const row = this.#db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  /** Promoted children, oldest first — inline ones live in the parent's blob. */
  children(parentId: string): Entity[] {
    const rows = this.#db
      .prepare(
        'SELECT * FROM entities WHERE parent_id = ? ORDER BY created_at, id',
      )
      .all(parentId) as Row[];
    return rows.map(rowToEntity);
  }

  /** Who a promoted entity is contained by, or nothing at the root. */
  parentOf(id: string): string | undefined {
    const row = this.#db
      .prepare('SELECT parent_id FROM entities WHERE id = ?')
      .get(id) as Row | undefined;
    return row?.parent_id ?? undefined;
  }

  /**
   * A new promoted entity. No parent means a child of the manifest —
   * an entity floating outside the tree isn't a thing.
   */
  create(draft: EntityDraft, actor: string, parentId?: string): Entity {
    const parent = parentId ?? this.root().id;
    const entity = toEntity({ ...draft, id: draft.id ?? newId('ent') });
    if (!entity) throw new Error('an entity needs at least a name');
    const at = now();
    this.#db
      .prepare(
        `INSERT INTO entities (id, parent_id, name, type, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entity.id,
        parent,
        entity.name,
        entity.type ?? null,
        blobOf(entity),
        at,
        at,
      );
    this.append(entity.id, actor, 'entity.created', { after: entity });
    return entity;
  }

  /** Write an entity back, whole. The stored value is the authority; this is how a human types over anything. */
  save(entity: Entity, actor: string): Entity {
    const before = this.get(entity.id);
    if (!before) throw new Error(`no entity ${entity.id} to save`);
    this.#db
      .prepare(
        'UPDATE entities SET name = ?, type = ?, data = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        entity.name,
        entity.type ?? null,
        blobOf(entity),
        now(),
        entity.id,
      );
    this.append(entity.id, actor, 'entity.updated', { before, after: entity });
    return entity;
  }

  /**
   * Delete an entity and everything promoted under it — containment
   * means the nested things go with their owner. One event per row, so
   * the log can put every one of them back.
   *
   * `extra` rides on the TOP row's payload only, and is how a caller
   * says what else this one deletion took with it — the turn order it
   * was standing in, the boards it was standing on. It belongs to the
   * deletion rather than to a row of its own so that ONE undo puts the
   * whole thing back (`server/session.ts`, `server/undo.ts`); a foe
   * restored without its place in the fight is half a restore.
   */
  remove(id: string, actor: string, extra?: Record<string, unknown>): void {
    for (const child of this.children(id)) this.remove(child.id, actor);
    const before = this.get(id);
    if (!before) return;
    // The parent rides along because the row it lived under is not IN
    // the row — and a restore that forgot it would put the thing back
    // at the root, which is a different table than the one deleted.
    const parent = this.parentOf(id);
    this.#db.prepare('DELETE FROM entities WHERE id = ?').run(id);
    this.append(id, actor, 'entity.deleted', { before, parent, ...(extra ?? {}) });
  }

  /**
   * Reparent a promoted entity — handing the pistol over IS this, and
   * its history rides along because history lives here, keyed by the
   * id that didn't change.
   */
  move(id: string, parentId: string, actor: string): void {
    const before = this.parentOf(id);
    if (before === undefined && this.get(id) === undefined) {
      throw new Error(`no entity ${id} to move`);
    }
    this.#db
      .prepare('UPDATE entities SET parent_id = ?, updated_at = ? WHERE id = ?')
      .run(parentId, now(), id);
    this.append(id, actor, 'entity.moved', { from: before, to: parentId });
  }

  // -- the event log --------------------------------------------------

  /** Rule 3, as an API: who, what, payload. App-level kinds (`turn.resolved`) come through here too. */
  append(
    entityId: string | null,
    actor: string,
    kind: string,
    payload?: unknown,
  ): void {
    this.#db
      .prepare(
        'INSERT INTO events (entity_id, actor, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        entityId,
        actor,
        kind,
        payload === undefined ? null : JSON.stringify(payload),
        now(),
      );
  }

  /** Newest first — the shape `/undo` walks. */
  events(opts: { entityId?: string; limit?: number } = {}): EventRow[] {
    const limit = opts.limit ?? 100;
    const rows = (
      opts.entityId
        ? this.#db
            .prepare(
              'SELECT * FROM events WHERE entity_id = ? ORDER BY id DESC LIMIT ?',
            )
            .all(opts.entityId, limit)
        : this.#db
            .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
            .all(limit)
    ) as Row[];
    return rows.map(rowToEvent);
  }

  // -- the campaign's template half (§13) ------------------------------
  //
  // Its OWN bestiary, statuses, catalog: the campaign's contribution to
  // the merge, authored content that travels with the file. §12 first
  // said this "lives in the manifest", and contact said no: the
  // manifest is an entity row, and entity-shaped content cannot pass
  // through a coercer whose leaves are strictly name/value. So the
  // template half gets ONE table — the SLOT ('bestiary' · 'statuses' ·
  // 'catalog' · …) is a column and the format's word, never a table
  // per type. Rows store whatever was authored, whole; the columns are
  // just what the merge addresses them by.

  /**
   * Author or amend one of this campaign's own template entries. The
   * id is identity (a row restating a pack's id is how the campaign
   * overrides that monster); minted here when the thing is new.
   */
  putTemplate(slot: string, raw: unknown, actor: string): { id: string } {
    if (!raw || typeof raw !== 'object') {
      throw new Error('a template needs at least a name');
    }
    const o = raw as Record<string, unknown>;
    const name = String(o.name ?? '').trim();
    if (!name) throw new Error('a template needs at least a name');
    const id = String(o.id ?? '').trim() || newId('tpl');
    const at = now();
    const before = this.templateRaw(id);
    this.#db
      .prepare(
        `INSERT INTO templates (id, slot, name, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           slot = excluded.slot, name = excluded.name,
           data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(id, slot, name, JSON.stringify({ ...o, id, name }), at, at);
    this.append(id, actor, 'template.updated', { slot, before, after: o });
    return { id };
  }

  /** The authored object, as written — the format reads its own shape out of this. */
  templateRaw(id: string): unknown {
    const row = this.#db
      .prepare('SELECT data FROM templates WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? parseJson(row.data) : undefined;
  }

  /** One slot's authored objects, oldest first — a merge layer, ready to stack. */
  templatesIn(slot: string): unknown[] {
    const rows = this.#db
      .prepare(
        'SELECT data FROM templates WHERE slot = ? ORDER BY created_at, id',
      )
      .all(slot) as Row[];
    return rows.map((r) => parseJson(r.data)).filter((d) => d !== undefined);
  }

  /**
   * The whole template half, slot and all — what a `.story` has to
   * carry, and the one reading that cannot be spelled with
   * `templatesIn`.
   *
   * A slot is the FORMAT's word, not Core's (§10), so nothing in core
   * knows the list of them; asking for "every slot" by naming them
   * would put 'bestiary' and 'encounters' in a file whose whole point
   * is that it doesn't know what those mean. So the table answers
   * instead, and the export stays as ignorant as the store is.
   */
  allTemplates(): { id: string; slot: string; name: string; data: unknown }[] {
    const rows = this.#db
      .prepare('SELECT id, slot, name, data FROM templates ORDER BY created_at, id')
      .all() as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      slot: String(r.slot),
      name: String(r.name),
      data: parseJson(r.data),
    }));
  }

  removeTemplate(id: string, actor: string): void {
    const before = this.templateRaw(id);
    if (before === undefined) return;
    // The slot is a column, not part of what was authored — so it is
    // logged, or nothing could ever put the row back where it was.
    const row = this.#db
      .prepare('SELECT slot FROM templates WHERE id = ?')
      .get(id) as Row | undefined;
    const slot = row ? String(row.slot) : undefined;
    this.#db.prepare('DELETE FROM templates WHERE id = ?').run(id);
    this.append(id, actor, 'template.deleted', { slot, before });
  }

  // -- live board state -----------------------------------------------
  //
  // Placements, fog and view for one board — the session-state half of
  // §4. It lives HERE, next to the entities the placements point at.
  //
  // It DOES travel in a `.story`, as a section like every other, on by
  // default (TEL-87, 2026-08-19). This comment used to say "never",
  // reasoning that exporting mid-fight must not ship token positions
  // and revealed fog — which was teller deciding what somebody's export
  // was for. An export is equally a BACKUP, and a backup that forgets
  // where everyone was standing restores the wrong table. So the
  // format stopped having an opinion and the person got a switch:
  // untick the live sections for anything you hand somebody.

  boardState(boardId: string): unknown {
    const row = this.#db
      .prepare('SELECT data FROM board_state WHERE board_id = ?')
      .get(boardId) as Row | undefined;
    return row ? parseJson(row.data) : undefined;
  }

  /** Every board this campaign has state for — the boards it has actually played on. */
  boardStates(): { boardId: string; data: unknown }[] {
    const rows = this.#db
      .prepare('SELECT board_id, data FROM board_state ORDER BY board_id')
      .all() as Row[];
    return rows.map((r) => ({
      boardId: String(r.board_id),
      data: parseJson(r.data),
    }));
  }

  putBoardState(boardId: string, data: unknown, actor: string): void {
    this.#db
      .prepare(
        `INSERT INTO board_state (board_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(board_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(boardId, JSON.stringify(data ?? null), now());
    this.append(boardId, actor, 'board.updated');
  }

  clearBoardState(boardId: string, actor: string): void {
    this.#db.prepare('DELETE FROM board_state WHERE board_id = ?').run(boardId);
    this.append(boardId, actor, 'board.cleared');
  }

  /**
   * The live turn order (rule 5): an ordered list, a current index, a
   * round — one row, whole. Ops are the caller's business; the store
   * keeps the fact and logs the change like every other fact (rule 3 —
   * which the old world's DO never did for initiative).
   */
  turnState(): unknown {
    const row = this.#db
      .prepare('SELECT data FROM turn_state WHERE id = 1')
      .get() as Row | undefined;
    return row ? parseJson(row.data) : undefined;
  }

  putTurnState(
    data: unknown,
    actor: string,
    op?: string | { op?: string; before?: unknown; after?: unknown },
  ): void {
    this.#db
      .prepare(
        `INSERT INTO turn_state (id, data, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(data ?? null), now());
    // A caller that hands over the whole before/after keeps the op
    // undoable; a bare op name is still accepted and logs what it
    // always did (the row is then a record, not a step back).
    const payload = typeof op === 'string' ? { op } : op;
    this.append(null, actor, 'turn.updated', payload || undefined);
  }

  close(): void {
    this.#db.close();
  }
}

/**
 * Mint a campaign. Explicit, and separate from opening on purpose: a
 * typo'd slug must not quietly become an empty campaign, the same
 * posture that keeps bare `teller` from starting a server.
 */
export function createCampaign(
  dataDir: string,
  slug: string,
  name: string,
  actor = 'host',
): Campaign {
  assertSlug(slug);
  const dir = join(dataDir, 'campaigns');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.db`);
  const db = open(path);
  db.exec(CAMPAIGN_SCHEMA);
  const campaign = new Campaign(db, slug);
  const has = db
    .prepare('SELECT id FROM entities WHERE parent_id IS NULL')
    .get();
  if (has) {
    db.close();
    throw new Error(`campaign ${slug} already exists`);
  }
  const at = now();
  const id = newId('ent');
  db.prepare(
    `INSERT INTO entities (id, parent_id, name, type, data, created_at, updated_at)
     VALUES (?, NULL, ?, 'campaign', '{}', ?, ?)`,
  ).run(id, name, at, at);
  campaign.append(id, actor, 'campaign.created', { name });
  return campaign;
}

export function openCampaign(dataDir: string, slug: string): Campaign {
  assertSlug(slug);
  const path = join(dataDir, 'campaigns', `${slug}.db`);
  // Opening a database CREATES the file, and a typo'd slug must not
  // quietly become an empty campaign — so existence is checked first.
  if (!existsSync(path)) {
    throw new Error(`no campaign ${slug} in ${dataDir} (teller host lists them)`);
  }
  const db = open(path);
  db.exec(CAMPAIGN_SCHEMA);
  return new Campaign(db, slug);
}

/**
 * One campaign, read from the outside — enough to put a row on the
 * campaign screen without opening the whole thing. The system arrives
 * as the ref the manifest declared (id + the name it cached); whether
 * that ref RESOLVES is the shelf's business, not this list's.
 */
export type CampaignSummary = { slug: string; name: string; system?: Ref };

/**
 * Every campaign on this machine, summarised. Each file is opened,
 * read and closed — a campaign that won't open is reported by its
 * slug alone rather than vanishing from the list ("you don't have
 * this" beats forgetting it existed, applied to a broken file).
 */
export function campaignSummaries(dataDir: string): CampaignSummary[] {
  return listCampaigns(dataDir).map((slug) => {
    try {
      const campaign = openCampaign(dataDir, slug);
      try {
        const root = campaign.root();
        const system = refIn(root.refs, 'system');
        return system ? { slug, name: root.name, system } : { slug, name: root.name };
      } finally {
        campaign.close();
      }
    } catch {
      return { slug, name: slug };
    }
  });
}

/**
 * A filename for a campaign someone just named. Derived, never typed:
 * the DM types "The Unlikely Duo" and the file is `the-unlikely-duo`.
 * A name that reduces to nothing still gets a file, and a slug already
 * taken gets a number — two campaigns may share a name, but never a
 * file.
 */
export function slugFor(dataDir: string, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/^-+/, '') || 'campaign';
  const taken = new Set(listCampaigns(dataDir));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** What's on this machine — the list bare `teller host` offers. */
export function listCampaigns(dataDir: string): string[] {
  try {
    return readdirSync(join(dataDir, 'campaigns'))
      .filter((f) => f.endsWith('.db'))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Where a deleted campaign goes. Not a table, not a flag on a row —
 * the campaign IS the file (§11), so the honest reversible delete is
 * a MOVE, and the trash is a folder beside the live ones.
 *
 * It sits inside `campaigns/` deliberately: a campaign on a stick you
 * carry takes its own wastebasket with it, and `listCampaigns` already
 * reads only `*.db` so a directory here is invisible to every other
 * reader.
 */
export const TRASH_DIR = '.trash';

/** A campaign file's WAL companions — moved with it, or the move loses writes. */
const DB_SIBLINGS = ['', '-wal', '-shm'];

/** Where a delete put it, so the route can say so out loud. */
export type TrashedCampaign = { slug: string; path: string };

/**
 * Delete a campaign — by moving its file to `campaigns/.trash/`.
 *
 * Unlinking a campaign is unlinking somebody's whole table: every
 * character, every scene, the entire event log that `/undo` walks
 * (rule 3), in one press. So this is a move, and the caller is told
 * the path so "where did it go" has an answer that isn't archaeology.
 * Recovering one is a `mv` — the same operation backing a campaign up
 * has always been.
 *
 * The caller decides whether the campaign may go at all; this function
 * knows nothing about which one is being played. Opening it is the
 * server's job and so is refusing (`server/index.ts`).
 */
export function trashCampaign(dataDir: string, slug: string): TrashedCampaign {
  assertSlug(slug);
  const dir = join(dataDir, 'campaigns');
  const from = join(dir, `${slug}.db`);
  if (!existsSync(from)) {
    throw new Error(`no campaign ${slug} in ${dataDir}`);
  }
  const trash = join(dir, TRASH_DIR);
  mkdirSync(trash, { recursive: true });
  // ISO, with the colons taken out: the instant is the point, and a
  // filename carrying `:` is a filename some tool somewhere mangles.
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  const to = join(trash, `${slug}-${at}.db`);
  for (const suffix of DB_SIBLINGS) {
    const side = `${from}${suffix}`;
    if (existsSync(side)) renameSync(side, `${to}${suffix}`);
  }
  return { slug, path: to };
}

/**
 * Rename a campaign — which means renaming the FILE, because the file
 * is the identity (§11). The manifest's `name` is a different fact
 * with a different door; this one is about what the campaign is called
 * on disk and in every url that names it.
 *
 * A slug already taken is refused rather than merged: two campaigns
 * may share a name, never a file (`slugFor` has said so since the
 * beginning), and silently swallowing one is the worst reading of
 * "rename".
 */
export function renameCampaign(dataDir: string, from: string, to: string): void {
  assertSlug(from);
  assertSlug(to);
  const dir = join(dataDir, 'campaigns');
  const before = join(dir, `${from}.db`);
  if (!existsSync(before)) {
    throw new Error(`no campaign ${from} in ${dataDir}`);
  }
  if (from === to) return;
  const after = join(dir, `${to}.db`);
  if (existsSync(after)) {
    throw new Error(`a campaign is already called ${to} — pick another name`);
  }
  for (const suffix of DB_SIBLINGS) {
    const side = `${before}${suffix}`;
    if (existsSync(side)) renameSync(side, `${after}${suffix}`);
  }
}

// ---------------------------------------------------------------------
// The shelf.

const SHELF_SCHEMA = `
CREATE TABLE IF NOT EXISTS systems (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  builtin    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS packs (
  id         TEXT PRIMARY KEY,
  system     TEXT,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  pages      INTEGER,
  indexed    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS book_pages (
  book_id    TEXT NOT NULL,
  page       INTEGER NOT NULL,
  text       TEXT NOT NULL,
  PRIMARY KEY (book_id, page)
);
-- Book search that knows what a word is (old world's migration 0006,
-- ported because the reasoning is unchanged). A LIKE '%q%' is
-- substring matching: "cover" hits "uncovered" and "discovery", so a
-- real question drowns. FTS5's tokenizer matches whole words, the
-- porter stemmer means "grapple" finds "grappled", and bm25() ranks,
-- which is what makes a cap mean "the best forty" instead of "the
-- first forty".
--
-- book_pages stays the source of truth; this is an EXTERNAL-CONTENT
-- index over it, kept in step by triggers — one copy of the text, and
-- anything that writes pages updates search for free.
CREATE VIRTUAL TABLE IF NOT EXISTS book_fts USING fts5(
  text,
  content = 'book_pages',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);
-- External-content tables don't read the content table on write; they
-- are TOLD what changed, and a 'delete' row must carry the OLD text —
-- which is why update deletes-then-inserts rather than just inserting.
CREATE TRIGGER IF NOT EXISTS book_pages_ai AFTER INSERT ON book_pages BEGIN
  INSERT INTO book_fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS book_pages_ad AFTER DELETE ON book_pages BEGIN
  INSERT INTO book_fts (book_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS book_pages_au AFTER UPDATE ON book_pages BEGIN
  INSERT INTO book_fts (book_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO book_fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TABLE IF NOT EXISTS boards (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL,
  name          TEXT NOT NULL,
  width_inches  REAL,
  grid          TEXT,
  -- Named patches of the map (core/fog.ts). Inherent geography, so it
  -- sits on the asset beside the calibration and not in the fight: the
  -- vault is where it is next campaign too.
  areas         TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugins (
  id         TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 0,
  config     TEXT,
  -- The needs, AS WRITTEN, that a human was shown when they said yes.
  -- Enablement is consent to a specific list (§15); without recording
  -- the list, a plugin could widen what it touches after the fact and
  -- the agreement would silently cover it.
  wants      TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS displays (
  id              TEXT PRIMARY KEY,
  name            TEXT,
  color           TEXT,
  role            TEXT NOT NULL DEFAULT 'blank',
  params          TEXT,
  code            TEXT,
  code_expires_at TEXT,
  last_seen_at    TEXT,
  ppi             REAL,
  ppi_y           REAL,
  vw              INTEGER,
  vh              INTEGER,
  position        INTEGER
);
`;

/** A board asset — the reusable half of §4. Same category as a book: the campaign references it by id. */
export type Board = {
  id: string;
  /** The image, by content key on disk. */
  key: string;
  name: string;
  widthInches?: number;
  grid?: unknown;
  /**
   * Named patches of the map — the layer fog lifts by name and terrain
   * will claim later (docs/BATTLEMAP-NEXT.md). Prep-authored and
   * campaign-independent, which is why it rides the shelf row; what a
   * fight did to one is `board_state`.
   */
  areas?: Area[];
};


// ---------------------------------------------------------------------
// The room's screens (rule 7).
//
// A display's `id` is capability-bearing — it is what the server checks
// — so it gets real entropy and is never rendered anywhere. The pairing
// `code` is the opposite: short, readable across a lit room, and
// short-lived; it only ever means "adopt this screen", never "grant
// this power". A display with NO code has been adopted — the code is
// consumed by the claim, and a deleted display simply introduces
// itself again as a stranger.

export type DisplayRole =
  | 'console'
  | 'table'
  | 'board'
  | 'art'
  | 'seat'
  | 'badge'
  | 'blank';

export type Display = {
  id: string;
  name?: string;
  color?: string;
  role: DisplayRole;
  /** The assignment's details — `entityId` for a seat, `pane` for a console slice. */
  params: Record<string, unknown>;
  code?: string;
  codeExpiresAt?: string;
  lastSeenAt?: string;
  ppi?: number;
  ppiY?: number;
  viewport?: { w: number; h: number };
  /** The DM's own ordering of the room — assigned at adoption, moved by arrows. */
  position?: number;
};

const DISPLAY_ROLES: DisplayRole[] = [
  'console',
  'table',
  'board',
  'art',
  'seat',
  'badge',
  'blank',
];

export function isDisplayRole(value: unknown): value is DisplayRole {
  return DISPLAY_ROLES.includes(value as DisplayRole);
}

/** No I/L/O/0/1 — this gets read aloud across a lit room. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_TTL_MIN = 15;

function newPairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

const codeExpiry = () => new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();

function rowToDisplay(row: Row): Display {
  const out: Display = {
    id: String(row.id),
    role: isDisplayRole(row.role) ? row.role : 'blank',
    params: (parseJson(row.params) as Record<string, unknown> | undefined) ?? {},
  };
  if (row.name) out.name = String(row.name);
  if (row.color) out.color = String(row.color);
  if (row.code) out.code = String(row.code);
  if (row.code_expires_at) out.codeExpiresAt = String(row.code_expires_at);
  if (row.last_seen_at) out.lastSeenAt = String(row.last_seen_at);
  if (typeof row.ppi === 'number') out.ppi = row.ppi;
  if (typeof row.ppi_y === 'number') out.ppiY = row.ppi_y;
  if (typeof row.vw === 'number' && typeof row.vh === 'number') {
    out.viewport = { w: row.vw, h: row.vh };
  }
  if (typeof row.position === 'number') out.position = row.position;
  return out;
}

function rowToBoard(row: Row): Board {
  const out: Board = {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
  };
  if (typeof row.width_inches === 'number') out.widthInches = row.width_inches;
  const grid = parseJson(row.grid);
  if (grid !== undefined) out.grid = grid;
  const areas = toAreas(parseJson(row.areas));
  if (areas.length) out.areas = areas;
  return out;
}

/**
 * A rulebook on this machine. `id` is `bok_` + the first 12 hex of the
 * sha-256 of its own bytes (rule 4a), so two people who own the same
 * book derive the same id without coordinating and a `.story` that
 * names one resolves on any host that has it.
 */
export type Book = {
  id: string;
  name: string;
  /** Pages with a text layer, once read. */
  pages: number;
  indexed: boolean;
  createdAt: string;
  /** False when the row is here but the file isn't — say so, never drop it (rule 9). */
  present?: boolean;
};

/** One page that answered a search, with the words fenced (see `searchBooks`). */
export type BookHit = {
  bookId: string;
  bookName: string;
  page: number;
  snippet: string;
};

function rowToBook(row: Row): Book {
  return {
    id: String(row.id),
    name: String(row.name),
    pages: Number(row.pages ?? 0),
    indexed: row.indexed === 1,
    createdAt: String(row.created_at),
  };
}

export class Shelf {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  // Systems and packs carry their whole template as the blob; the
  // columns are just what boot-time resolution filters by. CRUD grows
  // by contact — this is deliberately the least that lets a campaign's
  // refs resolve.

  putSystem(row: {
    id: string;
    name: string;
    version?: number;
    builtin?: boolean;
    data: unknown;
  }): void {
    const at = now();
    this.#db
      .prepare(
        `INSERT INTO systems (id, name, version, builtin, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, version = excluded.version,
           builtin = excluded.builtin, data = excluded.data,
           updated_at = excluded.updated_at`,
      )
      .run(
        row.id,
        row.name,
        row.version ?? 1,
        row.builtin ? 1 : 0,
        JSON.stringify(row.data ?? {}),
        at,
        at,
      );
  }

  system(id: string): { id: string; name: string; version: number; data: unknown } | undefined {
    const row = this.#db
      .prepare('SELECT * FROM systems WHERE id = ?')
      .get(id) as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      name: String(row.name),
      version: Number(row.version),
      data: parseJson(row.data) ?? {},
    };
  }

  putPack(row: {
    id: string;
    system?: string;
    name: string;
    version?: number;
    data: unknown;
  }): void {
    const at = now();
    this.#db
      .prepare(
        `INSERT INTO packs (id, system, name, version, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           system = excluded.system, name = excluded.name,
           version = excluded.version, data = excluded.data,
           updated_at = excluded.updated_at`,
      )
      .run(
        row.id,
        row.system ?? null,
        row.name,
        row.version ?? 1,
        JSON.stringify(row.data ?? {}),
        at,
        at,
      );
  }

  pack(id: string): { id: string; system?: string; name: string; version: number; data: unknown } | undefined {
    const row = this.#db
      .prepare('SELECT * FROM packs WHERE id = ?')
      .get(id) as Row | undefined;
    if (!row) return undefined;
    const out: { id: string; system?: string; name: string; version: number; data: unknown } = {
      id: String(row.id),
      name: String(row.name),
      version: Number(row.version),
      data: parseJson(row.data) ?? {},
    };
    if (row.system) out.system = String(row.system);
    return out;
  }

  systems(): { id: string; name: string; version: number }[] {
    const rows = this.#db
      .prepare('SELECT id, name, version FROM systems ORDER BY created_at, id')
      .all() as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      version: Number(r.version),
    }));
  }

  packs(): { id: string; system?: string; name: string; version: number }[] {
    const rows = this.#db
      .prepare('SELECT id, system, name, version FROM packs ORDER BY created_at, id')
      .all() as Row[];
    return rows.map((r) => {
      const out: { id: string; system?: string; name: string; version: number } = {
        id: String(r.id),
        name: String(r.name),
        version: Number(r.version),
      };
      if (r.system) out.system = String(r.system);
      return out;
    });
  }

  removePack(id: string): void {
    this.#db.prepare('DELETE FROM packs WHERE id = ?').run(id);
  }

  packsFor(system: string): string[] {
    const rows = this.#db
      .prepare('SELECT id FROM packs WHERE system = ? ORDER BY created_at, id')
      .all(system) as Row[];
    return rows.map((r) => String(r.id));
  }

  // Plugin TRUST — enablement and per-plugin config, and nothing else.
  // Trust is a fact about this machine, so it lives on the shelf and
  // never in a campaign. A row exists only once a HUMAN acted: the
  // discovery sweep may never write here, which is how "the sweep
  // discovers; only a human enables" is structural instead of polite
  // (§15). Config generalises `assistant.json`: one blob per plugin id.

  pluginTrust(id: string): {
    enabled: boolean;
    config: unknown;
    /** What was on screen when the human said yes; undefined for a row from before this was recorded. */
    wants?: string[];
  } | undefined {
    const row = this.#db
      .prepare('SELECT * FROM plugins WHERE id = ?')
      .get(id) as Row | undefined;
    if (!row) return undefined;
    const agreed = parseJson(row.wants);
    const out: { enabled: boolean; config: unknown; wants?: string[] } = {
      enabled: row.enabled === 1,
      config: parseJson(row.config),
    };
    if (Array.isArray(agreed)) out.wants = agreed.map((w) => String(w));
    return out;
  }

  /**
   * Say yes (or take it back), recording WHAT was agreed to.
   *
   * `wants` is the needs list as the human read it. Disabling clears the
   * record, because the next yes is a new agreement about whatever the
   * manifest says by then.
   */
  setPluginEnabled(id: string, enabled: boolean, wants?: string[]): void {
    this.#db
      .prepare(
        `INSERT INTO plugins (id, enabled, wants, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, wants = excluded.wants, updated_at = excluded.updated_at`,
      )
      .run(id, enabled ? 1 : 0, enabled && wants ? JSON.stringify(wants) : null, now());
  }

  setPluginConfig(id: string, config: unknown): void {
    this.#db
      .prepare(
        `INSERT INTO plugins (id, enabled, config, updated_at) VALUES (?, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
      )
      .run(id, config === undefined ? null : JSON.stringify(config), now());
  }

  /** Every trust row a human has touched — enabled or not. Revoking
   * needs the LIST, and until this existed the only way to reach a row
   * was to already know its id. */
  pluginTrusts(): { id: string; enabled: boolean }[] {
    const rows = this.#db
      .prepare('SELECT id, enabled FROM plugins ORDER BY id')
      .all() as Row[];
    return rows.map((r) => ({ id: String(r.id), enabled: r.enabled === 1 }));
  }

  // -- the machine's own small preferences ------------------------------
  //
  // Which campaign this table is running is a fact about the MACHINE,
  // not about any campaign — so it lives here, next to the displays
  // that survive a switch (rule 9). One key/value table rather than a
  // column per preference: nothing queries these, they're read by name.

  setting(key: string): string | undefined {
    const row = this.#db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as Row | undefined;
    return row?.value === null || row?.value === undefined
      ? undefined
      : String(row.value);
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) {
      this.#db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      return;
    }
    this.#db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now());
  }

  putBoard(board: Omit<Board, 'id'> & { id?: string }): Board {
    const id = board.id ?? newId('brd');
    this.#db
      .prepare(
        `INSERT INTO boards (id, key, name, width_inches, grid, areas, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           key = excluded.key, name = excluded.name,
           width_inches = excluded.width_inches, grid = excluded.grid,
           areas = excluded.areas`,
      )
      .run(
        id,
        board.key,
        board.name,
        board.widthInches ?? null,
        board.grid === undefined ? null : JSON.stringify(board.grid),
        board.areas === undefined ? null : JSON.stringify(toAreas(board.areas)),
        now(),
      );
    return { ...board, id };
  }

  board(id: string): Board | undefined {
    const row = this.#db
      .prepare('SELECT * FROM boards WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? rowToBoard(row) : undefined;
  }

  boards(): Board[] {
    const rows = this.#db
      .prepare('SELECT * FROM boards ORDER BY created_at, id')
      .all() as Row[];
    return rows.map(rowToBoard);
  }

  removeBoard(id: string): void {
    this.#db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  }

  // -- books ------------------------------------------------------------
  //
  // The DM's own rulebooks. A book lives on the host and nowhere else:
  // it arrives once and every screen in the room can read it, with no
  // per-device import and no copy stranded in one browser's storage
  // (rule 9). Not scoped to a campaign or a system — you own the
  // books, campaigns refer to them by id.
  //
  // There is no `key` column, unlike the old world's: a book's bytes
  // live at `<data>/books/<id>.pdf` and that path is a FUNCTION of the
  // id, so storing it would only create a second thing to keep true
  // (rule 8 — a column earns its place when a query needs it).

  putBook(row: { id: string; name: string }): void {
    this.#db
      .prepare(
        `INSERT INTO books (id, name, pages, indexed, created_at)
         VALUES (?, ?, 0, 0, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(row.id, row.name, now());
  }

  book(id: string): Book | undefined {
    const row = this.#db
      .prepare('SELECT * FROM books WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? rowToBook(row) : undefined;
  }

  books(): Book[] {
    const rows = this.#db
      .prepare('SELECT * FROM books ORDER BY created_at, id')
      .all() as Row[];
    return rows.map(rowToBook);
  }

  renameBook(id: string, name: string): void {
    this.#db.prepare('UPDATE books SET name = ? WHERE id = ?').run(name, id);
  }

  /** Forget the row AND its text. The FILE is the sweep's business. */
  removeBook(id: string): void {
    this.#db.prepare('DELETE FROM book_pages WHERE book_id = ?').run(id);
    this.#db.prepare('DELETE FROM books WHERE id = ?').run(id);
  }

  /** A book's text, replacing whatever was there. The triggers keep FTS in step. */
  indexBook(id: string, pages: { page: number; text: string }[]): void {
    this.#db.exec('BEGIN');
    try {
      this.#db.prepare('DELETE FROM book_pages WHERE book_id = ?').run(id);
      const insert = this.#db.prepare(
        'INSERT INTO book_pages (book_id, page, text) VALUES (?, ?, ?)',
      );
      for (const p of pages) insert.run(id, p.page, p.text);
      this.#db
        .prepare('UPDATE books SET indexed = 1, pages = ? WHERE id = ?')
        .run(pages.length, id);
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Ranked pages, with the matched words fenced for the client.
   *
   * `match` is an FTS5 expression, already built — raw input must never
   * reach MATCH (see `ftsQuery` in `server/books.ts`). char(2)/char(3)
   * are the fences: control characters, deliberately, because they
   * can't collide with anything a PDF's text layer contains and one
   * that escaped to the DOM would render as nothing.
   */
  searchBooks(match: string, limit: number): { hits: BookHit[]; total: number } {
    const from = `FROM book_fts
        JOIN book_pages p ON p.rowid = book_fts.rowid
        JOIN books b ON b.id = p.book_id
       WHERE book_fts MATCH ?`;
    const rows = this.#db
      .prepare(
        `SELECT p.book_id, p.page, b.name,
                snippet(book_fts, 0, char(2), char(3), '…', 18) AS snip
           ${from}
         ORDER BY bm25(book_fts)
         LIMIT ${Number(limit) || 40}`,
      )
      .all(match) as Row[];
    // Ranking makes the cap honest, but only if you can see you hit it.
    const counted = this.#db
      .prepare(`SELECT COUNT(*) AS n ${from}`)
      .get(match) as Row | undefined;
    const hits = rows.map((r) => ({
      bookId: String(r.book_id),
      bookName: String(r.name),
      page: Number(r.page),
      snippet: String(r.snip),
    }));
    return { hits, total: Number(counted?.n ?? hits.length) };
  }

  // -- displays ---------------------------------------------------------

  /** Mint a fresh screen, retrying if a pairing code happens to collide. */
  createDisplay(): Display {
    for (let attempt = 0; ; attempt++) {
      const id = `dsp_${randomBytes(24).toString('hex')}`;
      try {
        this.#db
          .prepare('INSERT INTO displays (id, code, code_expires_at) VALUES (?, ?, ?)')
          .run(id, newPairingCode(), codeExpiry());
        return this.display(id)!;
      } catch (err) {
        if (attempt === 4) throw err;
      }
    }
  }

  display(id: string): Display | undefined {
    const row = this.#db
      .prepare('SELECT * FROM displays WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? rowToDisplay(row) : undefined;
  }

  displays(): Display[] {
    // The DM's own order first; screens without one (unclaimed) trail
    // by recency. Never order the room by who spoke last — rows must
    // not leap out from under the hand about to touch them.
    const rows = this.#db
      .prepare(
        'SELECT * FROM displays ORDER BY position IS NULL, position, last_seen_at IS NULL, last_seen_at DESC, id',
      )
      .all() as Row[];
    return rows.map(rowToDisplay);
  }

  /** An unclaimed screen showing this code, if the code is still alive. */
  displayByCode(code: string): Display | undefined {
    const row = this.#db
      .prepare('SELECT * FROM displays WHERE code = ? AND code_expires_at >= ?')
      .get(code.trim().toUpperCase(), now()) as Row | undefined;
    return row ? rowToDisplay(row) : undefined;
  }

  touchDisplay(id: string): void {
    this.#db.prepare('UPDATE displays SET last_seen_at = ? WHERE id = ?').run(now(), id);
  }

  /** An unclaimed screen left on overnight shouldn't show a dead code. */
  refreshCodeIfExpired(display: Display): Display {
    if (!display.code) return display; // adopted — nothing to refresh
    if (display.codeExpiresAt && display.codeExpiresAt >= now()) return display;
    this.#db
      .prepare('UPDATE displays SET code = ?, code_expires_at = ? WHERE id = ?')
      .run(newPairingCode(), codeExpiry(), display.id);
    return this.display(display.id)!;
  }

  /** Adoption consumes the code — a display with no code is the room's.
   * A newly adopted screen lands at the END of the room's order; the
   * arrows move it from there (the DM's arrangement, rule 1 for UI). */
  claimDisplay(id: string, name: string): Display {
    this.#db
      .prepare(
        'UPDATE displays SET name = ?, code = NULL, code_expires_at = NULL, position = (SELECT COALESCE(MAX(position), 0) + 1 FROM displays) WHERE id = ?',
      )
      .run(name, id);
    return this.display(id)!;
  }

  updateDisplay(
    id: string,
    patch: {
      name?: string;
      color?: string;
      role?: DisplayRole;
      params?: Record<string, unknown>;
      ppi?: number | null;
      ppiY?: number | null;
      position?: number;
    },
  ): Display {
    const have = this.display(id);
    if (!have) throw new Error(`no display ${id}`);
    this.#db
      .prepare(
        'UPDATE displays SET name = ?, color = ?, role = ?, params = ?, ppi = ?, ppi_y = ?, position = ? WHERE id = ?',
      )
      .run(
        patch.name?.trim() ?? have.name ?? null,
        patch.color ?? have.color ?? null,
        patch.role ?? have.role,
        JSON.stringify(patch.params ?? have.params),
        patch.ppi === undefined ? (have.ppi ?? null) : patch.ppi,
        patch.ppiY === undefined ? (have.ppiY ?? null) : patch.ppiY,
        patch.position === undefined ? (have.position ?? null) : patch.position,
        id,
      );
    return this.display(id)!;
  }

  removeDisplay(id: string): void {
    this.#db.prepare('DELETE FROM displays WHERE id = ?').run(id);
  }

  /**
   * Forget unclaimed screens that stopped heartbeating. A screen that
   * was never adopted was never real (rule 6: the DM types the code) —
   * every open tab mints a row, and closed tabs would pile up forever
   * otherwise. Adopted screens are NEVER expired: an assignment is the
   * DM's act and only the DM's ✕ undoes it. Ten minutes of silence is
   * generous — an unclaimed pairing screen announces every few seconds.
   */
  expireUnclaimedDisplays(maxSilenceMs = 10 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - maxSilenceMs).toISOString();
    const { changes } = this.#db
      .prepare(
        'DELETE FROM displays WHERE code IS NOT NULL AND (last_seen_at IS NULL OR last_seen_at < ?)',
      )
      .run(cutoff);
    return Number(changes);
  }

  setDisplayViewport(id: string, w: number, h: number): void {
    this.#db.prepare('UPDATE displays SET vw = ?, vh = ? WHERE id = ?').run(w, h, id);
  }

  close(): void {
    this.#db.close();
  }
}

export function openShelf(dataDir: string): Shelf {
  mkdirSync(dataDir, { recursive: true });
  const db = open(join(dataDir, 'shelf.db'));
  db.exec(SHELF_SCHEMA);
  // Columns added after a table shipped: CREATE IF NOT EXISTS won't
  // grow an existing db, so each addition is one idempotent ALTER —
  // the error when it already exists is the only signal SQLite gives.
  try {
    db.exec('ALTER TABLE displays ADD COLUMN position INTEGER');
  } catch {
    // already there
  }
  try {
    db.exec('ALTER TABLE plugins ADD COLUMN wants TEXT');
  } catch {
    // already there
  }
  try {
    db.exec('ALTER TABLE boards ADD COLUMN areas TEXT');
  } catch {
    // already there
  }
  return new Shelf(db);
}
