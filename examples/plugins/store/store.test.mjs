// The counter's LAW, tested where it now lives (§14, §15). Written as
// the laws read, because the laws are the feature:
//
//   * money is integer minor units, and a total NAMES what it couldn't
//     price rather than quietly dropping it (rule 9's tail);
//   * a vendor is read defensively — a pack's file, a campaign's row and
//     an old world's export all open, and absent lines are the DERIVED
//     shelf while empty ones are a statement;
//   * the DM sees every cart, a seat sees its own and nobody else's, and
//     every other role sees nothing — decided against the `who` FACTS
//     the host hands in, never a secret the plugin holds (rule 7);
//   * browsing instantiates NOTHING — `sell` is the only function here
//     that proposes a write, and even that only PROPOSES (rule 1);
//   * the first sale instantiates the whole vendor once, THIN, carrying
//     its depleted counts at birth — one write, not two;
//   * and a line this host can't resolve is REFUSED out loud rather
//     than skipped.
//
// What the extraction bought is this file: the shelf, the quote and the
// sale used to be reachable only through HTTP, because they wanted a
// Session. They want a SNAPSHOT now, and a snapshot is an object
// literal — so the arithmetic of the shop is testable as arithmetic.
// The doors, the enable gate and the effect vocabulary's enforcement
// stay the server's job (`server/store-plugin.test.ts`).

import { describe, expect, it } from 'vitest';
import {
  cartTotal,
  formatPrice,
  makePayment,
  materialize,
  parsePrice,
  priceSymbol,
  quote,
  sell,
  shelfOf,
  shelfRows,
  toVendor,
  vendorOf,
  visibleCarts,
} from './store.mjs';

// ---------------------------------------------------------------------
// A tiny, complete world: two coins, three guns, ammo, a service, and
// three shops — one that wrote its lines, one that derives its shelf,
// one that derives and narrows. Lifted from the old `server/
// store-flow.test.ts`'s SYSTEM constant, which is what a host would put
// in a `systems` row; what's below is the SNAPSHOT the bridge assembles
// out of it (`server/plugin-bridge.ts`), which is all a plugin ever
// sees. The one shape change is the host's own: a catalogue entry's
// top-level `counters` arrives already folded into `lists.counters`,
// because `toTemplate` did that before the snapshot was built.

const CATALOG = [
  {
    id: 'wpn_rifle',
    name: 'Used Rifle',
    type: 'weapon',
    group: 'Guns',
    slots: 4,
    lists: {
      stats: [
        { name: 'Cost', value: '$20.00' },
        { name: 'Grit', value: 4 },
        { name: 'Quality', value: 'Used' },
      ],
    },
  },
  {
    id: 'wpn_shiny',
    name: 'Shiny Rifle',
    type: 'weapon',
    group: 'Guns',
    lists: { stats: [{ name: 'Cost', value: '$25.00' }, { name: 'Quality', value: 'Basic' }] },
  },
  {
    id: 'wpn_relic',
    name: 'The Widowmaker',
    type: 'weapon',
    group: 'Guns',
    lists: { stats: [{ name: 'Cost', value: '$500.00' }, { name: 'Quality', value: 'Legendary' }] },
  },
  {
    id: 'abl_free',
    name: 'Steady Hand',
    type: 'ability',
    group: 'Guns',
    lists: { stats: [{ name: 'Effect', value: 'you are steady' }] },
  },
  {
    id: 'amo_rounds',
    name: 'Plain Rounds',
    type: 'ammo',
    group: 'Sundries',
    lists: {
      stats: [{ name: 'Cost', value: '$0.50' }],
      counters: [{ name: 'Rounds', value: 3 }],
    },
  },
  {
    id: 'svc_bath',
    name: 'A Hot Bath',
    type: 'service',
    group: 'Services',
    lists: { stats: [{ name: 'Cost', value: '$0.30' }] },
  },
];

