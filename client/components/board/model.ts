// The battlemap's shapes and its arithmetic — everything the editor
// agrees with the table about, in one file with no JSX in it.
//
// docs/BATTLEMAP.md is the law and it did not change; what changed is
// where the facts live (§4). The BOARD is a shelf asset carrying the
// picture, its physical width and its grid style. The STATE is per
// campaign — placements, fog, zones, the view — and it is the thing
// this editor writes.
//
// THREE SPACES, THREE JOBS, never mixed:
//
//   * map space — where things ON the map are: normalized image
//     coordinates u, v ∈ 0..1, or 1-inch cell indices [col, row].
//     Resolution-independent (re-upload a bigger scan, nothing moves)
//     and re-declaration-safe (fix `widthInches` later and the tokens
//     stay glued to the painted features they stand on).
//   * physical space — SIZES in inches. An inch is an inch on every
//     display, through that display's calibrated ppi.
//   * glass space — the viewport maps one onto the other.
//
// The stored shapes below are the ones `server/public.ts` already knows
// how to strip: a hidden placement or zone is REMOVED from the
// player-safe snapshot rather than dimmed, and fog flattens to one mask
// of cells so the name and shape of an unentered room never reach the
// table. Nothing here may invent a second spelling of `hidden`.

/**
 * Fog's vocabulary is not declared here — it lives in `core/fog.ts`,
 * because the console, the server and the table all have to agree
 * about what a base means and three copies of that agreement is three
 * chances to disagree. Re-exported rather than re-declared, the way
 * `TOKEN_COLORS` is, so every existing import still reads `model.ts`.
 */
import type { Area, Cell, Fog } from '../../../core/fog.ts';

export {
  areaFogged,
  flatFog,
  fogVisible,
  newAreaId,
  toFog,
  withAreaFogged,
  withoutArea,
  type Area,
  type Cell,
  type FlatFog,
  type Fog,
  type FogBase,
} from '../../../core/fog.ts';

/**
 * Where a thing stands and what it looks like (§5).
 *
 * The token owns its position and appearance; the ENTITY supplies how
 * it's doing, derived at render through `entityId` and never stored —
 * so a token cannot go stale. It keeps `label` and `color` because it
 * must work UNLINKED (a rock, something in the dark), and because colour
 * is a deployment choice about sides.
 */
export type Placement = {
  /** Local, so the editor can address a row that hasn't been saved yet. */
  id?: string;
  entityId?: string;
  label?: string;
  color?: string;
  u: number;
  v: number;
  sizeInches?: number;
  /** Degrees. Only meaningful on a shape that isn't a disc. */
  rot?: number;
  shape?: 'circle' | 'square' | 'triangle';
  /** Behind the screen: stripped server-side, not dimmed (rule: hidden means absent). */
  hidden?: boolean;
};

/**
 * Painted ground. IDENTITY IS THE ID, not the effect — two fires in
 * different corners are two layers, independently shown, hidden,
 * deleted and painted into.
 */
export type Zone = {
  id: string;
  effect: string;
  cells: Cell[];
  hidden?: boolean;
};

/**
 * What the TABLE is aimed at — read by `client/views/TableView.tsx`.
 * `cu, cv` is the map-space point at the viewport centre; `zoom`
 * multiplies true scale, so 1.0 is exact.
 */
export type BoardView = {
  mode: 'fit' | 'true';
  zoom: number;
  cu: number;
  cv: number;
  /** While set, nothing in the editor may re-aim the table. */
  locked?: boolean;
};

export type BoardState = {
  placements?: Placement[];
  fog?: Fog;
  zones?: Zone[];
  view?: BoardView;
};

/** The shelf row. `grid` is blob on the server; this is its whole vocabulary. */
export type Board = {
  id: string;
  key: string;
  name: string;
  widthInches?: number;
  grid?: { on?: boolean; color?: string; opacity?: number };
  /** Named places — prep-authored, board-side, and never sent to a passive screen. */
  areas?: Area[];
};

export const DEFAULT_VIEW: BoardView = { mode: 'fit', zoom: 1, cu: 0.5, cv: 0.5 };

/**
 * A board nobody has fogged. `clear` with nothing covered renders as no
 * fog at all, which is rule 1's floor written as a default: reaching
 * for the tool, opening the workshop, or shaping an area leaves the
 * table showing its map.
 */
export const DEFAULT_FOG: Fog = { base: 'clear', revealed: [], fogged: [], areas: [] };

/**
 * The ground markers a painted layer can be. Environmental, not
 * mechanical: teller draws the fire, the table rules on what standing in
 * it costs (rule 1). Same list the old world painted with, because the
 * table already reads these colours.
 */
export const EFFECTS = ['fire', 'oil', 'smoke', 'ice', 'poison', 'water'];

