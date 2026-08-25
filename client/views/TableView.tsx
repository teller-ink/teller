// THE TABLE — the screen IN the table, under the minis.
//
// Ported from the old app (src/views/TableView.tsx), which is the
// visual and behavioural spec: the active board full-bleed, the grid on
// the map's own inch lines, ground markers under the minis, fog over
// the lot. It is the GROUND and nothing else (rule 6) — no bookkeeping,
// no notices, no controls. Everything it draws arrives from the
// console over the stream, and the one gesture it answers is a tap to
// go fullscreen, which is about the browser's chrome rather than about
// the game.
//
// What changed in the new world is only where the facts come from. A
// scene was a board with a fight smeared onto it; now the board is an
// asset and the fight is board STATE (§4), and a placement links to an
// entity by id while owning its own look (§5). So the glow is derived
// here, at render, through `placement.entityId` → the snapshot's
// roster — a token cannot go stale, and an unlinked one (a rock,
// something in the dark) still draws from its own label and colour.

import { useEffect, useId, useState } from 'react';
import {
  fileUrl,
  publicSnapshot,
  type PublicBoard,
  type PublicEntity,
  type PublicSnapshot,
} from '../lib/api.ts';
import { Zones } from '../components/board/Zones.tsx';
import type { Placement, Zone } from '../components/board/model.ts';
import { DECLARED, PUBLIC, useLive } from '../lib/use-session.ts';
import { useWakeLock } from '../lib/use-wake-lock.ts';
import { ConnectionHint } from '../components/ConnectionHint.tsx';
import { chipsOf, kinds, type KindDef } from './passive.ts';

// The painted ground and the shaped tokens arrive inside `state`, which
// `client/lib/api.ts` types only as far as the table used to draw. The
// stored shapes are the editor's — one board state, two surfaces — so
// they are read back through the editor's own types rather than a
// second spelling invented here (model.ts's closing warning).
type TableState = {
  zones?: Zone[];
  placements?: Placement[];
};

// A tap anywhere toggles fullscreen — a gesture, not a control: the
// table renders no button and nothing about the game can be touched
// from this surface (rule 6). It exists because the glass is usually a
// TV driven by someone else's browser chrome, and the chrome is not
// part of the ground.
const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
};

// ---- the grid ----------------------------------------------------------
// Drawn in MAP space, inside the same transformed layer as the tokens
// and the fog, so it agrees with every painted cell by construction.
// At true scale one cell is exactly one calibrated inch.

const GRID_DEFAULTS = { color: '#fbbf24', opacity: 0.22 };

/** '#rrggbb' → 'rgba(r, g, b, a)' */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function GridOverlay({
  cellPx,
  cellPxY,
  grid,
}: {
  cellPx: number;
  /** Vertical cell size; differs from cellPx only on a stretched table. */
  cellPxY?: number;
  grid?: { on?: boolean; color?: string; opacity?: number };
}) {
  if (grid?.on === false || !cellPx) return null;
  const cellY = cellPxY || cellPx;
  const line = rgba(
    grid?.color ?? GRID_DEFAULTS.color,
    grid?.opacity ?? GRID_DEFAULTS.opacity,
  );
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `linear-gradient(to right, ${line} 0 1px, transparent 1px 100%), linear-gradient(to bottom, ${line} 0 1px, transparent 1px 100%)`,
        backgroundSize: `${cellPx}px ${cellY}px`,
      }}
      aria-hidden
    />
  );
}

// ---- the fog -----------------------------------------------------------
// The darkness, near-opaque; there is no DM mode here, because this
// screen is never the DM's.
//
// ONE SET, ONE MASK (`core/fog.ts`). A sheet is masked down to the dark
// cells, so the barn goes black and the rest of the map keeps showing
// its own artwork — and a dungeon that starts black is the same code
// with every cell in the set. The edges are soft because the mask is
// blurred, not because the geometry is finer than an inch.