const VENDORS = [
  {
    id: 'ven_general',
    name: "Curly's General Store",
    blurb: 'Dusty shelves, honest prices.',
    lines: [
      // Counted: three sticks, and the DM said so.
      { ref: 'wpn_rifle', qty: 3 },
      // Uncounted: nobody tallies boxes of matches.
      { ref: 'amo_rounds' },
      // The shop's own price, over the book's.
      { ref: 'svc_bath', price: '$0.50' },
    ],
  },
  // Wrote no list at all: the shelf is DERIVED off the catalogue.
  { id: 'ven_emporium', name: 'The Emporium', groups: ['Guns', 'Sundries'] },
  // The same, narrowed to the grades he carries.
  { id: 'ven_secondhand', name: 'Secondhand Sal', groups: ['Guns'], filters: { quality: ['Used'] } },
];

/** Barrett, who is carrying thirty dollars and four dimes. */
function buyer(overrides = {}) {
  const stored = {
    id: 'ent_barrett',
    name: 'Barrett',
    type: 'Gunslinger',
    lists: {
      resources: [
        { name: 'Dollars', value: 30 },
        { name: 'Dimes', value: 4 },
      ],
    },
    ...overrides,
  };
  // The host pushes both readings; for a sheet with nothing thin about
  // it they are the same object's worth of facts.
  return { stored, reading: stored };
}

/**
 * The slice of the table the store's `needs` name — nothing else is in
 * here, because nothing else is in the real one either.
 */
function tableOf({
  own = [],
  entities = [buyer()],
  records = {},
  vendors = VENDORS,
  catalog = CATALOG,
} = {}) {
  return {
    campaign: { slug: 'duo', name: 'The Unlikely Duo', rootId: 'ent_root' },
    declarations: { vendors: { merged: vendors, own } },
    templates: { catalog },
    records: {
      store: { costField: 'cost', consumes: ['service'] },
      growth: { field: 'quality', unstocked: ['Legendary'] },
      currency: {
        symbol: '$',
        denominations: [
          { counter: 'Dollars', value: 100 },
          { counter: 'Dimes', value: 10 },
        ],
      },
      ...records,
    },
    entities,
  };
}

const TABLE = tableOf();
const curly = () => vendorOf(TABLE, 'ven_general');
const byRef = (shelf) => Object.fromEntries(shelf.map((l) => [l.ref, l]));

describe('money, as arithmetic', () => {
  it('reads and writes prices in integer minor units', () => {
    expect(parsePrice('$4.50')).toBe(450);
    expect(parsePrice('$1,200')).toBe(120000);
    expect(parsePrice('$0.05')).toBe(5);
    expect(parsePrice('—')).toBe(null);
    expect(parsePrice(undefined)).toBe(null);
    expect(priceSymbol('$4.50')).toBe('$');
    expect(formatPrice(450)).toBe('$4.50');
    expect(formatPrice(5)).toBe('$0.05');
  });

  it('totals a cart against the shelf and NAMES what it could not price', () => {
    const shelf = [
      { ref: 'a', name: 'A', stats: [], price: '$2.00', qty: null },
      { ref: 'b', name: 'B', stats: [], price: null, qty: null },
    ];
    const out = cartTotal([{ ref: 'a', qty: 3 }, { ref: 'b', qty: 1 }, { ref: 'z', qty: 1 }], shelf);
    expect(out.cents).toBe(600);
    expect(out.symbol).toBe('$');
    // Missing beats forgetting it existed (rule 9's tail).
    expect(out.missing.sort()).toEqual(['b', 'z']);
  });

  it('pays with exact coins when the purse has them, largest first', () => {
    const purse = [
      { name: 'Dollars', value: 100, held: 3 },
      { name: 'Dimes', value: 10, held: 5 },
    ];
    expect(makePayment(purse, 230)).toEqual({
      counts: { Dollars: 1, Dimes: 2 },
      paid: 230,
      change: 0,
    });
  });

  it('overpays with the smallest coin that covers it and takes change back', () => {
    const purse = [
      { name: 'Dollars', value: 100, held: 2 },
      { name: 'Dimes', value: 10, held: 0 },
    ];
    const out = makePayment(purse, 150);
    expect(out).not.toBeNull();
    expect(out.paid).toBe(200);
    expect(out.change).toBe(50);
    // A dollar went across; nothing came back that this purse can hold.
    expect(out.counts.Dollars).toBe(0);
  });

  it('refuses to propose a payment a purse cannot make — that ruling is the DM’s', () => {
    expect(makePayment([{ name: 'Dimes', value: 10, held: 2 }], 500)).toBeNull();
  });
});

