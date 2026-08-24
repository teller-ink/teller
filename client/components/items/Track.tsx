// A die pool, drawn as the track of boxes the printed sheet prints —
// ported from the old app's `src/components/sheet/Track.tsx` +
// `StatRow.tsx`, which is one renderer on purpose: the shop and the
// sheet are two moments of the same object, and a rifle's Short Range
// must draw itself identically at the gunsmith's and in your hands.
//
// Three shapes, all DERIVED rather than declared, which is what lets one
// renderer draw a weapon's Grit cost, its ranges and its upgrades
// without being told which is which:
//
//   * **a pool** → the track, exactly as a Skill draws it
//   * **something short** → a box, like the printed Grit square
//   * **prose** → the label on its own line with the text beneath
//
// **The printed sheet draws the WHOLE track** and you write the die's
// letter into each slot you own — `dice.track` slots, of which
// `owned.length` are filled. That distinction is the whole point: an
// empty slot and a slot that doesn't exist have to look different, and a
// player should see "one of a possible six" without counting anything.
// The first port drew only the dice owned, so a Used Pistol's "1B"
// Arm's Reach came out as a single lonely box beside a SKILLS block
// drawing six — the same value, two sizes, on one piece of glass
// (Brian, 2026-08-20, from the iPad).
//
// No starburst and no bonus slot here, and that's the old app's call
// too (`StatRow` passed `bonus={0}`): a weapon's ranges are plain runs
// of boxes on the printed page, and the ✶ sits once beside the Model
// rather than on each range.

import type { Amendment } from '../../../core/effects.ts';
import { expandPool, type DiceRecord } from '../../lib/dice.ts';

/** Past this a value is a word on a line, not a number in a box. */
const BOXY = 4;
/** Past this it is prose, and prose does not belong in a label column. */
const PROSE = 22;

/**
 * Does this value read as dice at all?
 *
 * Face-aware, like the old app's `looksLikePool`: read against the
 * letters the system says it HAS, so "2B1G" becomes dice while a
 * made-up "3Z" stays a word. Without a `dice` record nothing is a pool
 * — teller has no idea what a letter would mean.
 */
function looksLikePool(value: string, dice?: DiceRecord): boolean {
  if (!dice) return false;
  const compact = String(value ?? '').replace(/[\s+]/g, '');
  if (!/^(\d+[A-Za-z])+$/.test(compact)) return false;
  const known = new Set(Object.keys(dice.faces ?? {}).map((k) => k.toUpperCase()));
  const owned = expandPool(compact);
  return owned.length > 0 && owned.every((letter) => known.has(letter.toUpperCase()));
}

function Slot({ die }: { die?: string }) {
  return (
    <span
      className={`flex h-[1.35rem] w-[1.15rem] shrink-0 items-center justify-center rounded-[2px] border font-serif text-[0.8rem] italic leading-none ${
        die
          ? 'border-stone-200 bg-stone-200 text-stone-900'
          : 'border-stone-400 bg-transparent text-transparent'
      }`}
      title={die ?? 'empty'}
    >
      {die ?? '·'}
    </span>
  );
}

/** A single stat's value: the printed track if it parses as a pool, a box if it's short, a line if it's prose. */
export function PoolValue({ value, dice }: { value: string; dice?: DiceRecord }) {
  if (looksLikePool(value, dice)) {
    const owned = expandPool(value);
    const slots = Math.max(dice?.track ?? 0, owned.length);
    return (
      <>
        {Array.from({ length: slots }, (_, i) => (
          <Slot key={i} die={owned[i]} />
        ))}
      </>
    );
  }
  if (value.length > 0 && value.length <= BOXY) {
    return (
      <span className="flex h-7 min-w-8 items-center justify-center rounded-[3px] border-2 border-stone-400 px-1.5 font-mono text-sm text-stone-100">
        {value}
      </span>
    );
  }
  return <span className="break-words font-mono text-sm text-stone-200">{value || '—'}</span>;
}

/**
 * One row of a stat block — the label at a fixed width, the value shaped
 * by `PoolValue`. Long prose drops the label onto its own line above the
 * text, same as the old `StatRow`.
 *
 * LEFT-aligned, and that's load-bearing rather than taste: left
 * alignment is stable under wrapping, which is the property that matters
 * when the labels come out of a pack and this code has no idea how long
 * a system's words are (rule 2).
 */
export function StatRow({
  label,
  value,
  dice,
  amended,
}: {
  label: string;
  value: string;
  dice?: DiceRecord;
  /**
   * What the fittings work out, when that differs from the print
   * (`amendStats`, `core/effects.ts`). The AMENDED number is what the
   * table reads — a rifle wearing Damage +1B rolls the amended pool —
   * and the row says what amended it, because a number that changed
   * for a reason nobody can see is the thing rule 1 exists to prevent.
   * The printed value stays stored and is one tap from being read (the
   * title) or typed over.
   */
  amended?: Amendment;
}) {
  const shown = amended?.value ?? value;
  const pool = looksLikePool(shown, dice);
  const prose = !pool && shown.length > PROSE;
  const Label = (
    <span
      className={`break-words text-[0.7rem] uppercase leading-tight tracking-[0.1em] ${
        prose ? '' : 'w-[6.5rem] shrink-0'
      }`}
      style={{ color: 'var(--sheet-accent, #f59e0b)' }}
    >
      {label}
    </span>
  );
  if (prose) {
    return (
      <div className="flex flex-col gap-0.5 py-1">
        {Label}
        <span className="break-words text-[0.8rem] leading-snug text-stone-300">{shown}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 py-0.5">
      {Label}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        <PoolValue value={shown} dice={dice} />
        {/* WHO amended it, on the row it amended — a chip rather than a
            hover, because the rail bar has no pointer and a panel
            nobody can hover must still explain its own numbers. The
            title carries the print for whoever does have one. */}
        {amended && (
          <span
            className="break-words text-[0.6rem] uppercase leading-tight tracking-[0.08em]"
            style={{ color: 'var(--sheet-accent, #f59e0b)' }}
            title={`printed ${amended.printed} · ${amended.by.join(' · ')}`}
          >
            {amended.by.join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}
