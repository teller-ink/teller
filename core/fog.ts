// FOG, and the AREAS underneath it.
//
// One file, three readers: the console paints it, the server hands it
// to the room, and the table renders what arrives. Fog was spelled out
// three times in three components once; the vocabulary and the
// arithmetic live here now and everyone else imports them.
//
// THE WHOLE MODEL IS ONE SET:
//
//     Fog = { dark: Cell[] }
//
// A cell is dark iff it is in the set. The ground is always clear.
// There is nothing else to know, and nothing else to keep in sync.
//
// THE RETHINK (Brian, 2026-08-24, hours after the base shipped). The
// first cut of this file gave fog a BASE — `dark` worlds you painted
// light into, `clear` worlds you painted darkness onto — plus a
// freehand `revealed` list, a freehand `fogged` list, and a per-area
// `AreaFog` state. Four sources of truth, and a brush whose meaning
// depended on which one you were standing in. Every one of those was
// accidental: a "dark world" is not a different KIND of map, it is a
// map with a lot of dark paint on it, and the dungeon posture that
// motivated the base is one tap — cover all — not a mode. So the base
// is gone, the two freehand lists collapsed into the one set they were
// always halves of, and per-area fog state stopped existing.
//
// TWO VERBS, NO MODES. `darken` puts cells in; `clear` takes them out.
// The brush never changes meaning, and neither does "cover all" (every
// cell of the calibrated grid) or "clear all" (the empty set). Bounded
// by the grid throughout: no declared width means no cells means no
// fog, exactly as before.
//
// AREAS ARE PURE GEOMETRY — `{ id, name, cells }` on the BOARD row,
// authored in prep, outliving the campaign that lit them. They carry
// NO fog state anywhere, tonight's or otherwise. "Fog the vault" and
// "lift the vault" are verbs that add or remove that area's cells from
// the set, and whether the vault is currently dark is DERIVED when
// somebody asks (`areaStatus`) — never stored. A name is the point:
// "lift the vault" is a thing a Warden can say, and the assistant will
// eventually say it back.
//
// WHAT LIVES WHERE, and it is not a filing preference: the dark set is
// FIGHT-SIDE, in `board_state` with the placements, because painting
// mid-fight is a gesture at speed and must never write the shelf — play
// residue is not geography, and a board carried to another campaign
// should arrive without last Tuesday's brushstrokes on it. Areas are
// BOARD-SIDE, because a room is where it is whoever is playing.
//
// Names and shapes never reach a passive screen. The set IS the mask,
// so the public boundary ships it as-is (`server/public.ts`) and the
// table learns WHERE the darkness is and never that the dark patch is
// called "the vault".

/** A grid cell, by index from the map's origin. */
export type Cell = [number, number];

/**
 * How many 1-inch cells a map has. `rows` may be fractional — a map is
 * rarely a whole number of inches tall — so anything enumerating cells
 * rounds it UP, the way the editor's own `cellOf` clamps to.
 */
export type Grid = { cols: number; rows: number };

/**
 * A named patch of the map — inherent geography on the BOARD row, not
 * a fact about tonight. Fog is its first consumer; terrain is next
 * (BATTLEMAP-NEXT phase 1), which is why this is `Area` and not
 * `FogArea`.
 */
export type Area = { id: string; name: string; cells: Cell[] };

/**
 * The dark, and that is all of it. A cell is dark iff it is in here;
 * an empty set is a map with no fog on it, which is what a new board
 * is (rule 1 — fog never switches itself on).
 */
export type Fog = { dark: Cell[] };

/** A board nobody has fogged. */
export const NO_FOG: Fog = { dark: [] };

/**
 * Where an area stands right now, DERIVED. `partial` is a real answer
 * and not a rounding error — a room half-explored is a thing that
 * happens, and calling it fogged or lifted would be a lie the Warden
 * would then act on.
 */
export type AreaStatus = 'lifted' | 'fogged' | 'partial';

/**
 * An area's own id. Twelve hex characters behind a prefix, the same
 * shape `core/id.ts` mints — but generated with `getRandomValues`
 * rather than `randomUUID`, because this module is imported by the
 * client and a LAN host is not a secure context (rule 6). These name a
 * row; they confer nothing.
 */
