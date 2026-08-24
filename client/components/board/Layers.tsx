// The two overlays the editor draws over the map: the grid and the fog.
//
// Both are ported from the shipped table renderer (`client/views/
// TableView.tsx`) rather than re-derived, because the console preview
// and the table disagreeing is the exact bug docs/BATTLEMAP.md records
// as the reason the grid moved into map space in the first place. Same
// arithmetic, same cell size, same rounded-and-blurred reveal — one
// difference and one only: the DM's copy of the fog is see-through
// (`dm`), because the Warden has to work on ground the posse can't see.

import { useId } from 'react';
import type { Cell } from './model.ts';

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

export function GridOverlay({
  cellPx,
  cellPxY,
  grid,
}: {
  cellPx: number;
  cellPxY?: number;
  grid?: { on?: boolean; color?: string; opacity?: number };
}) {
  if (grid?.on === false || !cellPx) return null;
  const cellY = cellPxY || cellPx;
  const line = rgba(grid?.color ?? GRID_DEFAULTS.color, grid?.opacity ?? GRID_DEFAULTS.opacity);
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

/**
 * One dark sheet with the revealed cells punched out and blurred, so
 * explored ground has soft edges instead of a staircase of squares.
 *
 * The DM's copy is translucent, the table's is not — and the cells it
 * punches include every REVEALED area, which is exactly the flattening
 * `publicBoardState` does on the way out. An area still closed stays
 * dark here too; its extents are drawn separately, as an outline, so
 * the Warden can see a room the table cannot.
 */
export function FogLayer({
  fog,
  width,
  height,
  cellPx,
  cellPxY,
  dm = false,
}: {
  fog?: { on?: boolean; revealed?: Cell[]; regions?: { cells: Cell[]; revealed: boolean }[] };
  width: number;
  height: number;
  cellPx: number;
  cellPxY?: number;
  dm?: boolean;
}) {
  const uid = useId();
  if (!fog?.on || !cellPx || !width || !height) return null;
  const cellY = cellPxY || cellPx;
  const blur = Math.min(cellPx, cellY) * 0.28;
  const bleed = Math.min(cellPx, cellY) * 0.12;
  const clear: Cell[] = [
    ...(fog.revealed ?? []),
    ...(fog.regions ?? []).filter((r) => r.revealed).flatMap((r) => r.cells),
  ];
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <defs>
        <filter id={`fogblur-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <mask id={`fogmask-${uid}`}>
          <rect x="0" y="0" width={width} height={height} fill="white" />
          <g filter={`url(#fogblur-${uid})`}>
            {clear.map(([c, r], i) => (
              <rect
                key={i}
                x={c * cellPx - bleed}
                y={r * cellY - bleed}
                width={cellPx + bleed * 2}
                height={cellY + bleed * 2}
                rx={cellPx * 0.3}
                fill="black"
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
        opacity={dm ? 0.62 : 0.97}
        mask={`url(#fogmask-${uid})`}
      />
    </svg>
  );
}
