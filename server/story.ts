// `.story` — export and the two import doors (TEL-87).
//
// `core/bundle.ts` is the FORMAT. This is where it meets a host: what
// to gather, what a missing reference means, and what layering onto a
// running table is allowed to touch. Pure functions over a session, a
// shelf and a data dir — no routes, no sockets, the same posture as
// `public.ts` and `undo.ts`, so every one of these is testable against
// a temp directory and none of them needs a server to be right.
//
// **Two doors, and they are genuinely different operations** (TEL-87):
//
//   (a) START THIS FRESH — `importFresh` CREATES a campaign file from
//       the story. The whole campaign is stamped in, ids and all, and
//       the new file carries `refs.from` → the `sto_` id it came from.
//       This is the only door history comes through.
//
//   (b) LAYER IT ON — `importLayer` merges into a campaign that is
//       already being played. An import is a PROPOSAL, not an
//       authority: on any collision the STORED value wins (rule 1), and
//       the report says what was left alone. History never comes this
//       way — interleaving two tables' logs would hand `/undo` a chain
//       that steps sideways into somebody else's turn.
//
// A referenced pack, book or system that isn't on this host is
// REPORTED, at inspect and at import, and never silently dropped:
// "you don't have this" beats an encounter that deploys half-empty at
// the table.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MAX_ASSET_BYTES,
  STORY_VERSION,
  assembleStory,
  containsOf,
  isAssetKey,
  newStoryId,
  parseStory,
  storyFilename,
  storyKind,
  toRights,
  toSections,
  withoutUndo,
  type Rights,
  type StoryBoard,
  type StoryBody,
  type StoryEntity,
  type StoryEvent,
  type StoryFile,
  type StoryManifest,
  type StoryRef,
  type StorySections,
  type StoryTemplate,
} from '../core/bundle.ts';
import { refIn, refsIn, type Ref } from '../core/entity.ts';
import {
  createCampaign,
  slugFor,
  type Campaign,
  type Shelf,
} from '../core/store.ts';
import { declaredBooks } from './books.ts';
import type { Session } from './session.ts';

/**
 * Where a campaign keeps its own story identity.
 *
 * A templates row rather than a field on the root, for a reason worth
 * writing down: the root is an ENTITY, and an entity's coercer keeps
 * exactly lists, notes, children and refs — a `version` integer has
 * nowhere on it to live, and a ref cannot carry a number. The templates
 * table is the campaign's own authored half, already keyed by id, and
 * already logs a row per edit (rule 3). So identity lives there, in one
 * place, and the export EXCLUDES this slot from what it writes — a
 * story that carried the identity row would hand its own `sto_` id to
 * every campaign made from it, and two campaigns would re-export as the
 * same story.
 */
export const STORY_SLOT = 'story';

/** This campaign's story identity, as stored. */
export type StoryIdentity = { id: string; version: number; rights: Rights };

function readIdentity(campaign: Campaign): StoryIdentity | undefined {
  const row = campaign.templatesIn(STORY_SLOT)[0] as Record<string, unknown> | undefined;
  if (!row || typeof row.id !== 'string' || !row.id) return undefined;
  return {
    id: row.id,
    version: typeof row.version === 'number' && row.version > 0 ? row.version : 1,
    rights: toRights(row.rights),
  };
}

// ---------------------------------------------------------------------
// Gathering.

/** Every promoted row under the root, flat, with the parent it hangs from. */
function entitiesOf(campaign: Campaign, rootId: string): StoryEntity[] {
  const out: StoryEntity[] = [];
  const walk = (parent: string) => {
    for (const entity of campaign.children(parent)) {
      out.push({ entity, parent: parent === rootId ? null : parent });
      walk(entity.id);
    }
  };
  walk(rootId);
  return out;
}