export function newAreaId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `are_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** One cell's key in a set. The only place cell identity is spelled. */
export const cellKey = (cell: Cell): string => `${cell[0]},${cell[1]}`;

/**
 * A cell list, read defensively. Cells are opaque coordinates to
 * everything in here — nothing between the brush and the mask does
 * arithmetic on one — so the list is copied rather than validated
 * element by element.
 */
export function toCells(raw: unknown): Cell[] {
  return Array.isArray(raw) ? (raw.slice() as Cell[]) : [];
}

/** One area, narrowed. A patch with no cells is still an area — it is a room being drawn. */
export function toArea(raw: unknown): Area | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as { id?: unknown; name?: unknown; cells?: unknown };
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : newAreaId();
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'area';
  return { id, name, cells: toCells(o.cells) };
}

/**
 * The board's areas, narrowed — the serializer both edges run (rule 8).
 * Duplicate ids are dropped rather than merged: two rows claiming one
 * id is the bug, and the first one written wins.
 */
export function toAreas(raw: unknown): Area[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Area[] = [];
  for (const item of raw) {
    const area = toArea(item);
    if (!area || seen.has(area.id)) continue;
    seen.add(area.id);
    out.push(area);
  }
  return out;
}

// -- the set, and the two verbs -----------------------------------------

/** Every cell of the map. No grid means no cells, which means no fog. */
export function allCells(grid: Grid | null | undefined): Cell[] {
  if (!grid) return [];
  const out: Cell[] = [];
  const rows = Math.ceil(grid.rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid.cols; c++) out.push([c, r]);
  }
  return out;
}

/** Is this cell in the list? */
export function hasCell(cells: Cell[], cell: Cell): boolean {
  return cells.some((c) => c[0] === cell[0] && c[1] === cell[1]);
}

/** The same fog with these cells dark. Already-dark cells are not doubled. */
export function darken(fog: Fog, cells: Cell[]): Fog {
  const seen = new Set(fog.dark.map(cellKey));
  const dark = [...fog.dark];
  for (const cell of cells) {
    const key = cellKey(cell);
    if (seen.has(key)) continue;
    seen.add(key);
    dark.push(cell);
  }
  return { dark };
}

/** The same fog with these cells lit. A cell nobody darkened is a no-op. */
export function clear(fog: Fog, cells: Cell[]): Fog {
  if (!cells.length) return fog;
  const gone = new Set(cells.map(cellKey));
  return { dark: fog.dark.filter((c) => !gone.has(cellKey(c))) };
}

/** Every cell of the map, dark. The dungeon posture, which is one tap. */
export function coverAll(grid: Grid | null | undefined): Fog {
  return { dark: allCells(grid) };
}

/** Is there anything to draw at all? */
export function fogVisible(fog: Fog): boolean {
  return fog.dark.length > 0;
}

/**
 * Where this area stands, worked out from the set — never stored. An
 * area with no cells reads as `lifted`: a room being drawn is not a
 * room in darkness.
 */
export function areaStatus(fog: Fog, area: Area): AreaStatus {
  if (!area.cells.length) return 'lifted';
  const dark = new Set(fog.dark.map(cellKey));
  let covered = 0;
  for (const cell of area.cells) if (dark.has(cellKey(cell))) covered++;
  if (covered === 0) return 'lifted';
  return covered === area.cells.length ? 'fogged' : 'partial';
}

/**
 * EVERYWHERE ELSE — the map minus every named area, computed at the
 * moment somebody asks.
 *
 * It is what the prep workflow needs to see: partition the map into
 * rooms, watch this shrink toward nothing, and the count is the
 * progress bar. It is also a perfectly good thing to fog or lift in one
 * tap ("the whole outdoors goes dark, the rooms stay as they are").
 *
 * THE DISCIPLINE, and it is why this returns cells rather than an
 * area: **a derived selection may be ACTED ON, never POINTED AT.**
 * There is no id, no row on the board, nothing in the areas array and
 * nothing serialized — because a stored reference to shifting geometry
 * changes meaning the moment somebody draws a new area, and a name
 * that quietly means something else next week is the worst kind of
 * bug. Phase 1's terrain will want stable geometry to point at; this
 * remainder is deliberately un-referenceable, and anything that needs
 * to be referenced gets promoted into a real area first.
 */
export function restCells(grid: Grid | null | undefined, areas: Area[]): Cell[] {
  const claimed = new Set<string>();
  for (const area of areas) for (const cell of area.cells) claimed.add(cellKey(cell));
  return allCells(grid).filter((c) => !claimed.has(cellKey(c)));
}

// -- reading whatever shape it was written in ---------------------------
//
// Two older shapes exist and both have run on real data:
//
//   * PRE-PHASE-0 `{ on, revealed, regions }` — a world-is-dark switch
//     with named reveal-units living inside the fight state.
//   * PHASE-0 `{ base, revealed, fogged, areas }` — the shape this
//     file shipped and superseded the same night.
//
// Both are read HERE, lazily (rule 8: both edges coerce), so nothing
// has to have run before a board reads correctly. The one thing this
// function cannot do is the one thing both old shapes need: a
// world-is-dark map has no cells written down, and turning "everything"
// into a set needs to know how big the map is — which only the picture
// knows. So `migrateFog` below does the exact job where the grid is in
// hand (`server/boards.ts`, at campaign open and after an import), and
// what's here is the honest fallback for a blob read before that ran.

type LegacyFog = {
  /** Pre-phase-0: the world-is-dark switch. */
  on?: unknown;
  /** Pre-phase-0 and phase-0 alike: freehand light. */
  revealed?: unknown;
  /** Pre-phase-0: named reveal-units. */
  regions?: unknown;
  /** Phase-0: what an untouched map meant. */
  base?: unknown;
  /** Phase-0: freehand darkness. */
  fogged?: unknown;
  /** Phase-0: per-area fight state, consumed by the migration and gone. */
  areas?: unknown;
};

type LegacyRegion = { id?: unknown; name?: unknown; cells?: unknown; revealed?: unknown };

function legacyList(raw: unknown): LegacyRegion[] {
  return Array.isArray(raw) ? (raw.filter((r) => r && typeof r === 'object') as LegacyRegion[]) : [];
}

/** Which cells the old per-area state said were dark, by area id. */
function legacyAreaFog(raw: unknown): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const item of legacyList(raw)) {
    const { areaId, fogged } = item as { areaId?: unknown; fogged?: unknown };
    if (typeof areaId === 'string' && areaId) out.set(areaId, fogged === true);
  }
  return out;
}

/** Was the whole world dark in this old blob? */
function legacyWorldDark(o: LegacyFog): boolean {
  return o.base === 'dark' || (o.base === undefined && o.on === true);
}

/**
 * Fog, whatever shape it was written in.
 *
 * The CURRENT shape passes through. An old blob whose world was CLEAR
 * reads exactly — its painted darkness is already a list of cells, and
 * that list is the set. An old blob whose world was DARK cannot be
 * expressed without the grid, and answers with the cells it can prove
 * are dark rather than inventing bounds; `migrateFog` finishes it.
 */
export function toFog(raw: unknown): Fog {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { dark: [] };
  const o = raw as { dark?: unknown } & LegacyFog;
  if (Array.isArray(o.dark)) return { dark: toCells(o.dark) };
  if (legacyWorldDark(o)) return { dark: [] };
  // A clear world: the darkness is what somebody painted. Phase-0's
  // per-area fog is NOT folded in here — an area's cells live on the
  // board row and a state serializer only ever has the state — so a
  // covered area arrives once `migrateFog` has run.
  return { dark: toCells(o.fogged) };
}

/**
 * The structural half of the migration, where the grid is in hand.
 *
 * Answers `undefined` when there is nothing to write, so a board nobody
 * fogged keeps its row and stays out of the log — which also makes
 * this idempotent: run it twice and the second run writes nothing.
 *
 * What it does, per old shape:
 *
 *   * PRE-PHASE-0. `regions` become board AREAS (existing ones win on
 *     an id collision — an area a human authored outranks one this
 *     invented, rule 1 and the import law both). `on:false` means
 *     nothing was dark. `on:true` means everything was, minus the
 *     freehand `revealed` cells and minus every region that was lit.
 *   * PHASE-0. `base:'clear'` means the darkness was the freehand
 *     `fogged` list plus the cells of every area its `AreaFog` marked
 *     covered. `base:'dark'` means everything, minus `revealed` and
 *     minus the cells of every area marked NOT covered. Either way the
 *     `AreaFog` entries are consumed here and cease to exist.
 *
 * A blob that means "no fog" and promotes no areas is left where it
 * lies: reading it costs nothing, and rewriting it would put every
 * board on the host into the event log to say nothing changed.
 */
export function migrateFog(
  raw: unknown,
  existing: Area[],
  grid: Grid | null | undefined,
): { fog: Fog; areas: Area[] } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as { dark?: unknown } & LegacyFog;
  if (Array.isArray(o.dark)) return undefined;

  // Phase-0's per-area state, and pre-phase-0's regions, both resolve
  // to the same question: for each area, was it dark? The defaults
  // differ — under a dark world an area nobody ruled on stayed dark —
  // so each branch answers it for itself.
  const areas = [...existing];
  const held = new Set(areas.map((a) => a.id));
  const worldDark = legacyWorldDark(o);
  /** Cells the old blob said were LIT, which come back out of the dark. */
  const lit: Cell[] = [];
  /** Cells the old blob said were DARK, which go in. */
  const covered: Cell[] = [];

  if (o.base === undefined) {
    for (const region of legacyList(o.regions)) {
      const area = toArea(region);
      if (!area) continue;
      // The stored area's cells win, for the same reason its name does.
      const known = areas.find((a) => a.id === area.id);
      if (!held.has(area.id)) {
        held.add(area.id);
        areas.push(area);
      }
      // Under `on:false` NOTHING was dark — off meant off — so a
      // region's flag is only a fact when the world was dark, and
      // otherwise the shape is all that survives.
      if (worldDark && region.revealed === true) lit.push(...(known ? known.cells : area.cells));
    }
  } else {
    const state = legacyAreaFog(o.areas);
    for (const area of areas) {
      // Absent used to mean "matches the base": dark under dark, clear
      // under clear. Preserved exactly.
      const dark = state.get(area.id) ?? worldDark;
      (dark ? covered : lit).push(...area.cells);
    }
  }

  // A dark world was ALL of it minus the exceptions, and freehand light
  // was one of those exceptions — so it is cut alongside the lit areas
  // rather than before them, and a cell somebody had revealed stays
  // revealed. A clear world is the painted darkness plus the areas that
  // were covered, and its `revealed` list was already meaningless.
  const fog = worldDark
    ? clear(coverAll(grid), [...toCells(o.revealed), ...lit])
    : darken({ dark: toCells(o.fogged) }, covered);

  if (!fog.dark.length && areas.length === existing.length) return undefined;
  return { fog, areas };
}
