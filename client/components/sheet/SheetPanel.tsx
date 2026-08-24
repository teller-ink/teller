// The chrome every block on the printed sheet wears.
//
// Ported verbatim from the old app (src/components/sheet/SheetPanel.tsx)
// — pure UI, no data-shape changes needed. Dropped only the `mark` prop
// (the Talent tick), which has no equivalent declared in the new stack
// yet; the shape it decorated (Starburst) is kept and exported since
// `Track`-alikes still want it.
//
// SKILLS, HEALTH, GRIT, STATUSES, WEAPONS and ABILITIES are all the same
// object: a ruled rectangle with a tick bracketing each corner, and a
// centred display-face heading flanked by two tapered darts with a
// diamond between dart and word. Drawing that four times in four files
// is how three of them end up subtly different, so it lives here once.
//
// Nothing in this file knows what it's framing — it takes a title and
// children. The accent comes off `--sheet-accent`, set once by the card.

/**
 * The sheet's mark between one kind of die and the next, and the
 * Talent-tick glyph.
 */
export function Starburst({
  size = 14,
  fill = 'var(--sheet-accent, #f59e0b)',
}: {
  size?: number;
  fill?: string;
}) {
  const points = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return `${50 + 48 * Math.cos(a)},${50 + 48 * Math.sin(a)}`;
  });
  const inner = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    return `${50 + 18 * Math.cos(a)},${50 + 18 * Math.sin(a)}`;
  });
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p} L ${inner[i]}`)
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={`${d} Z`} fill={fill} />
    </svg>
  );
}

/**
 * The sheet's heading rule: a dart that tapers away from the word, with
 * a diamond pip at the thick end.
 */
function Dart({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-[0.5em] w-full min-w-3 max-w-[4.5rem] flex-1"
      style={{ transform: flip ? 'scaleX(-1)' : undefined }}
    >
      <path d="M 0 3.5 L 78 5 L 78 7 L 0 8.5 Z" fill="var(--sheet-accent, #f59e0b)" />
      <path d="M 88 6 L 93 2 L 98 6 L 93 10 Z" fill="var(--sheet-accent, #f59e0b)" />
    </svg>
  );
}

/** One corner tick. Positioned by the caller; the shape is the same four times. */
function Corner({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  const spin = { tl: 0, tr: 90, br: 180, bl: 270 }[at];
  const place = {
    tl: 'left-1 top-1',
    tr: 'right-1 top-1',
    bl: 'left-1 bottom-1',
    br: 'right-1 bottom-1',
  }[at];
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`pointer-events-none absolute h-2.5 w-2.5 text-stone-400 ${place}`}
      style={{ transform: `rotate(${spin}deg)` }}
    >
      <path
        d="M 2 14 L 2 5 Q 2 2 5 2 L 14 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SheetPanel({
  title,
  note,
  children,
  className = '',
  style,
  fill = false,
}: {
  title: string;
  /** The sheet's instruction line. Pack-supplied only. */
  note?: string;
  children: React.ReactNode;
  className?: string;
  /** Merged over the panel's own — for a caller-set tint or accent. */
  style?: React.CSSProperties;
  /** Grow to fill the column instead of hugging the content. */
  fill?: boolean;
}) {
  return (
    <section
      className={`relative rounded-md border border-stone-600/80 px-3 py-2.5 ${
        fill ? 'flex h-full flex-col' : ''
      } ${className}`}
      style={{ containerType: 'inline-size', ...style }}
    >
      <Corner at="tl" />
      <Corner at="tr" />
      <Corner at="bl" />
      <Corner at="br" />

      <div className="mb-2">
        <header className="flex items-center justify-center gap-1.5 px-2">
          <Dart />
          <h2 className="min-w-0 break-words text-center font-serif text-[1rem] font-bold uppercase leading-tight tracking-[0.14em] text-stone-100">
            {title}
          </h2>
          <Dart flip />
        </header>

        {note && (
          <p className="mt-1 text-center font-serif text-[0.75rem] italic leading-snug text-stone-400">
            {note}
          </p>
        )}
      </div>

      {fill ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
