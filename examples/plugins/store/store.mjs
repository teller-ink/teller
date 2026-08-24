// THE COUNTER — the law of buying things, as a plugin.
//
// This file was `server/store-flow.ts` and it moved here whole on
// 2026-08-20 (docs/CORE-NEXT.md §15: "the store is plugin №2, by
// extraction"). What changed in the move is exactly two things, and
// nothing else about the shop's rules did:
//
//   * IT READS A SNAPSHOT, not a session. Every function that used to
//     take `session` takes `table` — the slice of the world the host
//     pushed in, assembled from what `plugin.json` declared it needs.
//     A plugin never queries (§15's held line); it is handed what it
//     asked for, once, per call.
//   * IT RETURNS EFFECTS, not writes. `sell` used to call
//     `session.create` and `session.save`; it now describes them, and
//     the host executes them through its own doors as `plugin:<id>`.
//     Every write is still an ordinary logged, undoable, overtypeable
//     write — more so, because now there is no way for it to be
//     anything else.
//
// The two halves and the seam between them are untouched:
//
//   * THE SHOP SESSION IS EPHEMERAL. Which vendor is open, what each
//     seat has gathered, whose cart is on the counter — nobody's
//     campaign, over the moment the shop closes. It lives in the
//     plugin's own per-table memory (`state` in and out of every door
//     call), which the host keys by Session, so a campaign switch drops
//     it without anything having to remember to clear it. That is the
//     same WeakMap the carts used to sit in directly; the plugin just
//     doesn't hold the key any more.
//   * THE TRANSACTION IS PERMANENT, and goes through the ordinary
//     doors. Money leaves a counter, things land as carried children,
//     stock comes off the shelf — each a stored value a human can
//     retype (rule 1) on an entity whose write is logged and invertible
//     (rule 3).
//
// §14, VERBATIM WHERE IT MATTERS: the vendor is instantiated as an
// entity at the FIRST TRANSACTION — never on browse — so "the shop went
// live" is one event, addressable and undoable. And it instantiates
// THIN: the entity stores only DEPLETED counts, one entry per line that
// has moved off the template's own `qty`. A thick-copied shop would be
// frozen at instantiation day; a thin one carries the pack's new items
// automatically, and a price correction in the book reaches the shelf
// at the next render.
//
// WHAT'S A VENDOR, THEN. The shop-as-written is a TEMPLATE — a row in
// the `vendors` slot, authored by the DM or shipped by a pack, carrying
// `lines` that name catalogue entries by id. It rides `declarations`
// rather than `templates` — merged by NAME across the stack, campaign
// winning, like every other vocabulary-coupled slot.
//
// A DERIVED SHELF IS STILL THE DM'S, LINE BY LINE (2026-08-20). A shop
// that writes no lines takes its shelf off the catalogue, and until now
// that was all or nothing: the whole list was the book's, and the only
// way to charge one dollar more for one rifle was to write the other
// twenty-seven lines out by hand. So a vendor grows an `overrides` list
// beside its groups and filters — SPARSE, exactly the way the live
// vendor's `stock` is sparse (§14's defaultStep): derivation proposes
// every line, an entry exists only once a human has moved that line off
// what was proposed, and a touched line's stored value wins (rule 1,
// per line). `out: true` is the third thing a human can say about a
// line, and it means "not in THIS shop" — the catalogue keeps it.
//
// Nothing about that freezes the shelf: the derivation still runs on
// every render, so a price corrected in the pack still reaches the
// twenty-seven lines nobody touched.
//
// AND THE HAMMER, for when a DM wants the list itself (Brian,
// 2026-08-20). `materialize` writes the resolved shelf DOWN — every
// derived line, overrides folded in, into explicit `lines` — and the
// shop stops deriving. That IS a freeze, and it is chosen: from then on
// the list is the DM's, edited row by row like any authored shop, and
// the pack's new items no longer walk in. The road back is the same one
// the forgiving read below already paves — empty the written list and a
// shop that still declares groups or filters returns to the book.
//
// Two rungs, neither of them required: override one number, or own the
// whole list.
//
// NO GAME WORDS. "Vendor", "cart", "price" and "stock" are English. The
// name of the money is not: which counter a purchase debits, and which
// stat on a catalogue entry holds the asking price, both arrive from
// the `store` and `currency` records (rule 2). This file never learns
// the word "Dollars" and never learns the word "Cost".