describe('the vendor, read defensively', () => {
  it('needs an id and a name, and drops a line with no ref', () => {
    expect(toVendor({ id: 'v', name: 'Shop', lines: [{ ref: 'a' }, { price: '$1' }] })).toEqual({
      id: 'v',
      name: 'Shop',
      lines: [{ ref: 'a' }],
    });
    expect(toVendor({ name: 'Shop' })).toBeUndefined();
    expect(toVendor({ id: 'v' })).toBeUndefined();
    expect(toVendor(null)).toBeUndefined();
  });

  it('eats the old world’s `stock` spelling — a file authored before today still opens', () => {
    expect(
      toVendor({ id: 'v', name: 'S', stock: [{ ref: 'a', price: '$1.50', qty: 11 }] }).lines,
    ).toEqual([{ ref: 'a', price: '$1.50', qty: 11 }]);
  });

  it('keeps a finite count and lets an absent one mean unlimited', () => {
    const v = toVendor({ id: 'v', name: 'S', lines: [{ ref: 'a', qty: 3 }, { ref: 'b' }] });
    expect(v.lines[0].qty).toBe(3);
    expect(v.lines[1].qty).toBeUndefined();
  });

  it('tells an authored shelf from a derived one — absent lines, not empty ones', () => {
    // "He has nothing" is a statement; only a shop that never wrote a
    // list derives its shelf.
    expect(toVendor({ id: 'v', name: 'S', lines: [] }).lines).toEqual([]);
    expect(toVendor({ id: 'v', name: 'S' }).lines).toBeUndefined();
  });

  it('keeps the derived rule — the shelves he carries and the grades he stocks', () => {
    const v = toVendor({
      id: 'v',
      name: 'S',
      groups: ['Rifles', ' ', 'Pistols'],
      filters: { quality: ['Used', 'Basic'], nothing: [] },
    });
    expect(v.groups).toEqual(['Rifles', 'Pistols']);
    expect(v.filters).toEqual({ quality: ['Used', 'Basic'] });
  });
});

describe('who sees whose cart', () => {
  const shop = {
    vendorId: 'ven_general',
    carts: { ent_a: [{ ref: 'x', qty: 1 }], ent_b: [{ ref: 'y', qty: 2 }] },
    offered: { ent_a: true },
  };

  it('shows the DM every cart — ruling on them is the whole job', () => {
    const seen = visibleCarts(shop, { actor: 'dm', role: 'dm' });
    expect(seen.map((c) => c.entityId).sort()).toEqual(['ent_a', 'ent_b']);
    expect(seen.find((c) => c.entityId === 'ent_a').offered).toBe(true);
  });

  it('shows a seat its own and nobody else’s', () => {
    expect(visibleCarts(shop, { actor: 'Barrett', role: 'seat', entityId: 'ent_b' })).toEqual([
      { entityId: 'ent_b', lines: [{ ref: 'y', qty: 2 }], offered: false },
    ]);
  });

  it('shows every other role nothing at all', () => {
    for (const role of ['table', 'board', 'badge', 'art', 'blank', 'none']) {
      expect(visibleCarts(shop, { actor: 'screen', role })).toEqual([]);
    }
    // A seat the DM pointed at nothing is a seat with no cart of its own.
    expect(visibleCarts(shop, { actor: 'screen', role: 'seat' })).toEqual([]);
  });
});

