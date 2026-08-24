// The store's console pane — the DM's side of the counter, ported from
// teller's own `client/tools/store.tsx` when the store left the repo
// (§15's UI tier). Two sections, and the split is §13's prep/play seam
// wearing its plainest clothes:
//
//   VENDORS — prep. The shop AS WRITTEN: a name, a line of fiction, and
//   the lines behind the counter, each a catalogue entry with an
//   optional price of its own and an optional count. Absent count means
//   unlimited, which is the ordinary case: counting boxes of matches is
//   bookkeeping nobody asked for.
//
//   A shop that wrote NO list is edited here too, as of 2026-08-20, and
//   it is the same section wearing the shelf's own resolution: its
//   twenty-eight derived lines are shown as rows whose prices and counts
//   are the book's PROPOSALS, greyed in the placeholder, and typing over
//   one stores an override for that line and nothing else. Two rungs,
//   and the ladder is deliberate — override one number, or "write it all
//   down" and own the whole list from then on. Neither is required, and
//   the second is reversible by emptying the list it wrote.
//
//   THE COUNTER — play. Whoever has put a cart down, what it comes to,
//   and the sell button. Nothing here computes past a human: the total,
//   the coins and the change are all PROPOSALS in fields the Warden
//   types over before confirming (rule 1), and the sale carries what
//   they confirmed rather than what was proposed.
//
// Opening a shop instantiates NOTHING — browsing must never write (§14).
// The vendor becomes an entity at the first sale, which is one event
// the log carries and `/undo` steps back, and the "live" chip beside the
// name is how this screen says so.
//
// ONE CONSTRAINT THIS PANE DOESN'T SHARE WITH THE FILE IT CAME FROM.
// Tailwind builds teller's stylesheet by scanning teller's OWN source,
// and a shelf folder isn't in it — so a pane may only wear the
// utilities teller's client already uses somewhere. Arbitrary values
// (`text-[11px]`, `w-[19rem]`) compile to nothing, and this file was
// their only user before it moved: it rendered as unstyled slivers the
// first time it ran outside the repo. So every bracketed utility here
// is an inline `style` instead, pixel for pixel. A pane wanting more
// than that brings its own stylesheet (rung 3).
//
// Every figure it reads comes back through `plugin.call` — the pane's
// only way to reach its own doors, and the reason nothing here spells a
// url or the plugin's id. The one exception is the CATALOGUE, which is
// teller's own public door: the goods are the table's, not the store's,
// and a plugin that owned them would be a plugin nothing else could
// price against.

import { useState } from 'react';
import {
  api,
  btn,
  btnGhost,
  btnPrimary,
  card,
  input,
  sectionLabel,
  useLive,
  type BlockCtx,
} from 'teller';
import {
  formatPrice,
  makePayment,
  materialize,
  parsePrice,
  shelfRows,
  toVendor,
} from '../store.mjs';

// ---- what the doors answer with ---------------------------------------
//
// Declared here rather than imported: `store.mjs` is arithmetic, not
// types, and these are the shapes of the wire between the two halves of
// this plugin. One spelling of a payload, on both sides.

type Entry = { name: string; value?: unknown };

/** Only what this screen reads off a catalogue row — the goods are teller's. */
type Template = { id: string; name: string; lists?: Record<string, Entry[]> };

/**
 * What the book asks for this thing — the catalogue entry's own price
 * stat, found the way `shelfOf` finds it (the system's word for "what a
 * thing costs", matched case-insensitively: `costField` is 'cost', the
 * entry says 'Cost').
 *
 * Verbatim, not reformatted: this is the string that WILL apply if the
 * line's own price is left unset, so showing a tidied version of it
 * would be showing a number the shelf isn't going to use.
 */
function bookPrice(template: Template | undefined, costField: string): string | undefined {
  if (!template) return undefined;
  const want = costField.toLowerCase();
  for (const entries of Object.values(template.lists ?? {})) {
    const hit = (entries ?? []).find((e) => String(e?.name ?? '').toLowerCase() === want);
    if (hit?.value !== undefined && hit?.value !== null) return String(hit.value);
  }
  return undefined;
}

