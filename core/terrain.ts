// GROUND THAT MEANS SOMETHING — terrain, on the BOARD row.
//
// A sibling of `core/fog.ts` rather than another chapter of it. Fog is
// one set of dark cells and two verbs; terrain is a LIST of authored
// patches with words on them, and the only thing the two share is the
// lattice and the `Area` they can both point at. Keeping them apart
// means the file that answers "where is the dark" stays the length of
// its own idea.
//
// THE SHAPE:
//
//     TerrainPatch = { id, kind?, description?, elevation?,
//                      blocksSight?, cells? | areaId? }
//
// KIND IS FREE TEXT, and that is the design and not a shortcut. "deep
// water", "scree", "waist-high grass" — anything typeable, because the
// alternative is a registry, and a registry is a list of ground types
// somebody else decided your world may have. A curated list (teller's
// floor below, a system's, a pack's) is a SUGGESTION and never a gate:
// a board imported under a different system keeps every kind it was
// authored with, renders, and stays editable, because there is nothing
// to resolve and nothing to fall back from.
//
// DESCRIPTION IS THE INTERPRETIVE LAYER, in the author's own words:
// "waist-deep, footing treacherous" is what a Warden reads to rule and
// what an assistant reads to propose. teller never parses it. Systems
// may attach mechanics to a kind they recognize BY NAME — an optional
// overlay over this data, never a condition of storing it.
//
// ELEVATION is a number in the plane's calibrated unit, stored from day
// one and interpreted by nobody yet (bands and z are phase 2). On an
// uncalibrated board the field still stores, because it is data the
// author wrote down and dropping it would lose a fact to a feature that
// hasn't shipped.
//
// BLOCKSSIGHT is the one structural flag — the single fact about ground
// that geometry itself can act on (`server/geometry.ts` reports what a
// straight line crosses, and whether any of it was opaque). It reports;
// it refuses nothing.
//
// WHAT A PATCH CLAIMS: either its own `cells` or an `areaId` — a REAL
// stored area, never "everywhere else". The derived remainder
// (`restCells`) has no id on purpose: a stored reference to shifting
// geometry means something different the week after somebody draws a
// new room. A derived selection may be acted on, never pointed at.
//
// WHERE IT LIVES: the board row, beside the areas and the calibration.
// A cliff is where it is whoever is playing, so terrain outlives the
// campaign that fought over it and travels with the board — and it is
// DM-side, stripped from every passive payload (`server/public.ts`)
// exactly as areas are, because the shape and the words of ground
// nobody has walked onto are the Warden's to hand out.

import { cellKey, toCells, type Area, type Cell } from './fog.ts';

/**
 * One patch of authored ground. Every field but the id is optional,
 * because a patch is drawn before it is described and a half-filled row
 * is a real state of prep rather than an error.
 */
export type TerrainPatch = {
  id: string;
  /** The author's own word for this ground. Free text; never a registry key. */
  kind?: string;
  /** How it plays, in the author's own words. The interpretive layer — teller never parses it. */
  description?: string;
  /** In the plane's calibrated unit. Stored now, given meanings in phase 2. */
  elevation?: number;
  /** The one structural flag. Reported, never enforced. */
  blocksSight?: boolean;
  /** Its own painted cells, on the board's paint lattice (`rasterOf`). */
  cells?: Cell[];
  /** Or a stored area's, by id. Never the derived remainder. */
  areaId?: string;
};

/**
 * teller's FLOOR of kind suggestions — six words, and the shortness is
 * the point.
 *
 * These are materials, not mechanics: what the ground IS, which is a
 * thing every setting has, rather than what it DOES, which is the
 * system's business and the description's. They fill a datalist and
 * nothing else — no validation reads this array, and a kind nobody here
 * thought of is exactly as real as one that is.
 */
export const TERRAIN_KINDS = ['water', 'mud', 'sand', 'rubble', 'scrub', 'rock'] as const;

/**
 * A patch's own id. `ter_` plus twelve hex, minted the way `newAreaId`
 * mints `are_` — `getRandomValues` rather than `randomUUID`, because
 * this module is imported by the client and a LAN host is not a secure
 * context (rule 6). These name a row; they confer nothing.
 */
