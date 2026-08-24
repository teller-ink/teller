// The pocket: counters the system dresses with icons, banded into one
// slim tile — ported from the old app's `src/components/sheet/PocketPanel.tsx`.
// The denominations named in the `currency` record collapse into one
// Purse chip (a total, coins a tap away); every other iconed counter
// (Scrap, Supplies) gets its own compact chip beside it.
//
// Each chip's GLYPH is a second door: what the pack wrote about that
// counter, overlaid on tap rather than printed under the row.

import { useEffect, useRef, useState } from 'react';
import type { Entry } from '../../../core/entity.ts';
import { Glyph } from '../sheet/glyphs.tsx';
import type { CurrencyRecord } from './types.ts';

const BOXES_LIMIT = 12;

function isGauge(entry: Entry): boolean {
  return typeof entry.max === 'number' && entry.max > 0;
}

function boxable(entry: Entry): boolean {
  return isGauge(entry) && (entry.max ?? 0) <= BOXES_LIMIT;
}

function numberOf(entry: Entry): number {
  return typeof entry.value === 'number' ? entry.value : 0;
}

function formatPrice(cents: number, symbol: string): string {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/** A stepper, the size the old app drew it (`counters/shared.tsx`'s `Step`). */
function Step({ sign, onClick, label }: { sign: '−' | '+'; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 min-w-8 shrink-0 select-none items-center justify-center rounded-lg bg-stone-800 text-lg text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-700 active:text-stone-950"
    >
      {sign}
    </button>
  );
}

/**
 * The pack's words about this counter, one tap away — what a Supply is,
 * what Scrap kitbashes into, what the coins are worth. Publisher prose
 * (rule 4), so it arrives from the `notes` record and never from here.
 *
 * It used to render INLINE under the chip, and that was wrong twice
 * over: three sentences of italics under a number is the row's whole
 * height spent on something nobody reads twice, and on a strip it is
 * height there isn't. So it overlays instead — the same bargain the
 * statuses column already struck (`StatusPanel`, the system's own
 * plate): the row stays clean, the words are a tap away, and nothing
 * reflows when someone taps.
 */
function NotePopover({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // `pointerdown` rather than `click`: the button that opened this is
    // still under the finger on mouseup, and a click listener would
    // catch its own opening event and close again immediately.
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={title}
      className="absolute inset-x-0 top-full z-20 mt-1 max-h-[11rem] overflow-y-auto rounded-lg border border-amber-900/60 bg-stone-950 p-3 shadow-xl"
    >
      <div className="flex items-baseline gap-2">
        <span
          className="min-w-0 break-words font-serif text-sm font-bold uppercase tracking-wide"
          style={{ color: 'var(--sheet-accent, #f59e0b)' }}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="-my-1 ml-auto shrink-0 px-1.5 py-1 text-stone-500 transition-colors hover:text-stone-200"
        >
          ✕
        </button>
      </div>
      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-300">{text}</p>
    </div>
  );
}

/**
 * The chip's identity — its glyph, and its name where there's room —
 * doubling as the door to the pack's words when the pack wrote any.
 *
 * The old app's line, and it holds here: **the thing itself is the
 * target, there is no ⓘ.** A dot would cost a column in a chip that is
 * already three facts wide. The glyph is the one part of the row that
 * isn't a control — the value is typed or tapped, the steppers step,
 * the purse's total opens the coins — so it is the only part free to
 * mean "tell me about this". A counter the pack said nothing about is
 * simply not a button.
 */
function Identity({
  entry,
  icon,
  hasNote,
  open,
  onToggle,
}: {
  entry: string;
  icon: string;
  hasNote: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const glyph = <Glyph name={icon} className="h-5 w-5 shrink-0 text-stone-400" />;
  if (!hasNote) return glyph;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`what is ${entry}`}
      className="-m-1 shrink-0 rounded p-1 transition-colors hover:bg-stone-800/60"
    >
      {glyph}
    </button>
  );
}

