// THE WORKSHOP — where a battlemap is actually authored.
//
// Ported from the old app's `src/components/SceneEditor.tsx`, which is
// the behavioural and visual spec: a fullscreen canvas with floating
// tool overlays, edits that are LIVE and debounced with an in-editor
// undo stack (⌘Z) rather than save/cancel, so you can iterate against
// the real table without a round trip.
//
// What the new world changed is only where the facts live (§4). A scene
// was a board with a fight smeared onto it; now the BOARD is a shelf
// asset (picture, physical width, grid style) and the FIGHT is board
// state (placements, fog, zones, view) belonging to the campaign. So
// this component writes through two doors instead of one, and which
// door a control uses says which kind of thing it is editing.
//
// The laws it exists to keep, none of which are negotiable:
//
//   * MAP SPACE, always (`model.ts`). Positions are u,v ∈ 0..1 of the
//     source image, so re-uploading a higher-res scan moves nothing and
//     correcting `widthInches` afterwards leaves every token glued to
//     the feature it was standing on. PAINT is different and always
//     was: cells are indices into the board's lattice (`rasterOf` —
//     inches where the board is calibrated, the picture's own raster
//     where it isn't), so re-declaring the width DOES move them. That
//     is the one crossing this editor warns about before it happens.
//   * PHYSICAL MINIS PIN THE MAP. Panning mid-combat slides the ground
//     out from under real minis, so aiming the table is its OWN tool,
//     can be locked outright, and asks before overruling a running
//     fight. The default tool drags tokens and pans the workshop view —
//     a stray drag can never re-aim the table.
//   * HIDDEN MEANS ABSENT. A hidden placement or ground layer is
//     stripped server-side (`server/public.ts`), never dimmed, so
//     nothing is discoverable in devtools. New tokens start hidden.
//   * FOG NEVER SWITCHES ITSELF ON. Reaching for the tool, or shaping
//     an area, leaves the table clear; darkness is a decision someone
//     takes — with the brush, with "fog" on an area, or with cover-all.
//     A new board's dark set is empty, which renders as no fog at all.
//   * GEOGRAPHY AND RESIDUE WRITE THROUGH DIFFERENT DOORS. A named
//     AREA is inherent to the map, so it lands on the board row via
//     `onBoard` — prep, reusable, campaign-independent. Freehand fog
//     cells are what happened tonight, so they stay in `board_state`
//     with the tokens. Which door a control uses says which kind of
//     thing it is editing, and that is the seam this whole file is
//     organised around.
//
// Pointer events throughout, never HTML5 drag-and-drop: this console is
// an iPad as often as it is a laptop, and DnD does not exist there
// (the runner's own reasoning, `client/tools/runner.tsx`).

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as PointerEvt,
} from 'react';
import { input } from '../../lib/ui.ts';
import { FogLayer, GridOverlay } from './Layers.tsx';
import { Zones } from './Zones.tsx';
import {
  allCells,
  areaStatus,
  cellKey,
  cellOf,
  clamp01,
  clear,
  darken,
  DEFAULT_VIEW,
  EFFECTS,
  gridOf,
  hasCell,
  localId,
  newAreaId,
  paintDrifts,
  rasterOf,
  restCells,
  SIZES,
  snapUv,
  toFog,
  TOKEN_COLORS,
  withIds,
  withoutCell,
  zoneBase,
  type Area,
  type AreaStatus,
  type Board,
  type BoardState,
  type BoardView,
  type Cell,
  type Fog,
  type Grid,
  type Placement,
  type Zone,
} from './model.ts';

const SNAP_PREF = 'teller.board.snap';

// 'select' is the safe default: it drags tokens, and a drag on empty
// map pans the workshop view rather than re-aiming the table.
type Tool = 'select' | 'pan' | 'frame' | 'paint' | 'fog';

const panel = 'rounded-2xl border border-stone-800 bg-stone-950/85 shadow-xl backdrop-blur';
const toolBtn = (on: boolean) =>
  `flex h-11 w-11 items-center justify-center rounded-xl text-lg transition-colors ${
    on ? 'bg-amber-700 text-stone-950' : 'text-stone-300 hover:bg-stone-800'
  }`;

const SHAPES = ['circle', 'square', 'triangle'] as const;

/** Centering plus the zone footprint (shape and rotation) as one transform. */
function shapeStyle(placement: Placement): CSSProperties {
  const rot = placement.rot ?? 0;
  const shape = placement.shape ?? 'circle';
  return {
    transform: `translate(-50%, -50%) rotate(${rot}deg)`,
    borderRadius: shape === 'circle' ? '9999px' : shape === 'square' ? '4px' : '0',
    clipPath: shape === 'triangle' ? 'polygon(50% 0%, 100% 100%, 0% 100%)' : undefined,
  };
}

type Drag =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'paint'; op: 'add' | 'remove'; last: string }
  | { kind: 'token'; id: string }
  | { kind: 'frame' }
  | null;

export type RosterRow = { id: string; name: string; type?: string | null };