/** Everything the campaign authored, minus its own identity row. */
function templatesOf(campaign: Campaign): StoryTemplate[] {
  return campaign
    .allTemplates()
    .filter((row) => row.slot !== STORY_SLOT && row.data !== undefined)
    .map((row) => ({ slot: row.slot, entry: row.data }));
}

/** An asset key held under a template row's `data.key` — a handout's picture, today. */
function keyOf(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const data = (raw as { data?: unknown }).data;
  const key = data && typeof data === 'object' ? (data as { key?: unknown }).key : undefined;
  return typeof key === 'string' && isAssetKey(key) ? key : undefined;
}

/**
 * The boards this campaign has played on, plus their live state.
 *
 * `board_state` is a SECTION like everything else, on by default
 * (TEL-87, 2026-08-16: for a backup, live state is fine) — and it
 * leaves naturally when an author unticks the live sections for
 * something they're handing to somebody. The row comes off the SHELF
 * because that's where a board asset lives; a story restoring a fight
 * onto a board the opener doesn't have is why the two travel together.
 */
function boardsOf(session: Session): StoryBoard[] {
  const wanted = new Map<string, unknown>();
  for (const { boardId, data } of session.campaign.boardStates()) wanted.set(boardId, data);
  const active = refIn(session.campaign.root().refs, 'board');
  if (active && !wanted.has(active.id)) wanted.set(active.id, undefined);
  const out: StoryBoard[] = [];
  for (const [id, state] of wanted) {
    const board = session.shelf.board(id);
    if (!board) continue;
    const entry: StoryBoard = { id: board.id, key: board.key, name: board.name };
    if (board.widthInches !== undefined) entry.widthInches = board.widthInches;
    if (board.grid !== undefined) entry.grid = board.grid;
    if (board.areas?.length) entry.areas = board.areas;
    if (state !== undefined) entry.state = state;
    out.push(entry);
  }
  return out;
}

/** Oldest first — the log is a sequence, and a sequence read backwards is a different story. */
function eventsOf(campaign: Campaign, keepUndo: boolean): StoryEvent[] {
  const rows = campaign.events({ limit: 1_000_000 }).slice().reverse();
  return rows.map((row) => {
    const event: StoryEvent = {
      entityId: row.entityId,
      actor: row.actor,
      kind: row.kind,
      payload: row.payload,
      at: row.createdAt,
    };
    return keepUndo ? event : withoutUndo(event);
  });
}

// ---------------------------------------------------------------------
// What it runs on — referenced, never carried (rule 9).

function requiresOf(session: Session): StoryManifest['requires'] {
  const root = session.campaign.root();
  const out: StoryManifest['requires'] = {};

  const systemRef = refIn(root.refs, 'system');
  if (session.loaded.system) {
    const { id, name, version } = session.loaded.system;
    out.system = { id, name, version };
  } else if (systemRef) {
    // Declared but not on this host: it still travels, because what the
    // campaign runs on is a fact about the campaign, not about whether
    // this machine happens to hold it.
    out.system = { id: systemRef.id, name: systemRef.name || systemRef.id };
  }

  // The packs it ACTUALLY runs on, in the precedence boot resolved —
  // which is the declared order when there is a list, and every pack
  // for the system when there isn't. A host with one pack never made
  // anyone tick a box; the story shouldn't make them tick one either.
  const packs: StoryRef[] = session.loaded.packs.map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
  }));
  const held = new Set(packs.map((p) => p.id));
  for (const miss of session.loaded.missing) {
    if (miss.slot !== 'pack' || held.has(miss.ref.id)) continue;
    packs.push({ id: miss.ref.id, name: miss.ref.name || miss.ref.id });
  }
  // Declared order wins where it exists — `loaded.packs` is already in
  // it, and the unresolved ones go on the end rather than nowhere.
  if (packs.length) out.packs = packs;

  const bookIds = declaredBooks(
    session.dataDir,
    session.loaded.packs.map((p) => p.id),
  );
  const books = bookIds.map((id) => {
    const book = session.shelf.book(id);
    return { id, name: book?.name ?? id };
  });
  if (books.length) out.books = books;
  return out;
}