function Chip({
  entry,
  icon,
  onWrite,
  compact,
  note,
}: {
  entry: Entry;
  icon: string;
  onWrite: (value: number) => void;
  /**
   * Side by side rather than stacked, and no name printed.
   *
   * Three chips across a phone have no room for "SUPPLIES" over the
   * boxes and don't need it: the glyph is what the counter IS, and a
   * system that gave a counter a mark already said the mark carries it.
   * The word stays in `title` and `aria-label`.
   */
  compact: boolean;
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      title={compact ? entry.name : undefined}
      className={`relative flex items-center gap-1.5 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1.5 ${
        compact ? (boxable(entry) ? 'w-full' : 'min-w-[9.5rem] flex-1') : ''
      }`}
    >
      <Identity
        entry={entry.name}
        icon={icon}
        hasNote={Boolean(note)}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {!compact && (
          <span className="text-[9px] uppercase tracking-widest text-stone-500">{entry.name}</span>
        )}
        {boxable(entry) ? (
          <div className={`flex flex-wrap items-center gap-1 ${compact ? '' : 'mt-0.5'}`}>
            {Array.from({ length: entry.max ?? 0 }, (_, i) => {
              const filled = i < numberOf(entry);
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`set ${entry.name} to ${filled && i === numberOf(entry) - 1 ? i : i + 1}`}
                  onClick={() => onWrite(filled && i === numberOf(entry) - 1 ? i : i + 1)}
                  className="h-4 w-4 shrink-0 rounded-[2px] border-2 transition-colors"
                  style={
                    filled
                      ? { background: 'var(--sheet-accent, #f59e0b)', borderColor: 'var(--sheet-accent, #f59e0b)' }
                      : { borderColor: '#a8a29e' }
                  }
                />
              );
            })}
          </div>
        ) : (
          <span className="min-w-0 truncate font-mono text-base tabular-nums text-stone-100">
            {numberOf(entry)}
          </span>
        )}
      </div>
      {/* Boxes are their own steppers; only the numbers need a pair. */}
      {!boxable(entry) && (
        <div className="flex shrink-0 gap-1">
          <Step
            sign="−"
            label={`decrease ${entry.name}`}
            onClick={() => onWrite(Math.max(0, numberOf(entry) - 1))}
          />
          <Step
            sign="+"
            label={`increase ${entry.name}`}
            onClick={() => onWrite(numberOf(entry) + 1)}
          />
        </div>
      )}
      {open && note && (
        <NotePopover title={entry.name} text={note} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function PurseChip({
  entries,
  currency,
  icon,
  onWrite,
  compact,
  note,
}: {
  entries: Entry[];
  currency: CurrencyRecord;
  icon: string;
  onWrite: (name: string, value: number) => void;
  compact: boolean;
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const [telling, setTelling] = useState(false);
  const denoms = currency.denominations ?? [];
  const held = denoms
    .map((d) => ({ d, entry: entries.find((e) => e.name === d.counter) }))
    .filter((x): x is { d: (typeof denoms)[number]; entry: Entry } => Boolean(x.entry));
  if (!held.length) return null;
  const total = held.reduce((sum, { d, entry }) => sum + numberOf(entry) * d.value, 0);
  const symbol = currency.symbol ?? '$';

  return (
    <div
      className={`relative flex flex-col gap-1 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1.5 ${
        compact ? 'min-w-[9.5rem] flex-1' : ''
      }`}
    >
      {/* Two doors on one row, and they are different questions: the
          glyph asks what money IS in this world, the total asks what
          coins you're holding. Only the second one changes the sheet. */}
      <div className="flex items-center gap-1.5">
        <Identity
          entry="Purse"
          icon={icon}
          hasNote={Boolean(note)}
          open={telling}
          onToggle={() => setTelling((t) => !t)}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`purse, ${formatPrice(total, symbol)} — ${open ? 'close' : 'open'} the coin counts`}
        >
          {!compact && (
            <span className="text-[9px] uppercase tracking-widest text-stone-500">Purse</span>
          )}
          <span className="font-mono text-base tabular-nums text-stone-100">{formatPrice(total, symbol)}</span>
          <span className="ml-auto text-[10px] text-stone-600">{open ? '▾' : '▸'}</span>
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 border-t border-stone-800 pt-1">
          {held.map(({ entry }) => (
            <div key={entry.name} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 break-words text-[11px] text-stone-400">{entry.name}</span>
              <span className="font-mono text-sm tabular-nums text-stone-100">{numberOf(entry)}</span>
              <button
                type="button"
                aria-label={`fewer ${entry.name}`}
                onClick={() => onWrite(entry.name, Math.max(0, numberOf(entry) - 1))}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-stone-800 text-sm text-stone-200 hover:bg-stone-700"
              >
                −
              </button>
              <button
                type="button"
                aria-label={`more ${entry.name}`}
                onClick={() => onWrite(entry.name, numberOf(entry) + 1)}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-stone-800 text-sm text-stone-200 hover:bg-stone-700"
              >
                +
              </button>
            </div>
          ))}
        </div>
      )}
      {telling && note && (
        <NotePopover title="Purse" text={note} onClose={() => setTelling(false)} />
      )}
    </div>
  );
}

/** The pocket: the purse chip (when the character has any denomination) plus every other iconed counter, banded together at the left of Inventory. */
export function Pocket({
  entries,
  icons,
  currency,
  onWrite,
  compact = true,
  note,
}: {
  entries: Entry[];
  icons: Record<string, string>;
  currency?: CurrencyRecord;
  onWrite: (name: string, value: number) => void;
  /**
   * Shoulder to shoulder on one line, instead of a stack — the old
   * `PocketPanel`'s `row`. What a character carries in loose change is
   * three facts, and three facts should cost one row of a sheet. Only
   * the STRIP stacks, where the pocket has a pinned 13rem column of its
   * own and each counter's name is printed above its value.
   */
  compact?: boolean;
  /** The pack's words about a counter, when it wrote any (rule 4) — behind its glyph. */
  note?: (title: string) => string | undefined;
}) {
  const denomNames = new Set((currency?.denominations ?? []).map((d) => d.counter));
  const coins = entries.filter((e) => denomNames.has(e.name));
  const loose = entries.filter((e) => !denomNames.has(e.name));
  if (!coins.length && !loose.length) return null;
  return (
    <div className={`flex gap-1.5 ${compact ? 'w-full flex-wrap' : 'flex-col'}`}>
      {currency && coins.length > 0 && (
        <PurseChip
          entries={coins}
          currency={currency}
          icon={icons.Purse ?? 'coin'}
          onWrite={onWrite}
          compact={compact}
          note={note?.('Purse')}
        />
      )}
      {loose.map((entry) => (
        <Chip
          key={entry.name}
          entry={entry}
          icon={icons[entry.name] ?? ''}
          onWrite={(v) => onWrite(entry.name, v)}
          compact={compact}
          note={note?.(entry.name)}
        />
      ))}
    </div>
  );
}