export const VENDOR_SLOT = 'vendors';
export const CATALOG_SLOT = 'catalog';
/** The `type` a live shop wears. teller's public snapshot knows this word as FURNITURE. */
export const VENDOR_TYPE = 'vendor';
/** The list a live vendor's depleted counts live in, keyed by catalogue ref. */
export const STOCK_LIST = 'stock';

// ---------------------------------------------------------------------
// Reading the snapshot. Four tiny accessors, so the shape of what the
// host pushes is stated in one place instead of spelled out in twenty.

function asRecord(raw) {
  return raw && typeof raw === 'object' ? raw : {};
}

/** Every shop this table knows about, merged across the stack. */
export function vendorsOf(table) {
  return (table.declarations?.[VENDOR_SLOT]?.merged ?? [])
    .map(toVendor)
    .filter((v) => v !== undefined);
}

/** The campaign's OWN vendor rows, raw — what this console may edit. */
export function ownVendors(table) {
  return table.declarations?.[VENDOR_SLOT]?.own ?? [];
}

export function vendorOf(table, id) {
  return vendorsOf(table).find((v) => v.id === id);
}

export function catalogOf(table) {
  return table.templates?.[CATALOG_SLOT] ?? [];
}

export function templateOf(table, id) {
  return catalogOf(table).find((t) => t && t.id === id);
}

export function storeRecord(table) {
  return asRecord(table.records?.store);
}

export function growthRecord(table) {
  return asRecord(table.records?.growth);
}

/** The declared coins, when the system has any. Undefined means one counter. */
export function currencyRecord(table) {
  const held = asRecord(table.records?.currency);
  return Array.isArray(held.denominations) && held.denominations.length ? held : undefined;
}

/** One top-level entity, both readings: what's STORED and what it READS as. */
export function entityOf(table, id) {
  return (table.entities ?? []).find((e) => e.stored && e.stored.id === id);
}

// ---------------------------------------------------------------------
// The vendor, read defensively — a pack's file, a campaign's row and an
// old world's export all arrive here and all three must open.

export function toVendor(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const id = String(raw.id ?? '').trim();
  const name = String(raw.name ?? '').trim();
  if (!id || !name) return undefined;
  const out = { id, name };
  if (typeof raw.blurb === 'string' && raw.blurb.trim()) out.blurb = raw.blurb.trim();

  // `stock` is the old world's spelling of `lines`. Absent — not empty —
  // is the DERIVED shelf, so the two must never be conflated: "he has
  // nothing" is a statement, and only a shop that wrote no list at all
  // takes its shelf off the catalogue.
  const written = Array.isArray(raw.lines) ? raw.lines : Array.isArray(raw.stock) ? raw.stock : undefined;
  // An EMPTY written list on a vendor that declares groups or filters
  // reads as derived: the groups exist only to derive a shelf, and the
  // `[]` beside them is an editor's artifact, not a statement (found
  // live 2026-08-20 — six ported rows carried it and five shops stood
  // empty). "He has nothing" stays expressible: a vendor with no
  // groups and no filters and `[]` is exactly that.
  const meantDerived =
    written &&
    written.length === 0 &&
    ((Array.isArray(raw.groups) && raw.groups.length > 0) ||
      (raw.filters && typeof raw.filters === 'object'));
  if (written && !meantDerived) {
    out.lines = written
      .map((raw_) => {
        const line = raw_ && typeof raw_ === 'object' ? raw_ : {};
        const ref = String(line.ref ?? '').trim();
        if (!ref) return undefined;
        const l = { ref };
        if (typeof line.name === 'string' && line.name.trim()) l.name = line.name.trim();
        if (typeof line.price === 'string' && line.price.trim()) l.price = line.price.trim();
        if (line.qty === null) l.qty = null;
        else if (typeof line.qty === 'number' && Number.isFinite(line.qty)) {
          l.qty = Math.max(0, Math.floor(line.qty));
        }
        return l;
      })
      .filter((l) => l !== undefined);
  }

  const overrides = Array.isArray(raw.overrides)
    ? raw.overrides.map(toOverride).filter((o) => o !== undefined)
    : undefined;
  if (overrides?.length) out.overrides = overrides;

  const groups = Array.isArray(raw.groups)
    ? raw.groups.map((g) => String(g).trim()).filter(Boolean)
    : undefined;
  if (groups?.length) out.groups = groups;

  if (raw.filters && typeof raw.filters === 'object') {
    const filters = {};
    for (const [name_, values] of Object.entries(raw.filters)) {
      const kept = Array.isArray(values) ? values.map((v) => String(v).trim()).filter(Boolean) : [];
      if (kept.length) filters[name_] = kept;
    }
    if (Object.keys(filters).length) out.filters = filters;
  }
  return out;
}