function FogLayer({
  fog,
  left,
  top,
  width,
  height,
  cellPx,
  cellPxY,
}: {
  fog?: { dark?: [number, number][] };
  left: number;
  top: number;
  width: number;
  height: number;
  cellPx: number;
  cellPxY?: number;
}) {
  const uid = useId();
  // The snapshot arrives as the bare set — no area names, no shapes,
  // nothing but where the dark is. A map with nothing covered is just a
  // map, and draws nothing at all.
  const painted = fog?.dark ?? [];
  if (!painted.length) return null;
  if (!cellPx || !width || !height) return null;
  const cellY = cellPxY || cellPx;
  const blur = Math.min(cellPx, cellY) * 0.28;
  const bleed = Math.min(cellPx, cellY) * 0.12; // neighbours meet before the blur
  return (
    <svg
      className="pointer-events-none absolute"
      style={{ left, top, width, height }}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <defs>
        <filter id={`fogblur-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <mask id={`fogmask-${uid}`}>
          <rect x="0" y="0" width={width} height={height} fill="black" />
          <g filter={`url(#fogblur-${uid})`}>
            {/* a cell can arrive twice — index keys, since the
                coordinates are not unique here */}
            {painted.map(([c, r], i) => (
              <rect
                key={i}
                x={c * cellPx - bleed}
                y={r * cellY - bleed}
                width={cellPx + bleed * 2}
                height={cellY + bleed * 2}
                rx={cellPx * 0.3}
                fill="white"
              />
            ))}
          </g>
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        fill="#0a0908"
        opacity={0.97}
        mask={`url(#fogmask-${uid})`}
      />
    </svg>
  );
}

// ---- the board's bytes -------------------------------------------------

/** A ticketed url for the active board's image, refetched when it
 *  changes. An `<img>` can't send headers, so the proof rides in the
 *  query string (rule 7's second subject). */
function useBoardImage(key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }
    let live = true;
    fileUrl(key)
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);
  return url;
}

// ---- the view ----------------------------------------------------------

