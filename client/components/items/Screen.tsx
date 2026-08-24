// One declared carried-screen — Weapons, Abilities, Inventory (WiW) —
// ported from the old app's `carriedScreen` (`src/components/counters/Sheet.tsx`).
// The shelf-pan behaviour (rule 6's "deliberate shelf"), the kind
// filter rail and the pocket/tally lead column are all kept; what's
// gone is the per-screen shop/notch machinery, which isn't part of
// this port.

import { useState } from 'react';
import type { Entity, Entry } from '../../../core/entity.ts';
import type { Price } from '../../../core/spend.ts';
import { useAmendments } from '../../lib/amend.ts';
import { firedArmed, toggleArmed, useArmed } from '../../lib/armed.ts';
import type { DiceRecord } from '../../lib/dice.ts';
import { usePanelNote } from '../../lib/rules.ts';
import type { BlockCtx, Glass } from '../../panels/render.tsx';
import { BigGauge, boxable, Tally } from '../Counters.tsx';
import { ItemTile } from './ItemTile.tsx';
import { Pocket } from './Purse.tsx';
import type { CurrencyRecord, ScreenDecl, UseRecord } from './types.ts';

function numberOf(entry: Entry | undefined): number {
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/** The same read, keeping "there isn't one" distinct from zero. */
function numberOfOrNothing(entry: Entry | undefined): number | undefined {
  return typeof entry?.value === 'number' ? entry.value : undefined;
}

/** One empty list, so a character with no children doesn't rebuild the reading every render. */
const NOTHING: Entity[] = [];

/** A top-level entry, and which list it lives in — the sparse door needs both. */
function findWithList(e: Entity, name: string): { list: string; entry: Entry } | undefined {
  for (const [list, entries] of Object.entries(e.lists)) {
    const entry = entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (entry) return { list, entry };
  }
  return undefined;
}

/**
 * The STRIP is a third fact about glass, not a synonym for mounted —
 * the old app's own line (src/views/SeatView.tsx: `strip = ratio >=
 * 2.5`). The rail's fixed 22rem tiles and sideways snap exist because
 * 515px of height cannot stack; an iPad is mounted too, but it HAS
 * height, so its shelf wraps into fluid tiles and the REGION scrolls
 * down — rule 6's 2026-08-14 amendment, restored 2026-08-20 after the
 * port flattened three glasses into two and Brian's iPad got the
 * rail's pan.
 */
export function isStrip(): boolean {
  return window.innerWidth / window.innerHeight >= 2.5;
}

function tileWidth(glass: Glass): string {
  return glass === 'mounted' && isStrip()
    ? 'w-[22rem] shrink-0 snap-start self-stretch'
    : 'min-w-[15rem] flex-1 self-start';
}

/** The strip's shelf: one full-height row that pans, never two rows stacked. */
function Pan({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 snap-x snap-mandatory flex-nowrap items-stretch gap-2 overflow-x-auto overflow-y-hidden">
      {children}
    </div>
  );
}

/** Everywhere else: tiles wrap. The REGION that scrolls is the caller's, not this. */
function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap content-start gap-2">{children}</div>;
}

