// FOG, and the AREAS underneath it.
//
// One file, three readers: the console paints it, the server flattens
// it for the room, and the table renders what arrives. Fog used to be
// spelled out three times in three components; the moment it grew a
// second base that stopped being survivable, so the vocabulary and the
// arithmetic live here and everyone else imports them.
//
// THE BASE IS THE WHOLE IDEA (docs/BATTLEMAP-NEXT.md, phase 0). A map
// has an untouched meaning, and which meaning it has is the Warden's
// choice, not teller's:
//
//   * `dark` — the world is unlit and LIGHT is painted onto it. Today's
//     behaviour verbatim: freehand `revealed` cells punch holes, and an
//     area is lit when its fight-side state says it isn't fogged.
//   * `clear` — the world is visible and DARKNESS is painted onto it.
//     The new default, and the one a table actually reaches for: a
//     board arrives showing its own artwork, and the barn goes black
//     because someone painted it black, never because a tool was
//     touched (rule 1 — fog never switches itself on).
//
// WHAT LIVES WHERE, and it is not a filing preference:
//
//   * FREEHAND cells are FIGHT-SIDE (`revealed` under dark, `fogged`
//     under clear), in `board_state` with the placements. Painting to
//     reveal mid-fight is a gesture at speed and it must never write
//     the shelf — play residue is not geography, and a board carried
//     to another campaign should arrive without last Tuesday's
//     brushstrokes on it.
//   * AREAS are BOARD-SIDE — `{ id, name, cells }` on the shelf row,
//     authored in prep, outliving the campaign that lit them. A name
//     is the point: "lift the vault" is a thing a Warden can say, and
//     the assistant will eventually say it back.
//   * PER-AREA fog state is fight-side again (`fog.areas`), because
//     whether the vault is lit is something that happened tonight.
//
// An area with no fight-side entry MATCHES ITS BASE — dark under dark,
// clear under clear — so a freshly-authored area changes nothing until
// somebody says otherwise, and a board with no fog key at all renders
// as no fog.
//
// Names and shapes never reach a passive screen: `flatFog` collapses
// everything to one mask of cells (`server/public.ts`), so the table
// learns WHERE the darkness is and never that the dark patch is called
// "the vault".

/** A grid cell, by index from the map's origin. */
export type Cell = [number, number];

/** What an untouched map means. */
export type FogBase = 'dark' | 'clear';

/**
 * A named patch of the map — inherent geography on the BOARD row, not
 * a fact about tonight. Fog is its first consumer; terrain is next
 * (BATTLEMAP-NEXT phase 1), which is why this is `Area` and not
 * `FogArea`.
 */
export type Area = { id: string; name: string; cells: Cell[] };

/** One area's state in THIS fight — the half that isn't geography. */
export type AreaFog = { areaId: string; fogged: boolean };

export type Fog = {
  base: FogBase;
  /** Freehand light. Meaningful under `dark`. */
  revealed: Cell[];
  /** Freehand darkness. Meaningful under `clear`. */
  fogged: Cell[];
  areas: AreaFog[];
};

/**
 * Fog with the areas folded in and the names taken out — what a
 * renderer draws and what a passive screen is allowed to know. Both
 * arrays are always present and exactly one of them is ever populated,
 * so there is one shape to render and no optional-chaining archaeology
 * at the far end.
 */
export type FlatFog = { base: FogBase; revealed: Cell[]; fogged: Cell[] };

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
 * name for the fight state is the bug, and the first one written wins.
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

function toAreaFog(raw: unknown): AreaFog | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as { areaId?: unknown; fogged?: unknown };
  if (typeof o.areaId !== 'string' || !o.areaId) return undefined;
  return { areaId: o.areaId, fogged: o.fogged === true };
}

/** The fog as it was stored BEFORE the base — kept only so it can be read once more. */
type LegacyFog = { on?: unknown; revealed?: unknown; regions?: unknown };

type LegacyRegion = { id?: unknown; name?: unknown; cells?: unknown; revealed?: unknown };

function legacyRegions(raw: unknown): LegacyRegion[] {
  return Array.isArray(raw) ? (raw.filter((r) => r && typeof r === 'object') as LegacyRegion[]) : [];
}

/**
 * Fog, whatever shape it was written in. The lazy half of the
 * migration (rule 8: both edges coerce), so nothing has to have run
 * before a board renders correctly.
 *
 * The old world stored `{ on, revealed, regions }` — a world-is-dark
 * switch with named reveal-units inside the fight state. It reads as:
 * `on: true` is `dark`, `on: false` is `clear` WITH NOTHING FOGGED
 * (which is exactly what "off" looked like), and each region's
 * `revealed` becomes the area's fight-side `fogged: !revealed`.
 *
 * A region's CELLS can't become an area from here — an area belongs to
 * the board row and this function has only the state in its hands. So
 * a lit region's cells fold into freehand `revealed`, which renders
 * identically, and `promoteRegions` does the structural half where
 * both are available (`server/boards.ts`, at campaign open). Running
 * them in either order is safe: once the fog carries a `base` the
 * legacy branch never fires again.
 */