export function TableView({
  ppi,
  ppiY,
}: {
  /** This screen's own calibration — px per true inch, per axis. */
  ppi?: number;
  ppiY?: number;
}) {
  useWakeLock();
  const snapshot = useLive<PublicSnapshot>(publicSnapshot, [], { on: PUBLIC });
  const defs = useLive<KindDef[]>(kinds, [], { on: DECLARED });
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const active: PublicBoard | null = snapshot.data?.board ?? null;
  const mapKey = active?.board.key ?? null;
  const mapUrl = useBoardImage(mapKey);

  // Natural dimensions belong to the current image only.
  useEffect(() => setNat(null), [mapKey]);

  // Measure via ref AND onLoad: a cached image can complete before
  // React attaches the load listener, so onLoad alone silently misses.
  const measure = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth) {
      setNat((prev) =>
        prev?.w === el.naturalWidth && prev?.h === el.naturalHeight
          ? prev
          : { w: el.naturalWidth, h: el.naturalHeight },
      );
    }
  };

  if (!mapUrl || !active) return <IdleTable />;

  const widthInches = active.board.widthInches;
  const state = active.state ?? {};
  const ground = state as TableState;
  const view = state.view;

  // One geometry for both modes: where the map sits on the glass. Two
  // scales, because a true inch across need not be a true inch down: on
  // a stretched or overscanned picture the axes calibrate differently,
  // and a 1" square must still measure 1" both ways against a physical
  // ruler. On a correctly-set-up display sx === sy.
  let rect: { left: number; top: number; sx: number; sy: number } | null = null;
  if (nat) {
    if (view?.mode === 'true' && widthInches && ppi) {
      const zoom = view.zoom || 1;
      const pxY = ppiY ?? ppi;
      const sx = ((ppi * widthInches) / nat.w) * zoom;
      // The map's physical height follows from its aspect, so the
      // vertical scale differs from sx only by the vertical ppi.
      const sy = ((pxY * widthInches) / nat.w) * zoom;
      rect = {
        sx,
        sy,
        left: vp.w / 2 - (view.cu ?? 0.5) * nat.w * sx,
        top: vp.h / 2 - (view.cv ?? 0.5) * nat.h * sy,
      };
    } else {
      const scale = Math.min(vp.w / nat.w, vp.h / nat.h);
      rect = {
        sx: scale,
        sy: scale,
        left: (vp.w - nat.w * scale) / 2,
        top: (vp.h - nat.h * scale) / 2,
      };
    }
  }

  // Tokens size in MAP inches so they stay glued to the ground in
  // either mode (at true scale a 1" token IS 1" of glass).
  const pxPerMapInch =
    rect && nat && widthInches ? (rect.sx * nat.w) / widthInches : null;
  const pxPerMapInchY =
    rect && nat && widthInches ? (rect.sy * nat.w) / widthInches : null;

  const roster = snapshot.data?.roster ?? [];
  const turn = snapshot.data?.turn;
  const acting =
    turn && turn.turn !== null ? (turn.order[turn.turn]?.entityId ?? null) : null;

  return (
    <main className="relative h-dvh overflow-hidden bg-black" onClick={toggleFullscreen}>
      {/* The one thing the ground ever says about itself. It is a
          STATUS the screen wears, not bookkeeping and not a control
          (rule 6, and the same class as the identify flash) — a table
          TV quietly showing a five-minute-old fight is the failure this
          exists to make visible. The table still draws no notice and no
          button. */}
      <ConnectionHint />
      <img
        key={mapKey}
        src={mapUrl}
        alt=""
        ref={measure}
        onLoad={(e) => measure(e.currentTarget)}
        className="absolute max-w-none"
        style={
          rect && nat
            ? {
                width: nat.w * rect.sx,
                height: nat.h * rect.sy,
                left: rect.left,
                top: rect.top,
              }
            : { visibility: 'hidden' }
        }
      />
      {rect && nat && pxPerMapInch && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: rect.left,
            top: rect.top,
            width: nat.w * rect.sx,
            height: nat.h * rect.sy,
          }}
        >
          <GridOverlay
            cellPx={pxPerMapInch}
            cellPxY={pxPerMapInchY ?? undefined}
            grid={active.board.grid}
          />
          {/* painted ground, above the grid and under the minis — the
              console's own renderer, one layer melted into one blob.
              Hidden layers never arrive here (server/public.ts strips
              them), so the table needs no `dm` and no awareness. */}
          <Zones
            zones={ground.zones ?? []}
            width={nat.w * rect.sx}
            height={nat.h * rect.sy}
            cellPx={pxPerMapInch}
            cellPxY={pxPerMapInchY ?? undefined}
          />
        </div>
      )}
      {rect &&
        nat &&
        // Shapes first, discs on top: a rotated wedge or a square is
        // usually ground a mini stands ON, and the editor sorts the
        // same way — the two surfaces must not disagree about who
        // covers whom.
        [...(ground.placements ?? [])]
          .sort(
            (a, b) =>
              (a.shape && a.shape !== 'circle' ? 0 : 1) -
              (b.shape && b.shape !== 'circle' ? 0 : 1),
          )
          .map((placement, i) => (
            <Token
              key={i}
              label={placement.label}
              color={placement.color}
              entityId={placement.entityId}
              entity={
                placement.entityId
                  ? roster.find((e) => e.id === placement.entityId)
                  : undefined
              }
              acting={Boolean(placement.entityId) && placement.entityId === acting}
              defs={defs.data ?? []}
              shape={placement.shape}
              rot={placement.rot}
              left={rect.left + placement.u * nat.w * rect.sx}
              top={rect.top + placement.v * nat.h * rect.sy}
              size={(placement.sizeInches ?? 1) * (pxPerMapInch ?? 24)}
              sizeY={(placement.sizeInches ?? 1) * (pxPerMapInchY ?? pxPerMapInch ?? 24)}
            />
          ))}
      {/* fog sits above tokens and ground: unexplored means unseen */}
      {rect && nat && pxPerMapInch && (
        <FogLayer
          fog={state.fog}
          left={rect.left}
          top={rect.top}
          width={nat.w * rect.sx}
          height={nat.h * rect.sy}
          cellPx={pxPerMapInch}
          cellPxY={pxPerMapInchY ?? undefined}
        />
      )}
    </main>
  );
}

function IdleTable() {
  return (
    <main
      className="relative flex h-dvh flex-col items-center justify-center gap-2 overflow-hidden bg-black"
      onClick={toggleFullscreen}
    >
      <ConnectionHint />
      <h1 className="font-serif text-6xl text-stone-700">teller</h1>
      <p className="text-stone-600">the table awaits a map…</p>
    </main>
  );
}

// ---- one token ---------------------------------------------------------

