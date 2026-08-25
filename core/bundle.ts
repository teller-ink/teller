// The `.story` format — one table's arrangement, in one file.
//
// A story is a zip of OPTIONAL SECTIONS and that is the whole design.
// There are no story TYPES: "a starting kit", "an adventure", "a
// backup" are readings of what's inside, derived at the point somebody
// asks and never stored. A declared kind goes stale the moment the file
// is edited; a derived one cannot lie.
//
// **What a publisher wrote stays put; what you wrote travels** (rule 9).
// The system, the packs and the books this campaign runs on ride as a
// `requires` list — ids, cached names, versions — and never as bodies.
// Whoever opens the file either has them or is told exactly which ones
// they're missing; a referenced thing that's absent is REPORTED, never
// silently dropped.
//
// What DOES travel whole is the author's own uploads: handout pictures
// and board images. That is not a hole in rule 9, it's the same line
// drawn honestly — a rulebook is a thing the recipient owns, a
// photograph of a napkin the DM took mid-session is not. So `assets/`
// carries bytes, size-capped, and the zip container (the `.pack`
// precedent, `archive.ts`) is what keeps that from becoming base64
// bloat inside a JSON file.
//
// Identity is §14's stamp pattern applied to campaigns: a minted `sto_`
// id assigned once, baked in, plus a `version` that counts exports. A
// campaign CREATED from a story carries `refs.from` → that id, which is
// provenance; re-exporting a campaign keeps whatever `sto_` id it
// already had, which is identity. Two facts, two slots, never confused.
//
// This module is the FORMAT and nothing else: no database, no disk, no
// session. It assembles a buffer from plain data and reads plain data
// back out. `server/story.ts` is what knows where any of it lives.

import { writeArchive, openArchive, archiveJson, type ArchiveEntry } from './archive.ts';
import { toEntity, type Entity, type Ref } from './entity.ts';
import { toAreas, type Area } from './fog.ts';
import { toTerrain, type TerrainPatch } from './terrain.ts';
import { newId } from './id.ts';

/**
 * 3: entities, templates and a shelf-shaped `requires` (core-next).
 *
 * 1 carried pack bodies whole; 2 (TEL-62) referenced them. Both spoke
 * the old world's shape — characters, scenes, `data.npcs` — and neither
 * can be read into an entity store without a translation nobody has
 * asked for yet. A reader is told the number so it can say so.
 */
export const STORY_VERSION = 3;

/** The member every `.story` has, and the one that says it is one. */
export const MANIFEST = 'story.json';

/** Where the author's own bytes live inside the file. */
export const ASSETS = 'assets/';

/**
 * One picture's worth of bytes. A handout is a photo, not a rulebook —
 * and the cap is per file rather than per archive so one oversized
 * scan costs you that scan, not the whole export.
 */
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;

/**
 * The two roots an asset key may sit under — the same two `/files/`
 * will serve. It doubles as the traversal guard: a key that isn't one
 * of these is not an asset this format carries, whichever direction it
 * was travelling.
 */
export const ASSET_ROOTS = ['art/', 'map/'];

export function isAssetKey(key: string): boolean {
  if (key.includes('..') || key.startsWith('/')) return false;
  return ASSET_ROOTS.some((root) => key.startsWith(root));
}

// ---------------------------------------------------------------------
// Rights (TEL-87). The pack's vocabulary, verbatim.

/**
 * Who may hand this on — DECLARED, never derived.
 *
 * The old manifest carried a `personal` boolean computed from
 * `npcs.length > 0`, which is a heuristic pretending to be a fact: it
 * answered "did the exporter write any foes" and was read as "is this
 * safe to give away". Absent reads as `personal`, the same way a pack's
 * does, and it gates nothing — it exists so the answer lives in the
 * file instead of in whoever happened to know.
 */
export type RightsBasis = 'homebrew' | 'personal' | 'licensed';

export type Rights = {
  basis: RightsBasis;
  holder?: string;
  terms?: string;
};

const BASES: RightsBasis[] = ['homebrew', 'personal', 'licensed'];

/** Absent, unreadable, or a word we don't know all read as `personal`. */
export function toRights(raw: unknown): Rights {
  if (typeof raw === 'string') {
    return { basis: BASES.includes(raw as RightsBasis) ? (raw as RightsBasis) : 'personal' };
  }
  if (!raw || typeof raw !== 'object') return { basis: 'personal' };
  const o = raw as Record<string, unknown>;
  const basis = String(o.basis ?? '').trim() as RightsBasis;
  const out: Rights = { basis: BASES.includes(basis) ? basis : 'personal' };
  const holder = String(o.holder ?? '').trim();
  if (holder) out.holder = holder;
  const terms = String(o.terms ?? '').trim();
  if (terms) out.terms = terms;
  return out;
}