/**
 * One line a human moved off what the shelf proposed.
 *
 * SPARSE, so it is read strictly: an entry that says nothing is a line
 * back at its default and therefore isn't an entry at all. `out`
 * swallows the rest — a line this shop doesn't carry has no price here
 * — and a count is a COUNT, never null: unlimited is the ABSENCE of a
 * count, which is the absence of the override.
 */
function toOverride(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const ref = String(o.ref ?? '').trim();
  if (!ref) return undefined;
  if (o.out === true) return { ref, out: true };
  const out = { ref };
  if (typeof o.price === 'string' && o.price.trim()) out.price = o.price.trim();
  if (typeof o.qty === 'number' && Number.isFinite(o.qty)) out.qty = Math.max(0, Math.floor(o.qty));
  return out.price === undefined && out.qty === undefined ? undefined : out;
}

// ---------------------------------------------------------------------
// Money, as arithmetic. Integer minor units throughout — a price is a
// string in the book ("$4.50") because that is what a human typed, and
// a number everywhere it is added up.

export function parsePrice(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function priceSymbol(sample) {
  const hit = /^\s*([^\d\s]+)/.exec(String(sample ?? ''));
  return hit ? hit[1] : '$';
}

export function formatPrice(cents, symbol = '$') {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------
// The shelf: the shop as written, minus what the table has bought.

/** Find a stat by name, case-insensitively — `costField` is 'cost', the entry says 'Cost'. */
function statNamed(template, name) {
  if (!template || !name) return undefined;
  const want = String(name).toLowerCase();
  for (const entries of Object.values(template.lists ?? {})) {
    const hit = (entries ?? []).find((e) => String(e?.name ?? '').toLowerCase() === want);
    if (hit) return hit;
  }
  return undefined;
}

/** Every stat the catalogue entry carries, flattened in its own order. */
function statsOf(template) {
  if (!template) return [];
  return Object.values(template.lists ?? {}).flat();
}

/** What the entry asks, in the system's own words for "what a thing costs". */
function priceOf(template, store) {
  const stat = statNamed(template, store.costField);
  return stat?.value !== undefined && stat?.value !== null ? String(stat.value) : null;
}

function lineFrom(template, price, qty) {
  const out = { ref: template.id, name: template.name, stats: statsOf(template), price, qty };
  if (template.type) out.type = template.type;
  if (template.group) out.group = template.group;
  return out;
}

/** What the live vendor says it has sold down to, keyed by ref. */
function depletionOf(live) {
  return new Map(
    (live?.lists?.[STOCK_LIST] ?? [])
      .filter((e) => typeof e.value === 'number')
      .map((e) => [e.name, e.value]),
  );
}

/** One line of the shop AS WRITTEN, resolved through the catalogue. */
function writtenLine(table, line, depleted) {
  const store = storeRecord(table);
  const template = templateOf(table, line.ref);
  const written = line.qty ?? null;
  // Depletion only ever applies to a line the DM chose to count.
  const qty = written === null ? null : (depleted.get(line.ref) ?? written);
  if (!template) {
    return {
      ref: line.ref,
      name: line.name ?? line.ref,
      stats: [],
      price: line.price ?? null,
      qty,
      missing: true,
    };
  }
  return lineFrom(template, line.price ?? priceOf(template, store), qty);
}

/**
 * THE WHOLE SHELF, including the lines an override took OUT — each of
 * those marked `out`, so the console can show a human what they removed
 * and hand it back. Every player-facing surface takes `shelfOf`, which
 * is this minus those.
 *
 * The order of resolution is the law, and it is one sentence: the shop
 * as written (or the catalogue, when nothing was written) PROPOSES every
 * line, and a line a human touched carries what they typed (rule 1, per
 * line).
 *
 * A live vendor's depletion applies underneath both — an overridden
 * count makes a line COUNTED, and a counted line's stock is whatever the
 * entity has sold it down to, exactly as for a written one.
 */
export function shelfRows(table, vendor, live) {
  const depleted = depletionOf(live);
  const base = vendor.lines
    ? vendor.lines.map((line) => writtenLine(table, line, depleted))
    : derivedShelf(table, vendor);
  return overlay(table, vendor, base, depleted);
}

/**
 * What's behind the counter right now.
 *
 * The template's lines are the shop AS WRITTEN; the live vendor entity
 * (if the shop has ever transacted) restates a `qty` per line it has
 * sold down. A line the entity says nothing about is still at its
 * written count — that absence IS the thin instantiation (§14).
 */
export function shelfOf(table, vendor, live) {
  return shelfRows(table, vendor, live).filter((line) => !line.out);
}

/** One proposed line, with what a human said about it laid over the top. */
function overridden(line, over, depleted) {
  if (over.out) return { ...line, out: true };
  const out = { ...line };
  if (over.price !== undefined) out.price = over.price;
  if (over.qty !== undefined) out.qty = depleted.get(line.ref) ?? over.qty;
  return out;
}

/**
 * The sparse list, over the proposed shelf.
 *
 * The interesting half is the tail: an override whose ref the shelf no
 * longer proposes — the pack dropped the item, the shop's groups
 * changed, a filter narrowed past it. It does NOT vanish. A human
 * stating a price for a thing is a human stocking it, so the line stands
 * on its own, marked `dangling` for the console to flag; only an `out`
 * with nothing left to remove is inert, because it was already a
 * statement of absence and the absence arrived by itself.
 *
 * Never silently dropped is rule 9's tail, and a price a DM typed
 * evaporating because a pack was updated is exactly the shape it warns
 * about.
 */
function overlay(table, vendor, base, depleted) {
  if (!vendor.overrides?.length) return base;
  const store = storeRecord(table);
  const left = new Map(vendor.overrides.map((o) => [o.ref, o]));
  const rows = base.map((line) => {
    const over = left.get(line.ref);
    if (!over) return line;
    left.delete(line.ref);
    return overridden(line, over, depleted);
  });
  for (const over of left.values()) {
    if (over.out) continue;
    const template = templateOf(table, over.ref);
    const line = template
      ? lineFrom(template, priceOf(template, store), null)
      : { ref: over.ref, name: over.ref, stats: [], price: null, qty: null, missing: true };
    rows.push({ ...overridden(line, over, depleted), dangling: true });
  }
  return rows;
}

/**
 * THE SHELF, WRITTEN DOWN — the `lines` a derived shop becomes when its
 * DM takes the list over.
 *
 * Everything the shelf resolves to right now, overrides folded in and
 * the lines an override took out left out, each carrying its own price
 * so the book can no longer move it. That is a freeze and it is the
 * point: what comes back is a list the DM owns, edited row by row like
 * any authored shop. The overrides are spent in the making of it — a
 * line that carries its own price has nothing left to override — so the
 * caller writes them away with the same save.
 *
 * Depletion is deliberately NOT folded in: this is the shop as written,
 * and what the table has already bought off it stays where it lives, on
 * the live vendor. Reading it in here would sell the same rifle twice.
 */
export function materialize(table, vendor) {
  return shelfRows(table, vendor)
    .filter((line) => !line.out)
    .map((line) => {
      const out = { ref: line.ref };
      // Only a line the catalogue can't resolve needs to carry its name;
      // every other one still reads it off the entry it points at.
      if (line.missing) out.name = line.name;
      if (line.price !== null) out.price = line.price;
      if (line.qty !== null) out.qty = line.qty;
      return out;
    });
}

/**
 * THE SHELF A SHOP DIDN'T HAVE TO WRITE — everything in the catalogue
 * with a price, narrowed three ways:
 *
 *   * GROUPS — the shelves he keeps. No list means every shelf.
 *   * FILTERS — a stat's name against the values he carries. An entry
 *     that doesn't have the stat PASSES: a filter narrows the things it
 *     describes, it doesn't banish everything else — quality tiers
 *     exist on weapons, and the general store still sells flour.
 *   * OFF LIMITS — the grades the system says nobody simply stocks.
 *
 * Everything here is UNLIMITED, so nothing derived ever depletes and a
 * derived shop stays a shop that never instantiated.
 */
function derivedShelf(table, vendor) {
  const store = storeRecord(table);
  const growth = growthRecord(table);
  const groups = vendor.groups?.length ? new Set(vendor.groups) : null;
  const offLimits =
    growth.field && growth.unstocked?.length
      ? { field: growth.field, grades: new Set(growth.unstocked) }
      : null;

  const out = [];
  for (const template of catalogOf(table)) {
    if (!template) continue;
    const price = priceOf(template, store);
    // No price is no offer: an ability, a trade feature, anything the
    // catalogue holds that a shop can't sell.
    if (parsePrice(price) === null) continue;
    if (groups && !groups.has(template.group ?? '')) continue;
    if (offLimits) {
      const grade = statNamed(template, offLimits.field)?.value;
      if (grade !== undefined && offLimits.grades.has(String(grade))) continue;
    }
    let carried = true;
    for (const [name, values] of Object.entries(vendor.filters ?? {})) {
      const value = statNamed(template, name)?.value;
      if (value !== undefined && !values.includes(String(value))) carried = false;
    }
    if (carried) out.push(lineFrom(template, price, null));
  }
  return out.sort(
    (a, b) =>
      (a.group ?? '').localeCompare(b.group ?? '') ||
      (parsePrice(a.price) ?? 0) - (parsePrice(b.price) ?? 0),
  );
}

/** A cart against a shelf: line prices resolved, the book's total. */
export function cartTotal(lines, shelf) {
  const byRef = new Map(shelf.map((l) => [l.ref, l]));
  let cents = 0;
  let symbol = '';
  const missing = [];
  for (const line of lines) {
    const stocked = byRef.get(line.ref);
    const price = parsePrice(stocked?.price);
    if (!stocked || price === null) {
      missing.push(line.ref);
      continue;
    }
    cents += price * line.qty;
    if (!symbol) symbol = priceSymbol(stocked.price);
  }
  return { cents, symbol: symbol || '$', missing };
}

// ---------------------------------------------------------------------
// The purse. Denominations are ordinary counters (rule 2); this is the
// shopkeeper's arithmetic over them, and every figure it produces is a
// PROPOSAL the DM types over at the counter (rule 1).

function countOf(entry) {
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/** A named entry wherever it lives on this entity, and which list that was. */
function entryAcross(entity, name) {
  const want = String(name ?? '').toLowerCase();
  for (const [list, entries] of Object.entries(entity?.lists ?? {})) {
    const entry = (entries ?? []).find((e) => String(e?.name ?? '').toLowerCase() === want);
    if (entry) return { list, entry };
  }
  return undefined;
}

/** The declared denominations this buyer actually holds, largest first. */
export function purseOf(reading, currency) {
  const out = [];
  for (const d of currency.denominations ?? []) {
    const found = entryAcross(reading, d.counter);
    if (found) out.push({ name: found.entry.name, value: d.value, held: countOf(found.entry) });
  }
  return out.sort((a, b) => b.value - a.value);
}

export function purseTotal(purse) {
  return purse.reduce((sum, d) => sum + d.held * d.value, 0);
}

/**
 * Pay a price out of the purse the way a hand does it at a counter:
 * exact coins if they're there (largest first), otherwise the smallest
 * overpayment the pouch can make — and the change comes back in the
 * biggest coins that fit.
 *
 * Null when the whole purse can't cover it. That ruling belongs to the
 * DM, not to arithmetic: the console shows "holds $2.10, costs $4.50"
 * and the sell button still works, because a shopkeeper may extend
 * credit and teller may not decide he can't.
 */
export function makePayment(purse, price) {
  if (purseTotal(purse) < price) return null;

  const counts = {};
  let remaining = price;
  for (const d of purse) {
    const take = Math.min(Math.floor(remaining / d.value), d.held);
    counts[d.name] = d.held - take;
    remaining -= take * d.value;
  }
  let paid = price - remaining;
  if (remaining <= 0) return { counts, paid, change: 0 };

  // No exact change — hand over more, smallest sufficient coin first
  // (the human move: cover a nickel gap with a dime before breaking a
  // dollar).
  for (const d of [...purse].reverse()) {
    while (remaining > 0 && counts[d.name] > 0) {
      counts[d.name] -= 1;
      remaining -= d.value;
      paid += d.value;
    }
    if (remaining <= 0) break;
  }
  // The till's change, back in the biggest coins that fit.
  let change = -remaining;
  for (const d of purse) {
    const back = Math.floor(change / d.value);
    counts[d.name] = (counts[d.name] ?? 0) + back;
    change -= back * d.value;
  }
  return { counts, paid, change: -remaining };
}

// ---------------------------------------------------------------------
// The ephemeral half — one open shop, per-seat carts. This is the whole
// of the plugin's memory, and it is a plain object because that is all
// it may be: it crosses `structuredClone` on the way in and out of
// every door call, and the host holds it against the live Session.

/** A shop nobody has opened. The shape `state` always has, so no door reads null. */
export function noShop() {
  return null;
}

export function openShop(vendorId) {
  // Stale carts are wiped per visit rather than kept: walking back into
  // the general store is a new visit, and a cart from an hour ago on
  // somebody's screen is a bug wearing a memory. Browsing instantiates
  // NOTHING (§14) — this touches no entity and writes no stock.
  return { vendorId, carts: {}, offered: {} };
}

/** One seat's cart, replaced whole. Editing takes it back off the counter. */
export function setCart(shop, entityId, lines, offered) {
  const carts = { ...shop.carts };
  const on = { ...shop.offered };
  if (lines.length) carts[entityId] = lines;
  else delete carts[entityId];
  if (offered === undefined) delete on[entityId];
  else if (offered) on[entityId] = true;
  else delete on[entityId];
  return { ...shop, carts, offered: on };
}

/**
 * WHO SEES WHOSE CART — the whole law, in one function so there is one
 * place to read it and one place to test it.
 *
 *   * the DM sees every cart: ruling on them is the DM's whole job at
 *     the counter, and a cart is put there to be seen;
 *   * a SEAT sees its own and nobody else's — not because another
 *     player's shopping is a secret, but because there is no way to
 *     phrase the question about somebody else's, and a door that can't
 *     be asked wrong can't be answered wrong;
 *   * every other role sees nothing. A passive screen renders the
 *     `/public` snapshot, which never mentions a shop at all.
 *
 * `who` is the host's own ruling, handed in (rule 7). The plugin reads
 * facts and never a secret — it cannot decide it is the DM.
 */
export function visibleCarts(shop, who) {
  const all = Object.entries(shop.carts).map(([entityId, lines]) => ({
    entityId,
    lines,
    offered: shop.offered[entityId] === true,
  }));
  if (who.role === 'dm') return all;
  if (who.role !== 'seat' || !who.entityId) return [];
  return all.filter((c) => c.entityId === who.entityId);
}

// ---------------------------------------------------------------------
// The permanent half — the transaction.

/** The live vendor, if this shop has ever transacted. Found by its stamp. */
export function vendorEntity(table, vendorId) {
  return (table.entities ?? [])
    .map((e) => e.stored)
    .find((e) => e && e.type === VENDOR_TYPE && refFrom(e) === vendorId);
}

function refFrom(entity) {
  const held = entity.refs?.from;
  const ref = Array.isArray(held) ? held[0] : held;
  return ref?.id;
}

/** What the counter proposes for one cart, before anybody rules on it. Writes nothing. */
export function quote(table, shelf, entityId, lines, offered) {
  const held = entityOf(table, entityId);
  if (!held) return undefined;
  const { stored, reading } = held;
  const byRef = new Map(shelf.map((l) => [l.ref, l]));
  const { cents, symbol, missing } = cartTotal(lines, shelf);
  const out = {
    entityId,
    name: stored.name,
    lines: lines.map((l) => {
      const stocked = byRef.get(l.ref);
      return {
        ...l,
        name: stocked?.name ?? l.ref,
        price: stocked?.price ?? null,
        each: parsePrice(stocked?.price),
      };
    }),
    offered,
    total: cents,
    symbol,
    missing,
  };

  const currency = currencyRecord(table);
  if (currency) {
    const purse = purseOf(reading, currency);
    out.purse = purse.map((d) => ({ name: d.name, value: d.value, held: d.held }));
    out.held = purseTotal(purse);
    const payment = makePayment(purse, cents);
    if (payment) {
      out.payment = {
        counters: Object.entries(payment.counts).map(([name, value]) => ({ name, value })),
        paid: payment.paid,
        change: payment.change,
      };
    }
    return out;
  }

  // No coins declared: one counter, debited by the price. Whether that
  // price is in minor units or whole ones is the system's business and
  // this doesn't guess — the single-counter case debits MINOR units,
  // the same figure every other number here is in, and the DM types
  // over it if their table counts differently (rule 1).
  const store = storeRecord(table);
  if (store.counter) {
    const found = entryAcross(reading, store.counter);
    if (found) {
      out.held = countOf(found.entry);
      out.counter = { name: found.entry.name, value: Math.max(0, countOf(found.entry) - cents) };
    }
  }
  return out;
}

/**
 * Which lines this shop COUNTS, and at what — a number, or null for the
 * ordinary unlimited. A ref this doesn't mention is unlimited too, which
 * is every line of a derived shelf nobody has touched.
 *
 * The one place the two ways of counting a line meet: what the shop
 * wrote, and what a human overrode. A line taken out of the shop is
 * neither, so it comes out of the map entirely.
 */
function countsOf(vendor) {
  const out = new Map((vendor.lines ?? []).map((l) => [l.ref, l.qty ?? null]));
  for (const over of vendor.overrides ?? []) {
    if (over.out) out.delete(over.ref);
    else if (over.qty !== undefined) out.set(over.ref, over.qty);
  }
  return out;
}

/** A thin child (§K): a ref to the template and nothing else, so a correction reaches it forever. */
function thinChild(template) {
  const child = {
    id: `ent_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    name: template.name,
    lists: {},
    refs: { from: { id: template.id, name: template.name } },
  };
  if (template.type) child.type = template.type;
  return child;
}

/**
 * THE TRANSACTION, as a proposal.
 *
 * Four things happen and none of them happens here — this returns the
 * EFFECTS that make them happen, in the order the host must run them:
 *
 *   1. instantiate the vendor, if this is the first — one entity, which
 *      IS "the shop went live" and is undoable on its own. It carries
 *      its depleted counts at birth, so a first sale is one write and
 *      not two;
 *   2. otherwise write the depleted counts onto the vendor already
 *      there — thin, only lines the DM chose to count;
 *   3. take the payment and hand over the goods in ONE write on the
 *      buyer, so the purchase is one undo step rather than a dozen (the
 *      old world's own invariant, and it was right);
 *   4. append the receipt, for a log a human can read back.
 *
 * Every number that moves came from the console, where the DM could
 * type over it first. This does no arithmetic of its own on the buyer's
 * money — `quote()` proposed, a human confirmed, and what arrives here
 * is the ruling.
 *
 * `{{vendor}}` is the host's placeholder (`Effect.as`): the receipt and
 * the log name an entity that does not exist until effect 1 has run,
 * and the host substitutes the minted id into everything after it.
 */
export function sell(table, vendor, sale, shop) {
  const held = entityOf(table, sale.entityId);
  if (!held) return { error: `no entity ${sale.entityId}` };
  const buyer = held.stored;
  const reading = held.reading;
  const lines = (sale.lines ?? shop?.carts[sale.entityId] ?? []).filter((l) => l.qty > 0);
  if (!lines.length) return { error: 'an empty cart is not a sale' };

  const store = storeRecord(table);
  const consumed = new Set((store.consumes ?? []).map((k) => String(k).toLowerCase()));
  const refused = [];
  const effects = [];

  // 1 + 2 — the vendor goes live, and its shelf comes down.
  const live = vendorEntity(table, vendor.id);
  const shelf = shelfOf(table, vendor, live);
  // Derived stock counts nothing, so a derived shop writes no stock and
  // its entity stays as empty as the day it went live — unless a human
  // put a count on a line, which is what an override's `qty` IS.
  const written = countsOf(vendor);
  const stock = [...(live?.lists?.[STOCK_LIST] ?? [])];
  let depleted = false;
  for (const line of lines) {
    if (written.get(line.ref) === null || written.get(line.ref) === undefined) continue;
    const stocked = shelf.find((s) => s.ref === line.ref);
    const left = Math.max(0, (stocked?.qty ?? 0) - line.qty);
    const at = stock.findIndex((e) => e.name === line.ref);
    if (at >= 0) stock[at] = { ...stock[at], value: left };
    else stock.push({ name: line.ref, value: left });
    depleted = true;
  }
  let vendorEntityId;
  if (!live) {
    effects.push({
      effect: 'entity.create',
      as: 'vendor',
      draft: {
        name: vendor.name,
        type: VENDOR_TYPE,
        lists: depleted ? { [STOCK_LIST]: stock } : {},
        refs: { from: { id: vendor.id, name: vendor.name } },
      },
    });
    vendorEntityId = '{{vendor}}';
  } else {
    vendorEntityId = live.id;
    if (depleted) {
      effects.push({
        effect: 'entity.save',
        entity: { ...live, lists: { ...live.lists, [STOCK_LIST]: stock } },
      });
    }
  }

  // 3 — one write on the buyer: the money out, the goods in.
  const lists = { ...buyer.lists };
  for (const want of sale.counters ?? []) {
    const found = entryAcross(reading, want.name);
    if (!found) {
      refused.push(`nothing on ${buyer.name} is called ${want.name}`);
      continue;
    }
    // The sparse-write bargain: touching an entry that lives only in
    // the template copies exactly that entry down first, so its ceiling
    // and its spelling survive.
    const heldEntries = [...(lists[found.list] ?? [])];
    const at = heldEntries.findIndex(
      (e) => String(e?.name ?? '').toLowerCase() === found.entry.name.toLowerCase(),
    );
    if (at >= 0) heldEntries[at] = { ...heldEntries[at], value: want.value };
    else heldEntries.push({ ...found.entry, value: want.value });
    lists[found.list] = heldEntries;
  }

  const carried = [];
  const children = [...(buyer.children ?? [])];
  const receiptLines = [];
  for (const line of lines) {
    const template = templateOf(table, line.ref);
    const stocked = shelf.find((s) => s.ref === line.ref);
    receiptLines.push({ ref: line.ref, name: stocked?.name ?? line.ref, qty: line.qty });
    if (!template) {
      refused.push(`${stocked?.name ?? line.ref} isn't on this host — nothing was carried away`);
      continue;
    }
    // A service is bought and consumed at the counter; nobody carries a
    // bath home. Which kinds those are is the system's declaration.
    if (consumed.has(String(template.type ?? '').toLowerCase())) continue;
    for (let n = 0; n < Math.min(line.qty, 99); n++) {
      const child = thinChild(template);
      children.push(child);
      carried.push({ id: child.id, name: child.name });
    }
  }

  effects.push({ effect: 'entity.save', entity: { ...buyer, lists, children } });

  // 4 — the receipt. A record, not a mutation: what it MOVED each has
  // its own invertible effect above (`server/undo.ts` skips records for
  // exactly this reason).
  const total = sale.total ?? cartTotal(lines, shelf).cents;
  effects.push({
    effect: 'log',
    entityId: buyer.id,
    kind: 'shop.sold',
    payload: {
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorEntityId,
      buyerId: buyer.id,
      buyerName: buyer.name,
      total,
      lines: receiptLines,
      ...(refused.length ? { refused } : {}),
    },
  });

  return {
    effects,
    receipt: {
      vendor: { id: vendor.id, name: vendor.name, entityId: vendorEntityId },
      buyer: { id: buyer.id, name: buyer.name },
      total,
      lines: receiptLines,
      carried,
      refused,
    },
  };
}

/** The resolved shop a screen renders — what the `shop` door answers with. */
export function shopView(table, shop, who) {
  const vendor = vendorOf(table, shop.vendorId);
  if (!vendor) return undefined;
  const live = vendorEntity(table, vendor.id);
  const shelf = shelfOf(table, vendor, live);
  const carts = [];
  for (const { entityId, lines, offered } of visibleCarts(shop, who)) {
    const q = quote(table, shelf, entityId, lines, offered);
    if (q) carts.push(q);
  }
  return {
    vendor: {
      id: vendor.id,
      name: vendor.name,
      ...(vendor.blurb ? { blurb: vendor.blurb } : {}),
      live: live !== undefined,
    },
    shelf,
    carts,
  };
}