function Token({
  entityId,
  entity,
  acting,
  defs,
  label,
  color,
  shape = 'circle',
  rot = 0,
  left,
  top,
  size,
  sizeY,
}: {
  entityId?: string;
  entity?: PublicEntity;
  acting: boolean;
  defs: KindDef[];
  label?: string;
  color?: string;
  shape?: Placement['shape'];
  rot?: number;
  left: number;
  top: number;
  size: number;
  sizeY: number;
}) {
  // The link supplies how it's DOING; the placement supplies where it
  // is and what it looks like (§5). A placement naming an entity the
  // campaign no longer has keeps its own cached label and says so —
  // never a bare id, never quietly dropped (rule 9's tail).
  const dangling = Boolean(entityId) && !entity;
  const name = entity?.name ?? label ?? '?';
  const vitality = entity?.vitality;
  // `down` gets no glow at all, deliberately. A glow says "still in
  // this" — pulsing red is the thing that's about to happen, not the
  // thing that already did. Something at zero goes quiet and dims
  // instead, so the table can read the fight's remaining threats at a
  // glance without the spent ones competing for the same attention.
  const down = vitality === 'down';
  // Kept as its parts rather than one string, because a clipped shape
  // needs the same halo expressed as a filter (below). The law itself
  // is untouched: same three cases, same colours, same sizes.
  const halo = acting
    ? { color: 'rgba(251,191,36,0.75)', blur: size * 0.6, spread: size * 0.2 }
    : vitality === 'critical'
      ? { color: 'rgba(220,38,38,0.8)', blur: size * 0.5, spread: size * 0.15 }
      : vitality === 'bloodied'
        ? { color: 'rgba(220,38,38,0.5)', blur: size * 0.35, spread: size * 0.1 }
        : null;
  const glow = halo ? `0 0 ${halo.blur}px ${halo.spread}px ${halo.color}` : undefined;
  // A state the DM applied, made visible. Statuses reach the table; the
  // numbers behind them never do — and the ring combines with the glow
  // rather than replacing it, because "poisoned" and "nearly dead" are
  // two different things to know at a glance.
  const ringPx = Math.max(2, size * 0.06);
  const ring =
    entity && chipsOf(entity, defs).length
      ? `0 0 0 ${ringPx}px rgba(168,85,247,0.9)`
      : null;
  // The footprint the console drew, drawn the same way (`shapeStyle` in
  // BoardEditor): same clip, same rotation, so a wedge aimed down the
  // corridor on the console is aimed down the corridor on the table.
  // The centering translate moved into the transform with it — CSS lets
  // an element have only one.
  const clipped = shape === 'triangle';
  const shadow = ring ? `${ring}${glow ? `, ${glow}` : ''}` : glow;
  // A clip cuts the box-shadow away with the corners, so a triangle
  // wears its ring and halo as filters instead — applied AFTER the
  // clip, they follow the silhouette. Nothing about which glow it gets
  // changes; only how the same glow is painted.
  const filter = clipped
    ? [
        ring ? `drop-shadow(0 0 ${ringPx}px rgba(168,85,247,0.9))` : null,
        halo ? `drop-shadow(0 0 ${(halo.blur + halo.spread) / 2}px ${halo.color})` : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined
    : undefined;
  return (
    <div
      className={`absolute flex items-center justify-center font-mono font-bold text-stone-950 transition-opacity ${
        down ? 'opacity-40' : ''
      } ${!down && (acting || vitality === 'critical') ? 'animate-pulse' : ''} ${
        dangling
          ? 'border-2 border-dashed border-stone-400'
          : down
            ? 'border-2 border-stone-950'
            : vitality === 'bloodied' || vitality === 'critical'
              ? 'border-2 border-red-900'
              : 'border-2 border-stone-950/80'
      }`}
      style={{
        left,
        top,
        width: size,
        height: sizeY,
        backgroundColor: dangling ? '#57534e' : (color ?? '#d6d3d1'),
        boxShadow: clipped ? undefined : shadow,
        filter,
        transform: `translate(-50%, -50%) rotate(${rot}deg)`,
        borderRadius: shape === 'circle' ? '9999px' : shape === 'square' ? '4px' : '0',
        clipPath: clipped ? 'polygon(50% 0%, 100% 100%, 0% 100%)' : undefined,
        fontSize: Math.max(9, size * 0.28),
        transition: 'left 300ms, top 300ms',
      }}
      title={dangling ? `${name} — missing` : name}
    >
      {name.slice(0, 2)}
    </div>
  );
}