export function BoardEditor({
  board,
  state,
  roster,
  mapUrl,
  live,
  ppi,
  ppiY,
  tableViewport,
  combatRunning,
  onState,
  onBoard,
  onClose,
}: {
  board: Board;
  /** The stored state, as the server last answered. */
  state: BoardState;
  roster: RosterRow[];
  mapUrl: string | null;
  /** Is this board the one on the table right now? */
  live: boolean;
  /** The TABLE's calibration, so the frame box means something. */
  ppi?: number;
  ppiY?: number;
  tableViewport?: { w: number; h: number };
  combatRunning?: boolean;
  onState: (next: BoardState) => void;
  onBoard: (patch: {
    name?: string;
    widthInches?: number | null;
    grid?: unknown;
    areas?: Area[];
  }) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const [camReady, setCamReady] = useState(false);

  const [tool, setTool] = useState<Tool>('select');
  const [brush, setBrush] = useState<string>(EFFECTS[0]);
  // TWO VERBS, NO MODES: the brush either darkens cells or clears
  // them, and it means that on every board there has ever been.
  const [fogBrush, setFogBrush] = useState<'darken' | 'clear'>('darken');
  const [secret, setSecret] = useState(false);
  const [snap, setSnap] = useState(() => localStorage.getItem(SNAP_PREF) !== '0');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoneEditId, setZoneEditId] = useState<string | null>(null);
  const [areaEditId, setAreaEditId] = useState<string | null>(null);
  const [areaName, setAreaName] = useState('');
  const [carrying, setCarrying] = useState<RosterRow | null>(null);

  // --- the draft ------------------------------------------------------
  //
  // Edits are live and debounced (the old editor's own posture): the
  // draft is authoritative while the hand is moving, the server catches
  // up a beat later, and the server's answer is only taken back while
  // nothing is in flight — otherwise a reload landing mid-drag would
  // snap a token back to where it was two hundred milliseconds ago.

  const [draft, setDraft] = useState<BoardState>(() => withIds(state));
  const draftRef = useRef<BoardState>(withIds(state));
  const undoRef = useRef<BoardState[]>([]);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<Drag>(null);
  const strokeRef = useRef<string | null>(null);
  const confirmedRef = useRef(false);

  // --- the AREAS draft ------------------------------------------------
  //
  // The same live-and-debounced posture as the state draft above, and
  // for the same reason: shaping a room is a drag, and a PATCH per cell
  // would be a hundred writes to the shelf for one gesture. Separate
  // because the destination is separate — areas are the BOARD's, so
  // they go out through `onBoard` while everything else in this editor
  // goes out through `onState`.

  const [areas, setAreas] = useState<Area[]>(board.areas ?? []);
  const areasRef = useRef<Area[]>(board.areas ?? []);
  const areasDirty = useRef(false);
  const areasTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (areasDirty.current) return;
    areasRef.current = board.areas ?? [];
    setAreas(board.areas ?? []);
  }, [board.areas]);

  const commitAreas = (next: Area[]) => {
    areasRef.current = next;
    areasDirty.current = true;
    setAreas(next);
    if (areasTimer.current) clearTimeout(areasTimer.current);
    areasTimer.current = setTimeout(() => {
      areasTimer.current = null;
      areasDirty.current = false;
      onBoard({ areas: areasRef.current });
    }, 350);
  };

  // A different board is a different draft, always — no carry-over.
  useEffect(() => {
    const seeded = withIds(state);
    draftRef.current = seeded;
    setDraft(seeded);
    undoRef.current = [];
    dirty.current = false;
    setSelectedId(null);
    setZoneEditId(null);
    setAreaEditId(null);
    areasRef.current = board.areas ?? [];
    areasDirty.current = false;
    setAreas(board.areas ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);

  useEffect(() => {
    if (!dirty.current) {
      const seeded = withIds(state);
      draftRef.current = seeded;
      setDraft(seeded);
    }
  }, [state]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      dirty.current = false;
      onState(draftRef.current);
    }, 350);
  };

  /** Draw it now, tell the server shortly. */
  const commit = (next: BoardState) => {
    draftRef.current = next;
    dirty.current = true;
    setDraft(next);
    flush();
  };

  /** Draw it now and say nothing — for the middle of a drag. */
  const stage = (next: BoardState) => {
    draftRef.current = next;
    dirty.current = true;
    setDraft(next);
  };

  /** One undo step, taken before a gesture rather than during it. */
  const mark = () => {
    undoRef.current.push(draftRef.current);
    if (undoRef.current.length > 40) undoRef.current.shift();
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (prev) commit(prev);
  };

  // --- geometry -------------------------------------------------------

  // Self-healing measurement: the observer catches resizes and the
  // layout pass re-checks every render, so a stale zero (pane hidden,
  // tab backgrounded, device rotated) can never strand the geometry.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w && h && (size?.w !== w || size?.h !== h)) setSize({ w, h });
  });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measured off a probe rather than the rendered <img>: React's onLoad
  // misses an image the browser already had, and the whole geometry
  // (grid, tiles, painting, framing) hangs off this.
  useEffect(() => {
    if (!mapUrl) return;
    let alive = true;
    const probe = new Image();
    const take = () => {
      if (alive && probe.naturalWidth) setNat({ w: probe.naturalWidth, h: probe.naturalHeight });
    };
    probe.onload = take;
    probe.src = mapUrl;
    if (probe.complete) take();
    return () => {
      alive = false;
    };
  }, [mapUrl]);

  const fitScale = nat && size ? Math.min(size.w / nat.w, size.h / nat.h) : null;
  const baseW = nat && fitScale ? nat.w * fitScale : 0;
  const baseH = nat && fitScale ? nat.h * fitScale : 0;

  useEffect(() => {
    if (!camReady && size && baseW && baseH) {
      setCam({ x: (size.w - baseW) / 2, y: (size.h - baseH) / 2, z: 1 });
      setCamReady(true);
    }
  }, [camReady, size, baseW, baseH]);

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setCam((c) => {
      const z = Math.min(8, Math.max(0.4, c.z * factor));
      const k = z / c.z;
      return { z, x: px - k * (px - c.x), y: py - k * (py - c.y) };
    });
  };

  const zoomCenter = (factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  const resetCam = () => {
    if (size) setCam({ x: (size.w - baseW) / 2, y: (size.h - baseH) / 2, z: 1 });
  };

  const toUv = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !baseW || !baseH) return null;
    return {
      u: clamp01((clientX - rect.left - cam.x) / cam.z / baseW),
      v: clamp01((clientY - rect.top - cam.y) / cam.z / baseH),
    };
  };

  // TWO LATTICES, and only one of them is physical.
  //
  //   `grid`   — inches. What the overlay draws, what tokens snap to,
  //              what true scale measures. Null on an uncalibrated board,
  //              and every physical affordance stays gated on it.
  //   `raster` — cells to PAINT on, which every board has (`rasterOf`):
  //              the inch grid where there is one, an image-relative
  //              raster where there isn't. Fog, areas and ground read it.
  //
  // On a calibrated board they are the same lattice, so nothing about a
  // battlemap changed.
  const grid = gridOf(board.widthInches, nat);
  const raster = rasterOf(board.widthInches, nat);
  /** One painted cell, on screen. Square by construction on either lattice. */
  const cellPx = raster && baseW ? baseW / raster.cols : null;
  /** One true inch, on screen — for anything sized in inches. */
  const inchPx = grid && baseW ? baseW / grid.cols : null;
  const place = (u: number, v: number, sizeInches: number, free = false) =>
    snap && !free ? snapUv(u, v, sizeInches, grid) : { u, v };

  const cellAt = (clientX: number, clientY: number): Cell | null => {
    const uv = toUv(clientX, clientY);
    return uv ? cellOf(uv.u, uv.v, raster) : null;
  };

  // --- the pieces of state, and the writers ---------------------------

  const placements = draft.placements ?? [];
  const zones = draft.zones ?? [];
  const fog: Fog = toFog(draft.fog);
  const editingArea = areas.find((a) => a.id === areaEditId) ?? null;
  // Dark cells no area has claimed — what "name it" would name, and the
  // only sense in which freehand paint is still a separate thing.
  const claimed = new Set(areas.flatMap((a) => a.cells.map(cellKey)));
  const unclaimed = fog.dark.filter((c) => !claimed.has(cellKey(c)));
  const view: BoardView = { ...DEFAULT_VIEW, ...(draft.view ?? {}) };
  const selected = placements.find((p) => p.id === selectedId) ?? null;

  const setPlacements = (next: Placement[], living = true) => {
    const d = { ...draftRef.current, placements: next };
    living ? commit(d) : stage(d);
  };

  const setPlacement = (id: string, patch: Partial<Placement>, living = true) =>
    setPlacements(
      (draftRef.current.placements ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
      living,
    );

  const setFog = (next: Fog) => commit({ ...draftRef.current, fog: next });

  const setView = (patch: Partial<BoardView>, living = true) => {
    const d = draftRef.current;
    const next = { ...d, view: { ...DEFAULT_VIEW, ...(d.view ?? {}), ...patch } };
    living ? commit(next) : stage(next);
  };

  /**
   * Physical minis stand on the current framing, so re-aiming mid-fight
   * asks first — once per editor session, and never a hard refusal. The
   * human is the rules engine (rule 1); this is a speed bump, not a gate.
   */
  const framingAllowed = () => {
    if (!combatRunning || confirmedRef.current) return true;
    confirmedRef.current = window.confirm(
      'A fight is running — physical minis stand on the current framing. Re-aim the table anyway?',
    );
    return confirmedRef.current;
  };

  /**
   * Which ground LAYER a paint stroke belongs to. Touching existing
   * paint of the current brush picks that layer up (and erases from
   * it); otherwise the stroke continues the layer being edited, or
   * starts a fresh one — so two separate fires stay two separate fires.
   */
  const strokeTarget = (cell: Cell): { id: string; op: 'add' | 'remove' } => {
    const list = draftRef.current.zones ?? [];
    const under = list.find(
      (z) => z.effect === brush && !!z.hidden === secret && hasCell(z.cells, cell),
    );
    if (under) return { id: under.id, op: 'remove' };
    const editing = list.find(
      (z) => z.id === zoneEditId && z.effect === brush && !!z.hidden === secret,
    );
    return { id: editing?.id ?? localId('zon'), op: 'add' };
  };

  const applyCell = (zoneId: string, cell: Cell, op: 'add' | 'remove') => {
    const d = draftRef.current;
    const list = [...(d.zones ?? [])];
    const i = list.findIndex((z) => z.id === zoneId);
    if (i < 0) {
      if (op === 'remove') return;
      list.push({
        id: zoneId,
        effect: brush,
        cells: [cell],
        ...(secret ? { hidden: true } : {}),
      });
    } else {
      const cells = withoutCell(list[i].cells, cell);
      if (op === 'add') cells.push(cell);
      list[i] = { ...list[i], cells };
    }
    commit({ ...d, zones: list.filter((z) => z.cells.length > 0) });
  };

  /**
   * One stroke. Shaping an area writes the BOARD; everything else
   * writes the dark set and stays in the fight, which is the whole
   * reason painting the dark back mid-combat is cheap.
   */
  const applyFog = (cell: Cell, op: 'add' | 'remove') => {
    if (areaEditId) {
      const edit = (cells: Cell[]) => {
        const next = withoutCell(cells, cell);
        return op === 'add' ? [...next, cell] : next;
      };
      commitAreas(
        areasRef.current.map((a) => (a.id === areaEditId ? { ...a, cells: edit(a.cells) } : a)),
      );
      return;
    }
    const f = toFog(draftRef.current.fog);
    commit({ ...draftRef.current, fog: op === 'add' ? darken(f, [cell]) : clear(f, [cell]) });
  };

  /**
   * A painted patch becomes a NAMED PLACE — the one promotion in this
   * editor that moves a fact from the fight to the map. The unclaimed
   * dark cells arrive on the board as an area and the dark set is not
   * touched at all, so nothing on the table changes at the moment of
   * naming. (Painting does NOT create an area by itself: every
   * brushstroke of a running fight would silently become geography.)
   */
  const promotePatch = () => {
    if (!unclaimed.length) return;
    mark();
    const area: Area = {
      id: newAreaId(),
      name: areaName.trim() || `Area ${areasRef.current.length + 1}`,
      cells: unclaimed,
    };
    commitAreas([...areasRef.current, area]);
    setAreaName('');
  };

  /**
   * An area off the map. Its cells keep whatever they were — deleting a
   * name is not a ruling about the light, and a room that goes back to
   * being anonymous dark is what "forget this shape" honestly means.
   */
  const dropArea = (id: string) => {
    mark();
    commitAreas(areasRef.current.filter((a) => a.id !== id));
    if (areaEditId === id) setAreaEditId(null);
  };

  /** These cells dark, or these cells lit — the two verbs, everywhere. */
  const paint = (cells: Cell[], dark: boolean) => {
    if (!cells.length) return;
    mark();
    const f = toFog(draftRef.current.fog);
    setFog(dark ? darken(f, cells) : clear(f, cells));
  };

  /**
   * The dungeon posture, which is ONE TAP and not a mode. Equivalent to
   * fogging every area and the remainder with them — `allCells` is just
   * the shorter spelling of the same set, since the areas and the rest
   * partition the map by construction.
   */
  const setAll = (dark: boolean) => paint(allCells(raster), dark);

  /**
   * Calibrating a PAINTED board, said out loud before it happens.
   *
   * A cell is an index into a lattice, and declaring a width (or
   * correcting one) re-shapes the lattice — so the same indices land
   * somewhere else and the fog and the areas drift. There is no honest
   * remap of a brushstroke, so this doesn't attempt one: it says what
   * will happen and lets the human decide (rule 1 — a speed bump, never
   * a refusal). Fog is tonight's, areas are few, and a repaint is a real
   * answer. Silent is the one thing it must not be.
   */
  const setWidthInches = (next: number | null) => {
    if (
      paintDrifts(board.widthInches, next, nat, toFog(draftRef.current.fog), areasRef.current) &&
      !window.confirm(
        'Changing the width re-shapes this map\u2019s paint grid \u2014 the fog and areas already painted on it will land in different cells and may need repainting. Change it anyway?',
      )
    ) {
      return false;
    }
    onBoard({ widthInches: next });
    return true;
  };

  /** Drop one on the map. New markers start behind the screen, always. */
  const addPlacement = (u: number, v: number, entity?: RosterRow) => {
    mark();
    const put = place(u, v, 1);
    const next: Placement = {
      id: localId('plc'),
      ...put,
      sizeInches: 1,
      color: TOKEN_COLORS[placements.length % TOKEN_COLORS.length],
      hidden: true,
      ...(entity ? { entityId: entity.id } : { label: `Marker ${placements.length + 1}` }),
    };
    setPlacements([...placements, next]);
    setSelectedId(next.id ?? null);
    setTool('select');
  };

  // --- keyboard -------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (carrying) setCarrying(null);
        else onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
      if (e.key === 'v') setTool('select');
      if (e.key === 'f') setTool('frame');
      if (e.key === 'h') setTool('pan');
      if (e.key === 'b' && raster) setTool('paint');
      if (e.key === 'g' && raster) setTool('fog');
      if (e.key === 'l') setView({ locked: !view.locked });
      if (e.key === 's' && grid) {
        const next = !snap;
        setSnap(next);
        localStorage.setItem(SNAP_PREF, next ? '1' : '0');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // --- pointer --------------------------------------------------------

  // Capture keeps a drag alive past the element's edge, and throws when
  // the pointer isn't active — never let that abort the interaction.
  const capture = (e: PointerEvt) => {
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  const onPointerDown = (e: PointerEvt) => {
    capture(e);
    // Something is being carried from the roster strip: this tap is
    // where it lands. Tap-then-tap, so the same gesture works with a
    // finger on glass and a mouse on a laptop.
    if (carrying) {
      const uv = toUv(e.clientX, e.clientY);
      if (uv) addPlacement(uv.u, uv.v, carrying);
      setCarrying(null);
      return;
    }
    if (tool === 'pan' || tool === 'select' || e.button === 1) {
      dragRef.current = { kind: 'pan', x: e.clientX, y: e.clientY };
      return;
    }
    if (tool === 'paint' || tool === 'fog') {
      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) return;
      mark();
      if (tool === 'fog') {
        // The brush means one thing: darken adds, clear removes. When an
        // area is being shaped the same two verbs extend and trim its
        // outline instead — the only place the target changes, and the
        // labels say so.
        const op: 'add' | 'remove' = fogBrush === 'darken' ? 'add' : 'remove';
        dragRef.current = { kind: 'paint', op, last: cell.join(',') };
        applyFog(cell, op);
        return;
      }
      const target = strokeTarget(cell);
      setZoneEditId(target.id);
      strokeRef.current = target.id;
      dragRef.current = { kind: 'paint', op: target.op, last: cell.join(',') };
      applyCell(target.id, cell, target.op);
      return;
    }
    // the frame tool — the only thing here that re-aims the table
    if (view.locked || view.mode !== 'true') return;
    if (!framingAllowed()) return;
    mark();
    dragRef.current = { kind: 'frame' };
    const uv = toUv(e.clientX, e.clientY);
    if (uv) setView({ cu: uv.u, cv: uv.v }, false);
  };

  const onPointerMove = (e: PointerEvt) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      dragRef.current = { kind: 'pan', x: e.clientX, y: e.clientY };
      setCam((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
    } else if (d.kind === 'paint') {
      const cell = cellAt(e.clientX, e.clientY);
      if (cell && cell.join(',') !== d.last) {
        d.last = cell.join(',');
        if (tool === 'fog') applyFog(cell, d.op);
        else if (strokeRef.current) applyCell(strokeRef.current, cell, d.op);
      }
    } else if (d.kind === 'token') {
      const uv = toUv(e.clientX, e.clientY);
      if (!uv) return;
      const token = (draftRef.current.placements ?? []).find((p) => p.id === d.id);
      // Option bypasses the snap, for fine placement.
      setPlacement(d.id, place(uv.u, uv.v, token?.sizeInches ?? 1, e.altKey), false);
    } else if (d.kind === 'frame') {
      const uv = toUv(e.clientX, e.clientY);
      if (uv) setView({ cu: uv.u, cv: uv.v }, false);
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    // One write for the whole drag, not one per pointer sample.
    if (d?.kind === 'token' || d?.kind === 'frame') commit(draftRef.current);
  };

  // --- the table's frame ----------------------------------------------
  //
  // What the table can actually SHOW, drawn on the map at the same
  // scale — which is only knowable once the table has been calibrated
  // and the map has a declared width. Without either there is no box,
  // and the editor says so rather than drawing a lie.

  const zoomed = (board.widthInches ?? 0) * (view.zoom || 1);
  const denomX = (ppi ?? 0) * zoomed;
  const denomY = (ppiY ?? ppi ?? 0) * zoomed;
  const frame =
    view.mode === 'true' && denomX > 0 && denomY > 0 && tableViewport && nat
      ? {
          fw: tableViewport.w / denomX,
          fh: tableViewport.h / (denomY * (nat.h / nat.w)),
        }
      : null;

  // The comment above promises the editor "says so rather than drawing a
  // lie" — this is the saying-so (it was silent until 2026-08-23, and
  // the silence read as "there are no sizing settings"). Name the ONE
  // missing ingredient, most actionable first.
  const frameGap =
    view.mode !== 'true' || frame
      ? null
      : !tableViewport
        ? 'no table screen — adopt one in Screens and assign it the table role'
        : !(ppi && ppi > 0)
          ? "the table screen isn't calibrated — Screens → its row → calibrate"
          : !(board.widthInches && board.widthInches > 0)
            ? 'this map has no declared width — set "inches wide" below'
            : 'waiting on the map image';

  const px = (inches: number) => (inchPx ? inches * inchPx : 24);
  const names = new Map(roster.map((r) => [r.id, r.name]));
  const nameOf = (p: Placement) =>
    p.label ?? (p.entityId ? (names.get(p.entityId) ?? 'missing') : '?');

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-stone-950">
      {/* ---------------- canvas ---------------- */}
      <div
        ref={canvasRef}
        className={`absolute inset-0 touch-none overflow-hidden ${
          carrying
            ? 'cursor-copy'
            : tool === 'pan'
              ? 'cursor-grab'
              : tool === 'paint' || tool === 'fog'
                ? 'cursor-crosshair'
                : ''
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12)}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: baseW || undefined,
            height: baseH || undefined,
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`,
          }}
        >
          {mapUrl && (
            <img
              src={mapUrl}
              alt={board.name}
              className="absolute inset-0 h-full w-full select-none"
              draggable={false}
            />
          )}

          {cellPx && (
            <Zones zones={zones} width={baseW} height={baseH} cellPx={cellPx} dm />
          )}
          {/* The TACTICAL grid, and only ever that: an uncalibrated
              board can be painted but draws no lines, because lines
              would claim a scale the board hasn't got. */}
          {inchPx && <GridOverlay cellPx={inchPx} grid={board.grid} />}
          {cellPx && (
            <FogLayer
              fog={fog}
              width={baseW}
              height={baseH}
              cellPx={cellPx}
              dm
            />
          )}

          {/* Area extents — rooms the Warden can see and the table
              can't, and which one the brush is shaping. */}
          {cellPx &&
            tool === 'fog' &&
            areas.map((area) =>
              area.cells.map(([c, r]) => (
                <div
                  key={`${area.id}:${c},${r}`}
                  className="pointer-events-none absolute"
                  style={{
                    left: c * cellPx,
                    top: r * cellPx,
                    width: cellPx,
                    height: cellPx,
                    border: `${Math.max(1, cellPx * 0.04)}px solid ${
                      area.id === areaEditId
                        ? 'rgba(251,191,36,0.85)'
                        : 'rgba(125,211,252,0.45)'
                    }`,
                    background:
                      area.id === areaEditId
                        ? 'rgba(251,191,36,0.12)'
                        : 'rgba(125,211,252,0.07)',
                  }}
                />
              )),
            )}

          {frame && (
            <div
              className={`pointer-events-none absolute border-2 ${
                view.locked
                  ? 'border-dashed border-amber-500/60'
                  : 'border-amber-400 bg-amber-400/5'
              }`}
              style={{
                left: (view.cu - frame.fw / 2) * baseW,
                top: (view.cv - frame.fh / 2) * baseH,
                width: frame.fw * baseW,
                height: frame.fh * baseH,
                borderWidth: 2 / cam.z,
              }}
              aria-hidden
            />
          )}

          {[...placements]
            .sort((a, b) => (a.shape && a.shape !== 'circle' ? 0 : 1) - (b.shape && b.shape !== 'circle' ? 0 : 1))
            .map((p) => {
              const s = px(p.sizeInches ?? 1);
              const label = nameOf(p);
              return (
                <button
                  key={p.id}
                  className={`absolute flex items-center justify-center border-2 font-mono font-bold text-stone-950 ${
                    tool !== 'select' ? 'pointer-events-none' : ''
                  } ${selectedId === p.id ? 'ring-2 ring-amber-300' : ''} ${
                    p.hidden ? 'border-dashed border-stone-300/70' : 'border-stone-950/70'
                  }`}
                  style={{
                    left: p.u * baseW,
                    top: p.v * baseH,
                    width: s,
                    height: s,
                    fontSize: Math.max(8, s * 0.3),
                    opacity: p.hidden ? 0.55 : 1,
                    backgroundColor: p.color ?? '#d6d3d1',
                    ...shapeStyle(p),
                  }}
                  onPointerDown={(e) => {
                    if (tool !== 'select' || carrying) return;
                    e.stopPropagation();
                    capture(e);
                    mark();
                    setSelectedId(p.id ?? null);
                    if (p.id) dragRef.current = { kind: 'token', id: p.id };
                  }}
                  aria-label={`token ${label}`}
                  title={label}
                >
                  {label.slice(0, 2)}
                </button>
              );
            })}
        </div>
      </div>

      {/* ---------------- top bar ---------------- */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className={`pointer-events-auto flex items-center gap-2 px-3 py-2 ${panel}`}>
          <input
            className="w-48 bg-transparent font-serif text-lg text-stone-100 focus:outline-none"
            defaultValue={board.name}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== board.name) onBoard({ name });
            }}
            aria-label="board name"
          />
          <span
            className={`font-mono text-[10px] uppercase tracking-widest ${
              live ? 'text-emerald-500/80' : 'text-stone-500'
            }`}
            title={
              live
                ? 'this board is on the table — edits show up immediately'
                : 'off the table — shape it privately, then put it up'
            }
          >
            {live ? 'on the table' : 'off the table'}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <div className={`flex items-center gap-1 p-1 ${panel}`}>
            <button className={toolBtn(false)} onClick={undo} title="undo (⌘Z)" aria-label="undo">
              ↺
            </button>
            <button
              className={toolBtn(false)}
              onClick={() => zoomCenter(1 / 1.25)}
              aria-label="zoom out"
            >
              −
            </button>
            <button
              className="px-1 font-mono text-xs text-stone-400 hover:text-stone-100"
              onClick={resetCam}
              title="reset view"
            >
              {Math.round(cam.z * 100)}%
            </button>
            <button
              className={toolBtn(false)}
              onClick={() => zoomCenter(1.25)}
              aria-label="zoom in"
            >
              +
            </button>
          </div>
          <button
            className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl text-lg text-stone-300 hover:text-stone-100 ${panel}`}
            onClick={onClose}
            aria-label="close editor"
            title="close (esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ---------------- left tool rail ---------------- */}
      <div className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-2">
        <div className={`flex flex-col gap-1 p-1 ${panel}`}>
          <button
            className={toolBtn(tool === 'select')}
            onClick={() => setTool('select')}
            title="select (V) — drag tokens; drag the map to move your view"
            aria-label="select tool"
          >
            ⊹
          </button>
          <button
            className={toolBtn(tool === 'frame')}
            onClick={() => setTool('frame')}
            title={
              view.locked
                ? 'framing is locked — unlock below to aim the table'
                : 'aim the table (F) — drag to move what the table shows'
            }
            aria-label="frame tool"
          >
            <span className={view.locked ? 'opacity-40' : ''}>▣</span>
          </button>
          <button
            className={toolBtn(!!view.locked)}
            onClick={() => setView({ locked: !view.locked })}
            title={
              view.locked
                ? 'framing locked — tap to allow re-aiming (L)'
                : 'lock framing so it cannot be moved by accident (L)'
            }
            aria-label={view.locked ? 'unlock framing' : 'lock framing'}
          >
            {view.locked ? '🔒' : '🔓'}
          </button>
          <button
            className={toolBtn(tool === 'pan')}
            onClick={() => setTool('pan')}
            title="pan the workshop view (H)"
            aria-label="pan tool"
          >
            ✋
          </button>
          <button
            className={toolBtn(tool === 'paint')}
            onClick={() => raster && setTool('paint')}
            disabled={!raster}
            title={
              grid
                ? 'paint ground effects onto 1" tiles (B)'
                : raster
                  ? "paint ground effects (B) — this map has no declared width, so its cells are the picture's own, not inches"
                  : "this map's picture could not be measured, so it has no cells"
            }
            aria-label="paint tool"
          >
            <span className={raster ? '' : 'opacity-30'}>🖌</span>
          </button>
          <button
            className={toolBtn(tool === 'fog')}
            onClick={() => raster && setTool('fog')}
            disabled={!raster}
            title={
              raster
                ? 'fog (G) — paint darkness onto the map, or lift it. Reaching for the tool never darkens anything; every black cell is one somebody painted.'
                : "this map's picture could not be measured, so it has no cells"
            }
            aria-label="fog tool"
          >
            <span className={raster ? '' : 'opacity-30'}>🌫</span>
          </button>
          <button
            className={toolBtn(snap && !!grid)}
            onClick={() => {
              const next = !snap;
              setSnap(next);
              localStorage.setItem(SNAP_PREF, next ? '1' : '0');
            }}
            disabled={!grid}
            title={
              grid
                ? snap
                  ? 'tokens snap to the grid (S) — hold ⌥ while dragging to place freely'
                  : 'tokens place freely (S) — turn on to snap them to the grid'
                : 'set the map width first — snapping needs inch tiles'
            }
            aria-label={snap ? 'snapping on' : 'snapping off'}
          >
            <span className={grid ? '' : 'opacity-30'}>🧲</span>
          </button>
          <button
            className={toolBtn(board.grid?.on !== false)}
            onClick={() =>
              onBoard({ grid: { ...(board.grid ?? {}), on: board.grid?.on === false } })
            }
            title="this map's grid — the table shows the same lines"
            aria-label="toggle grid"
          >
            ▦
          </button>
        </div>

        {tool === 'fog' && (
          <div className={`flex flex-col gap-1 p-1 ${panel}`}>
            {(['darken', 'clear'] as const).map((m) => (
              <button
                key={m}
                className={`rounded-lg px-1 py-2 text-[10px] leading-tight ${
                  fogBrush === m
                    ? 'bg-amber-700 text-stone-950'
                    : 'text-stone-300 hover:bg-stone-800'
                }`}
                onClick={() => setFogBrush(m)}
                aria-label={`fog brush ${m}`}
                title={
                  areaEditId
                    ? m === 'darken'
                      ? 'extend this area'
                      : 'trim this area'
                    : m === 'darken'
                      ? 'make it dark'
                      : 'make it visible'
                }
              >
                {areaEditId ? (m === 'darken' ? 'shape' : 'trim') : m === 'darken' ? 'fog' : 'lift'}
              </button>
            ))}
          </div>
        )}

        {tool === 'paint' && (
          <div className={`flex flex-col gap-1 p-1 ${panel}`}>
            {EFFECTS.map((fx) => (
              <button
                key={fx}
                className={`flex h-9 w-11 items-center justify-center rounded-lg ${
                  brush === fx ? 'ring-2 ring-amber-400' : ''
                }`}
                style={{ backgroundColor: zoneBase(fx).fill }}
                onClick={() => setBrush(fx)}
                title={fx}
                aria-label={`brush ${fx}`}
              />
            ))}
            <button
              className={`mt-1 flex h-9 w-11 items-center justify-center rounded-lg text-sm ${
                secret ? 'bg-amber-700' : 'hover:bg-stone-800'
              }`}
              onClick={() => setSecret(!secret)}
              aria-label={secret ? 'painting hidden' : 'painting visible'}
              title={
                secret
                  ? 'painting behind the screen — the table sees nothing'
                  : 'painting in the open — the table sees it immediately'
              }
            >
              {secret ? '🙈' : '👁'}
            </button>
          </div>
        )}
      </div>

      {/* ---------------- right panels ---------------- */}
      <div className="absolute right-3 top-1/2 flex max-h-[80vh] w-64 -translate-y-1/2 flex-col gap-2 overflow-y-auto">
        <BoardPanel
          board={board}
          onBoard={onBoard}
          onWidth={setWidthInches}
          view={view}
          setView={setView}
          frameGap={frameGap}
        />
        {tool === 'paint' && (
          <GroundPanel
            zones={zones}
            editing={zoneEditId}
            onEdit={setZoneEditId}
            onToggle={(id) =>
              commit({
                ...draftRef.current,
                zones: (draftRef.current.zones ?? []).map((z) =>
                  z.id === id ? { ...z, hidden: z.hidden ? undefined : true } : z,
                ),
              })
            }
            onDelete={(id) =>
              commit({
                ...draftRef.current,
                zones: (draftRef.current.zones ?? []).filter((z) => z.id !== id),
              })
            }
          />
        )}
        {tool === 'fog' && (
          <FogPanel
            fog={fog}
            areas={areas}
            raster={raster}
            patch={unclaimed.length}
            editing={areaEditId}
            onEdit={setAreaEditId}
            onPaint={paint}
            setAll={setAll}
            areaName={areaName}
            onAreaName={setAreaName}
            onPromote={promotePatch}
            onRename={(id, name) =>
              commitAreas(areasRef.current.map((a) => (a.id === id ? { ...a, name } : a)))
            }
            onDrop={dropArea}
          />
        )}
      </div>

      {/* ---------------- token inspector ---------------- */}
      {selected && (
        <div
          className={`absolute bottom-24 left-1/2 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 ${panel}`}
        >
          <button
            className={`rounded-lg px-2.5 py-1.5 font-mono text-xs ${
              selected.hidden
                ? 'bg-stone-800 text-amber-300'
                : 'bg-emerald-800/70 text-emerald-100'
            }`}
            onClick={() => {
              mark();
              setPlacement(selected.id!, { hidden: selected.hidden ? undefined : true });
            }}
            title={
              selected.hidden
                ? 'behind the screen — tap to reveal it to the table'
                : 'the table can see this — tap to hide it'
            }
            aria-label={selected.hidden ? 'reveal to the table' : 'hide from the table'}
          >
            {selected.hidden ? '🙈 hidden' : '👁 shown'}
          </button>
          <input
            className={`${input} w-28`}
            value={selected.label ?? ''}
            placeholder={selected.entityId ? (names.get(selected.entityId) ?? '') : 'label'}
            onChange={(e) => setPlacement(selected.id!, { label: e.target.value || undefined })}
            aria-label="token label"
          />
          <select
            className={input}
            value={selected.shape ?? 'circle'}
            onChange={(e) =>
              setPlacement(selected.id!, { shape: e.target.value as Placement['shape'] })
            }
            aria-label="token shape"
          >
            {SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {selected.shape && selected.shape !== 'circle' && (
            <button
              className="rounded bg-stone-800 px-2 py-1 font-mono text-xs text-stone-300"
              onClick={() => setPlacement(selected.id!, { rot: ((selected.rot ?? 0) + 45) % 360 })}
              aria-label="rotate"
            >
              ⟳ {selected.rot ?? 0}°
            </button>
          )}
          <div className="flex gap-1">
            {TOKEN_COLORS.map((color) => (
              <button
                key={color}
                className={`h-5 w-5 rounded-full ${
                  selected.color === color ? 'ring-2 ring-stone-100' : ''
                }`}
                style={{ backgroundColor: color }}
                onClick={() => setPlacement(selected.id!, { color })}
                aria-label={`color ${color}`}
              />
            ))}
          </div>
          <select
            className={input}
            value={selected.sizeInches ?? 1}
            onChange={(e) => setPlacement(selected.id!, { sizeInches: Number(e.target.value) })}
            aria-label="token size"
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}"
              </option>
            ))}
          </select>
          {/* The link (§5): the token stores where it is and what it
              looks like, the entity supplies how it's DOING. Unlinking
              is ordinary — a rock, or something in the dark. */}
          <select
            className={input}
            value={selected.entityId ?? ''}
            onChange={(e) =>
              setPlacement(selected.id!, {
                entityId: e.target.value || undefined,
                ...(e.target.value ? {} : { label: selected.label ?? nameOf(selected) }),
              })
            }
            aria-label="link this token to someone"
          >
            <option value="">no link</option>
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            className="rounded px-2 py-1 text-sm text-stone-400 hover:bg-red-950 hover:text-red-300"
            onClick={() => {
              mark();
              setPlacements(placements.filter((p) => p.id !== selected.id));
              setSelectedId(null);
            }}
          >
            delete
          </button>
        </div>
      )}

      {/* ---------------- the roster strip ---------------- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 p-3">
        <div className={`pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 p-2 ${panel}`}>
          <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">
            {carrying ? 'tap the map' : 'place'}
          </span>
          {roster.map((r) => (
            <button
              key={r.id}
              className={`rounded-md px-2 py-1 text-xs transition-colors ${
                carrying?.id === r.id
                  ? 'bg-amber-700 text-stone-950'
                  : 'bg-stone-800 text-stone-200 hover:bg-stone-700'
              }`}
              onClick={() => setCarrying(carrying?.id === r.id ? null : r)}
              title={`${r.name} — tap, then tap the map`}
            >
              {r.name}
            </button>
          ))}
          <button
            className="rounded-md bg-stone-800 px-2 py-1 text-xs text-stone-400 transition-colors hover:bg-stone-700 hover:text-stone-100"
            onClick={() => addPlacement(view.cu, view.cv)}
            title="an unlinked marker — a rock, a barrel, something in the dark"
          >
            + marker
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- the panels --------------------------------------------------------

/** What the BOARD is — the shelf row's own facts, plus how it's aimed. */
function BoardPanel({
  board,
  onBoard,
  onWidth,
  view,
  setView,
  frameGap,
}: {
  board: Board;
  onBoard: (patch: { name?: string; widthInches?: number | null; grid?: unknown }) => void;
  /** The width goes through its own door, because calibrating painted cells asks first. */
  onWidth: (next: number | null) => boolean;
  view: BoardView;
  setView: (patch: Partial<BoardView>) => void;
  /** Why true scale can't draw the table's frame right now — null when it can. */
  frameGap: string | null;
}) {
  return (
    <section className={`space-y-2 p-3 ${panel}`}>
      <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">board</span>
      <label className="flex items-center gap-2 text-xs text-stone-400">
        <span className="w-20">inches wide</span>
        <input
          className={`${input} w-20 text-right font-mono`}
          type="number"
          min={1}
          defaultValue={board.widthInches ?? ''}
          placeholder="—"
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const next = raw ? Number(raw) : null;
            if (next === (board.widthInches ?? null)) return;
            // Declined at the warning: put the field back to the truth,
            // so the box never shows a width the board hasn't got.
            if (!onWidth(next)) e.target.value = String(board.widthInches ?? '');
          }}
          aria-label="map width in inches"
        />
      </label>
      <p className="text-[11px] leading-snug text-stone-600">
        The map's real width. Print-destined art carries its DPI — pixels ÷ dpi. Without
        it you can still paint fog and areas — on the picture's own cells — but there's
        no grid, no snapping and nothing measured in inches.
      </p>
      <div className="flex items-center gap-2">
        <span className="w-20 text-xs text-stone-400">grid</span>
        <input
          className="h-7 w-10 rounded border border-stone-700 bg-stone-900"
          type="color"
          value={board.grid?.color ?? '#fbbf24'}
          onChange={(e) => onBoard({ grid: { ...(board.grid ?? {}), color: e.target.value } })}
          aria-label="grid colour"
        />
        <input
          className="flex-1"
          type="range"
          min={0}
          max={0.8}
          step={0.02}
          value={board.grid?.opacity ?? 0.22}
          onChange={(e) =>
            onBoard({ grid: { ...(board.grid ?? {}), opacity: Number(e.target.value) } })
          }
          aria-label="grid opacity"
        />
      </div>
      <div className="flex items-center gap-1.5 pt-1">
        {(['fit', 'true'] as const).map((mode) => (
          <button
            key={mode}
            className={`rounded-md px-2 py-1 text-xs ${
              view.mode === mode
                ? 'bg-amber-700 text-stone-950'
                : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
            }`}
            onClick={() => setView({ mode })}
            title={
              mode === 'fit'
                ? 'the whole map on the table, whatever size that is'
                : 'true scale — one drawn inch is one real inch on the calibrated table'
            }
          >
            {mode === 'fit' ? 'fit' : 'true scale'}
          </button>
        ))}
        {view.mode === 'true' && (
          <span className="ml-auto font-mono text-[11px] text-stone-500">
            ×{(view.zoom || 1).toFixed(2)}
          </span>
        )}
      </div>
      {frameGap && (
        <p className="text-[11px] leading-snug text-amber-500/90">{frameGap}</p>
      )}
      {view.mode === 'true' && (
        <input
          className="w-full"
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          value={view.zoom || 1}
          onChange={(e) => setView({ zoom: Number(e.target.value) })}
          aria-label="zoom"
        />
      )}
    </section>
  );
}

/** Painted ground, one row per LAYER — identity is the id, not the effect. */
function GroundPanel({
  zones,
  editing,
  onEdit,
  onToggle,
  onDelete,
}: {
  zones: Zone[];
  editing: string | null;
  onEdit: (id: string | null) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className={`space-y-1.5 p-3 ${panel}`}>
      <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">ground</span>
      {zones.length === 0 && <p className="text-xs text-stone-600">nothing painted</p>}
      {zones.map((zone) => (
        <div key={zone.id} className="flex items-center gap-1.5">
          <button
            className={`h-4 w-4 shrink-0 rounded ${editing === zone.id ? 'ring-2 ring-amber-400' : ''}`}
            style={{ backgroundColor: zoneBase(zone.effect).fill }}
            onClick={() => onEdit(editing === zone.id ? null : zone.id)}
            title="paint into this layer"
            aria-label={`edit ${zone.effect} layer`}
          />
          <span className="min-w-0 flex-1 truncate text-xs text-stone-300">
            {zone.effect}
            <span className="ml-1 font-mono text-[10px] text-stone-600">{zone.cells.length}</span>
          </span>
          <button
            className="rounded px-1 text-xs"
            onClick={() => onToggle(zone.id)}
            title={zone.hidden ? 'hidden from the table' : 'the table can see this'}
            aria-label={zone.hidden ? 'reveal layer' : 'hide layer'}
          >
            {zone.hidden ? '🙈' : '👁'}
          </button>
          <button
            className="rounded px-1 text-xs text-stone-500 hover:text-red-300"
            onClick={() => onDelete(zone.id)}
            aria-label={`delete ${zone.effect} layer`}
          >
            ✕
          </button>
        </div>
      ))}
    </section>
  );
}

/**
 * Fog: two verbs, the brush's leftovers, and the named places darkness
 * gets lifted from.
 *
 * There is no mode switch here and there deliberately isn't one. The
 * dungeon posture — everything black until the posse walks in — is the
 * "cover all" button and nothing more; a board arrives showing its
 * artwork and every dark cell is one somebody painted (rule 1).
 *
 * AREAS are the board's, not the fight's: named in prep, reusable next
 * campaign, fogged and lifted with one tap. They carry no state of
 * their own — whether the vault is dark is READ OFF the set each time
 * anyone asks, so there is nothing to keep in step. They stay DM-only:
 * what travels is the set of dark cells, so the name and shape of an
 * unentered room never reach the table.
 *
 * EVERYWHERE ELSE is a row, not a place. See `restCells` — it is
 * derived at ask-time, has no id and is never stored, and its cell
 * count is the prep progress bar: partition the map into rooms and
 * watch it fall to nothing.
 */
function FogPanel({
  fog,
  areas,
  raster,
  patch,
  editing,
  onEdit,
  onPaint,
  setAll,
  areaName,
  onAreaName,
  onPromote,
  onRename,
  onDrop,
}: {
  fog: Fog;
  areas: Area[];
  /** The board's PAINT lattice — inches where it's calibrated, the picture's own raster where it isn't. */
  raster: Grid | null;
  /** How many dark cells are sitting there unnamed. */
  patch: number;
  editing: string | null;
  onEdit: (id: string | null) => void;
  onPaint: (cells: Cell[], dark: boolean) => void;
  setAll: (dark: boolean) => void;
  areaName: string;
  onAreaName: (name: string) => void;
  onPromote: () => void;
  onRename: (id: string, name: string) => void;
  onDrop: (id: string) => void;
}) {
  const rest = restCells(raster, areas);
  return (
    <section className={`space-y-1.5 p-3 ${panel}`}>
      <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">fog</span>
      <div className="flex gap-1.5">
        <button
          className="flex-1 rounded-md bg-stone-800 px-2 py-1 text-xs text-stone-300 hover:bg-stone-700"
          onClick={() => setAll(false)}
          disabled={!fog.dark.length}
          title="lift everything, areas included"
        >
          clear all
        </button>
        <button
          className="flex-1 rounded-md bg-stone-800 px-2 py-1 text-xs text-stone-300 hover:bg-stone-700"
          onClick={() => setAll(true)}
          disabled={!raster}
          title="cover the whole map — the dungeon posture, which is one tap"
        >
          cover all
        </button>
      </div>

      {/* The promotion: a patch the brush drew becomes a place with a
          name on the board. Only offered when there is something to
          name, so it is never a button that does nothing. */}
      <div className="flex items-center gap-1.5 pt-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">
          areas
        </span>
        <span className="font-mono text-[10px] text-stone-600">{areas.length}</span>
      </div>
      {patch > 0 && (
        <div className="flex items-center gap-1.5">
          <input
            className={`${input} min-w-0 flex-1 text-xs`}
            value={areaName}
            placeholder={`name these ${patch} cells`}
            onChange={(e) => onAreaName(e.target.value)}
            aria-label="name this patch"
          />
          <button
            className="rounded-md bg-stone-800 px-2 py-1 text-xs text-amber-300 hover:bg-stone-700"
            onClick={onPromote}
            title="make this patch a named place on the map — it outlives the fight"
          >
            name it
          </button>
        </div>
      )}
      {areas.length === 0 && patch === 0 && (
        <p className="text-xs text-stone-600">
          paint a patch with the brush, then name it to keep it
        </p>
      )}
      {areas.map((area) => (
        <AreaRow
          key={area.id}
          name={area.name}
          count={area.cells.length}
          status={areaStatus(fog, area)}
          editing={editing === area.id}
          onEdit={() => onEdit(editing === area.id ? null : area.id)}
          onRename={(name) => onRename(area.id, name)}
          onPaint={(dark) => onPaint(area.cells, dark)}
          onDrop={() => onDrop(area.id)}
        />
      ))}
      {/* Pinned, last, and visibly not a place: no shape button, no
          rename, no delete, because there is no row anywhere to shape,
          rename or delete. */}
      {raster && (
        <AreaRow
          name="everywhere else"
          count={rest.length}
          status={areaStatus(fog, { id: 'rest', name: 'rest', cells: rest })}
          onPaint={(dark) => onPaint(rest, dark)}
        />
      )}
    </section>
  );
}

/** The words a status wears, and the verb it offers. */
const STATUS: Record<AreaStatus, { label: string; tone: string; title: string }> = {
  fogged: { label: 'dark', tone: 'bg-stone-800 text-amber-300', title: 'dark — tap to lift it' },
  lifted: {
    label: 'lifted',
    tone: 'bg-emerald-800/70 text-emerald-100',
    title: 'lifted — tap to cover it',
  },
  partial: {
    label: 'part',
    tone: 'bg-stone-800 text-stone-400',
    title: 'partly dark — tap to cover the rest',
  },
};

/**
 * One row of the areas list. Shared by the real ones and by "everywhere
 * else", because the tap is identical — resolve some cells, write the
 * set — and only the affordances around it differ.
 */
function AreaRow({
  name,
  count,
  status,
  editing,
  onEdit,
  onRename,
  onPaint,
  onDrop,
}: {
  name: string;
  count: number;
  status: AreaStatus;
  editing?: boolean;
  onEdit?: () => void;
  onRename?: (name: string) => void;
  onPaint: (dark: boolean) => void;
  onDrop?: () => void;
}) {
  const derived = !onRename;
  const { label, tone, title } = STATUS[status];
  return (
    <div className={`flex items-center gap-1.5 ${derived ? 'border-t border-stone-800 pt-1.5' : ''}`}>
      {onEdit ? (
        <button
          className={`h-4 w-4 shrink-0 rounded border ${
            editing ? 'border-amber-400 bg-amber-400/30' : 'border-sky-400/50'
          }`}
          onClick={onEdit}
          title="shape this area with the brush"
          aria-label={`shape ${name}`}
        />
      ) : (
        <span className="h-4 w-4 shrink-0" aria-hidden />
      )}
      {onRename ? (
        <input
          className="min-w-0 flex-1 bg-transparent text-xs text-stone-300 focus:outline-none"
          value={name}
          onChange={(e) => onRename(e.target.value)}
          aria-label="area name"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs italic text-stone-500">{name}</span>
      )}
      <span className="font-mono text-[10px] text-stone-600">{count}</span>
      <button
        className={`rounded px-1.5 py-0.5 text-[10px] ${tone}`}
        onClick={() => onPaint(status !== 'fogged')}
        disabled={count === 0}
        title={title}
        aria-label={status === 'fogged' ? `lift ${name}` : `fog ${name}`}
      >
        {label}
      </button>
      {onDrop ? (
        <button
          className="rounded px-1 text-xs text-stone-500 hover:text-red-300"
          onClick={onDrop}
          aria-label={`delete ${name}`}
        >
          ✕
        </button>
      ) : (
        <span className="px-1 text-xs" aria-hidden>
          {' '}
        </span>
      )}
    </div>
  );
}