type VendorLine = { ref: string; name?: string; price?: string; qty?: number | null };

/** One line of a derived shelf a human moved off what the book proposed. */
type Override = { ref: string; price?: string; qty?: number; out?: true };

type Vendor = {
  id: string;
  name: string;
  blurb?: string;
  /** Explicit stock. ABSENT — not empty — means the shelf is derived. */
  lines?: VendorLine[];
  /** Derived stock: the catalogue shelves he carries. Absent = all of them. */
  groups?: string[];
  /** Derived stock: a catalogue stat's name → the values he carries. */
  filters?: Record<string, string[]>;
  /** Sparse, over the derived shelf: an entry per line somebody touched. */
  overrides?: Override[];
  /** This campaign authored it, so this console may edit it. */
  own?: boolean;
};

/** The slice of the table `store.mjs` reads to resolve a shelf — assembled here, for prep. */
type Table = { templates: { catalog: Template[] }; records: Record<string, unknown> };

type StockLine = {
  ref: string;
  name: string;
  type?: string;
  /** The catalogue's shelf label — what the seat's chip row narrows by. */
  group?: string;
  stats: Entry[];
  price: string | null;
  /** null = unlimited, and that is the ordinary case. */
  qty: number | null;
  missing?: true;
  /** An override took this line out of THIS shop. Only the console sees these. */
  out?: true;
  /** An override the derivation no longer proposes — kept, and flagged. */
  dangling?: true;
};

type CartLine = { ref: string; qty: number };

type ShopQuote = {
  entityId: string;
  name: string;
  lines: (CartLine & { name: string; price: string | null; each: number | null })[];
  offered: boolean;
  total: number;
  symbol: string;
  missing: string[];
  purse?: { name: string; value: number; held: number }[];
  held?: number;
  payment?: { counters: { name: string; value: number }[]; paid: number; change: number };
  counter?: { name: string; value: number };
};

type ShopView = {
  vendor: { id: string; name: string; blurb?: string; live: boolean };
  shelf: StockLine[];
  carts: ShopQuote[];
};

type Receipt = {
  vendor: { id: string; name: string; entityId: string };
  buyer: { id: string; name: string };
  total: number;
  lines: { ref: string; name: string; qty: number }[];
  carried: { id: string; name: string }[];
  refused: string[];
};

type Sale = { entityId: string; total: number; counters: { name: string; value: number }[] };

/** A pane always has its plugin — that is what makes it a pane (§15). */
type PaneProps = BlockCtx & { plugin: NonNullable<BlockCtx['plugin']> };

// ---- prep: the shop as written ----------------------------------------

function LineRow({
  line,
  template,
  book,
  onChange,
  onRemove,
}: {
  line: VendorLine;
  template: Template | undefined;
  /** What the catalogue asks, when it asks anything — the placeholder. */
  book: string | undefined;
  onChange: (patch: Partial<VendorLine>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-stone-100">
        {template?.name ?? line.name ?? line.ref}
        {!template && (
          <span className="ml-2 font-mono text-amber-500/80" style={{ fontSize: '11px' }}>
            not on this host
          </span>
        )}
      </span>
      {/* UNSET shows the book's own number, greyed — the figure that
          WILL apply, rather than the word "book's", which named the
          fallback without ever saying what it was. It stays a
          placeholder and never a value: typing overrides it, clearing
          lets the book's number show through again (rule 1 — the stored
          value wins, and here there isn't one). */}
      <input
        className={`${input} w-24 text-right font-mono text-xs`}
        placeholder={book ?? "book's"}
        defaultValue={line.price ?? ''}
        onBlur={(e) => onChange({ price: e.target.value.trim() || undefined })}
        aria-label={`what ${template?.name ?? line.ref} costs here${
          book ? ` (the book says ${book})` : ''
        }`}
      />
      <input
        className={`${input} w-20 text-right font-mono text-xs`}
        type="number"
        min={0}
        placeholder="∞"
        defaultValue={line.qty ?? ''}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          onChange({ qty: raw === '' ? null : Math.max(0, Math.floor(Number(raw) || 0)) });
        }}
        aria-label={`how many ${template?.name ?? line.ref} he has`}
      />
      <button className={`${btnGhost} hover:text-red-300`} onClick={onRemove} aria-label="remove">
        ✕
      </button>
    </li>
  );
}