export function newTerrainId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `ter_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A trimmed string, or nothing — an empty field is an absent one, never `''`. */
const text = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;

/**
 * One patch, narrowed (rule 8 — both edges coerce). An id is minted for
 * anything arriving without one, so a client that forgets cannot author
 * two nameless rows that later collide.
 *
 * `cells` and `areaId` are both KEPT when both arrive, and `areaId`
 * wins at resolution time. Dropping one would silently discard whatever
 * the author painted before they bound the patch to a room, and the
 * cells are the thing they'd want back on unbinding it.
 */
export function toTerrainPatch(raw: unknown): TerrainPatch | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: TerrainPatch = { id: text(o.id) ?? newTerrainId() };
  const kind = text(o.kind);
  if (kind) out.kind = kind;
  const description = text(o.description);
  if (description) out.description = description;
  if (typeof o.elevation === 'number' && Number.isFinite(o.elevation)) out.elevation = o.elevation;
  if (o.blocksSight === true) out.blocksSight = true;
  if (Array.isArray(o.cells)) {
    const cells = toCells(o.cells);
    if (cells.length) out.cells = cells;
  }
  const areaId = text(o.areaId);
  if (areaId) out.areaId = areaId;
  return out;
}

/**
 * The board's terrain, narrowed. Duplicate ids are dropped rather than
 * merged, the way `toAreas` drops them: two rows claiming one id is the
 * bug, and the first one written wins.
 */
export function toTerrain(raw: unknown): TerrainPatch[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TerrainPatch[] = [];
  for (const item of raw) {
    const patch = toTerrainPatch(item);
    if (!patch || seen.has(patch.id)) continue;
    seen.add(patch.id);
    out.push(patch);
  }
  return out;
}

/** A patch resolved against the board's areas: where it actually is, and what went wrong. */
export type ResolvedPatch = {
  patch: TerrainPatch;
  /** The cells this patch covers, right now. */
  cells: Cell[];
  /**
   * The `areaId` this patch names and the board hasn't got. An explicit
   * absence beats a silent one: a patch bound to a deleted room is a
   * thing the Warden should be told about, not a patch that quietly
   * covers nothing.
   */
  missingArea?: string;
};

/**
 * WHERE EVERY PATCH IS — the one door, and every reader goes through
 * it.
 *
 * The editor tints with it, the server measures with it, and a story
 * round-trips rows it never resolved. Two spellings of "which cells is
 * this patch on" is two chances to disagree about whether the ford is
 * under anybody's feet.
 *
 * `areaId` wins over `cells` when a patch carries both: binding a patch
 * to a room is the stronger statement, and the painted cells stay on
 * the row so unbinding gives them back.
 *
 * A dangling `areaId` resolves to NO cells and says so in
 * `missingArea`. Falling back to the patch's own cells would be worse
 * than empty — it would put ground somewhere the author explicitly
 * moved it away from.
 */
export function resolveTerrain(patches: TerrainPatch[], areas: Area[]): ResolvedPatch[] {
  const byId = new Map(areas.map((a) => [a.id, a]));
  return patches.map((patch) => {
    if (patch.areaId) {
      const area = byId.get(patch.areaId);
      if (!area) return { patch, cells: [], missingArea: patch.areaId };
      return { patch, cells: area.cells };
    }
    return { patch, cells: patch.cells ?? [] };
  });
}

/**
 * What to CALL a patch when something has to say it out loud — the
 * author's kind, else the room it claims, else an honest placeholder.
 *
 * Uniqueness is the caller's problem and `labelTerrain` below is where
 * it's solved; this is the raw word.
 */
export function terrainLabel(patch: TerrainPatch, areas: Area[]): string {
  if (patch.kind) return patch.kind;
  if (patch.areaId) {
    const area = areas.find((a) => a.id === patch.areaId);
    if (area) return area.name;
  }
  return 'unnamed ground';
}

/**
 * Every patch's label, made UNIQUE — two patches of "water" become
 * "water" and "water (2)".
 *
 * Not cosmetic. Downstream facts are keyed by name (which tokens stand
 * in it, what a line crossed), and a reader handed two rows wearing one
 * word cannot tell which one anybody is in — an ambiguous aggregate
 * teaches a wrong answer. The suffix is only ever added on a genuine
 * collision, so the ordinary board reads exactly as authored.
 */
export function labelTerrain(patches: TerrainPatch[], areas: Area[]): Map<string, string> {
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const patch of patches) {
    const base = terrainLabel(patch, areas);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out.set(patch.id, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}

/** Every cell any patch covers, as a key set — what the editor tints against. */
export function terrainCellKeys(resolved: ResolvedPatch[]): Set<string> {
  const out = new Set<string>();
  for (const { cells } of resolved) for (const cell of cells) out.add(cellKey(cell));
  return out;
}