describe('the shelf, resolved through the catalogue', () => {
  it('reads the shop’s price over the book’s, and an absent count as unlimited', () => {
    const shelf = byRef(shelfOf(TABLE, curly(), undefined));
    expect(shelf.wpn_rifle).toMatchObject({ name: 'Used Rifle', price: '$20.00', qty: 3 });
    expect(shelf.amo_rounds.qty).toBe(null);
    // The vendor's own price, over the entry's $0.30.
    expect(shelf.svc_bath.price).toBe('$0.50');
  });

  it('DERIVES a shelf for a shop that wrote no lines — the shelves he keeps, priced things only', () => {
    const shelf = shelfOf(TABLE, vendorOf(TABLE, 'ven_emporium'), undefined);
    const refs = shelf.map((l) => l.ref);
    // In: the two guns he can sell, and the rounds off the other shelf.
    expect(refs).toContain('wpn_rifle');
    expect(refs).toContain('wpn_shiny');
    expect(refs).toContain('amo_rounds');
    // Out: a shelf he doesn't keep, a thing with no price, and the
    // grade the system says nobody simply has in stock.
    expect(refs).not.toContain('svc_bath');
    expect(refs).not.toContain('abl_free');
    expect(refs).not.toContain('wpn_relic');
    // Derived stock is unlimited, and it carries the catalogue's own
    // shelf label so a chip row has something to narrow by.
    expect(shelf.find((l) => l.ref === 'wpn_rifle')).toMatchObject({
      name: 'Used Rifle',
      price: '$20.00',
      qty: null,
      group: 'Guns',
    });
  });

  it('narrows a derived shelf by the grades he carries, and passes anything without that stat', () => {
    const shelf = shelfOf(TABLE, vendorOf(TABLE, 'ven_secondhand'), undefined);
    // Only the Used gun: the Basic one is filtered, the Legendary one is
    // off limits, and the rounds are off a shelf he doesn't keep.
    expect(shelf.map((l) => l.ref)).toEqual(['wpn_rifle']);
  });

  it('keeps a line the catalogue can’t resolve, and says so — never drops it', () => {
    const vendor = toVendor({
      id: 'v',
      name: 'S',
      lines: [{ ref: 'itm_ghost', name: 'A Rumour', price: '$3.00', qty: 2 }],
    });
    expect(shelfOf(TABLE, vendor, undefined)).toEqual([
      {
        ref: 'itm_ghost',
        name: 'A Rumour',
        stats: [],
        price: '$3.00',
        qty: 2,
        missing: true,
      },
    ]);
  });

  it('depletes only what the DM chose to COUNT — the thin instantiation, read back', () => {
    const live = {
      id: 'ent_shop',
      name: "Curly's General Store",
      type: 'vendor',
      lists: { stock: [{ name: 'wpn_rifle', value: 1 }, { name: 'amo_rounds', value: 0 }] },
      refs: { from: { id: 'ven_general', name: "Curly's General Store" } },
    };
    const shelf = byRef(shelfOf(TABLE, curly(), live));
    expect(shelf.wpn_rifle.qty).toBe(1);
    // The uncounted line stays unlimited however loudly the entity
    // claims otherwise: absence is what "unlimited" IS here.
    expect(shelf.amo_rounds.qty).toBe(null);
  });
});