/**
 * ONE LINE OF A DERIVED SHELF, and the three things a human may say
 * about it.
 *
 * The book PROPOSES, in the placeholder — the price and the count the
 * shelf will use if nobody touches this row, greyed because a proposal
 * is not a value (rule 1, and the same greyed-placeholder grammar the
 * written shelf's rows already use for an unset price). Typing takes the
 * line over; the ↺ hands it back; ✕ takes it out of this shop
 * altogether, which the catalogue never hears about.
 *
 * An overridden field wears an inset rule rather than a border colour —
 * teller's stylesheet is built `important`, so an inline `borderColor`
 * loses to the `input` class's own and vanishes silently. `box-shadow`
 * is the property that wins that argument (the shelf tile's cart ring
 * learned it first).
 */
function OverrideRow({
  line,
  over,
  own,
  onOver,
}: {
  line: StockLine;
  over: Override | undefined;
  own: boolean;
  /** A patch onto this line's override, or null to hand the line back to the book. */
  onOver: (next: Partial<Override> | null) => void;
}) {
  const mine = { boxShadow: 'inset 0 0 0 1px #b45309' };
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5"
      style={line.out ? { opacity: 0.5 } : undefined}
    >
      <span
        className="min-w-0 flex-1 truncate text-sm text-stone-100"
        style={line.out ? { textDecoration: 'line-through' } : undefined}
      >
        {line.name}
        {line.missing && (
          <span className="ml-2 font-mono text-amber-500/80" style={{ fontSize: '11px' }}>
            not on this host
          </span>
        )}
        {line.dangling && !line.missing && (
          <span className="ml-2 font-mono text-amber-500/80" style={{ fontSize: '11px' }}>
            no longer on the catalogue's shelf — yours is what's keeping it here
          </span>
        )}
      </span>

      {line.out ? (
        <button className={btn} onClick={() => onOver(null)} disabled={!own}>
          back on the shelf
        </button>
      ) : (
        <>
          <input
            className={`${input} w-24 text-right font-mono text-xs`}
            placeholder={line.price ?? "book's"}
            defaultValue={over?.price ?? ''}
            style={over?.price === undefined ? undefined : mine}
            disabled={!own}
            onBlur={(e) => onOver({ price: e.target.value.trim() || undefined })}
            aria-label={`what ${line.name} costs here${
              line.price ? ` (the book says ${line.price})` : ''
            }`}
          />
          <input
            className={`${input} w-20 text-right font-mono text-xs`}
            type="number"
            min={0}
            placeholder={line.qty === null ? '∞' : String(line.qty)}
            defaultValue={over?.qty ?? ''}
            style={over?.qty === undefined ? undefined : mine}
            disabled={!own}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              onOver({ qty: raw === '' ? undefined : Math.max(0, Math.floor(Number(raw) || 0)) });
            }}
            aria-label={`how many ${line.name} he has`}
          />
          {over && (
            <button
              className={btnGhost}
              onClick={() => onOver(null)}
              disabled={!own}
              aria-label={`back to the book for ${line.name}`}
              title="back to the book"
            >
              ↺
            </button>
          )}
          <button
            className={`${btnGhost} hover:text-red-300`}
            onClick={() => onOver({ out: true })}
            disabled={!own}
            aria-label={`take ${line.name} out of this shop`}
            title="not in this shop"
          >
            ✕
          </button>
        </>
      )}
    </li>
  );
}

