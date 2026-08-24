import type { Entry } from '../../../core/entity.ts';
import { SheetPanel } from './SheetPanel.tsx';

// A boxed resource, the way the printed sheet draws Grit — a ring of
// numbers you mark, for anything with a small ceiling; a bar and
// steppers for anything bigger. Ported from the old app's `SheetGauge`
// (src/components/counters/Sheet.tsx) — the one gauge treatment `Sheet`
// falls back to once a counter has no pinned fields (Health) and no
// declared dial face (Grit's cylinder).
//
// Tapping the number you're already on steps back one, so the ring can
// reach zero without a separate control.

const RING_LIMIT = 12;

function numberOf(entry: Entry): number {
  return typeof entry.value === 'number' ? entry.value : 0;
}

function fraction(entry: Entry): number {
  if (typeof entry.max !== 'number' || entry.max <= 0) return 0;
  return Math.max(0, Math.min(1, numberOf(entry) / entry.max));
}

function isLow(entry: Entry): boolean {
  return typeof entry.max === 'number' && entry.max > 0 && fraction(entry) <= 0.25;
}

function NumberRing({ entry, onSet }: { entry: Entry; onSet: (next: number) => void }) {
  const max = entry.max!;
  const current = numberOf(entry);
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1;
        const marked = n <= current;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onSet(n === current ? n - 1 : n)}
            aria-label={`set ${entry.name} to ${n === current ? n - 1 : n}`}
            aria-pressed={marked}
            className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-sm transition-colors ${
              marked ? 'text-stone-950' : 'border-stone-700 text-stone-500 hover:border-stone-500'
            }`}
            style={
              marked
                ? { background: 'var(--sheet-accent, #f59e0b)', borderColor: 'var(--sheet-accent, #f59e0b)' }
                : undefined
            }
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

export function SheetGauge({
  entry,
  onSet,
  note,
  fill = false,
}: {
  entry: Entry;
  onSet: (next: number) => void;
  note?: string;
  /** Stretch to the column (a shelf tile); default is content height. */
  fill?: boolean;
}) {
  const ringable = typeof entry.max === 'number' && entry.max > 0 && entry.max <= RING_LIMIT;
  const current = numberOf(entry);
  const low = isLow(entry);

  return (
    <SheetPanel title={entry.name} note={note} fill={fill}>
      {ringable ? (
        <div className="flex flex-1 items-center justify-center">
          <NumberRing entry={entry} onSet={onSet} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-1.5">
          <span
            className={`leading-none ${low ? 'text-red-400' : 'text-stone-100'}`}
            style={{ fontSize: '2rem' }}
          >
            {current}
            {typeof entry.max === 'number' && (
              <span className="text-stone-600">/{entry.max}</span>
            )}
          </span>
          {typeof entry.max === 'number' && (
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-800">
              <div
                className="h-full rounded-full transition-[width] duration-200"
                style={{
                  width: `${fraction(entry) * 100}%`,
                  background: low ? '#ef4444' : 'var(--sheet-accent, #f59e0b)',
                }}
              />
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              aria-label={`decrease ${entry.name}`}
              onClick={() => onSet(Math.max(0, current - 1))}
              className="h-9 flex-1 rounded-lg bg-stone-800 text-lg text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-700 active:text-stone-950"
            >
              −
            </button>
            <button
              type="button"
              aria-label={`increase ${entry.name}`}
              onClick={() => onSet(typeof entry.max === 'number' ? Math.min(entry.max, current + 1) : current + 1)}
              className="h-9 flex-1 rounded-lg bg-stone-800 text-lg text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-700 active:text-stone-950"
            >
              +
            </button>
          </div>
        </div>
      )}
    </SheetPanel>
  );
}