describe('a derived shelf, overridden line by line', () => {
  /** The Emporium, with a hand laid on one or two of his lines. */
  const withOverrides = (overrides) =>
    toVendor({ ...VENDORS[1], overrides });

  it('keeps only the entries that SAY something — a line at its default is no entry', () => {
    const v = toVendor({
      id: 'v',
      name: 'S',
      overrides: [
        { ref: 'a', price: '$9.00' },
        { ref: 'b', qty: 2 },
        { ref: 'c', out: true },
        // Nothing stated, no ref at all, and a count that isn't one.
        { ref: 'd' },
        { price: '$1.00' },
        { ref: 'e', qty: 'lots' },
      ],
    });
    expect(v.overrides).toEqual([
      { ref: 'a', price: '$9.00' },
      { ref: 'b', qty: 2 },
      { ref: 'c', out: true },
    ]);
  });

  it('lets the overridden line’s price win and leaves every other line the book’s', () => {
    const shelf = byRef(shelfOf(TABLE, withOverrides([{ ref: 'wpn_rifle', price: '$29.00' }])));
    expect(shelf.wpn_rifle.price).toBe('$29.00');
    // The twenty-seven nobody touched still come off the catalogue, so a
    // price corrected in the pack still reaches them.
    expect(shelf.wpn_shiny.price).toBe('$25.00');
    expect(shelf.amo_rounds.price).toBe('$0.50');
  });

  it('makes an overridden count COUNTED — derived stock has none until a human says so', () => {
    expect(byRef(shelfOf(TABLE, vendorOf(TABLE, 'ven_emporium'))).wpn_rifle.qty).toBe(null);
    expect(byRef(shelfOf(TABLE, withOverrides([{ ref: 'wpn_rifle', qty: 2 }]))).wpn_rifle.qty).toBe(2);
  });

  it('depletes an overridden count exactly as it depletes a written one', () => {
    const vendor = withOverrides([{ ref: 'wpn_rifle', qty: 2 }]);
    const out = sell(
      TABLE,
      vendor,
      { entityId: 'ent_barrett' },
      { vendorId: 'ven_emporium', carts: { ent_barrett: [{ ref: 'wpn_rifle', qty: 1 }] }, offered: {} },
    );
    // Thin, as ever: the one line that moved off its default.
    expect(out.effects[0].draft.lists.stock).toEqual([{ name: 'wpn_rifle', value: 1 }]);
    // …and read back, the shelf says one left rather than the two the
    // override wrote — stock is the live count (§14).
    const live = {
      id: 'ent_shop',
      name: 'The Emporium',
      type: 'vendor',
      lists: { stock: [{ name: 'wpn_rifle', value: 1 }] },
      refs: { from: { id: 'ven_emporium', name: 'The Emporium' } },
    };
    expect(byRef(shelfOf(TABLE, vendor, live)).wpn_rifle.qty).toBe(1);
    // The line beside it was never counted, so nothing about it moved.
    expect(byRef(shelfOf(TABLE, vendor, live)).wpn_shiny.qty).toBe(null);
  });

  it('takes a line OUT of this shop and nowhere else', () => {
    const vendor = withOverrides([{ ref: 'wpn_shiny', out: true }]);
    expect(shelfOf(TABLE, vendor).map((l) => l.ref)).not.toContain('wpn_shiny');
    // The console still sees it, marked — you can only hand back what
    // you can still find.
    const row = shelfRows(TABLE, vendor).find((l) => l.ref === 'wpn_shiny');
    expect(row).toMatchObject({ name: 'Shiny Rifle', out: true });
    // And the catalogue never heard about any of it.
    expect(shelfOf(TABLE, vendorOf(TABLE, 'ven_emporium')).map((l) => l.ref)).toContain('wpn_shiny');
  });

  it('hands the line back to the book when the override goes', () => {
    const shelf = byRef(shelfOf(TABLE, withOverrides([])));
    expect(shelf.wpn_rifle.price).toBe('$20.00');
    expect(shelf.wpn_rifle.qty).toBe(null);
    expect(Object.keys(shelf)).toContain('wpn_shiny');
  });

  it('leaves a shop that WROTE its lines exactly as it found it', () => {
    expect(shelfOf(TABLE, curly())).toEqual(shelfOf(TABLE, toVendor({ ...VENDORS[0] })));
    // …and still overrides one of them if somebody asks it to, because
    // the law is per line and not per kind of shop.
    const written = toVendor({ ...VENDORS[0], overrides: [{ ref: 'wpn_rifle', price: '$1.00' }] });
    expect(byRef(shelfOf(TABLE, written)).wpn_rifle.price).toBe('$1.00');
  });

  it('never drops an override the derivation stopped proposing — it stands on its own', () => {
    // Sal carries Used guns only; the Shiny one is filtered out from
    // under a price somebody typed for it.
    const vendor = toVendor({ ...VENDORS[2], overrides: [{ ref: 'wpn_shiny', price: '$9.00' }] });
    const line = shelfOf(TABLE, vendor).find((l) => l.ref === 'wpn_shiny');
    expect(line).toMatchObject({ name: 'Shiny Rifle', price: '$9.00', dangling: true });
    // A ref this host has no entry for at all is kept the same way, and
    // says which hole it is.
    const ghost = toVendor({ ...VENDORS[1], overrides: [{ ref: 'itm_ghost', price: '$3.00' }] });
    expect(shelfOf(TABLE, ghost).find((l) => l.ref === 'itm_ghost')).toMatchObject({
      name: 'itm_ghost',
      price: '$3.00',
      missing: true,
      dangling: true,
    });
  });

  it('lets a dangling `out` be inert — the absence it asked for already arrived', () => {
    const vendor = toVendor({ ...VENDORS[2], overrides: [{ ref: 'wpn_shiny', out: true }] });
    expect(shelfRows(TABLE, vendor).map((l) => l.ref)).toEqual(['wpn_rifle']);
  });
});