// ---------------------------------------------------------------------
// Export.

export type ExportOptions = {
  /** Per-section switches. Anything unstated stays ON. */
  sections?: unknown;
  /** Declared, never derived. Stated once, then remembered across re-exports. */
  rights?: unknown;
  actor?: string;
};

export type ExportedStory = {
  bytes: Buffer;
  manifest: StoryManifest;
  filename: string;
  /** Anything left out that a person would want told: an asset too big, a file gone. */
  skipped: string[];
};

/**
 * One campaign, as a file.
 *
 * Export is also the BACKUP: once the campaign lives on a host under
 * your table there is no cloud copy, and a dead drive is a dead
 * campaign unless you've written one of these. The one cost of rule 9
 * is that packs and books are referenced — back up `~/.teller/packs/`
 * alongside your `.story` files.
 */
export function exportStory(session: Session, opts: ExportOptions = {}): ExportedStory {
  const sections = toSections(opts.sections);
  const actor = opts.actor ?? 'dm';
  const campaign = session.campaign;
  const root = campaign.root();
  const skipped: string[] = [];

  // Identity: minted once, kept forever, version counting exports.
  const held = readIdentity(campaign);
  const rights = opts.rights === undefined ? (held?.rights ?? toRights(undefined)) : toRights(opts.rights);
  const id = held?.id ?? newStoryId();
  const version = (held?.version ?? 0) + 1;
  campaign.putTemplate(STORY_SLOT, { id, name: root.name, version, rights }, actor);

  const templates = sections.templates ? templatesOf(campaign) : [];
  const entities = sections.entities ? entitiesOf(campaign, root.id) : [];
  const boards = sections.boards ? boardsOf(session) : [];
  const turn = sections.turn ? campaign.turnState() : undefined;
  const events = sections.events ? eventsOf(campaign, sections.undo) : [];

  const body: StoryBody = { campaign: root };
  if (templates.length) body.templates = templates;
  if (entities.length) body.entities = entities;
  if (boards.length) body.boards = boards;
  if (turn) body.turn = turn;
  if (events.length) body.events = events;

  if (sections.assets) {
    const keys = new Set<string>();
    for (const { entry } of templates) {
      const key = keyOf(entry);
      if (key) keys.add(key);
    }
    for (const board of boards) if (isAssetKey(board.key)) keys.add(board.key);
    const assets: { name: string; data: Buffer }[] = [];
    for (const key of keys) {
      if (!session.dataDir) break;
      const path = join(session.dataDir, key);
      if (!existsSync(path)) {
        skipped.push(`${key} — the file isn't on this host any more`);
        continue;
      }
      if (statSync(path).size > MAX_ASSET_BYTES) {
        skipped.push(`${key} — bigger than a story carries`);
        continue;
      }
      assets.push({ name: key, data: readFileSync(path) });
    }
    if (assets.length) body.assets = assets;
  }

  const manifest = {
    teller: STORY_VERSION,
    story: id,
    version,
    name: root.name,
    requires: requiresOf(session),
    rights,
    exportedAt: new Date().toISOString(),
  };
  const bytes = assembleStory(manifest, body);
  return {
    bytes,
    manifest: { ...manifest, contains: containsOf(body) },
    filename: storyFilename(root.name),
    skipped,
  };
}

// ---------------------------------------------------------------------
// Looking in the box before opening it.

/** A reference the file names and this host doesn't hold. */
export type MissingRef = { slot: 'system' | 'pack' | 'book'; ref: StoryRef };

export type StorySummary = {
  manifest: StoryManifest;
  /** Derived from `contains`, never stored. */
  kind: string;
  /** What's inside, counted, with a word for it a console can read aloud. */
  sections: { name: string; count: number; label: string }[];
  missing: MissingRef[];
};

