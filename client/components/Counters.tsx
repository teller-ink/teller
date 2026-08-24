// The counter LAYOUTS from the old app's `counters/` — big steppers
// (Focus.tsx), a ledger line (Ledger.tsx), and the skills dice-track row
// (sheet/SkillPanel.tsx + sheet/Track.tsx). ClassNames kept verbatim
// wherever the shape survives the port; the seam is the same one
// `Vitals.tsx` crosses — `Counter{id,current,max,hidden,display}` becomes
// `Entry{name,value?,max?}`, and a write is a sparse edit handed to
// `ctx.write` rather than a whole-array replace.
//
// `shared.tsx`'s helpers (`bumped`, `isGauge`, `isLow`, `Step`, `Refill`,
// `Value`, `Name`, `Bar`) are folded in here rather than kept as their
// own file — this is the only place in the new client that needs them,
// and a `Counter`-shaped `shared.tsx` had nothing left to share.

import { useState } from 'react';
import type { Entry } from '../../core/entity.ts';
import { expandPool, type DiceRecord } from '../lib/dice.ts';
import type { RuleHit } from '../lib/rules.ts';
import { SheetPanel, Starburst } from './sheet/SheetPanel.tsx';

// ---- shared primitives (ported from counters/shared.tsx) --------------

function numberOf(entry: Entry): number {
  return typeof entry.value === 'number' ? entry.value : 0;
}

function isGauge(entry: Entry): boolean {
  return typeof entry.max === 'number' && entry.max > 0;
}

function fill(entry: Entry): number {
  if (!isGauge(entry)) return 0;
  return Math.max(0, Math.min(1, numberOf(entry) / entry.max!));
}

function isLow(entry: Entry): boolean {
  return isGauge(entry) && fill(entry) <= 0.25;
}

function isBlank(entry: Entry): boolean {
  return !isGauge(entry) && numberOf(entry) === 0;
}

/** Clamped to [0, max]. An entry never goes negative or past its ceiling. */
export function stepValue(entry: Entry, delta: number): number {
  let next = numberOf(entry) + delta;
  if (typeof entry.max === 'number') next = Math.min(next, entry.max);
  return Math.max(next, 0);
}