describe('writing the whole shelf down', () => {
  const emporium = () => vendorOf(TABLE, 'ven_emporium');

  it('writes the shelf as it stands, overrides folded in', () => {
    const vendor = toVendor({
      ...VENDORS[1],
      overrides: [
        { ref: 'wpn_rifle', price: '$29.00', qty: 2 },
        { ref: 'wpn_shiny', out: true },
      ],
    });
    const lines = materialize(TABLE, vendor);
    // Every line the shelf resolves to, and only those: the one taken
    // out is not written down.
    expect(lines.map((l) => l.ref)).toEqual(
      shelfOf(TABLE, vendor).map((l) => l.ref),
    );
    expect(lines).toContainEqual({ ref: 'wpn_rifle', price: '$29.00', qty: 2 });
    // A line nobody touched carries the book's price VERBATIM, which is
    // what makes this a freeze rather than a copy of the same question.
    expect(lines).toContainEqual({ ref: 'amo_rounds', price: '$0.50' });
    expect(lines.map((l) => l.ref)).not.toContain('wpn_shiny');
  });

  it('is a FREEZE, knowingly — the catalogue stops reaching it', () => {
    const written = { ...VENDORS[1], lines: materialize(TABLE, emporium()), overrides: undefined };
    // The pack corrects a price and adds an item.
    const later = tableOf({
      vendors: [written],
      catalog: [
        { ...CATALOG[0], lists: { stats: [{ name: 'Cost', value: '$99.00' }] } },
        ...CATALOG.slice(1),
        { id: 'wpn_new', name: 'A New Gun', group: 'Guns', lists: { stats: [{ name: 'Cost', value: '$7.00' }] } },
      ],
    });
    const shelf = byRef(shelfOf(later, vendorOf(later, 'ven_emporium')));
    expect(shelf.wpn_rifle.price).toBe('$20.00');
    expect(shelf.wpn_new).toBeUndefined();
  });

  it('hands the shelf back to the book when the written list is emptied', () => {
    // The road back is one affordance and no new field: a shop that
    // still knows which shelves it keeps reads an empty list as derived.
    const back = toVendor({ ...VENDORS[1], lines: [] });
    expect(back.lines).toBeUndefined();
    expect(shelfOf(TABLE, back).map((l) => l.ref)).toEqual(
      shelfOf(TABLE, emporium()).map((l) => l.ref),
    );
  });
});

describe('the quote — a proposal, and nothing else', () => {
  const shelf = () => shelfOf(TABLE, curly(), undefined);

  it('proposes a payment out of the purse, and says what is held', () => {
    const out = quote(TABLE, shelf(), 'ent_barrett', [{ ref: 'amo_rounds', qty: 3 }], false);
    // 3 × $0.50 = $1.50, out of 30 dollars and 4 dimes.
    expect(out.total).toBe(150);
    expect(out.held).toBe(3040);
    expect(out.purse).toEqual([
      { name: 'Dollars', value: 100, held: 30 },
      { name: 'Dimes', value: 10, held: 4 },
    ]);
    // No exact change in 30 dollars and 4 dimes: two dollars go across
    // and fifty cents comes back in dimes, which is what a hand does.
    expect(out.payment.paid).toBe(240);
    expect(out.payment.change).toBe(90);
    expect(
      Object.fromEntries(out.payment.counters.map((c) => [c.name, c.value])),
    ).toEqual({ Dollars: 28, Dimes: 9 });
  });

  it('proposes nothing beyond the purse, and does not shut the door', () => {
    // A shopkeeper may extend credit and teller may not decide he can't:
    // the total stands, the proposal is simply absent.
    const out = quote(TABLE, shelf(), 'ent_barrett', [{ ref: 'wpn_rifle', qty: 3 }], false);
    expect(out.total).toBe(6000);
    expect(out.payment).toBeUndefined();
    expect(out.held).toBe(3040);
  });

  it('falls back to ONE counter when the system declares no coins', () => {
    const table = tableOf({
      records: {
        store: { costField: 'cost', consumes: ['service'], counter: 'Dollars' },
        currency: {},
      },
    });
    const out = quote(table, shelfOf(table, vendorOf(table, 'ven_general'), undefined), 'ent_barrett', [
      { ref: 'amo_rounds', qty: 2 },
    ]);
    expect(out.purse).toBeUndefined();
    expect(out.held).toBe(30);
    // Minor units, the same figure every other number here is in — and
    // the DM types over it if their table counts differently (rule 1).
    expect(out.counter).toEqual({ name: 'Dollars', value: 0 });
  });

  it('NAMES the lines it could not price rather than pretending they were free', () => {
    const vendor = toVendor({ id: 'v', name: 'S', lines: [{ ref: 'abl_free' }, { ref: 'amo_rounds' }] });
    const out = quote(TABLE, shelfOf(TABLE, vendor, undefined), 'ent_barrett', [
      { ref: 'abl_free', qty: 1 },
      { ref: 'amo_rounds', qty: 1 },
    ]);
    expect(out.missing).toEqual(['abl_free']);
    expect(out.total).toBe(50);
    // The unpriced line still shows, with its price honestly null.
    expect(out.lines.find((l) => l.ref === 'abl_free')).toMatchObject({
      name: 'Steady Hand',
      price: null,
      each: null,
    });
  });

  it('answers about nobody it was not handed', () => {
    expect(quote(TABLE, shelf(), 'ent_nobody', [{ ref: 'amo_rounds', qty: 1 }])).toBeUndefined();
  });
});

