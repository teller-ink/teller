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
//     source image and painted ground is 1-inch cell indices, so
//     re-uploading a higher-res scan moves nothing and correcting
//     `widthInches` afterwards leaves every token glued to the feature
//     it was standing on.
//   * PHYSICAL MINIS PIN THE MAP. Panning mid-combat slides the ground
//     out from under real minis, so aiming the table is its OWN tool,
//     can be locked outright, and asks before overruling a running
//     fight. The default tool drags tokens and pans the workshop view —
//     a stray drag can never re-aim the table.
//   * HIDDEN MEANS ABSENT. A hidden placement or ground layer is
//     stripped server-side (`server/public.ts`), never dimmed, so
//     nothing is discoverable in devtools. New tokens start hidden.
//   * FOG NEVER SWITCHES ITSELF ON. Reaching for the tool, or shaping
//     an area, leaves the table clear; blacking it out is a decision
//     someone takes in the panel.
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
  cellOf,
  clamp01,
  DEFAULT_VIEW,
  EFFECTS,
  gridOf,
  hasCell,
  localId,
  SIZES,
  snapUv,
  TOKEN_COLORS,
  withIds,
  withoutCell,
  zoneBase,
  type Board,
  type BoardState,
  type BoardView,
  type Cell,
  type Fog,
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
  onBoard: (patch: { name?: string; widthInches?: number | null; grid?: unknown }) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const [camReady, setCamReady] = useState(false);

  const [tool, setTool] = useState<Tool>('select');
  const [brush, setBrush] = useState<string>(EFFECTS[0]);
  const [fogBrush, setFogBrush] = useState<'reveal' | 'cover'>('reveal');
  const [secret, setSecret] = useState(false);
  const [snap, setSnap] = useState(() => localStorage.getItem(SNAP_PREF) !== '0');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoneEditId, setZoneEditId] = useState<string | null>(null);
  const [regionEditId, setRegionEditId] = useState<string | null>(null);
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

  // A different board is a different draft, always — no carry-over.
  useEffect(() => {
    const seeded = withIds(state);
    draftRef.current = seeded;
    setDraft(seeded);
    undoRef.current = [];
    dirty.current = false;
    setSelectedId(null);
    setZoneEditId(null);
    setRegionEditId(null);
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

  const grid = gridOf(board.widthInches, nat);
  const cellPx = grid && baseW ? baseW / grid.cols : null;
  const place = (u: number, v: number, sizeInches: number, free = false) =>
    snap && !free ? snapUv(u, v, sizeInches, grid) : { u, v };

  const cellAt = (clientX: number, clientY: number): Cell | null => {
    const uv = toUv(clientX, clientY);
    return uv ? cellOf(uv.u, uv.v, grid) : null;
  };

  // --- the pieces of state, and the writers ---------------------------

  const placements = draft.placements ?? [];
  const zones = draft.zones ?? [];
  const fog: Fog = draft.fog ?? { on: false, revealed: [] };
  const regions = fog.regions ?? [];
  const editingRegion = regions.find((r) => r.id === regionEditId) ?? null;
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

  const setFog = (patch: Partial<Fog>) =>
    commit({ ...draftRef.current, fog: { ...fog, ...patch } });

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

  const fogPainted = (cell: Cell) =>
    regionEditId ? hasCell(editingRegion?.cells ?? [], cell) : hasCell(fog.revealed ?? [], cell);

  const applyFog = (cell: Cell, op: 'add' | 'remove') => {
    const d = draftRef.current;
    const f: Fog = d.fog ?? { on: false, revealed: [] };
    const edit = (cells: Cell[]) => {
      const next = withoutCell(cells, cell);
      return op === 'add' ? [...next, cell] : next;
    };
    // Painting into an area SHAPES the room; otherwise it clears ground.
    const nextFog: Fog = regionEditId
      ? {
          ...f,
          regions: (f.regions ?? []).map((r) =>
            r.id === regionEditId ? { ...r, cells: edit(r.cells) } : r,
          ),
        }
      : { ...f, revealed: edit(f.revealed ?? []) };
    commit({ ...d, fog: nextFog });
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
      if (e.key === 'b' && grid) setTool('paint');
      if (e.key === 'g' && grid) setTool('fog');
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
        const op = fogBrush === 'reveal' ? (fogPainted(cell) ? 'remove' : 'add') : 'remove';
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

  const px = (inches: number) => (cellPx ? inches * cellPx : 24);
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
          {cellPx && <GridOverlay cellPx={cellPx} grid={board.grid} />}
          {cellPx && (
            <FogLayer fog={fog} width={baseW} height={baseH} cellPx={cellPx} dm />
          )}

          {/* Area extents — rooms the Warden can see and the table
              can't, and which one the brush is shaping. */}
          {cellPx &&
            tool === 'fog' &&
            regions.map((region) =>
              region.cells.map(([c, r]) => (
                <div
                  key={`${region.id}:${c},${r}`}
                  className="pointer-events-none absolute"
                  style={{
                    left: c * cellPx,
                    top: r * cellPx,
                    width: cellPx,
                    height: cellPx,
                    border: `${Math.max(1, cellPx * 0.04)}px solid ${
                      region.id === regionEditId
                        ? 'rgba(251,191,36,0.85)'
                        : 'rgba(125,211,252,0.45)'
                    }`,
                    background:
                      region.id === regionEditId
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
            onClick={() => grid && setTool('paint')}
            disabled={!grid}
            title={
              grid
                ? 'paint ground effects onto 1" tiles (B)'
                : 'set the map width first — tiles need inches'
            }
            aria-label="paint tool"
          >
            <span className={grid ? '' : 'opacity-30'}>🖌</span>
          </button>
          <button
            className={toolBtn(tool === 'fog')}
            onClick={() => grid && setTool('fog')}
            disabled={!grid}
            title={
              grid
                ? "fog (G) — paint what the posse can see. Reaching for the tool never blacks out the table; that's the switch in the fog panel."
                : 'set the map width first — fog uses inch tiles'
            }
            aria-label="fog tool"
          >
            <span className={grid ? '' : 'opacity-30'}>🌫</span>
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
            {(['reveal', 'cover'] as const).map((m) => (
              <button
                key={m}
                className={`rounded-lg px-1 py-2 text-[10px] leading-tight ${
                  fogBrush === m
                    ? 'bg-amber-700 text-stone-950'
                    : 'text-stone-300 hover:bg-stone-800'
                }`}
                onClick={() => setFogBrush(m)}
                aria-label={`fog brush ${m}`}
              >
                {m}
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
        <BoardPanel board={board} onBoard={onBoard} view={view} setView={setView} frameGap={frameGap} />
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
            grid={grid}
            editing={regionEditId}
            onEdit={setRegionEditId}
            setFog={setFog}
            mark={mark}
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
  view,
  setView,
  frameGap,
}: {
  board: Board;
  onBoard: (patch: { name?: string; widthInches?: number | null; grid?: unknown }) => void;
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
            if (next !== (board.widthInches ?? null)) onBoard({ widthInches: next });
          }}
          aria-label="map width in inches"
        />
      </label>
      <p className="text-[11px] leading-snug text-stone-600">
        The map's real width. Print-destined art carries its DPI — pixels ÷ dpi. Without
        it there are no cells, so no grid, no painting and no fog.
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
 * Fog, and the AREAS that make it usable at speed: paint a room once
 * during prep, reveal the whole thing with one tap when the posse walks
 * in. Areas are DM-only structure — the snapshot flattens fog to plain
 * revealed cells, so the name and shape of an unentered room never
 * reaches the table.
 */
function FogPanel({
  fog,
  grid,
  editing,
  onEdit,
  setFog,
  mark,
}: {
  fog: Fog;
  grid: { cols: number; rows: number } | null;
  editing: string | null;
  onEdit: (id: string | null) => void;
  setFog: (patch: Partial<Fog>) => void;
  mark: () => void;
}) {
  const regions = fog.regions ?? [];
  return (
    <section className={`space-y-1.5 p-3 ${panel}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">fog</span>
        <button
          className={`rounded-md px-2 py-1 text-xs ${
            fog.on ? 'bg-amber-700 text-stone-950' : 'bg-stone-800 text-stone-300'
          }`}
          onClick={() => {
            mark();
            setFog({ on: !fog.on });
          }}
          title={
            fog.on
              ? 'the table is dark except where you have revealed'
              : 'the table is clear — turn this on to black it out'
          }
        >
          {fog.on ? 'on' : 'off'}
        </button>
      </div>
      <div className="flex gap-1.5">
        <button
          className="rounded-md bg-stone-800 px-2 py-1 text-xs text-stone-300 hover:bg-stone-700"
          onClick={() => {
            mark();
            setFog({ revealed: allCells(grid) });
          }}
          disabled={!grid}
          title="reveal the whole map"
        >
          reveal all
        </button>
        <button
          className="rounded-md bg-stone-800 px-2 py-1 text-xs text-stone-300 hover:bg-stone-700"
          onClick={() => {
            mark();
            setFog({ revealed: [] });
          }}
          title="cover the whole map again"
        >
          hide all
        </button>
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">areas</span>
        <button
          className="rounded px-1.5 text-sm text-stone-400 hover:text-stone-100"
          onClick={() => {
            mark();
            const region = {
              id: localId('rgn'),
              name: `Area ${regions.length + 1}`,
              cells: [] as Cell[],
              revealed: false,
            };
            setFog({ regions: [...regions, region] });
            onEdit(region.id);
          }}
          title="paint a room now, reveal it in one tap later"
          aria-label="add an area"
        >
          +
        </button>
      </div>
      {regions.length === 0 && <p className="text-xs text-stone-600">no areas yet</p>}
      {regions.map((region) => (
        <div key={region.id} className="flex items-center gap-1.5">
          <button
            className={`h-4 w-4 shrink-0 rounded border ${
              editing === region.id ? 'border-amber-400 bg-amber-400/30' : 'border-sky-400/50'
            }`}
            onClick={() => onEdit(editing === region.id ? null : region.id)}
            title="shape this area with the brush"
            aria-label={`shape ${region.name}`}
          />
          <input
            className="min-w-0 flex-1 bg-transparent text-xs text-stone-300 focus:outline-none"
            value={region.name}
            onChange={(e) =>
              setFog({
                regions: regions.map((r) =>
                  r.id === region.id ? { ...r, name: e.target.value } : r,
                ),
              })
            }
            aria-label="area name"
          />
          <span className="font-mono text-[10px] text-stone-600">{region.cells.length}</span>
          <button
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              region.revealed ? 'bg-emerald-800/70 text-emerald-100' : 'bg-stone-800 text-amber-300'
            }`}
            onClick={() => {
              mark();
              setFog({
                regions: regions.map((r) =>
                  r.id === region.id ? { ...r, revealed: !r.revealed } : r,
                ),
              });
            }}
            title={region.revealed ? 'the posse has been here' : 'the posse has not been here'}
          >
            {region.revealed ? 'shown' : 'hidden'}
          </button>
          <button
            className="rounded px-1 text-xs text-stone-500 hover:text-red-300"
            onClick={() => setFog({ regions: regions.filter((r) => r.id !== region.id) })}
            aria-label={`delete ${region.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </section>
  );
}
