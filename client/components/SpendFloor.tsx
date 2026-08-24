// The floor under a system's advancement menu (§L: shape-derived,
// neutral, no vocabulary) — what a table gets when the system declares
// `spends` and supplies no `SpendMenu` presentation of its own.
//
// Everything it draws it was handed: the label, the tier names, the
// purchase names, their costs and the book's own words about them all
// arrive from the declaration at runtime. The only sentences in this
// file are teller's own, and they describe SHAPE — "spends", "buy",
// "this will:" — never a game's words.
//
// The grammar, and it is the same one every floor uses: a name, a
// price, a one-line summary of what it does, and a control. Picking a
// purchase does not buy it — it opens what would happen, and the
// person taps the change they want. That second tap is the human in
// rule 1's loop: nothing is written until somebody agrees to the exact
// thing this will do.
//
// This is the CONTRACT for the face a system supplies instead (§L
// phase 3's seam): a `SpendMenu.tsx` in a pack is handed exactly these
// props, so the caller's `presentationOf('SpendMenu') ?? SpendFloor`
// is a drop-in either way.

import { useState } from 'react';
import {
  affordable,
  describeEffect,
  isRefusal,
  locate,
  needsChoice,
  spendOptions,
  tierAt,
  type EntryWrite,
  type SpendPlan,
  type SpendWorld,
  type SpendsDecl,
  type SpendItem,
} from '../../core/effects.ts';
import { numberOf, type Entry } from '../../core/entity.ts';
import { btn, card, sectionLabel } from '../lib/ui.ts';
import { Refusal } from '../panels/render.tsx';

/** What any `SpendMenu` face receives — teller's floor and a pack's alike. */
export type SpendMenuProps = {
  spends: SpendsDecl;
  /** The entity, the declared groups/dice/marks and the catalogue, assembled. */
  world: SpendWorld;
  /** The caption a pack set under this heading, if it set one. */
  note?: string;
  /** The one combined application. Absent on a surface that may look but not buy. */
  onBuy?: (plan: SpendPlan) => Promise<void>;
  /** The ordinary override path — steppers on the declaration's own counters. */
  onSet?: (write: EntryWrite) => void;
  accent?: string;
};

function Stepper({
  found,
  onSet,
}: {
  found: { list: string; entry: Entry };
  onSet?: (write: EntryWrite) => void;
}) {
  const value = numberOf(found.entry) ?? 0;
  const bump = (d: number) =>
    onSet?.({ list: found.list, name: found.entry.name, value: value + d });
  return (
    <div className="flex items-center gap-1.5">
      <span className={sectionLabel}>{found.entry.name}</span>
      <span className="font-mono text-base text-stone-100">{value}</span>
      {onSet && (
        <>
          <button
            type="button"
            aria-label={`decrease ${found.entry.name}`}
            onClick={() => bump(-1)}
            className="flex h-6 min-w-6 items-center justify-center rounded bg-stone-800 font-mono text-sm text-stone-100 hover:bg-stone-700"
          >
            −
          </button>
          <button
            type="button"
            aria-label={`increase ${found.entry.name}`}
            onClick={() => bump(1)}
            className="flex h-6 min-w-6 items-center justify-center rounded bg-stone-800 font-mono text-sm text-stone-100 hover:bg-stone-700"
          >
            +
          </button>
        </>
      )}
    </div>
  );
}

export function SpendFloor({
  spends,
  world,
  note,
  onBuy,
  onSet,
  accent,
}: SpendMenuProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wallet = locate(world.entity, spends.counter);
  const lifetime = spends.total ? locate(world.entity, spends.total) : undefined;
  const tier = tierAt(spends.tiers, numberOf(lifetime?.entry) ?? 0);
  const opened = open ? world.entity && spends.menu.find((s) => s.name === open) : undefined;

  const commit = (plan: SpendPlan) => {
    if (!onBuy || busy) return;
    setBusy(true);
    onBuy(plan)
      .catch(() => {})
      .finally(() => {
        setBusy(false);
        setOpen(null);
      });
  };

  return (
    <section className={`${card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={sectionLabel}>{spends.label ?? spends.counter}</p>
        {note && <p className="text-xs text-stone-500">{note}</p>}
      </div>

      {/* The ledger: the derived tier, then a stepper on each counter the
          declaration names — the stored values stay authoritative, and a
          person types over any of it (rule 1). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {tier && (
          <span
            className="rounded-[3px] px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-stone-950"
            style={{ background: accent ?? 'var(--sheet-accent, #f59e0b)' }}
          >
            {tier.name}
          </span>
        )}
        {lifetime && <Stepper found={lifetime} onSet={onSet} />}
        {wallet && <Stepper found={wallet} onSet={onSet} />}
        {!wallet && (
          <Refusal>nothing here is called '{spends.counter}' yet</Refusal>
        )}
      </div>

      {/* The menu — name, price, and what it does in one neutral line. */}
      <div className="flex flex-col gap-1.5">
        {spends.menu.map((spend) => {
          const broke = !affordable(spends, world.entity, spend.cost);
          const isOpen = open === spend.name;
          return (
            <button
              key={spend.name}
              type="button"
              disabled={!onBuy || broke}
              aria-expanded={isOpen}
              aria-label={`${spend.name}: ${spend.cost} ${spends.counter}`}
              onClick={() => setOpen(isOpen ? null : spend.name)}
              className={`flex flex-col items-start gap-0.5 rounded border px-2 py-1.5 text-left transition-colors disabled:opacity-40 ${
                isOpen
                  ? 'border-transparent'
                  : 'border-stone-700 enabled:hover:bg-stone-800/60'
              }`}
              style={isOpen ? { borderColor: accent ?? 'var(--sheet-accent, #f59e0b)' } : undefined}
            >
              <span className="flex w-full items-center gap-2">
                <span className="text-[0.8rem] leading-tight text-stone-200">{spend.name}</span>
                <span className="ml-auto rounded-[3px] bg-stone-800 px-1 font-mono text-[0.7rem] text-stone-400">
                  {spend.cost}
                </span>
              </span>
              <span className="text-[0.7rem] leading-tight text-stone-500">
                {spend.text ?? describeEffect(spend.effect)}
              </span>
            </button>
          );
        })}
      </div>

      {opened && (
        <Chooser
          spends={spends}
          spend={opened}
          world={world}
          busy={busy}
          onPick={commit}
        />
      )}
    </section>
  );
}

/**
 * What the open purchase would actually do, one row per option. This is
 * the confirmation step: every row says the change in the declaration's
 * own words, and tapping one is the whole write.
 */
function Chooser({
  spends,
  spend,
  world,
  busy,
  onPick,
}: {
  spends: SpendsDecl;
  spend: SpendItem;
  world: SpendWorld;
  busy: boolean;
  onPick: (plan: SpendPlan) => void;
}) {
  const options = spendOptions(spends, spend, world);
  return (
    <div className="flex flex-col gap-1.5 rounded bg-stone-900/80 px-2 py-1.5">
      <p className={sectionLabel}>
        {spend.name} — {spend.cost} {spends.counter}
        {needsChoice(spend.effect) ? ', pick one' : ', confirm'}
      </p>
      {isRefusal(options) ? (
        <Refusal>{options.refusal}</Refusal>
      ) : options.length === 0 ? (
        <Refusal>nothing left to pick</Refusal>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={busy}
              onClick={() => onPick(option.plan)}
              className={`${btn} font-mono text-[0.75rem]`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