// ---------------------------------------------------------------------
// Sections.

/**
 * What goes in the file — every part of it, and all of it optional.
 *
 * Everything defaults ON (Brian, 2026-08-16: "it should just be
 * everything. Live state is fine. History and logs is fine"). What you
 * leave out is a decision you made, not one teller made for you: an
 * author's starting snapshot needs no filter, because their campaign
 * has no live state in it yet.
 *
 * The campaign's own manifest facts — its name, its vocabulary, the
 * refs it runs on — are not a section. They are the campaign; a file
 * without them isn't a story of anything.
 */
export type StorySections = {
  /** The campaign's own authored half: its bestiary, encounters, statuses, handout rows. */
  templates: boolean;
  /** The things in play — the roster, the foes on the table, their live counters. */
  entities: boolean;
  /** Whose turn it is (rule 5). It's the fight; a backup that forgets it restores a shrug. */
  turn: boolean;
  /** Board rows and their placements, fog and view. */
  boards: boolean;
  /** Handout pictures and board images — the author's own uploads, bytes and all. */
  assets: boolean;
  /** What happened: turns resolved, foes deployed, tables cleared. */
  events: boolean;
  /**
   * The `before` snapshot every edit carries so `/undo` can walk back.
   *
   * Its own switch because it is a different KIND of thing at a
   * different scale: on a real campaign it was 6.5 MB against 15 KB of
   * actual play history, and it is the least portable part, since
   * undoing past an import would restore a state from a table that
   * doesn't exist on this host. Keep it for a backup of your own game;
   * drop it for anything you hand somebody.
   */
  undo: boolean;
};

export const SECTION_NAMES = [
  'templates',
  'entities',
  'turn',
  'boards',
  'assets',
  'events',
  'undo',
] as const;

export const ALL_SECTIONS: StorySections = {
  templates: true,
  entities: true,
  turn: true,
  boards: true,
  assets: true,
  events: true,
  undo: true,
};

/**
 * Whatever the console sent, as switches. Anything unstated stays ON —
 * a caller who names one section is turning that one off, not turning
 * six others off by omission.
 */
export function toSections(raw: unknown): StorySections {
  const out = { ...ALL_SECTIONS };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const name of SECTION_NAMES) {
    if (name in o) out[name] = o[name] !== false;
  }
  // `undo` cannot outlive the log it annotates: dropping history and
  // keeping the rollback snapshots would be keeping the heavy half of
  // the thing you dropped.
  if (!out.events) out.undo = false;
  return out;
}

// ---------------------------------------------------------------------
// Identity.

/** A minted story id — assigned once at authoring, baked into the file. */
export function newStoryId(): string {
  return newId('sto');
}

export function isStoryId(value: unknown): value is string {
  return typeof value === 'string' && /^sto_[0-9a-f]{12}$/.test(value);
}

// ---------------------------------------------------------------------
// The manifest.

/**
 * Something the opener is expected to have. Version is what a console
 * says out loud ("v3, you have v2"); the id is what matches.
 */
export type StoryRef = { id: string; name: string; version?: number };

export type StoryManifest = {
  teller: number;
  /** This story's own minted id — stable across every re-export of the same campaign. */
  story: string;
  /** Counts exports of THIS story. Bumped by the exporter, never by hand. */
  version: number;
  name: string;
  /** What a reader will find inside, so it can be shown before unpacking. */
  contains: string[];
  /**
   * What this needs and does NOT provide — always by reference.
   * `packs` is ORDERED, and the order is the precedence the campaign
   * was built with.
   */
  requires: { system?: StoryRef; packs?: StoryRef[]; books?: StoryRef[] };
  rights: Rights;
  exportedAt: string;
};

function toStoryRef(raw: unknown): StoryRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '').trim();
  if (!id) return undefined;
  const out: StoryRef = { id, name: String(o.name ?? '').trim() || id };
  if (typeof o.version === 'number' && Number.isFinite(o.version)) out.version = o.version;
  return out;
}

function toStoryRefs(raw: unknown): StoryRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(toStoryRef).filter((r): r is StoryRef => r !== undefined);
}

/** Reading is forgiving, permanently: a file written against any past shape may arrive at any time. */
export function toManifest(raw: unknown): StoryManifest | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const teller = Number(o.teller ?? 0);
  if (!teller) return undefined;
  const requires = (o.requires ?? {}) as Record<string, unknown>;
  const system = toStoryRef(requires.system);
  const packs = toStoryRefs(requires.packs);
  const books = toStoryRefs(requires.books);
  const out: StoryManifest = {
    teller,
    story: isStoryId(o.story) ? o.story : String(o.story ?? '').trim(),
    version: typeof o.version === 'number' && o.version > 0 ? o.version : 1,
    name: String(o.name ?? '').trim() || 'Imported campaign',
    contains: Array.isArray(o.contains) ? o.contains.map(String) : [],
    requires: {},
    rights: toRights(o.rights),
    exportedAt: String(o.exportedAt ?? '') || new Date(0).toISOString(),
  };
  if (system) out.requires.system = system;
  if (packs.length) out.requires.packs = packs;
  if (books.length) out.requires.books = books;
  return out;
}