export function toFog(raw: unknown): Fog {
  const clear: Fog = { base: 'clear', revealed: [], fogged: [], areas: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clear;
  const o = raw as Fog & LegacyFog;
  if (o.base === 'dark' || o.base === 'clear') {
    return {
      base: o.base,
      revealed: toCells(o.revealed),
      fogged: toCells(o.fogged),
      areas: Array.isArray(o.areas)
        ? o.areas.flatMap((a) => {
            const one = toAreaFog(a);
            return one ? [one] : [];
          })
        : [],
    };
  }
  const dark = o.on === true;
  const regions = legacyRegions(o.regions);
  if (!dark) return clear;
  const revealed = toCells(o.revealed);
  for (const region of regions) {
    if (region.revealed === true) revealed.push(...toCells(region.cells));
  }
  return { base: 'dark', revealed, fogged: [], areas: [] };
}

/**
 * The structural half of the migration: old fog regions become board
 * AREAS, and their reveal flags become fight-side state.
 *
 * Answers `undefined` when there is nothing to promote, so the caller
 * writes nothing and a board nobody fogged keeps its row and stays out
 * of the log. `areas` is what the board row becomes — the existing
 * ones first, since an area a human authored outranks one this
 * function invented (rule 1, and the import law: the stored value
 * wins).
 */
export function promoteRegions(
  rawFog: unknown,
  existing: Area[],
): { fog: Fog; areas: Area[] } | undefined {
  if (!rawFog || typeof rawFog !== 'object' || Array.isArray(rawFog)) return undefined;
  const o = rawFog as Fog & LegacyFog;
  if (o.base === 'dark' || o.base === 'clear') return undefined;
  const regions = legacyRegions(o.regions);
  if (!regions.length) return undefined;
  const dark = o.on === true;
  const areas = [...existing];
  const held = new Set(areas.map((a) => a.id));
  const state: AreaFog[] = [];
  for (const region of regions) {
    const area = toArea(region);
    if (!area) continue;
    if (!held.has(area.id)) {
      held.add(area.id);
      areas.push(area);
    }
    // Under `dark` a closed region WAS the fog; under `clear` nothing
    // was fogged at all, and the area arrives as a shape somebody
    // painted rather than as darkness nobody asked for.
    state.push({ areaId: area.id, fogged: dark ? region.revealed !== true : false });
  }
  return {
    fog: {
      base: dark ? 'dark' : 'clear',
      revealed: dark ? toCells(o.revealed) : [],
      fogged: [],
      areas: state,
    },
    areas,
  };
}

/** Is this area dark right now? With nothing said about it, it matches the base. */
export function areaFogged(fog: Fog, areaId: string): boolean {
  const found = fog.areas.find((a) => a.areaId === areaId);
  return found ? found.fogged : fog.base === 'dark';
}

/** The same fog with one area lit or covered — the fight-side write. */
export function withAreaFogged(fog: Fog, areaId: string, fogged: boolean): Fog {
  const rest = fog.areas.filter((a) => a.areaId !== areaId);
  return { ...fog, areas: [...rest, { areaId, fogged }] };
}

/** The same fog with an area's state forgotten — for when the area itself goes. */
export function withoutArea(fog: Fog, areaId: string): Fog {
  return { ...fog, areas: fog.areas.filter((a) => a.areaId !== areaId) };
}

/**
 * The EFFECTIVE mask: freehand cells and the areas folded together,
 * with every name and every shape-that-isn't-dark left behind.
 *
 * This is the one arithmetic the console preview, the table and the
 * public boundary all run, so the DM's copy and the players' copy
 * cannot disagree about where the dark is — the disagreement between
 * two spellings of a mask is the bug docs/BATTLEMAP.md already records
 * once, about the grid.
 */
export function flatFog(fog: Fog, areas: Area[]): FlatFog {
  const cells: Cell[] = fog.base === 'dark' ? [...fog.revealed] : [...fog.fogged];
  for (const area of areas) {
    const dark = areaFogged(fog, area.id);
    // Dark base collects the LIT areas, clear base the covered ones —
    // each base carries the exception to itself.
    if (fog.base === 'dark' ? !dark : dark) cells.push(...area.cells);
  }
  return fog.base === 'dark'
    ? { base: 'dark', revealed: cells, fogged: [] }
    : { base: 'clear', revealed: [], fogged: cells };
}

/** Is there anything to draw at all? A clear map with nothing covered is just a map. */
export function fogVisible(flat: FlatFog): boolean {
  return flat.base === 'dark' || flat.fogged.length > 0;
}