function VendorCard({
  vendor,
  table,
  catalog,
  byId,
  costField,
  expanded,
  isOpen,
  onToggle,
  onSave,
  onDelete,
  onOpen,
}: {
  vendor: Vendor;
  /** What a shelf is resolved against — the catalogue and the system's records. */
  table: Table;
  catalog: Template[];
  byId: Map<string, Template>;
  /** The system's word for what a thing costs (`records.store.costField`). */
  costField: string;
  expanded: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSave: (next: Vendor) => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [adding, setAdding] = useState('');
  // Read through the plugin's OWN reading of a row rather than the raw
  // keys, so this screen and the shelf agree about what a shop is — an
  // empty `lines` beside groups reads as derived in `store.mjs`, and a
  // console that checked `lines === undefined` itself would call the same
  // shop written and offer the wrong editor.
  const shape: Vendor = toVendor(vendor) ?? vendor;
  const lines = shape.lines ?? [];
  // He wrote no list at all, so his shelf is DERIVED off the catalogue.
  // Not the same as an empty one: "he has nothing" is a statement.
  const derived = shape.lines === undefined;
  const overrides = shape.overrides ?? [];
  const rows: StockLine[] = derived && expanded ? shelfRows(table, shape) : [];
  const patch = (next: Partial<Vendor>) => onSave({ ...vendor, ...next });

  /** One line's override, replaced or removed — the sparse write, from this end. */
  const setOver = (ref: string, next: Partial<Override> | null) => {
    const kept = overrides.filter((o) => o.ref !== ref);
    if (next) {
      const merged: Override = next.out
        ? { ref, out: true }
        : { ...overrides.find((o) => o.ref === ref), ...next, ref, out: undefined };
      // An entry that says nothing is a line back at its default, and
      // the sparse list holds no such thing.
      if (merged.out || merged.price !== undefined || merged.qty !== undefined) kept.push(merged);
    }
    patch({ overrides: kept.length ? kept : undefined });
  };

  const writeItAllDown = () => {
    const written = materialize(table, shape) as VendorLine[];
    if (
      !window.confirm(
        `Write ${shape.name}'s shelf down as ${written.length} lines?\n\n` +
          `The list becomes this shop's own: the catalogue stops adding to it and stops ` +
          `correcting its prices, and you edit it row by row from here. Emptying the list ` +
          `later hands the shelf back to the book.`,
      )
    ) {
      return;
    }
    // The overrides were spent in the making of it — every line carries
    // its own price now, so there is nothing left for them to override.
    patch({ lines: written, overrides: undefined });
  };

  const backToTheBook = () => {
    if (
      !window.confirm(
        `Hand ${shape.name}'s shelf back to the book?\n\n` +
          `The ${lines.length} written line${lines.length === 1 ? '' : 's'} ` +
          `${lines.length === 1 ? 'is' : 'are'} discarded, and he carries whatever the ` +
          `catalogue prices on his shelves again.`,
      )
    ) {
      return;
    }
    patch({ lines: [] });
  };

  return (
    <li className="rounded-md border border-stone-800">
      <div className="flex items-center gap-2 p-2">
        <button className="min-w-0 flex-1 truncate text-left" onClick={onToggle}>
          <span className="text-sm text-stone-100">{vendor.name}</span>
          <span className="ml-2 font-mono text-stone-600" style={{ fontSize: '11px' }}>
            {derived ? 'off the catalogue' : `${lines.length} line${lines.length === 1 ? '' : 's'}`}
            {overrides.length > 0 && `, ${overrides.length} yours`}
          </span>
          {!vendor.own && (
            <span className="ml-2 font-mono text-stone-600" style={{ fontSize: '11px' }}>
              from a pack
            </span>
          )}
        </button>
        <button className={isOpen ? btn : btnPrimary} onClick={onOpen}>
          {isOpen ? 'shut the shop' : 'open'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-stone-800 p-2">
          {!vendor.own && (
            <p className="text-stone-500" style={{ fontSize: '12px' }}>
              A pack wrote this one. Restate it as the campaign's own to change it — the campaign
              wins the merge.
            </p>
          )}
          <input
            className={`${input} w-full`}
            defaultValue={vendor.name}
            onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value.trim() })}
            aria-label="shop name"
            disabled={!vendor.own}
          />
          <input
            className={`${input} w-full text-xs`}
            placeholder="one line of fiction for the masthead"
            defaultValue={vendor.blurb ?? ''}
            onBlur={(e) => patch({ blurb: e.target.value.trim() || undefined })}
            aria-label="blurb"
            disabled={!vendor.own}
          />

          <div className="flex items-baseline gap-2">
            <span className={sectionLabel}>Behind the counter</span>
            <span className="text-stone-600" style={{ fontSize: '11px' }}>
              price · stock (blank = unlimited)
            </span>
          </div>
          {derived ? (
            <>
              {/* The shelf, RESOLVED — what he actually has behind the
                  counter right now, rather than a sentence describing
                  where it came from. The sentence was the whole editor
                  for a derived shop, which made "charge a dollar more
                  for one rifle" mean writing the other twenty-seven
                  lines out by hand. */}
              <p className="text-stone-500" style={{ fontSize: '12px' }}>
                Off the catalogue: everything it prices
                {shape.groups?.length ? ` on ${shape.groups.join(', ')}` : ''}
                {shape.filters
                  ? `, ${Object.entries(shape.filters)
                      .map(([name, values]) => `${name} ${values.join(' or ')}`)
                      .join(' · ')}`
                  : ''}
                . Type over a price or a count and that line is this shop's; ✕ takes one out of
                this shop and nowhere else. Everything you leave alone keeps up with the book.
              </p>
              <ul className="space-y-1">
                {rows.map((line) => {
                  const over = overrides.find((o) => o.ref === line.ref);
                  return (
                    <OverrideRow
                      // The stored override is part of the identity: these
                      // fields are uncontrolled, so a row whose override
                      // changed underneath has to be a new row or it goes
                      // on showing what was typed into the old one.
                      key={`${line.ref}:${over?.price ?? ''}:${over?.qty ?? ''}:${over?.out ?? ''}`}
                      line={line}
                      over={over}
                      own={vendor.own === true}
                      onOver={(next) => setOver(line.ref, next)}
                    />
                  );
                })}
                {rows.length === 0 && (
                  <li className="text-sm text-stone-600">
                    the catalogue prices nothing he'd carry
                  </li>
                )}
              </ul>
            </>
          ) : (
            <ul className="space-y-1">
              {lines.map((line, i) => (
                <LineRow
                  key={`${line.ref}-${i}`}
                  line={line}
                  template={byId.get(line.ref)}
                  book={bookPrice(byId.get(line.ref), costField)}
                  onChange={(p) =>
                    patch({ lines: lines.map((l, j) => (j === i ? { ...l, ...p } : l)) })
                  }
                  onRemove={() => patch({ lines: lines.filter((_, j) => j !== i) })}
                />
              ))}
              {lines.length === 0 && (
                <li className="text-sm text-stone-600">nothing on the shelves yet</li>
              )}
            </ul>
          )}

          {vendor.own && (
            <div className="flex flex-wrap items-center gap-2">
              {derived ? (
                // The other rung (Brian, 2026-08-20): own the whole list.
                // Overriding one number and taking the list over are both
                // first-class, and neither is the price of the other.
                <button className={btn} onClick={writeItAllDown} disabled={rows.length === 0}>
                  write it all down
                </button>
              ) : (
                <>
                  <select
                    className={`${input} min-w-0 flex-1 text-xs`}
                    value={adding}
                    onChange={(e) => setAdding(e.target.value)}
                  >
                    <option value="">stock the shelf…</option>
                    {catalog.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className={btn}
                    disabled={!adding}
                    onClick={() => {
                      const t = byId.get(adding);
                      patch({ lines: [...lines, { ref: adding, ...(t ? { name: t.name } : {}) }] });
                      setAdding('');
                    }}
                  >
                    add
                  </button>
                  {/* The road back, and it only exists for a shop that
                      still knows which shelves it keeps: emptying the
                      written list is what returns him to the book. */}
                  {(shape.groups?.length || shape.filters) && (
                    <button className={btnGhost} style={{ fontSize: '11px' }} onClick={backToTheBook}>
                      back to the book
                    </button>
                  )}
                </>
              )}
              <button
                className={`${btnGhost} ml-auto hover:text-red-300`}
                style={{ fontSize: '11px' }}
                onClick={onDelete}
              >
                delete this shop
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---- play: the counter -------------------------------------------------

/** One cart on the counter, with the ruling the Warden is about to make. */
function CounterRow({
  quote,
  symbol,
  onSold,
  onHandBack,
}: {
  quote: ShopQuote;
  symbol: string;
  onSold: (sale: Sale) => void;
  onHandBack: () => void;
}) {
  // The book's total is the OPENING figure, never the last word — a
  // haggle is the most ordinary thing that happens at a counter.
  const [asked, setAsked] = useState<string | null>(null);
  const final = asked === null ? quote.total : (parsePrice(asked) ?? 0);

  // Re-proposed as the figure moves. The door proposed the first one;
  // this keeps up with the typing, out of the plugin's OWN arithmetic —
  // `store.mjs` is bundled into this pane, so there is one spelling of
  // a payment rather than a mirrored copy, and no round trip per
  // keystroke to re-propose change for a haggled price.
  const proposal = quote.purse ? makePayment(quote.purse, final) : undefined;
  const counters =
    proposal
      ? Object.entries(proposal.counts).map(([name, value]) => ({ name, value }))
      : quote.counter
        ? [{ name: quote.counter.name, value: Math.max(0, (quote.held ?? 0) - final) }]
        : [];
  const short = quote.held !== undefined && quote.held < final;

  return (
    <li
      className={`space-y-2 rounded-md border p-2 ${
        quote.offered ? 'border-amber-600/60 bg-amber-950/30' : 'border-stone-800'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm text-stone-100">{quote.name}</span>
        {quote.offered && (
          <span
            className="uppercase tracking-widest text-amber-400"
            style={{ fontSize: '11px' }}
          >
            on the counter
          </span>
        )}
        <span className="ml-auto font-mono text-stone-600" style={{ fontSize: '11px' }}>
          the book says {formatPrice(quote.total, symbol)}
        </span>
      </div>

      <ul className="space-y-0.5">
        {quote.lines.map((l) => (
          <li
            key={l.ref}
            className="flex items-baseline gap-2 text-stone-300"
            style={{ fontSize: '12px' }}
          >
            <span className="font-mono text-stone-500">{l.qty}×</span>
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <span className="font-mono text-stone-500">{l.price ?? '—'}</span>
          </li>
        ))}
      </ul>
      {quote.missing.length > 0 && (
        <p className="font-mono text-amber-500/80" style={{ fontSize: '11px' }}>
          {quote.missing.length} line{quote.missing.length === 1 ? '' : 's'} the catalogue can't
          price
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="uppercase tracking-widest text-stone-500" style={{ fontSize: '11px' }}>
          asking
        </label>
        <input
          className={`${input} w-24 text-right font-mono text-sm`}
          value={asked ?? formatPrice(quote.total, symbol)}
          onChange={(e) => setAsked(e.target.value)}
          aria-label={`what ${quote.name} is being charged`}
        />
        {quote.held !== undefined && (
          <span
            className={short ? 'text-red-400' : 'text-stone-500'}
            style={{ fontSize: '11px' }}
          >
            holds {formatPrice(quote.held, symbol)}
          </span>
        )}
        {proposal && proposal.change > 0 && (
          <span className="text-stone-500" style={{ fontSize: '11px' }}>
            pays {formatPrice(proposal.paid, symbol)}, takes {formatPrice(proposal.change, symbol)}{' '}
            back
          </span>
        )}
      </div>

      {counters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {counters.map((c) => (
            <span
              key={c.name}
              className="rounded-md bg-stone-900 px-2 py-1 font-mono text-stone-400"
              style={{ fontSize: '11px' }}
            >
              {c.name} → {c.value}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button className={btnGhost} onClick={onHandBack}>
          hand it back
        </button>
        <button
          className={`${btnPrimary} ml-auto`}
          onClick={() => onSold({ entityId: quote.entityId, total: final, counters })}
        >
          sold
        </button>
      </div>
    </li>
  );
}

export default function StorePane({ plugin }: PaneProps) {
  // THE TWO RECORDS A SHELF IS RESOLVED AGAINST, asked for by name.
  //
  // Not read off `records`: the ctx a block is handed carries the six
  // slots the chrome fetches for the SHEET (accents, dials, brand,
  // portraits, dice, marks), and 'store' has never been one of them —
  // so `records.store?.costField ?? 'cost'` was the fallback every time
  // and worked only because this system's stat happens to be called
  // Cost. A derived shelf resolved with no `costField` prices nothing
  // and comes back empty, which is how that was finally found.
  //
  // Teller's own public doors, like the catalogue below and for the same
  // reason: what a thing costs and which grades nobody stocks are the
  // TABLE's declarations, not the store's.
  const { data: records } = useLive<Record<string, Record<string, unknown>>>(
    () =>
      Promise.all(
        ['store', 'growth'].map((slot) =>
          api<Record<string, unknown>>(`/api/stack/record/${slot}`)
            .catch(() => ({}))
            .then((r) => [slot, r] as const),
        ),
      ).then(Object.fromEntries),
    [],
    { on: ['templates'] },
  );
  // The system's word for what a thing costs — the same declaration the
  // shelf reads, so an unset line's placeholder is exactly the number
  // the shelf will use. A system that declares nothing falls to 'cost',
  // which is what `store.mjs` does too.
  const costField = String(records?.store?.costField ?? 'cost');
  // Each on its own word: a vendor and the open shop are the store's
  // own ('shop'), the catalogue is the content stack's ('templates').
  const { data: vendors, reload: reloadVendors } = useLive(
    () => plugin.call<Vendor[]>('vendors'),
    [],
    { on: ['shop', 'templates'] },
  );
  const { data: catalog } = useLive(
    () => api<Template[]>('/api/stack/templates/catalog').catch(() => []),
    [],
    { on: ['templates'] },
  );
  const { data: view, reload: reloadShop } = useLive<ShopView | null>(
    () => plugin.call<ShopView | null>('shop'),
    [],
    // 'templates' too: the open shop's shelf is resolved off vendor rows
    // that this very pane edits, so the counter has to hear about a
    // price the Warden just typed on the shelf below it.
    { on: ['shop', 'entities', 'templates'] },
  );
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  // The four doors, spelled once. Nothing below knows a url or an id —
  // `plugin.call` is the whole of a pane's reach (§15), and a door moved
  // between plugins needs no edit here.
  const saveVendor = (vendor: Omit<Vendor, 'own' | 'id'> & { id?: string }) =>
    plugin.call<{ id: string }>('vendors', { method: 'POST', body: { template: vendor } });
  const deleteVendor = (id: string) =>
    plugin.call<{ ok: true }>('vendors', { method: 'DELETE', path: [id] });
  const openShop = (vendorId: string | null) =>
    plugin.call<ShopView | null>('shop', { method: 'POST', body: { vendorId } });
  const writeCart = (entityId: string, lines: CartLine[], offered?: boolean) =>
    plugin.call<ShopView | null>('cart', {
      method: 'PUT',
      path: [entityId],
      body: { lines, ...(offered === undefined ? {} : { offered }) },
    });
  const sell = (sale: Sale) => plugin.call<Receipt>('sell', { method: 'POST', body: { sale } });

  if (!vendors || !catalog || !records) return null;
  const byId = new Map(catalog.map((t) => [t.id, t]));
  // The slice `store.mjs` resolves a shelf against, assembled here for
  // PREP: the same two facts the host pushes a door, so the shelf this
  // screen edits is the shelf the counter will serve. No live vendor —
  // what the table has already bought off him is play, and the editor
  // shows the shop as written.
  const table: Table = { templates: { catalog }, records };
  const openId = view?.vendor.id;

  const save = async (next: Vendor) => {
    // Everything the row carried goes back — the door hands the
    // campaign's own rows out raw underneath, so a key this form has
    // never heard of survives being edited here.
    //
    // And `lines` goes back exactly as it arrived. This used to write
    // `lines: next.lines ?? []` on every save, which meant editing a
    // derived shop's BLURB declared it had nothing — survivable only
    // because a row with groups reads an empty list as derived anyway.
    // A shop that derives the whole catalogue has no groups to be
    // rescued by, and now that a derived shop is edited rather than
    // described, that save happens all the time.
    const { own: _own, ...rest } = next;
    await saveVendor(rest);
    reloadVendors();
    reloadShop();
  };

  const create = async () => {
    const made = await saveVendor({ name: `Shop ${vendors.length + 1}`, lines: [] });
    reloadVendors();
    setOpen(made.id);
  };

  const remove = async (vendor: Vendor) => {
    if (!window.confirm(`Delete "${vendor.name}"?`)) return;
    if (openId === vendor.id) await openShop(null);
    await deleteVendor(vendor.id);
    if (open === vendor.id) setOpen(null);
    reloadVendors();
    reloadShop();
  };

  const toggleOpen = async (vendor: Vendor) => {
    await openShop(openId === vendor.id ? null : vendor.id);
    setStatus('');
    reloadShop();
  };

  const confirm = async (sale: Sale) => {
    try {
      const receipt = await sell(sale);
      const carried = receipt.carried.length;
      setStatus(
        `${receipt.buyer.name} paid ${formatPrice(receipt.total)}` +
          (carried ? ` and carried off ${carried} thing${carried === 1 ? '' : 's'}` : '') +
          (receipt.refused.length ? ` — ${receipt.refused.join('; ')}` : ''),
      );
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    }
    reloadShop();
  };

  const symbol = view?.carts[0]?.symbol ?? '$';

  return (
    <div className="space-y-4">
      {view && (
        <section className={`${card} space-y-3`}>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={sectionLabel}>The counter</span>
            <span className="text-sm text-stone-100">{view.vendor.name}</span>
            {view.vendor.live && (
              <span
                className="rounded-full border px-2 py-0.5 uppercase tracking-wider"
                style={{ borderColor: '#b45309', color: '#f59e0b', fontSize: '0.6rem' }}
                title="this shop has transacted — it exists as an entity, and its stock is tracked"
              >
                live
              </span>
            )}
            <button className={`${btnGhost} ml-auto`} onClick={() => openShop(null).then(reloadShop)}>
              shut the shop
            </button>
          </div>

          {status && <p className="font-mono text-xs text-amber-400">{status}</p>}

          <ul className="space-y-2">
            {view.carts.length === 0 && (
              <li className="text-sm text-stone-600">nobody's gathered anything yet</li>
            )}
            {view.carts.map((quote) => (
              <CounterRow
                key={quote.entityId}
                quote={quote}
                symbol={quote.symbol || symbol}
                onSold={confirm}
                onHandBack={() => writeCart(quote.entityId, []).then(reloadShop)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className={`${card} space-y-3`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Shops</span>
          <button className={btnGhost} onClick={create}>
            new shop
          </button>
        </div>

        {vendors.length === 0 && (
          <p className="text-sm text-stone-600">
            nothing to buy anywhere — a shop is a name and a list of what's behind the counter
          </p>
        )}

        <ul className="space-y-2">
          {vendors.map((vendor) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              table={table}
              catalog={catalog}
              byId={byId}
              costField={costField}
              expanded={open === vendor.id}
              isOpen={openId === vendor.id}
              onToggle={() => setOpen(open === vendor.id ? null : vendor.id)}
              onSave={save}
              onDelete={() => remove(vendor)}
              onOpen={() => toggleOpen(vendor)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