/**
 * What kind of thing this is — DERIVED from what's inside, never
 * stored. The console reads this to say "a starting kit" versus "an
 * adventure you can run tonight"; the importer never branches on it,
 * because import is one operation regardless.
 */
export function storyKind(contains: string[]): string {
  const has = (s: string) => contains.includes(s);
  if (has('events') || has('turn')) return 'a table in progress';
  if (has('entities')) return 'a campaign';
  if (has('templates')) return 'a starting kit';
  return 'an empty campaign';
}

// ---------------------------------------------------------------------
// The body.

/** One promoted entity and the row it hangs under. Flat, because the tree is the parents. */
export type StoryEntity = { entity: Entity; parent: string | null };

/** One authored template row — the slot is a column, so it travels beside the object. */
export type StoryTemplate = { slot: string; entry: unknown };

/**
 * A board and what's on it. The row is a SHELF asset (an image plus a
 * calibration) and the state is the campaign's live placements, but
 * they travel together because separating them is how you get a story
 * that restores a fight onto a board nobody has.
 */
export type StoryBoard = {
  id: string;
  key: string;
  name: string;
  widthInches?: number;
  grid?: unknown;
  /** The named places on it — geography, so it travels with the row and not with the fight. */
  areas?: Area[];
  /** The ground itself — same category as the areas, so it travels the same way. */
  terrain?: TerrainPatch[];
  state?: unknown;
};

/**
 * One row of what happened. Ids are deliberately NOT carried: they're
 * an autoincrement in the host's own table and mean nothing in another.
 * Order is what matters and order is the array.
 */
export type StoryEvent = {
  entityId: string | null;
  actor: string;
  kind: string;
  payload?: unknown;
  at: string;
};

/** Everything a story can hold, already gathered. What `assembleStory` writes. */
export type StoryBody = {
  /** The manifest facts — the root entity, whole. Never optional. */
  campaign: Entity;
  templates?: StoryTemplate[];
  entities?: StoryEntity[];
  turn?: unknown;
  boards?: StoryBoard[];
  events?: StoryEvent[];
  /** Names are asset KEYS relative to the data dir — `art/…`, `map/…`. */
  assets?: ArchiveEntry[];
};

const json = (name: string, value: unknown): ArchiveEntry => ({
  name,
  data: Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
});

/**
 * What a reader will find inside — computed from the body that's about
 * to be written, so `contains` and the file can never disagree.
 */
export function containsOf(body: StoryBody): string[] {
  const out = ['campaign'];
  if (body.templates?.length) out.push('templates');
  if (body.entities?.length) out.push('entities');
  if (body.turn) out.push('turn');
  if (body.boards?.length) out.push('boards');
  if (body.events?.length) out.push('events');
  if (body.assets?.length) out.push('assets');
  return out;
}

/**
 * The file, assembled. `contains` is filled in here rather than by the
 * caller for the reason above; everything else on the manifest is the
 * caller's to state.
 */
export function assembleStory(
  manifest: Omit<StoryManifest, 'contains' | 'teller'> & { teller?: number },
  body: StoryBody,
): Buffer {
  const full: StoryManifest = {
    ...manifest,
    teller: manifest.teller ?? STORY_VERSION,
    contains: containsOf(body),
  };
  const entries: ArchiveEntry[] = [json(MANIFEST, full), json('campaign.json', body.campaign)];
  if (body.templates?.length) entries.push(json('templates.json', body.templates));
  if (body.entities?.length) entries.push(json('entities.json', body.entities));
  if (body.turn) entries.push(json('turn.json', body.turn));
  if (body.boards?.length) entries.push(json('boards.json', body.boards));
  if (body.events?.length) entries.push(json('events.json', body.events));
  for (const asset of body.assets ?? []) {
    if (!isAssetKey(asset.name)) continue;
    if (asset.data.length > MAX_ASSET_BYTES) continue;
    entries.push({ name: `${ASSETS}${asset.name}`, data: asset.data });
  }
  return writeArchive(entries);
}

/** A story read back — the manifest, plus every section as data. */
export type StoryFile = {
  manifest: StoryManifest;
  campaign?: Entity;
  templates: StoryTemplate[];
  entities: StoryEntity[];
  turn?: unknown;
  boards: StoryBoard[];
  events: StoryEvent[];
  /** Keyed by the asset key, `assets/` already stripped. */
  assets: Map<string, Buffer>;
};