export function CarriedScreen({
  ctx,
  screen,
  claimedKinds,
}: {
  ctx: BlockCtx;
  screen: ScreenDecl;
  /** Every kind ANY declared screen claims by name — what a `rest` screen catches is what's left over. */
  claimedKinds: Set<string>;
}) {
  // Hooks first, unconditionally — the filter's own state and the
  // pack's captions both have to be asked for before the no-entity
  // door below, or React counts a different number of them per render.
  const [kind, setKind] = useState('');
  const note = usePanelNote();

  const entity = ctx.entity as Entity | undefined;
  const use = ctx.records.use as UseRecord | undefined;
  const dice = ctx.records.dice as DiceRecord | undefined;
  const children = entity?.children ?? NOTHING;
  // What's bolted on and what's chambered, folded into the pools they
  // amend — the reading the table rolls, computed here and stored
  // nowhere (§8). Asked for before the no-entity door below, like every
  // other hook.
  const amendments = useAmendments(children, dice);
  // The turn's armed moves, and the refill that releases their locks.
  // The balance is read here because it's the CHARACTER's counter, not
  // any one weapon's.
  const wallet = entity && use?.costCounter ? findWithList(entity, use.costCounter) : undefined;
  const { armed: armedActs, spent: spentActs } = useArmed(
    numberOfOrNothing(wallet?.entry),
    entity?.id ?? '',
  );

  if (!entity) return <p className="p-4 text-sm text-stone-500">no entity to show</p>;

  const currency = ctx.records.currency as CurrencyRecord | undefined;
  const icons = (ctx.records.icons as Record<string, string> | undefined) ?? {};
  const wanted = new Set((screen.kinds ?? []).map((k) => k.toLowerCase()));
  const held = children.filter((c) => {
    const kind = (c.type ?? '').toLowerCase();
    return wanted.has(kind) || (screen.rest === true && !claimedKinds.has(kind));
  });
  const ammoPool = use?.consumesKind
    ? children.filter((c) => (c.type ?? '').toLowerCase() === use.consumesKind!.toLowerCase())
    : [];

  // Every weapon's fitted upgrades, so an upgrade tile on Inventory can
  // wear "fitted to <weapon>" — the outside world addresses upgrades
  // (§K), and the world here is this character's own weapon rack.
  const fittedTo = new Map<string, string>();
  for (const c of children) {
    const upgrades = c.refs?.upgrades;
    const refs = Array.isArray(upgrades) ? upgrades : upgrades ? [upgrades] : [];
    for (const r of refs) fittedTo.set(r.id, c.name);
  }

  const itemKinds = [...new Set(held.map((c) => c.type ?? ''))];
  const shown = itemKinds.length > 1 && kind ? held.filter((c) => (c.type ?? '') === kind) : held;

  const declared = (screen.counters ?? [])
    .map((name) => findWithList(entity, name))
    .filter((x): x is { list: string; entry: Entry } => Boolean(x));
  const denomNames = new Set((currency?.denominations ?? []).map((d) => d.counter));
  const pocketEntries = declared.filter((d) => icons[d.entry.name] || denomNames.has(d.entry.name)).map((d) => d.entry);
  const tallies = declared.filter((d) => !icons[d.entry.name] && !denomNames.has(d.entry.name));

  const arming = screen.arms === true;

  const write = (target: { list: string; entry: Entry }, value: number) =>
    ctx.write?.({ list: target.list, name: target.entry.name, value });

  // One squeeze: every price in the tile's ledger comes off ITS OWN
  // counter, and nothing is spent twice or spent somewhere it wasn't
  // named. The tile computed the ledger — the same list it drew and
  // priced its trigger from — so there is no second arithmetic here to
  // drift from the first.
  const fireCost = (ledger: Price[]) => {
    for (const price of ledger) {
      const pot = findWithList(entity, price.counter);
      if (pot) write(pot, Math.max(0, numberOf(pot.entry) - price.amount));
    }
    // What was armed rode along in the ledger; burn the lock.
    firedArmed();
  };

  const mounted = ctx.glass === 'mounted';
  const strip = mounted && isStrip();

  const pocket = pocketEntries.length > 0 && (
    <Pocket
      entries={pocketEntries}
      icons={icons}
      currency={currency}
      // Stacked with its names printed only in the strip's pinned
      // column, which is 13rem wide precisely so it can be; everywhere
      // else the pocket lies down into a row of chips — the old
      // `PocketPanel`'s `row`.
      compact={!strip}
      note={note}
      onWrite={(name, value) => {
        const target = declared.find((d) => d.entry.name === name);
        if (target) write(target, value);
      }}
    />
  );

  // A declared counter on a carried screen is a TILE like the things
  // beside it, and how it's drawn is the counter's own shape: a small
  // capped one (the Ace tally under the abilities it pays for) wears
  // the printed sheet's tick boxes; anything bigger keeps the bar
  // gauge. The old app's `boxable` routing, restored — the port had
  // put every declared counter on the big gauge.
  const gauges = tallies.map(({ entry, list }) => {
    const onWrite = (v: number) => ctx.write?.({ list, name: entry.name, value: v });
    return (
      <div key={entry.name} className={`flex flex-col gap-2 ${tileWidth(ctx.glass)}`}>
        {boxable(entry) ? (
          <Tally entry={entry} note={note(entry.name)} onWrite={onWrite} />
        ) : (
          <BigGauge entry={entry} onWrite={onWrite} />
        )}
      </div>
    );
  });

  const tile = (item: Entity, armed: boolean) => {
    const costEntry = use?.costCounter
      ? (item.lists.stats ?? []).find((s) => s.name.toLowerCase() === use.costCounter!.toLowerCase())
      : undefined;
    // The item's additional prices: the stat this thing carries for
    // each declared extra, spent from the counter the system named.
    // Matched on the counter's name and then on the declaration's
    // field key, because a stat is named in this world and keyed in
    // the old one, and a pack authored either way should still pay.
    const extras: Price[] = (use?.costs ?? []).flatMap((c) => {
      const stat = (item.lists.stats ?? []).find(
        (s) =>
          s.name.toLowerCase() === c.counter.toLowerCase() ||
          s.name.toLowerCase() === (c.field ?? '').toLowerCase(),
      );
      const amount = numberOf(stat);
      return amount > 0 ? [{ counter: c.counter, amount }] : [];
    });
    return (
      <div key={item.id} className={`flex flex-col gap-2 ${tileWidth(ctx.glass)}`}>
        <ItemTile
          characterId={entity.id}
          child={item}
          fill={mounted}
          use={use}
          arming={armed}
          ammoPool={ammoPool}
          costEntry={costEntry}
          extras={extras}
          onFireCost={fireCost}
          fittedTo={fittedTo.get(item.id)}
          amended={amendments.get(item.id)}
          actions={use?.actions ?? []}
          armed={armedActs}
          spent={spentActs}
          onToggleAction={toggleArmed}
          dice={dice}
          currency={currency}
          available={
            use?.costCounter ? numberOf(findWithList(entity, use.costCounter)?.entry) : undefined
          }
          balances={Object.fromEntries(
            (use?.costs ?? []).map((c) => [
              c.counter,
              numberOf(findWithList(entity, c.counter)?.entry),
            ]),
          )}
        />
      </div>
    );
  };

  // The pools (a system's ammo) sit under their own rule rather than
  // mixed in with the things that fire them — everywhere but the strip,
  // where a screen is ONE shelf and there are no two rows to rule
  // between.
  const pools = shown.filter((c) => ammoPool.includes(c));
  const rest = strip ? shown : shown.filter((c) => !ammoPool.includes(c));
  const empty = shown.length === 0 && tallies.length === 0;

  return (
    <div className={`flex min-h-0 flex-1 gap-2 ${mounted ? '' : 'flex-col'}`}>
      {/* The pinned left column: the filter chips (when this screen holds
          more than one KIND), and on the STRIP the pocket beneath them —
          controls above belongings, neither ever pans away, because the
          whole point of money and supplies is that they're always in
          reach. Glass with height doesn't need that: there the pocket
          leads the shelf instead, as full-width rows nothing pans past.
          Sticky only where the card scrolls (held glass) — mounted glass
          never scrolls, so there is nothing to stick to. */}
      {(itemKinds.length > 1 || (strip && pocketEntries.length > 0)) && (
        <div
          className={`flex shrink-0 flex-col gap-2 self-start ${
            mounted ? '' : 'sticky top-0 z-10 w-full'
          } ${strip && pocketEntries.length > 0 ? 'w-[13rem] self-stretch justify-center' : ''}`}
        >
          {itemKinds.length > 1 && (
            <div
              className={`flex gap-1 ${
                !mounted || (strip && pocketEntries.length > 0) ? 'flex-wrap' : 'flex-col'
              }`}
            >
              {['', ...itemKinds].map((k) => (
                <button
                  key={k || 'all'}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`max-w-[7rem] break-words rounded-md px-2 py-1.5 text-left text-[0.65rem] uppercase tracking-[0.14em] transition-colors ${
                    kind === k ? 'text-stone-950' : 'bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                  }`}
                  style={kind === k ? { background: 'var(--sheet-accent, #f59e0b)' } : undefined}
                >
                  {k || 'all'}
                </button>
              ))}
            </div>
          )}
          {strip && pocket}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {strip ? (
          <Pan>
            {gauges}
            {empty && <p className="p-4 text-sm text-stone-600 italic">nothing here yet</p>}
            {rest.map((item) => tile(item, arming))}
          </Pan>
        ) : (
          // ONE scrolling region, not one per shelf: the rule between
          // gear and pools has to travel with them, and a screwed-down
          // panel must never grow a second thing to scroll.
          <div
            className={`flex min-h-0 flex-col gap-2 ${mounted ? 'flex-1 overflow-y-auto' : ''}`}
          >
            {pocketEntries.length > 0 && <div className="w-full">{pocket}</div>}
            <Wrap>
              {gauges}
              {empty && <p className="p-4 text-sm text-stone-600 italic">nothing here yet</p>}
              {rest.map((item) => tile(item, arming))}
            </Wrap>
            {pools.length > 0 && (
              <>
                {/* The rule separates pools from the things that fire
                    them; an all-pools screen has nothing to separate. */}
                {rest.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[0.65rem] uppercase tracking-widest text-stone-500">
                      {use?.consumesKind}
                    </span>
                    <div className="h-px flex-1 bg-stone-800" />
                  </div>
                )}
                <Wrap>{pools.map((item) => tile(item, false))}</Wrap>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
