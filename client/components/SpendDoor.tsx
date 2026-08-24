// The way in to a declared advancement menu — the door and the menu
// behind it, in one block.
//
// It lived in the seat chrome, which synthesized a block carrying an
// `onOpen` callback because only code could open the overlay. §M-5a
// takes the chrome apart, and 'More' becomes an ordinary `.panel` file
// — a declaration cannot write a function into JSON, so the block had
// to become self-sufficient or the file could never carry it. It reads
// exactly what every other block reads: the subject and the merged
// records (`spends` — a system that declares none grows no button).
//
// The face is SUMMONED (§L phase 3) and `SpendFloor` is the answer for
// `undefined`: a system that prints its own advancement page ships
// `SpendMenu.tsx` and gets it; a system that ships none still gets a
// working menu, because a price and a counter need no vocabulary.

import { useEffect, useState } from 'react';
import type { Entity } from '../../core/entity.ts';
import { locate, tierAt, toSpends, type SpendPlan } from '../../core/effects.ts';
import { numberOf } from '../../core/entity.ts';
import type { Template } from '../../core/stamp.ts';
import { api } from '../lib/api.ts';
import { presentationOf, useSystemFaces } from '../lib/presentations.ts';
import { usePanelNote } from '../lib/rules.ts';
import { applyPlan, loadCatalog, spendWorld } from '../lib/spend.ts';
import { writeEntry } from '../lib/entry.ts';
import { card, sectionLabel } from '../lib/ui.ts';
import type { BlockCtx } from '../panels/render.tsx';
import { SpendFloor, type SpendMenuProps } from './SpendFloor.tsx';

/**
 * The menu, opened over whatever screen is showing.
 *
 * Bounded on purpose (rule 6): the PAGE never scrolls, on either family
 * of glass, so the overlay is a fixed panel with a max height and its
 * own scroll region — the "deliberate shelf" exemption, which is the
 * only kind of scrolling a screwed-down panel may be asked for.
 */
