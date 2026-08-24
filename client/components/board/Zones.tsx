// Painted ground as ONE organic layer — ported from the old app
// (src/components/TileZones.tsx), which is the visual spec.
//
// Every cell of a layer renders as a rounded rect through an SVG "goo"
// filter (blur + alpha contrast), so adjacent tiles melt into a single
// blob while an isolated tile stays a rounded square. Animated effects
// get a hot core per cell above the goo. The STORAGE is dumb — a plain
// array of [col, row] — and the visual is smart; that split is why fog
// and ground can share one brush.
//
// Identity is the LAYER, not the effect (docs/BATTLEMAP.md): two fires
// in different corners are two layers, so the core gradient is keyed per
// zone and never per effect.

import { useId } from 'react';
import { zoneBase, type Zone } from './model.ts';

export function Zones({
  zones,
  width,
  height,
  cellPx,
  cellPxY,
  dm = false,
}: {
  zones: Zone[];
  width: number;
  height: number;
  cellPx: number;
  /** Vertical cell size; differs from cellPx only on a stretched table. */
  cellPxY?: number;
  /** Console-side: hidden layers draw ghosted instead of absent. */
  dm?: boolean;
}) {
  const uid = useId();
  if (zones.length === 0 || !cellPx || !width || !height) return null;
  const cellY = cellPxY || cellPx;
  const inset = Math.min(cellPx, cellY) * 0.06;
  const blur = Math.min(cellPx, cellY) * 0.22;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <defs>
        <filter id={`goo-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
          />
        </filter>
      </defs>
      {zones.map((zone, zi) => {
        const base = zoneBase(zone.effect);
        const ghost = dm && zone.hidden;
        const coreId = `core-${uid}-${zone.id ?? zi}`;
        return (
          <g key={zone.id ?? zi} opacity={ghost ? 0.4 : 1}>
            {base.core && (
              <defs>
                <radialGradient id={coreId}>
                  <stop offset="0%" stopColor={base.core} stopOpacity="0.85" />
                  <stop offset="100%" stopColor={base.core} stopOpacity="0" />
                </radialGradient>
              </defs>
            )}
            {/* opaque fills through the goo filter; translucency AFTER */}
            <g opacity={base.opacity} className={base.core ? 'animate-pulse' : undefined}>
              <g filter={`url(#goo-${uid})`}>
                {zone.cells.map(([c, r]) => (
                  <rect
                    key={`${c},${r}`}
                    x={c * cellPx + inset}
                    y={r * cellY + inset}
                    width={cellPx - inset * 2}
                    height={cellY - inset * 2}
                    rx={cellPx * 0.18}
                    fill={base.fill}
                  />
                ))}
              </g>
            </g>
            {base.core &&
              zone.cells.map(([c, r]) => (
                <circle
                  key={`core-${c},${r}`}
                  cx={(c + 0.5) * cellPx}
                  cy={(r + 0.5) * cellY}
                  r={cellPx * 0.42}
                  fill={`url(#${coreId})`}
                  className="animate-pulse"
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}