describe('the sale, as a proposal', () => {
  const vendor = () => curly();
  const shopWith = (lines) => ({
    vendorId: 'ven_general',
    carts: { ent_barrett: lines },
    offered: {},
  });

  it('instantiates the WHOLE vendor at the first sale, THIN, and at BIRTH', () => {
    const out = sell(
      TABLE,
      vendor(),
      { entityId: 'ent_barrett', counters: [{ name: 'Dollars', value: 8 }] },
      shopWith([{ ref: 'wpn_rifle', qty: 1 }, { ref: 'amo_rounds', qty: 4 }]),
    );
    const [made, ...rest] = out.effects;
    expect(made).toMatchObject({ effect: 'entity.create', as: 'vendor' });
    expect(made.draft.type).toBe('vendor');
    expect(made.draft.refs.from).toEqual({ id: 'ven_general', name: "Curly's General Store" });
    // THIN: only the COUNTED line moved off its default. The unlimited
    // one is absent, which is what lets the pack add items for free.
    expect(made.draft.lists.stock).toEqual([{ name: 'wpn_rifle', value: 2 }]);
    // ONE write, not two — the shelf comes down at birth, so "the shop
    // went live" is a single undoable step.
    expect(rest.filter((e) => e.effect === 'entity.save')).toHaveLength(1);
    // …and the receipt names the thing that doesn't exist yet, for the
    // host to substitute once it does.
    expect(out.receipt.vendor.entityId).toBe('{{vendor}}');
  });

  it('writes onto the vendor already there at every sale after the first', () => {
    const live = {
      id: 'ent_shop',
      name: "Curly's General Store",
      type: 'vendor',
      lists: { stock: [{ name: 'wpn_rifle', value: 2 }] },
      refs: { from: { id: 'ven_general', name: "Curly's General Store" } },
    };
    const table = tableOf({ entities: [buyer(), { stored: live, reading: live }] });
    const out = sell(
      table,
      vendorOf(table, 'ven_general'),
      { entityId: 'ent_barrett' },
      shopWith([{ ref: 'wpn_rifle', qty: 1 }]),
    );
    expect(out.effects.map((e) => e.effect)).toEqual(['entity.save', 'entity.save', 'log']);
    expect(out.effects[0].entity.id).toBe('ent_shop');
    expect(out.effects[0].entity.lists.stock).toEqual([{ name: 'wpn_rifle', value: 1 }]);
    expect(out.receipt.vendor.entityId).toBe('ent_shop');
  });

  it('writes the money and the goods in ONE save on the buyer', () => {
    const out = sell(
      TABLE,
      vendor(),
      { entityId: 'ent_barrett', counters: [{ name: 'Dollars', value: 28 }, { name: 'Dimes', value: 9 }] },
      shopWith([{ ref: 'amo_rounds', qty: 2 }]),
    );
    const saves = out.effects.filter((e) => e.effect === 'entity.save');
    expect(saves).toHaveLength(1);
    const buyerSave = saves[0].entity;
    expect(buyerSave.lists.resources).toEqual([
      { name: 'Dollars', value: 28 },
      { name: 'Dimes', value: 9 },
    ]);
    // THIN (§14/§K): a ref to the template and nothing else, so a
    // correction in the book reaches it forever.
    expect(buyerSave.children).toHaveLength(2);
    expect(buyerSave.children[0].lists).toEqual({});
    expect(buyerSave.children[0].refs.from).toEqual({ id: 'amo_rounds', name: 'Plain Rounds' });
    expect(out.receipt.carried).toHaveLength(2);
  });

  it('names a counter it cannot find rather than inventing a list for it', () => {
    const out = sell(
      TABLE,
      vendor(),
      { entityId: 'ent_barrett', counters: [{ name: 'Doubloons', value: 3 }] },
      shopWith([{ ref: 'amo_rounds', qty: 1 }]),
    );
    expect(out.receipt.refused[0]).toContain('Doubloons');
    const buyerSave = out.effects.find((e) => e.effect === 'entity.save').entity;
    expect(Object.keys(buyerSave.lists)).toEqual(['resources']);
  });

  it('sells what the system CONSUMES and hands nothing over — nobody carries a bath home', () => {
    const out = sell(
      TABLE,
      vendor(),
      { entityId: 'ent_barrett' },
      shopWith([{ ref: 'svc_bath', qty: 1 }, { ref: 'amo_rounds', qty: 1 }]),
    );
    // Bought — it is on the receipt and it was paid for…
    expect(out.receipt.lines.map((l) => l.ref)).toEqual(['svc_bath', 'amo_rounds']);
    expect(out.receipt.total).toBe(100);
    // …and carried away it is not.
    expect(out.receipt.carried.map((c) => c.name)).toEqual(['Plain Rounds']);
  });

  it('REFUSES a line this host can’t resolve, out loud — a half-empty sale is worse', () => {
    const ghost = toVendor({ id: 'ven_general', name: "Curly's General Store", lines: [{ ref: 'itm_ghost' }] });
    const out = sell(
      TABLE,
      ghost,
      { entityId: 'ent_barrett' },
      shopWith([{ ref: 'itm_ghost', qty: 1 }]),
    );
    expect(out.receipt.refused[0]).toContain('itm_ghost');
    expect(out.receipt.carried).toEqual([]);
    // Refused, not silent: the log carries it too.
    expect(out.effects.at(-1).payload.refused[0]).toContain('itm_ghost');
  });

  it('takes the total the DM confirmed, not the one it proposed (rule 1)', () => {
    // The Warden haggled Curly down to nothing.
    const out = sell(
      TABLE,
      vendor(),
      { entityId: 'ent_barrett', total: 0 },
      shopWith([{ ref: 'amo_rounds', qty: 2 }]),
    );
    expect(out.receipt.total).toBe(0);
    expect(out.effects.at(-1).payload.total).toBe(0);
  });

  it('ends in a `log` effect whose payload IS the receipt', () => {
    const out = sell(
      TABLE,
      vendor(),
      { entityId: 'ent_barrett' },
      shopWith([{ ref: 'amo_rounds', qty: 2 }]),
    );
    const receipt = out.effects.at(-1);
    expect(receipt).toMatchObject({ effect: 'log', kind: 'shop.sold', entityId: 'ent_barrett' });
    expect(receipt.payload).toMatchObject({
      vendorId: 'ven_general',
      vendorName: "Curly's General Store",
      buyerId: 'ent_barrett',
      buyerName: 'Barrett',
      total: out.receipt.total,
      lines: out.receipt.lines,
    });
  });

  it('refuses an empty cart and a buyer nobody has, and proposes nothing at all', () => {
    expect(sell(TABLE, vendor(), { entityId: 'ent_barrett' }, shopWith([])).error).toContain('empty');
    expect(sell(TABLE, vendor(), { entityId: 'ent_nobody' }, shopWith([{ ref: 'amo_rounds', qty: 1 }])).error)
      .toContain('ent_nobody');
    expect(sell(TABLE, vendor(), { entityId: 'ent_barrett' }, shopWith([])).effects).toBeUndefined();
  });

  it('never depletes a DERIVED shop — nothing there was ever counted', () => {
    const out = sell(
      TABLE,
      vendorOf(TABLE, 'ven_emporium'),
      { entityId: 'ent_barrett' },
      { vendorId: 'ven_emporium', carts: { ent_barrett: [{ ref: 'wpn_rifle', qty: 1 }] }, offered: {} },
    );
    const made = out.effects[0];
    expect(made.effect).toBe('entity.create');
    // Live, and as empty as the day it went live.
    expect(made.draft.lists).toEqual({});
  });
});