/** What this file names that this machine hasn't got. Reported, never dropped. */
export function missingRefs(
  shelf: Shelf,
  manifest: StoryManifest,
): MissingRef[] {
  const out: MissingRef[] = [];
  const { system, packs = [], books = [] } = manifest.requires;
  if (system && !shelf.system(system.id)) out.push({ slot: 'system', ref: system });
  for (const pack of packs) if (!shelf.pack(pack.id)) out.push({ slot: 'pack', ref: pack });
  for (const book of books) if (!shelf.book(book.id)) out.push({ slot: 'book', ref: book });
  return out;
}

/**
 * Read a story without applying it — you should be able to see what's
 * in a box before you open it, and "you're missing the Guidebook" is
 * something you want while DECIDING whether to import, not after an
 * encounter deploys half-empty at the table.
 */
export function inspectStory(bytes: Buffer, shelf: Shelf): StorySummary {
  const file = parseStory(bytes);
  const sections: StorySummary['sections'] = [];
  const add = (name: string, n: number, one: string, many = `${one}s`) => {
    if (n > 0) sections.push({ name, count: n, label: n === 1 ? one : many });
  };
  add('templates', file.templates.length, 'authored entry', 'authored entries');
  add('entities', file.entities.length, 'thing in play', 'things in play');
  add('turn', file.turn ? 1 : 0, 'a fight in progress');
  add('boards', file.boards.length, 'board');
  add('events', file.events.length, 'event of history', 'events of history');
  add('assets', file.assets.size, 'image');
  return {
    manifest: file.manifest,
    kind: storyKind(file.manifest.contains),
    sections,
    missing: missingRefs(shelf, file.manifest),
  };
}

// ---------------------------------------------------------------------
// Door (a): start this fresh.

export type ImportReport = {
  applied: string[];
  skipped: string[];
  missing: MissingRef[];
};

export type FreshImport = ImportReport & {
  slug: string;
  /** Where it came from — the story's own id, now this campaign's `refs.from`. */
  from: string;
};