function SpendOverlay({
  ctx,
  entity,
  onClose,
}: {
  ctx: BlockCtx;
  entity: Entity;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [catalog, setCatalog] = useState<Template[]>([]);
  const note = usePanelNote();
  useSystemFaces();
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((all) => {
      if (!cancelled) setCatalog(all);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const spends = toSpends(ctx.records.spends);
  if (!spends) return null;
  const accent = entity.type
    ? (ctx.records.accents?.[entity.type] as string | undefined)
    : undefined;
  const Menu = presentationOf<typeof SpendFloor>('SpendMenu') ?? SpendFloor;
  const props: SpendMenuProps = {
    spends,
    world: spendWorld(entity, ctx.records, catalog),
    note: note(spends.label ?? spends.counter),
    accent,
    onSet: (write) => {
      void writeEntry(entity.id, write);
    },
    onBuy: (plan: SpendPlan) =>
      applyPlan(entity.id, plan, catalog).then(
        () => setProblem(undefined),
        (err: unknown) => {
          // Never silent: a purchase the server refused (stamping is the
          // DM's own door) says so in the server's own words, and the
          // writes that DID land are visible on the sheet behind this.
          setProblem(err instanceof Error ? err.message : String(err));
          throw err;
        },
      ),
  };
  return (
    <div
      role="dialog"
      aria-label={spends.label ?? spends.counter}
      className="fixed inset-0 z-30 flex items-center justify-center bg-stone-950/80 p-4"
      onClick={onClose}
    >
      {/* The close rides the corner of the sheet rather than sitting on
          a bar of its own: one framed panel, floated in the dark, is
          the whole dialog — a header strip above a panel that already
          has a heading was two chromes for one thing. */}
      <div
        className="relative flex max-h-full w-full max-w-[34rem] flex-col overflow-y-auto rounded-xl border border-stone-700 bg-stone-950 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="absolute right-0 top-0 z-10 rounded-md px-2 py-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-200"
        >
          ✕
        </button>
        <Menu {...props} />
        {problem && <p className="pt-2 text-sm italic text-stone-500">{problem}</p>}
      </div>
    </div>
  );
}

/**
 * A stored counter's own half of its name — "Prestige · Unclaimed"
 * reads as "Unclaimed" on a strip already headed by the whole. Purely
 * presentational, and the full name is what every write still carries.
 */
function half(name: string): string {
  return name.replace(/^.*·\s*/, '');
}

/**
 * The door itself. Deliberately NOT a chip on the top bar: that bar
 * carries what a TURN spends (`use`), and this is what a CAREER spends
 * — the old app kept it on More as `PrestigePanel`, and so does teller.
 *
 * ONE strip, not three things in a row (Brian, 2026-08-21). The door
 * used to carry the wallet alone, and the declaration's two counters
 * then came round again as ordinary ledger rows underneath it — the
 * same numbers, twice, in two grammars. Everything a glance wants now
 * rides the bar: the tier you've reached (derived from the total, never
 * stored), the total itself, the unclaimed points ACCENTED because they
 * are the part that can be acted on, and the way in at the end of it.
 *
 * The steppers do not ride here on purpose: overriding either counter
 * is a deliberate act, and it lives one tap away behind the door beside
 * the menu that spends them (rule 1 — the override exists, it just
 * isn't the thing a glance trips over).
 */
export function SpendDoor({ ctx }: { ctx: BlockCtx }) {
  const [open, setOpen] = useState(false);
  const entity = ctx.entity as Entity | undefined;
  const spends = toSpends(ctx.records.spends);
  if (!entity || !spends) return null;
  const label = spends.label ?? spends.counter;
  const wallet = locate(entity, spends.counter);
  const unclaimed = numberOf(wallet?.entry) ?? 0;
  const lifetime = spends.total ? locate(entity, spends.total) : undefined;
  const total = lifetime ? (numberOf(lifetime.entry) ?? 0) : undefined;
  const tier = total === undefined ? undefined : tierAt(spends.tiers, total);
  const ink = 'var(--sheet-accent, #f59e0b)';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={[
          `${label}:`,
          tier ? `${tier.name},` : '',
          total === undefined ? '' : `${total} ${half(spends.total!)},`,
          `${unclaimed} ${half(spends.counter)}`,
        ]
          .filter(Boolean)
          .join(' ')}
        className={`${card} flex w-full flex-wrap items-center gap-x-5 gap-y-2 py-3 text-left transition-colors hover:bg-stone-800/40`}
      >
        <span className="flex items-center gap-2">
          <span className={sectionLabel}>{label}</span>
          {tier && (
            <span
              className="rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-stone-950"
              style={{ background: ink }}
            >
              {tier.name}
            </span>
          )}
        </span>

        {total !== undefined && (
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-lg leading-none text-stone-100">{total}</span>
            <span className={sectionLabel}>{half(spends.total!)}</span>
          </span>
        )}

        {/* The actionable half, and the only thing on the strip wearing
            the accent: unclaimed points are what the menu behind the
            door can turn into something. At zero it goes quiet rather
            than away — a box that vanishes is a box nobody learns. */}
        <span
          className="flex items-baseline gap-1.5 rounded-full border px-3 py-1"
          style={
            unclaimed > 0
              ? {
                  borderColor: ink,
                  background: 'color-mix(in srgb, var(--sheet-accent, #f59e0b) 14%, transparent)',
                }
              : { borderColor: '#44403c' }
          }
        >
          <span
            className="font-mono text-lg leading-none"
            style={{ color: unclaimed > 0 ? ink : '#a8a29e' }}
          >
            {unclaimed}
          </span>
          <span className={sectionLabel}>{half(spends.counter)}</span>
        </span>

        <span className="ml-auto text-xs uppercase tracking-widest text-stone-500">open ▸</span>
      </button>
      {open && <SpendOverlay ctx={ctx} entity={entity} onClose={() => setOpen(false)} />}
    </>
  );
}