/**
 * The gooey tile-layer vocabulary, ported verbatim from the old app
 * (`src/components/token-visuals.ts`).
 *
 * The blur+contrast merge filter REQUIRES opaque fills — semi-transparent
 * input dies in the alpha contrast — so fills are solid and translucency
 * is applied to the group AFTER the filter. An unrecognised effect gets
 * a neutral mark rather than throwing: a pack that invented a look, or a
 * typo in a hand-edited file, must never take the console down.
 */
export function zoneBase(effect: string): { fill: string; opacity: number; core?: string } {
  switch (effect) {
    case 'fire':
      return { fill: '#f97316', opacity: 0.7, core: 'rgba(253,224,71,0.85)' };
    case 'oil':
      return { fill: '#14101c', opacity: 0.8 };
    case 'smoke':
      return { fill: '#b4afaa', opacity: 0.55 };
    case 'ice':
      return { fill: '#93c5fd', opacity: 0.55 };
    case 'poison':
      return { fill: '#84cc16', opacity: 0.55, core: 'rgba(190,242,100,0.6)' };
    case 'water':
      return { fill: '#0ea5e9', opacity: 0.55 };
    default:
      return { fill: '#a8a29e', opacity: 0.5 };
  }
}

/**
 * Token colours — the deployment palette, sides rather than species.
 *
 * Re-exported rather than declared: deploying a fight colours tokens
 * server-side now, so the list lives in `core/tokens.ts` where both ends
 * can read the same one.
 */
export { TOKEN_COLORS } from '../../../core/tokens.ts';

/** Base sizes, in true inches. A 1" base is the default everywhere. */
export const SIZES = [0.5, 1, 2, 3, 4, 6, 8];

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** How many 1-inch cells across and down, from the map's own declared width. */
export function gridOf(
  widthInches: number | undefined,
  nat: { w: number; h: number } | null,
): { cols: number; rows: number } | null {
  if (!widthInches || !nat || !nat.w || !nat.h) return null;
  const cols = Math.max(1, Math.round(widthInches));
  const rows = Math.max(1, (widthInches * nat.h) / nat.w);
  return { cols, rows };
}

/**
 * Snap a position to the grid the way a MINI sits on it.
 *
 * An odd-inch base (1", 3") centres in a square; an even one (2", 4")
 * centres on the intersection, because that is where a 2" base actually
 * balances. Ported unchanged — it is the piece of this file most likely
 * to be "simplified" into being wrong.
 */
export function snapUv(
  u: number,
  v: number,
  sizeInches: number,
  grid: { cols: number; rows: number } | null,
): { u: number; v: number } {
  if (!grid) return { u, v };
  const onIntersection = sizeInches >= 2 && Math.round(sizeInches) % 2 === 0;
  const fit = (n: number) => (onIntersection ? Math.round(n) : Math.floor(n) + 0.5);
  return {
    u: clamp01(fit(u * grid.cols) / grid.cols),
    v: clamp01(fit(v * grid.rows) / grid.rows),
  };
}

/** Which cell a map-space point falls in. Null when the map has no cells. */
export function cellOf(
  u: number,
  v: number,
  grid: { cols: number; rows: number } | null,
): Cell | null {
  if (!grid) return null;
  return [
    Math.min(grid.cols - 1, Math.max(0, Math.floor(u * grid.cols))),
    Math.min(Math.ceil(grid.rows) - 1, Math.max(0, Math.floor(v * grid.rows))),
  ];
}

export const cellKey = (cell: Cell) => `${cell[0]},${cell[1]}`;

export function hasCell(cells: Cell[], cell: Cell): boolean {
  return cells.some((c) => c[0] === cell[0] && c[1] === cell[1]);
}

export function withoutCell(cells: Cell[], cell: Cell): Cell[] {
  return cells.filter((c) => !(c[0] === cell[0] && c[1] === cell[1]));
}

/**
 * A local id. Not `crypto.randomUUID` — a LAN host is served over plain
 * HTTP and that is not a secure context, so the good generator isn't
 * there (rule 6). These name a row inside one blob; they confer nothing.
 */
export function localId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Give every placement an id it may not have had.
 *
 * The blob predates the editor: the vanilla client wrote placements as
 * bare `{ entityId, u, v }`, and there is nothing to address a row with
 * — no way to say WHICH of three Bark Watchers is being dragged. Index
 * would do until the list is filtered. So ids are minted on the way in
 * and written back with the first edit; nothing else about the row is
 * touched, and a board nobody edits is left exactly as it was.
 */
export function withIds(state: BoardState): BoardState {
  const placements = state.placements;
  if (!placements?.some((p) => !p.id)) return state;
  return {
    ...state,
    placements: placements.map((p) => (p.id ? p : { ...p, id: localId('plc') })),
  };
}

/** Every cell of the map, for revealing or covering the lot at once. */
export function allCells(grid: { cols: number; rows: number } | null): Cell[] {
  if (!grid) return [];
  const out: Cell[] = [];
  const rows = Math.ceil(grid.rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid.cols; c++) out.push([c, r]);
  }
  return out;
}