function assetsOnto(dataDir: string, file: StoryFile, report: ImportReport): void {
  let stored = 0;
  for (const [key, data] of file.assets) {
    const path = join(dataDir, key);
    // Content-hashed names, so the same picture is the same file: an
    // existing one is the same bytes and re-writing it would be work
    // for nothing.
    if (existsSync(path)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    stored++;
  }
  if (stored) report.applied.push(`${stored} image${stored === 1 ? '' : 's'}`);
}

/** The refs the incoming manifest ran on, restored as the new campaign's own. */
function refsFrom(file: StoryFile): Record<string, Ref | Ref[]> {
  const out: Record<string, Ref | Ref[]> = {};
  const incoming = file.campaign?.refs ?? {};
  const system = refIn(incoming, 'system') ?? file.manifest.requires.system;
  if (system) out.system = { id: system.id, name: system.name };
  const declared = refsIn(incoming, 'packs');
  const packs = declared.length
    ? declared
    : (file.manifest.requires.packs ?? []).map((p) => ({ id: p.id, name: p.name }));
  if (packs.length) out.packs = packs.map((p) => ({ id: p.id, name: p.name }));
  // Everything else the manifest was holding — the active board, the
  // showing handout — travels as it was.
  for (const [slot, held] of Object.entries(incoming)) {
    if (slot === 'system' || slot === 'packs' || slot === 'from' || slot === 'story') continue;
    out[slot] = held;
  }
  return out;
}

/**
 * Create a campaign FILE from a story — §M-7's campaign door, and the
 * only one history comes through.
 *
 * Entity ids are kept, because this is a whole-file stamp: nothing here
 * is being merged with anything, so the ids that the log, the
 * placements and the turn order all point at stay pointing at the same
 * things. The one id that cannot survive is the ROOT's — the file it
 * lands in already minted one — so children that hung off the old root
 * are reparented onto the new one, and nothing else moves.
 */
export function importFresh(
  shelf: Shelf,
  dataDir: string,
  bytes: Buffer,
  opts: { slug?: string; name?: string; sections?: unknown; actor?: string } = {},
): FreshImport {
  const file = parseStory(bytes);
  const sections = toSections(opts.sections);
  const actor = opts.actor ?? 'host';
  const report: ImportReport = {
    applied: [],
    skipped: [],
    missing: missingRefs(shelf, file.manifest),
  };

  // What you call your table is yours to decide — a starter story
  // shouldn't dictate the name of every campaign built from it.
  const name = opts.name?.trim() || file.campaign?.name || file.manifest.name;
  const slug = opts.slug?.trim() || slugFor(dataDir, name);
  const campaign = createCampaign(dataDir, slug, name, actor);
  try {
    const root = campaign.root();
    const incoming = file.campaign;
    campaign.save(
      {
        ...root,
        name,
        ...(incoming?.lists ? { lists: incoming.lists } : {}),
        ...(incoming?.notes ? { notes: incoming.notes } : {}),
        refs: {
          ...refsFrom(file),
          // Provenance (§14): where this campaign was stamped from. It
          // is NOT this campaign's own story id — re-exporting mints
          // one of those, and confusing the two is how a copy starts
          // overwriting its original.
          from: { id: file.manifest.story, name: file.manifest.name },
        },
      },
      actor,
    );
    report.applied.push(`campaign “${name}”`);

    // History first, so the log reads in the order it happened: the
    // file was made, then here is everything that had already happened
    // in it, then the rows landing. Only through THIS door — see
    // `importLayer`.
    if (sections.events && file.events.length) {
      for (const event of file.events) {
        campaign.append(event.entityId, event.actor, event.kind, event.payload);
      }
      report.applied.push(`${file.events.length} events of history`);
    }

    applyTemplates(campaign, file.templates, sections, actor, report, 'fresh');
    applyEntities(campaign, root.id, file.entities, sections, actor, report, 'fresh');
    applyBoards(shelf, campaign, file.boards, sections, actor, report, 'fresh');
    if (sections.turn && file.turn) {
      campaign.putTurnState(file.turn, actor, { op: 'import' });
      report.applied.push('the fight in progress');
    }
    if (sections.assets && file.assets.size) assetsOnto(dataDir, file, report);
  } finally {
    campaign.close();
  }

  return { ...report, slug, from: file.manifest.story };
}

// ---------------------------------------------------------------------
// Door (b): layer onto a running table.

/**
 * Merge a story into the campaign already being played.
 *
 * The governing rule when something already exists is rule 1: **the
 * stored value wins**, and the report says what was left alone. Anything
 * else would mean a story update quietly overwriting a Warden's own
 * decisions, which is the exact thing "override IS the architecture"
 * was written to prevent.
 */
export function importLayer(
  session: Session,
  bytes: Buffer,
  opts: { sections?: unknown; actor?: string } = {},
): ImportReport {
  const file = parseStory(bytes);
  const sections = toSections(opts.sections);
  const actor = opts.actor ?? 'dm';
  const campaign = session.campaign;
  const report: ImportReport = {
    applied: [],
    skipped: [],
    missing: missingRefs(session.shelf, file.manifest),
  };

  applyTemplates(campaign, file.templates, sections, actor, report, 'layer');
  applyEntities(campaign, campaign.root().id, file.entities, sections, actor, report, 'layer');
  applyBoards(session.shelf, campaign, file.boards, sections, actor, report, 'layer');

  // Live state layers only onto a table that has none — an empty turn
  // order is nothing to overrule, a fight in progress is.
  if (sections.turn && file.turn) {
    if (campaign.turnState()) {
      report.skipped.push('the fight in progress — yours is already running');
    } else {
      campaign.putTurnState(file.turn, actor, { op: 'import' });
      report.applied.push('the fight in progress');
    }
  }

  if (sections.assets && file.assets.size && session.dataDir) {
    assetsOnto(session.dataDir, file, report);
  }

  // History stays with the table that lived it. Layering another
  // table's log into a running one would interleave two games and hand
  // `/undo` a chain that steps sideways into somebody else's turn.
  if (sections.events && file.events.length) {
    report.skipped.push(
      `${file.events.length} events — history stays with the table that lived it`,
    );
  }

  return report;
}

// ---------------------------------------------------------------------
// The shared halves. `mode` is the ONE thing that differs, and it
// differs in exactly one way each time: fresh writes, layer proposes.

type Mode = 'fresh' | 'layer';

function applyTemplates(
  campaign: Campaign,
  templates: StoryTemplate[],
  sections: StorySections,
  actor: string,
  report: ImportReport,
  mode: Mode,
): void {
  if (!sections.templates || !templates.length) return;
  let added = 0;
  let kept = 0;
  for (const { slot, entry } of templates) {
    if (slot === STORY_SLOT) continue;
    const id = (entry as { id?: unknown }).id;
    const known = typeof id === 'string' && campaign.templateRaw(id) !== undefined;
    if (mode === 'layer' && known) {
      kept++;
      continue;
    }
    campaign.putTemplate(slot, entry, actor);
    added++;
  }
  if (added) report.applied.push(`${added} authored entr${added === 1 ? 'y' : 'ies'}`);
  if (kept) report.skipped.push(`${kept} you already had — yours kept`);
}

function applyEntities(
  campaign: Campaign,
  rootId: string,
  entities: StoryEntity[],
  sections: StorySections,
  actor: string,
  report: ImportReport,
  mode: Mode,
): void {
  if (!sections.entities || !entities.length) return;
  let added = 0;
  let kept = 0;
  // Parents before children: a row is created under its parent, so the
  // parent has to be there. The export walked the tree top-down, and
  // this trusts that order — a child whose parent never arrived lands
  // at the root rather than nowhere.
  const landed = new Set<string>();
  for (const { entity, parent } of entities) {
    if (campaign.get(entity.id)) {
      kept++;
      continue;
    }
    const under = parent && landed.has(parent) ? parent : rootId;
    if (parent && !landed.has(parent) && campaign.get(parent)) {
      campaign.create(entity, actor, parent);
    } else {
      campaign.create(entity, actor, under);
    }
    landed.add(entity.id);
    added++;
  }
  if (added) report.applied.push(`${added} thing${added === 1 ? '' : 's'} in play`);
  if (kept) {
    report.skipped.push(
      mode === 'layer'
        ? `${kept} already at this table — yours kept`
        : `${kept} already here`,
    );
  }
}

function applyBoards(
  shelf: Shelf,
  campaign: Campaign,
  boards: StoryBoard[],
  sections: StorySections,
  actor: string,
  report: ImportReport,
  mode: Mode,
): void {
  if (!sections.boards || !boards.length) return;
  let added = 0;
  let kept = 0;
  for (const board of boards) {
    const known = shelf.board(board.id);
    if (known && mode === 'layer') kept++;
    else {
      shelf.putBoard({
        id: board.id,
        key: board.key,
        name: board.name,
        ...(board.widthInches !== undefined ? { widthInches: board.widthInches } : {}),
        ...(board.grid !== undefined ? { grid: board.grid } : {}),
        ...(board.areas?.length ? { areas: board.areas } : {}),
      });
      added++;
    }
    if (board.state === undefined) continue;
    if (mode === 'layer' && campaign.boardState(board.id) !== undefined) {
      report.skipped.push(`what's on “${board.name}” — yours kept`);
      continue;
    }
    campaign.putBoardState(board.id, board.state, actor);
  }
  if (added) report.applied.push(`${added} board${added === 1 ? '' : 's'}`);
  if (kept) report.skipped.push(`${kept} board${kept === 1 ? '' : 's'} you already had`);
}