function toStoryEntity(raw: unknown): StoryEntity | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const entity = toEntity(o.entity ?? o);
  if (!entity) return undefined;
  const parent = typeof o.parent === 'string' && o.parent ? o.parent : null;
  return { entity, parent };
}

function toStoryTemplate(raw: unknown): StoryTemplate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const slot = String(o.slot ?? '').trim();
  if (!slot || !o.entry || typeof o.entry !== 'object') return undefined;
  return { slot, entry: o.entry };
}

function toStoryBoard(raw: unknown): StoryBoard | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '').trim();
  const key = String(o.key ?? '').trim();
  if (!id || !key) return undefined;
  const out: StoryBoard = { id, key, name: String(o.name ?? '').trim() || id };
  if (typeof o.widthInches === 'number') out.widthInches = o.widthInches;
  if (o.grid !== undefined) out.grid = o.grid;
  if (o.areas !== undefined) {
    const areas = toAreas(o.areas);
    if (areas.length) out.areas = areas;
  }
  if (o.terrain !== undefined) {
    const terrain = toTerrain(o.terrain);
    if (terrain.length) out.terrain = terrain;
  }
  if (o.state !== undefined) out.state = o.state;
  return out;
}

function toStoryEvent(raw: unknown): StoryEvent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind ?? '').trim();
  if (!kind) return undefined;
  return {
    entityId: typeof o.entityId === 'string' && o.entityId ? o.entityId : null,
    actor: String(o.actor ?? '').trim() || 'dm',
    kind,
    payload: o.payload,
    at: String(o.at ?? '') || new Date(0).toISOString(),
  };
}

function list<T>(raw: unknown, coerce: (item: unknown) => T | undefined): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(coerce).filter((item): item is T => item !== undefined);
}

/**
 * Read a `.story`. Throws only for "this isn't one" — everything
 * inside is coerced, and a section that won't parse comes back empty
 * rather than taking the file down with it.
 *
 * `openArchive` is what gets called rather than `readArchive`, so a
 * story someone re-zipped from a folder (and therefore nested under one
 * directory) reads exactly like one teller wrote.
 */
export function parseStory(bytes: Buffer): StoryFile {
  let files: Map<string, Buffer>;
  try {
    files = openArchive(bytes);
  } catch {
    throw new Error('not a .story — this file is not an archive');
  }
  const manifest = toManifest(archiveJson(files, MANIFEST));
  if (!manifest) {
    // The old world's manifest was `teller.json` (versions 1 and 2 —
    // see STORY_VERSION). Neither can be read into the entity store,
    // and "not a .story" would send the one person this happens to
    // hunting a corrupt file instead of a superseded format — refuse
    // by name, with the way through.
    if (archiveJson(files, 'teller.json')) {
      throw new Error(
        'this is a pre-fold bundle (teller.json, versions 1-2) — the old ' +
          "world's shape can't be imported. Rebuild the campaign on this " +
          'host and export a fresh .story; the old file remains readable ' +
          'by the old app in git history.',
      );
    }
    throw new Error(`no ${MANIFEST} — this archive is not a .story`);
  }
  const assets = new Map<string, Buffer>();
  for (const [name, data] of files) {
    if (!name.startsWith(ASSETS)) continue;
    const key = name.slice(ASSETS.length);
    if (isAssetKey(key)) assets.set(key, data);
  }
  const turn = archiveJson(files, 'turn.json');
  return {
    manifest,
    campaign: toEntity(archiveJson(files, 'campaign.json')),
    templates: list(archiveJson(files, 'templates.json'), toStoryTemplate),
    entities: list(archiveJson(files, 'entities.json'), toStoryEntity),
    ...(turn === undefined || turn === null ? {} : { turn }),
    boards: list(archiveJson(files, 'boards.json'), toStoryBoard),
    events: list(archiveJson(files, 'events.json'), toStoryEvent),
    assets,
  };
}

/**
 * Strip the rollback snapshot, keep the event. What HAPPENED survives;
 * only the machinery for reversing it goes.
 */
export function withoutUndo(event: StoryEvent): StoryEvent {
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || !('before' in payload)) return event;
  const { before: _before, ...rest } = payload as Record<string, unknown>;
  return { ...event, payload: rest };
}

/**
 * Filenames should look like what they are when they land in Downloads.
 * There is deliberately no second extension for the "starting kit"
 * case: kit and adventure differ only in how FULL they are, and a new
 * extension tracks a different KIND of thing, never a different degree
 * of completeness.
 */
export function storyFilename(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'campaign';
  return `${slug}.story`;
}

/** A ref as the manifest states it, from the entity ref a campaign holds. */
export function storyRefOf(ref: Ref, version?: number): StoryRef {
  const out: StoryRef = { id: ref.id, name: ref.name || ref.id };
  if (version !== undefined) out.version = version;
  return out;
}