function Step({
  sign,
  onClick,
  label,
  big,
  className = '',
}: {
  sign: '−' | '+';
  onClick: () => void;
  label: string;
  big?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex shrink-0 select-none items-center justify-center rounded-lg bg-stone-800 text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-700 active:text-stone-950 ${
        big ? 'h-12 min-w-12 text-2xl' : 'h-8 min-w-8 text-lg'
      } ${className}`}
    >
      {sign}
    </button>
  );
}

function Refill({
  entry,
  onSet,
  big,
}: {
  entry: Entry;
  onSet: (next: number) => void;
  big?: boolean;
}) {
  const canRefill = isGauge(entry) && numberOf(entry) < entry.max!;
  return (
    <button
      type="button"
      disabled={!canRefill}
      onClick={() => onSet(entry.max!)}
      aria-label={`refill ${entry.name}`}
      title="refill to max"
      className={`flex shrink-0 items-center justify-center rounded text-stone-500 transition-colors hover:bg-stone-800 hover:text-amber-300 disabled:pointer-events-none disabled:opacity-0 ${
        big ? 'h-7 w-7 text-base' : 'h-6 w-6 text-sm'
      }`}
    >
      ↻
    </button>
  );
}

function Bar({ entry, thick }: { entry: Entry; thick?: boolean }) {
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-stone-800 ${
        thick ? 'h-2.5' : 'h-1.5'
      }`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-200 ${
          isLow(entry) ? 'bg-red-500' : 'bg-amber-500'
        }`}
        style={{ width: `${fill(entry) * 100}%` }}
      />
    </div>
  );
}

function Value({ entry, className = '', style }: { entry: Entry; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      style={style}
      className={`whitespace-nowrap font-mono tabular-nums ${
        isLow(entry) ? 'text-red-400' : isBlank(entry) ? 'text-stone-600' : 'text-stone-100'
      } ${className}`}
    >
      {numberOf(entry)}
      <span className="text-stone-600">/{typeof entry.max === 'number' ? entry.max : '—'}</span>
    </span>
  );
}

function Name({ entry, className = '' }: { entry: Entry; className?: string }) {
  return <span className={`break-words ${className}`}>{entry.name}</span>;
}

// ---- Big — the fight, and nothing else (ported from counters/Focus.tsx) --

export function BigGauge({
  entry,
  onWrite,
}: {
  entry: Entry;
  onWrite: (value: number) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 rounded-2xl border border-stone-800 bg-stone-900/70 p-4">
      <div className="flex items-baseline gap-2">
        <Name entry={entry} className="min-w-0 flex-1 text-xs font-medium uppercase tracking-widest text-stone-400" />
        <Refill entry={entry} onSet={onWrite} big />
      </div>
      <Value entry={entry} className="text-[clamp(2.5rem,9cqh,5rem)] leading-none" />
      <Bar entry={entry} thick />
      <div className="flex gap-2">
        <Step
          sign="−"
          big
          className="h-16 flex-1 text-3xl"
          label={`decrease ${entry.name}`}
          onClick={() => onWrite(stepValue(entry, -1))}
        />
        <Step
          sign="+"
          big
          className="h-16 flex-1 text-3xl"
          label={`increase ${entry.name}`}
          onClick={() => onWrite(stepValue(entry, 1))}
        />
      </div>
    </div>
  );
}

// ---- Tally — a small counter drawn as marks (ported from sheet/TallyPanel.tsx) --

/** Past this many boxes a row stops being readable — the old app's line. */
const BOXES_LIMIT = 12;

/**
 * Would this counter draw as tick boxes? A capped counter with a
 * smallish ceiling. Exported so a screen can route a slot-shaped gauge
 * here and leave a big bar gauge (34/50) on the bar it wants — the old
 * app's `boxable`, entry-shaped.
 */
export function boxable(entry: Entry): boolean {
  return isGauge(entry) && (entry.max ?? 0) <= BOXES_LIMIT;
}

/**
 * The printed sheet's tick boxes — a counter you fill in one mark at a
 * time, ported from the old app's `TallyPanel` with its classNames
 * intact. Generic on purpose (rule 2): this knows "a counter with a
 * smallish max, shown as boxes", and not one word of any system.
 *
 * TELLER's floor rather than a system presentation, which is the §M-3
 * sort: nothing here is anybody's face — marks counting a counter is
 * function — and it belongs with the neighbours it's drawn beside
 * (`Reticle`, `Pocket`, `ItemTile`), all of which are the client's own.
 * A system that wants its own face for this summons one the way the
 * sheet's gauges do; the floor keeps the marks.
 *
 * Tapping a box proposes a value — tap the fourth to set 4, tap the
 * last filled one to untick it — and the steppers do what steppers do.
 * All ordinary counter arithmetic: event-logged, undoable, and the
 * console can type over it (rule 1).
 */
export function Tally({
  entry,
  note,
  onWrite,
}: {
  entry: Entry;
  note?: string;
  onWrite: (value: number) => void;
}) {
  const max = entry.max ?? 0;
  const current = numberOf(entry);
  return (
    <SheetPanel title={entry.name} note={note} fill className="w-full">
      <div className="flex min-h-0 flex-1 flex-wrap content-center items-center justify-center gap-2">
        <Step
          sign="−"
          label={`decrease ${entry.name}`}
          onClick={() => onWrite(stepValue(entry, -1))}
        />
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {Array.from({ length: max }, (_, i) => {
            const filled = i < current;
            return (
              <button
                key={i}
                type="button"
                aria-label={`set ${entry.name} to ${
                  filled && i === current - 1 ? i : i + 1
                }`}
                // Tapping the last filled box unticks it; any other box
                // means "this many".
                onClick={() => onWrite(filled && i === current - 1 ? i : i + 1)}
                className="h-8 w-8 rounded-[3px] border-2 transition-colors"
                style={
                  filled
                    ? {
                        background: 'var(--sheet-accent, #f59e0b)',
                        borderColor: 'var(--sheet-accent, #f59e0b)',
                      }
                    : { borderColor: '#a8a29e' }
                }
              />
            );
          })}
        </div>
        <Step
          sign="+"
          label={`increase ${entry.name}`}
          onClick={() => onWrite(stepValue(entry, 1))}
        />
      </div>
    </SheetPanel>
  );
}

// ---- Ledger — everything, at once, quietly (ported from counters/Ledger.tsx) --

export function LedgerRow({
  entry,
  onWrite,
}: {
  entry: Entry;
  onWrite: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-stone-800/70 px-1 py-1 last:border-0">
      <div className="min-w-0 flex-1">
        <Name entry={entry} className="block text-sm text-stone-300" />
        {isGauge(entry) && (
          <div className="mt-1 h-px w-full bg-stone-800">
            <div
              className={`h-px ${isLow(entry) ? 'bg-red-500' : 'bg-amber-500'}`}
              style={{ width: `${fill(entry) * 100}%` }}
            />
          </div>
        )}
      </div>
      <Value entry={entry} className="text-sm" />
      <Refill entry={entry} onSet={onWrite} />
      <Step sign="−" label={`decrease ${entry.name}`} onClick={() => onWrite(stepValue(entry, -1))} />
      <Step sign="+" label={`increase ${entry.name}`} onClick={() => onWrite(stepValue(entry, 1))} />
    </div>
  );
}

// ---- Rows — the printed sheet's dice track (ported from sheet/SkillPanel + Track) --

/**
 * One slot on the track — a die owned reads filled; an empty one
 * doesn't. `bonus` distinguishes an UNOWNED bonus slot (dimmer ring)
 * from an unowned base slot, exactly as the old Track drew it — a
 * player should see "three of a possible six, plus one Talent die"
 * without counting anything.
 */
function Slot({ die, bonus }: { die?: string; bonus?: boolean }) {
  return (
    <span
      className={`flex h-[1.35rem] w-[1.15rem] shrink-0 items-center justify-center rounded-[2px] border font-serif text-[0.8rem] italic leading-none ${
        die
          ? 'border-stone-200 bg-stone-200 text-stone-900'
          : bonus
            ? 'border-stone-500 bg-stone-800/40 text-transparent'
            : 'border-stone-400 bg-transparent text-transparent'
      }`}
      title={die ?? 'empty'}
    >
      {die ?? '·'}
    </span>
  );
}

/**
 * The printed sheet's skill row: name right-aligned against a rule, a
 * track of boxes to the right — one per die in the pool.
 *
 * Face-aware as of the `dice` stack record (docs/CORE-NEXT.md §J):
 * given `dice`, the track pads out to the system's declared length and
 * draws the starburst + Talent bonus slots, same as the old app's
 * `Track`. Without it — today's only caller, the `rows` block in
 * `panels/blocks.tsx`, doesn't fetch or pass the record yet — this
 * renders exactly as before: one plain box per die, no starburst, no
 * bonus. `dice` and `marked` are additive, never required.
 *
 * `lookup` is additive too (rules-lookup): the printed sheet never had
 * a lookup at all, so a matching entry turns the name into a button —
 * tap it for the pack's own text on Charm, Finesse, whatever the
 * system calls its skills. Popped as a bounded, absolutely-positioned
 * overlay (rule 6 — mounted glass never scrolls, so opening one must
 * never reflow the row beneath it).
 */
export function SkillRow({
  entry,
  accent,
  dice,
  /** This skill's Talent is bought — the ✶ box fills (see the `marks` record). */
  marked = false,
  markTitle,
  lookup,
}: {
  entry: Entry;
  accent?: string;
  dice?: DiceRecord;
  marked?: boolean;
  markTitle?: string;
  lookup?: (name: string) => RuleHit | undefined;
}) {
  const [open, setOpen] = useState(false);
  const value = typeof entry.value === 'string' ? entry.value : String(entry.value ?? '');
  const owned = /^(?:\d+[A-Za-z])+$/.test(value.replace(/\s+/g, '')) ? expandPool(value) : [];
  const declared = dice?.track ?? 0;
  // A track only for things that ARE pools — a declared track was
  // drawing empty boxes under "Normal" and throwing the word away.
  const slots = owned.length ? Math.max(declared, owned.length) : 0;
  const bonus = dice?.trackBonus ?? 0;
  const hit = lookup?.(entry.name);

  return (
    <div className="relative flex items-center gap-2.5 py-1">
      {hit ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`what does ${entry.name} do`}
          className="w-[7.5rem] shrink-0 break-words rounded px-1 py-0.5 text-right text-[1rem] font-bold uppercase leading-tight tracking-wide transition-colors hover:bg-stone-800/60"
          style={{ color: accent ?? 'var(--sheet-accent, #f59e0b)' }}
        >
          {entry.name}
        </button>
      ) : (
        <span
          className="w-[7.5rem] shrink-0 break-words rounded px-1 py-0.5 text-right text-[1rem] font-bold uppercase leading-tight tracking-wide"
          style={{ color: accent ?? 'var(--sheet-accent, #f59e0b)' }}
        >
          {entry.name}
        </span>
      )}
      {open && hit && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-40 w-64 max-w-[85vw] overflow-y-auto rounded-lg border border-amber-900/60 bg-stone-950 p-3 shadow-xl">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-amber-200">{hit.name}</span>
            {hit.meta && <span className="font-mono text-xs text-amber-400">{hit.meta}</span>}
            <span className="ml-auto text-[10px] uppercase tracking-wider text-stone-600">
              {hit.section}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-300">
            {hit.text}
          </p>
        </div>
      )}
      <div className="w-px self-stretch bg-stone-600" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {slots ? (
          <>
            {Array.from({ length: slots }, (_, i) => (
              <Slot key={i} die={owned[i]} />
            ))}
            {bonus > 0 && (
              <>
                <Starburst />
                {Array.from({ length: bonus }, (_, i) =>
                  marked ? (
                    <span
                      key={`b${i}`}
                      title={markTitle}
                      className="flex h-[1.35rem] w-[1.15rem] shrink-0 items-center justify-center rounded-[2px] border"
                      style={{
                        borderColor: 'var(--sheet-accent, #f59e0b)',
                        background: 'var(--sheet-accent, #f59e0b)',
                      }}
                    >
                      <Starburst size={11} fill="#1c1917" />
                    </span>
                  ) : (
                    <Slot key={`b${i}`} die={owned[slots + i]} bonus />
                  ),
                )}
              </>
            )}
          </>
        ) : (
          <span className="break-words font-mono text-sm text-stone-200">{value || '—'}</span>
        )}
      </div>
    </div>
  );
}
