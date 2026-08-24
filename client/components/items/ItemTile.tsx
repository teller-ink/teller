// One carried thing, on its own tile — ported from the old app's
// `src/components/sheet/ItemPanel.tsx`, trimmed to what §K's flat
// children actually carry: no upgrade back-face (an upgrade is now its
// own tile on Inventory, wearing a "fitted to …" chip, rather than a
// flip on the weapon that holds it — see `InventoryTile` below), no
// notch/history face (growth/etching isn't part of this port), no
// Talent tick (marks aren't wired to items yet). What's kept: the
// stats in catalogue order, a resource stepper for whatever the item
// itself counts down (ammo's rounds, an ability's uses), and the
// chamber-select-plus-trigger for anything `use` prices.

import type { Amendment } from '../../../core/effects.ts';
import type { Entity, Entry, Ref } from '../../../core/entity.ts';
import type { DiceRecord } from '../../lib/dice.ts';
import { writeChildEntry, writeRef } from '../../lib/refs.ts';
import { SheetPanel } from '../sheet/SheetPanel.tsx';
import { Reticle } from './Reticle.tsx';
import { StatRow } from './Track.tsx';
import type { CurrencyRecord, UseRecord } from './types.ts';

function numberOf(entry: Entry | undefined): number {
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/**
 * FILING information — what you'd want at the gunsmith's and nowhere
 * else. The old app had a flag for it (`Field.filing`, and the sheet
 * rendered `fields.filter((f) => !f.filing)`); the flag never made the
 * jump into the template serialization, so a thing you already own has
 * been wearing its price tag on the seat (Brian, 2026-08-20).
 *
 * Derived rather than named, because "Cost" is one system's word: a
 * stat whose whole value reads as an amount of the DECLARED currency is
 * a price, and the seat doesn't show prices. Price belongs to the
 * shelf, which is the store plugin's business now.
 */
function isPriceTag(value: string, currency?: CurrencyRecord): boolean {
  const symbol = currency?.symbol;
  if (!symbol) return false;
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${escaped}\\s*[\\d,]+(?:\\.\\d+)?\\s*$`).test(String(value ?? ''));
}

/**
 * A stepper, the size the old app drew it (`counters/shared.tsx`'s
 * `Step`). The port had shrunk these to `h-7 w-7` with no type size and
 * no press state — a control on the rail bar you tap with a thumb
 * mid-fight, made smaller than the one on the console.
 */
function Step({
  sign,
  onClick,
  label,
}: {
  sign: '−' | '+';
  onClick: () => void;
  label: string;
}) {
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

/** The child's own resource entry — ammo's Rounds/Arrows, an ability's
 * Uses, a Medical Kit's Supplies. Never `stats` — a weapon's Grit is a
 * stat (its cost, drawn as a row above), not something this stepper
 * should also offer to decrement.
 *
 * `resources` first because that's where this system files them, and
 * `counters` after because that's the word a catalogue entry authored
 * its own with (`toTemplate` keeps the author's key rather than
 * renaming it, so a box of rounds bought at the counter reads its pool
 * through the template like everything else a thin stamp derives). The
 * ordered-preference shape is `vitalIn`'s, for the same reason. */
const POOL_LISTS = ['resources', 'counters'];

function poolEntryOf(child: Entity): { list: string; entry: Entry } | undefined {
  for (const list of POOL_LISTS) {
    const entry = (child.lists[list] ?? []).find((e) => typeof e.value === 'number');
    if (entry) return { list, entry };
  }
  return undefined;
}

/** A stepper for the item's own countdown — Rounds, Arrows, Uses, Supplies. */
function CounterRow({
  entry,
  onWrite,
}: {
  entry: Entry;
  onWrite: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-stone-800 bg-stone-900/60 px-2 py-1">
      <span className="min-w-0 flex-1 break-words text-[0.65rem] uppercase tracking-widest text-stone-500">
        {entry.name}
      </span>
      <span className="whitespace-nowrap font-mono text-sm tabular-nums text-stone-100">
        {numberOf(entry)}
        {typeof entry.max === 'number' && <span className="text-stone-600">/{entry.max}</span>}
      </span>
      <Step
        sign="−"
        label={`decrease ${entry.name}`}
        onClick={() => onWrite(Math.max(0, numberOf(entry) - 1))}
      />
      <Step
        sign="+"
        label={`increase ${entry.name}`}
        onClick={() =>
          onWrite(
            entry.max !== undefined
              ? Math.min(entry.max, numberOf(entry) + 1)
              : numberOf(entry) + 1,
          )
        }
      />
    </div>
  );
}

export function ItemTile({
  characterId,
  child,
  fill = false,
  use,
  arming = false,
  ammoPool = [],
  costEntry,
  onFireCost,
  extras = [],
  fittedTo,
  dice,
  currency,
  available,
  balances = {},
  amended,
  actions = [],
  armed = [],
  spent = [],
  onToggleAction,
}: {
  characterId: string;
  child: Entity;
  /** Stretch to the shelf's height (mounted glass); natural height held. */
  fill?: boolean;
  use?: UseRecord;
  /** Offer the chamber select + trigger — declared per SCREEN (`screens[].arms`), not per item. */
  arming?: boolean;
  /** The character's own ammo children — what a chamber select offers. */
  ammoPool?: Entity[];
  /** This item's own priced entry, read off ITS stats (the weapon's own Grit box). */
  costEntry?: Entry;
  /** Spend the character's cost counter + extras + one chambered round — resolved by the SCREEN, which holds the character-level balances this tile doesn't. */
  onFireCost?: (total: number) => void;
  /** The item's additional prices (`use.costs`), already resolved against this item's own stats. */
  extras?: { counter: string; amount: number }[];
  /** "fitted to <weapon name>" — an upgrade wearing where it's bolted on. */
  fittedTo?: string;
  /** The system's dice, so a range draws the printed track and not just the dice owned. */
  dice?: DiceRecord;
  /** The declared money — what makes a price tag recognisable, and hidden (`isPriceTag`). */
  currency?: CurrencyRecord;
  /** What the cost counter currently holds, for the trigger's disabled state. */
  available?: number;
  /** What each `use.costs` counter holds, same job. */
  balances?: Record<string, number>;
  /**
   * What this thing's fittings work out, by stat name lower-cased
   * (`useAmendments`) — the reading the table rolls. Absent for a stat
   * nothing touched, which is every stat on a thing with nothing
   * bolted on.
   */
  amended?: Map<string, Amendment>;
  /** The system's per-turn moves (`use.actions`) — armed here, paid at fire. */
  actions?: { name: string; cost: number; text?: string }[];
  /** Which of them are armed, and which are used up until the counter refills. */
  armed?: string[];
  spent?: string[];
  onToggleAction?: (name: string) => void;
}) {
  const chamberedRef = child.refs?.chambered as Ref | undefined;
  const chambered = ammoPool.find((a) => a.id === chamberedRef?.id);
  const pool = poolEntryOf(child);
  // A FIXED order, so three panels in a row read as one table: the
  // priced field first (the printed sheet's Grit box), then everything
  // else in catalogue order. Filing information never shows at all.
  const stats = (child.lists.stats ?? []).filter(
    (s) => !isPriceTag(String(s.value ?? ''), currency),
  );
  const bodyRows = costEntry ? stats.filter((s) => s !== costEntry) : stats;

  const price = numberOf(costEntry);
  const fireable = Boolean(onFireCost) && Boolean(use) && costEntry !== undefined && price > 0;
  const verb = use?.verbs?.[child.type ?? ''] ?? use?.verb ?? 'Use';
  // An armed action rides on the same squeeze — one price, one write,
  // one undo. Aim's cost is the turn's, not the weapon's, which is why
  // it arrives here rather than being read off the item.
  //
  // Only an action with a PRICE can be armed, and that is the whole
  // filter: deduct-at-fire is the mechanism, so a move whose cost the
  // system didn't state has nothing to ride along on — but a flat cost
  // alone isn't consent to arm (2026-08-24, Brian: a priced defensive
  // move would inherit the once-per-turn lock it doesn't have). The
  // SYSTEM says which of its actions ride a trigger, with `arms: true`
  // on the action record — the mechanic stated as data, never inferred
  // from the shape of a cost. The rest are reference, and reference
  // doesn't wear a reticle.
  const armable = actions.filter(
    (a) => a.arms === true && typeof a.cost === 'number' && a.cost > 0,
  );
  const armedCost = armable
    .filter((a) => armed.includes(a.name))
    .reduce((n, a) => n + a.cost, 0);
  const total = price + armedCost + extras.reduce((n, e) => n + e.amount, 0);
  // Every price must clear: the main counter AND each of the item's
  // extra currencies. Unaffordable is DISABLED, not clamped — teller
  // declines to automate a spend the counter can't cover, and the
  // steppers stay right there for the table to rule otherwise (rule 1).
  const short = [
    ...(available !== undefined && available < total ? [use?.costCounter] : []),
    ...extras.filter((e) => (balances[e.counter] ?? 0) < e.amount).map((e) => e.counter),
  ].filter((n): n is string => Boolean(n));

  return (
    <SheetPanel title={child.name} fill={fill} className="w-full">
      <div className={`flex flex-col gap-1 ${fill ? 'min-h-0 flex-1' : ''}`}>
        {costEntry && (
          <StatRow
            label={costEntry.name}
            value={String(costEntry.value ?? '')}
            dice={dice}
            amended={amended?.get(costEntry.name.toLowerCase())}
          />
        )}
        {bodyRows.map((field) => (
          <StatRow
            key={field.name}
            label={field.name}
            value={String(field.value ?? '')}
            dice={dice}
            amended={amended?.get(field.name.toLowerCase())}
          />
        ))}

        {/* The bottom cluster, pinned (`mt-auto`) and identical on every
            tile, which is what makes a row of them read as one table:
            every chamber select, trigger, chip and stepper sits at the
            same height on every weapon, whatever the middle of each tile
            got up to. */}
        <div className="mt-auto flex flex-col gap-1 pt-1">
          {/* The chamber select and the trigger on ONE row, as the old
              app drew them — the select takes the slack, the button
              keeps its width, and both are 9 units tall. Stacked, they
              cost the tile a whole extra row of height for a control
              that reads as one gesture. */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
          {arming && use?.consumesKind && (
            <select
              className="h-9 min-w-0 flex-1 basis-32 rounded-md border border-stone-700 bg-stone-900 px-2 text-[0.75rem] text-stone-200 focus:border-stone-500 focus:outline-none"
              value={chambered?.id ?? ''}
              onChange={(e) => {
                const next = ammoPool.find((a) => a.id === e.target.value);
                writeRef(characterId, child.id, 'chambered', next ? { id: next.id, name: next.name } : null);
              }}
              aria-label={`what ${child.name} is loaded with`}
            >
              <option value="">—</option>
              {ammoPool.map((a) => {
                const roundsHere = poolEntryOf(a);
                return (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {roundsHere ? ` · ${numberOf(roundsHere.entry)}` : ''}
                  </option>
                );
              })}
            </select>
          )}

          {/* The turn's moves, one reticle each, on the trigger row
              where the price they add is felt. Arm it here or on any
              other weapon — same state, one Aim. */}
          {fireable &&
            armable.map((action) => {
              const isArmed = armed.includes(action.name);
              const isSpent = spent.includes(action.name);
              const broke = available !== undefined && !isArmed && available < action.cost;
              return (
                <Reticle
                  key={action.name}
                  armed={isArmed}
                  spent={isSpent}
                  disabled={broke || !onToggleAction}
                  label={
                    isSpent
                      ? `${action.name}: used this turn — back when your ${use?.costCounter} reloads`
                      : `${action.name}: +${action.cost} ${use?.costCounter} on your next shot. ${
                          action.text ?? ''
                        }`
                  }
                  onToggle={() => onToggleAction?.(action.name)}
                />
              );
            })}

          {fireable && (
            <button
              type="button"
              className="flex h-9 shrink-0 items-center justify-center rounded-md border-2 px-3 font-mono text-sm font-bold tracking-wider transition-colors active:bg-stone-800 disabled:opacity-35"
              style={{ borderColor: 'var(--sheet-accent, #f59e0b)', color: 'var(--sheet-accent, #f59e0b)' }}
              disabled={short.length > 0}
              onClick={() => {
                onFireCost?.(total);
                if (chambered) {
                  const roundsHere = poolEntryOf(chambered);
                  if (roundsHere) {
                    writeChildEntry(characterId, chambered.id, roundsHere.list, roundsHere.entry.name, {
                      value: Math.max(0, numberOf(roundsHere.entry) - 1),
                    });
                  }
                }
              }}
              aria-label={`${verb} ${child.name}${
                armedCost > 0 ? ` with ${armed.join(' and ')}` : ''
              }: spend ${total} ${use?.costCounter}${
                extras.length ? ` and ${extras.map((e) => `${e.amount} ${e.counter}`).join(' and ')}` : ''
              }${chambered ? ` and one ${chambered.name}` : ''}${
                short.length ? ` (not enough ${short.join(', ')})` : ''
              }`}
            >
              {verb} −{total} {use?.costCounter}
            </button>
          )}
          </div>

          {/* Chips, because a tag is a word that is either there or not.
              In the pinned cluster with everything else, so a tile that
              wears one still lines up with the tiles that don't. */}
          {fittedTo && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              <span
                className="rounded-full border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider"
                style={{
                  borderColor: 'var(--sheet-accent, #f59e0b)',
                  color: 'var(--sheet-accent, #f59e0b)',
                }}
              >
                fitted to {fittedTo}
              </span>
            </div>
          )}

          {pool && (
            <div className="flex flex-col gap-1 pt-0.5">
              <CounterRow
                entry={pool.entry}
                onWrite={(v) =>
                  writeChildEntry(characterId, child.id, pool.list, pool.entry.name, {
                    value: v,
                  })
                }
              />
            </div>
          )}
        </div>
      </div>
    </SheetPanel>
  );
}
