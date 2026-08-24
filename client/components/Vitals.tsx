// A counter you can read across a table, and one you can change.
//
// Ported from the old app (src/components/Vitals.tsx), classNames kept
// verbatim. The seam: the old `Counter` had its own `id`/`current`; the
// new `Entry` (core/entity.ts) has `name`/`value?`/`max?` and no id of
// its own (a list is keyed by entry NAME). `onBump` here takes the
// entry's CURRENT numeric value and hands back what the caller should
// write, rather than mutating a whole array — `ctx.write` is a sparse
// edit, not a replace.

import type { Entry } from '../../core/entity.ts';

// The BAR is the glance and the NUMBER is the truth: 34 and 10 aren't
// comparable at speed, but two bars are. Nothing here derives anything
// — the stored value is what's drawn, and the steppers write straight
// back to it (rule 1). A counter with no max has no bar, because a
// bar would have to invent a ceiling to draw one.

/** How full, as a fraction, or null when the entry is unbounded. */
function fill(entry: Entry): number | null {
  if (typeof entry.max !== 'number' || entry.max <= 0) return null;
  const value = typeof entry.value === 'number' ? entry.value : 0;
  return Math.max(0, Math.min(1, value / entry.max));
}

/**
 * Colour carries SEVERITY, not identity — which side someone is on is
 * already the row's left edge, and saying it twice just makes a
 * healthy party shout. A full bar is deliberately near-silent; the
 * eye should only be pulled to the ones in trouble.
 */
function tone(ratio: number): string {
  if (ratio <= 0) return 'bg-stone-800';
  if (ratio <= 0.3) return 'bg-red-600';
  if (ratio <= 0.6) return 'bg-amber-600';
  return 'bg-stone-600';
}

export function VitalBar({
  entry,
  className = '',
}: {
  entry: Entry;
  className?: string;
}) {
  const ratio = fill(entry);
  if (ratio === null) return null;
  return (
    <div className={`h-1 overflow-hidden rounded-full bg-stone-900 ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${tone(ratio)}`}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

export function CounterStepper({
  entry,
  onBump,
  big = false,
}: {
  entry: Entry;
  onBump: (delta: number) => void;
  big?: boolean;
}) {
  const value = typeof entry.value === 'number' ? entry.value : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className={`truncate ${big ? 'text-xs' : 'text-[11px]'} text-stone-400`}>
          {entry.name}
        </span>
        <span
          className={`ml-auto font-mono ${big ? 'text-base' : 'text-xs'} text-stone-100`}
        >
          {value}
          {typeof entry.max === 'number' && (
            <span className="text-stone-600">/{entry.max}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            className="rounded px-1.5 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
            onClick={() => onBump(-1)}
            aria-label={`${entry.name} down`}
          >
            −
          </button>
          <button
            className="rounded px-1.5 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
            onClick={() => onBump(1)}
            aria-label={`${entry.name} up`}
          >
            +
          </button>
        </span>
      </div>
      <VitalBar entry={entry} className="mt-1" />
    </div>
  );
}
