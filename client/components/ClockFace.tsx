// A Blades-style progress clock: a circle cut into `max` wedges,
// `current` of them filled. Pure presentation over the counter
// primitive — same data, same events; only renderers know clocks exist.
//
// Ported verbatim from the old app (src/components/ClockFace.tsx) — pure
// svg, no data-shape changes needed.

const FILLED = '#d97706'; // amber-600
const EMPTY = '#292524'; // stone-800
const SEAM = '#0c0a09'; // stone-950 — gaps between wedges

export function ClockFace({
  current,
  max,
  size = 56,
  onClick,
  label,
  className,
}: {
  current: number;
  max: number;
  size?: number;
  onClick?: () => void;
  label?: string;
  /**
   * Lets a caller size the face with CSS instead of pixels — the svg has
   * a viewBox, so `h-full w-auto` scales it to whatever box it's in.
   * `size` alone can't cooperate with a fluid layout: a fixed 84px face
   * in a row capped by viewport height overflowed its own tile.
   */
  className?: string;
}) {
  const c = 50;
  const r = 46;
  const filled = Math.max(0, Math.min(current, max));

  const point = (frac: number): [number, number] => {
    const angle = frac * 2 * Math.PI - Math.PI / 2; // start at 12 o'clock
    return [c + r * Math.cos(angle), c + r * Math.sin(angle)];
  };

  const wedge = (i: number) => {
    const [x1, y1] = point(i / max);
    const [x2, y2] = point((i + 1) / max);
    const largeArc = max === 2 ? 0 : 1 / max > 0.5 ? 1 : 0;
    return `M ${c} ${c} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={label ?? `${current} of ${max}`}
      onClick={onClick}
      className={`${onClick ? 'cursor-pointer select-none' : ''} ${className ?? ''}`}
    >
      {max <= 1 ? (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill={filled >= max ? FILLED : EMPTY}
          stroke={SEAM}
          strokeWidth="2.5"
        />
      ) : (
        Array.from({ length: max }, (_, i) => (
          <path
            key={i}
            d={wedge(i)}
            fill={i < filled ? FILLED : EMPTY}
            stroke={SEAM}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        ))
      )}
    </svg>
  );
}
