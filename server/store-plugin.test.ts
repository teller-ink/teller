// THE BRIDGE, with the store as its customer (docs/CORE-NEXT.md §15).
//
// This was `server/store-flow.test.ts`'s 'the doors' describe, and it is
// deliberately still shaped like one: a real host, a real campaign, a
// real server on a real port, and every assertion made through HTTP the
// way a screen makes it. What changed is what it is a test OF. The
// counter's arithmetic moved out to `examples/plugins/store/
// store.test.mjs`, where a snapshot is an object literal; what's left
// here is everything that only exists because the store is now a
// PLUGIN — the install, the enable gate, the snapshot the manifest's
// `needs` bought it, the effects the host ran on its behalf, and the
// day somebody switches it off.
//
// The laws, unchanged by the move:
//
//   * browsing instantiates NOTHING — the vendor entity does not exist
//     until money changes hands;
//   * the first sale instantiates the WHOLE vendor, once, as one event
//     — and now literally one, because the shelf comes down at birth;
//   * and it instantiates THIN — only lines the DM chose to COUNT ever
//     appear in the stored stock;
//   * a seat writes its own cart and nobody else's;
//   * every figure that moved came from the console, and every write is
//     one `/undo` can step back.
//
// And the laws the TIER owes, which nothing owed before:
//
//   * a plugin's panes are listed where a surface can use them, and its
//     compiled bytes are served only while it is running;
//   * SWITCH IT OFF AND IT IS GONE — no panes, no doors, no code, no
//     crash. That is the degradation contract and it is the reason the
//     tier is allowed to exist at all;
//   * an effect outside the manifest's `needs` is refused, out loud,
//     with NOTHING written;
//   * and a plugin's memory of a table dies with the table.

import { cpSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enablePlugin, loadPlugins } from '../core/plugins.ts';
import { createCampaign, openShelf } from '../core/store.ts';
import type { Entity } from '../core/entity.ts';
import { serve } from './index.ts';
import { Host, Session } from './session.ts';
import { pluginState } from './plugin-bridge.ts';
import { peekUndo, undo } from './undo.ts';

const KEY = 'test-key-0123456789abcdef';

/** Where the store's source lives in this checkout — the folder a person copies onto their shelf. */
const STORE_SRC = join(dirname(new URL(import.meta.url).pathname), '..', 'examples', 'plugins', 'store');
/** Identity is the id, never the folder name — so read it out of the manifest. */
const STORE = (
  JSON.parse(readFileSync(join(STORE_SRC, 'plugin.json'), 'utf8')) as { id: string }
).id;

/** A tiny, complete world: two coins, three things for sale, one buyer. */
const SYSTEM = {
  id: 'sys_test',
  name: 'Testable',
  version: 1,
  data: {
    store: { costField: 'cost', consumes: ['service'] },
    growth: { field: 'quality', unstocked: ['Legendary'] },
    currency: {
      symbol: '$',
      denominations: [
        { counter: 'Dollars', value: 100 },
        { counter: 'Dimes', value: 10 },
      ],
    },
    catalog: [
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
        lists: {
          stats: [{ name: 'Cost', value: '$500.00' }, { name: 'Quality', value: 'Legendary' }],
        },
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
        // The old world's spelling, still arriving from the converter:
        // counters authored beside the lists rather than in them.
        counters: [{ name: 'Rounds', current: 3, max: null }],
        lists: { stats: [{ name: 'Cost', value: '$0.50' }] },
      },
      {
        id: 'svc_bath',
        name: 'A Hot Bath',
        type: 'service',
        group: 'Services',
        lists: { stats: [{ name: 'Cost', value: '$0.30' }] },
      },
    ],
    vendors: [
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
      {
        id: 'ven_secondhand',
        name: 'Secondhand Sal',
        groups: ['Guns'],
        filters: { quality: ['Used'] },
      },
    ],
  },
};

/**
 * A plugin that asks for one thing and does another: it declared
 * `read:entities` and nothing else, and its one door proposes an
 * `entity.remove`. Written here rather than by breaking the store's own
 * manifest, because the store's manifest is the honest example and this
 * is the dishonest one.
 */
const OVERREACH = 'plg_overreach01';

let dir: string;
let session: Session;
let host: Host;
let server: Server;
let base: string;
let barrett: string;

async function call(
  method: string,
  path: string,
  opts: { key?: boolean; display?: string; body?: unknown } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.key) headers['x-teller-key'] = KEY;
  if (opts.display) headers['x-teller-display'] = opts.display;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** A screen the DM adopted and pointed at a role. */
async function screen(role: string, params?: Record<string, unknown>): Promise<string> {
  const hello = await call('POST', '/api/displays/hello', { body: {} });
  await call('POST', '/api/displays/claim', {
    key: true,
    body: { code: hello.body.display.code },
  });
  await call('PATCH', `/api/displays/${hello.body.display.id}`, {
    key: true,
    body: { role, ...(params ? { params } : {}) },
  });
  return hello.body.display.id;
}

const door = (name: string) => `/api/plugin/${STORE}/${name}`;

const open = (vendorId = 'ven_general') =>
  call('POST', door('shop'), { key: true, body: { vendorId } });

/**
 * The live vendor, if this shop has ever transacted — found by its
 * stamp, the same way the plugin finds it in its own snapshot.
 */
function vendorEntity(vendorId: string): Entity | undefined {
  return session.campaign
    .children(session.loaded.manifest.id)
    .find((e) => e.type === 'vendor' && (e.refs?.from as { id?: string } | undefined)?.id === vendorId);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-store-plugin-'));
  const shelf = openShelf(dir);
  shelf.putSystem(SYSTEM);

  // §15's install path, whole: the plugin is a FOLDER on the shelf, and
  // a human enabled it. Nothing here is a special case for the store —
  // this is copying a folder in and ticking a box.
  cpSync(STORE_SRC, join(dir, 'plugins', 'store'), { recursive: true, preserveTimestamps: true });
  enablePlugin(dir, shelf, STORE, true);

  const over = join(dir, 'plugins', 'overreach');
  mkdirSync(over, { recursive: true });
  writeFileSync(
    join(over, 'plugin.json'),
    JSON.stringify({
      id: OVERREACH,
      name: 'Overreach',
      version: 1,
      provides: [{ point: 'door.grab', role: 'dm' }],
      needs: ['read:entities — to see what it has no business removing'],
    }),
  );
  writeFileSync(
    join(over, 'host.mjs'),
    `export const provides = {
      'door.grab': (req) => ({
        body: { took: req.body.id },
        effects: [{ effect: 'entity.remove', id: req.body.id }],
      }),
    };`,
  );
  enablePlugin(dir, shelf, OVERREACH, true);

  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  campaign.save(
    { ...campaign.root(), refs: { system: { id: 'sys_test', name: 'Testable' } } },
    'test',
  );
  session = new Session(shelf, campaign, dir);
  barrett = session.create(
    {
      name: 'Barrett',
      type: 'Gunslinger',
      lists: {
        resources: [
          { name: 'Dollars', value: 30 },
          { name: 'Dimes', value: 4 },
        ],
      },
    } as never,
    'console',
  ).id;

  host = Host.around(session);
  const plugins = await loadPlugins(dir, shelf);
  expect(plugins.problems).toEqual([]);
  host.setPlugins(plugins.loaded, plugins.problems);

  server = serve(host, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  (host.session ?? session).close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the doors', () => {
  // -- the shelf ------------------------------------------------------

  it('lists the merged vendors and says which are the campaign’s own', async () => {
    const listed = await call('GET', door('vendors'), { key: true });
    expect(listed.body).toHaveLength(3);
    expect(listed.body[0]).toMatchObject({ id: 'ven_general', own: false });

    // Writing one goes through the plugin's own door, as a proposed
    // `template.save` the host executes — and the minted id comes back
    // in the answer, substituted (`Effect.as`).
    const made = await call('POST', door('vendors'), {
      key: true,
      body: { template: { name: 'The Saloon', lines: [{ ref: 'svc_bath' }] } },
    });
    expect(made.status).toBe(200);
    expect(made.body.id).toMatch(/^tpl_/);

    const after = await call('GET', door('vendors'), { key: true });
    expect(after.body).toHaveLength(4);
    expect(after.body.find((v: { name: string }) => v.name === 'The Saloon').own).toBe(true);
  });

  it('resolves the shelf through the catalogue the manifest asked for', async () => {
    // The snapshot is the whole point: `read:templates/catalog` bought
    // the names and the prices, `read:declarations/vendors` bought the
    // shop, and the plugin queried for neither.
    const shop = (await open()).body;
    expect(shop.vendor).toMatchObject({ name: "Curly's General Store", live: false });
    const byRef = Object.fromEntries(shop.shelf.map((l: { ref: string }) => [l.ref, l]));
    expect(byRef.wpn_rifle).toMatchObject({ name: 'Used Rifle', price: '$20.00', qty: 3 });
    // Absent qty is unlimited on purpose.
    expect(byRef.amo_rounds.qty).toBe(null);
    // The vendor's own price, over the entry's $0.30.
    expect(byRef.svc_bath.price).toBe('$0.50');
  });

  it('BROWSING INSTANTIATES NOTHING — no vendor entity until money moves', async () => {
    await open('ven_emporium');
    await call('GET', door('shop'), { key: true });
    await open();
    await call('GET', door('shop'), { key: true });
    expect(vendorEntity('ven_general')).toBeUndefined();
    expect(vendorEntity('ven_emporium')).toBeUndefined();
    expect(session.campaign.children(session.loaded.manifest.id)).toHaveLength(1);
  });

  it('closes, and both open and close land in the log as table history', async () => {
    await open();
    expect((await call('POST', door('shop'), { key: true, body: {} })).body).toBe(null);
    expect((await call('GET', door('shop'), { key: true })).body).toBe(null);
    const kinds = session.campaign.events({ limit: 20 }).map((e) => e.kind);
    expect(kinds).toContain('shop.opened');
    expect(kinds).toContain('shop.closed');
    // And the log says a PLUGIN moved, not that 'dm' mysteriously did.
    expect(session.campaign.events({ limit: 20 }).find((e) => e.kind === 'shop.opened')!.actor).toBe(
      `plugin:${STORE}`,
    );
  });

  it('refuses a vendor nobody declared', async () => {
    expect((await open('ven_ghost')).status).toBe(404);
  });

  it('never instantiates a derived shop’s stock — nothing was counted', async () => {
    await open('ven_emporium');
    await call('POST', door('sell'), {
      key: true,
      body: { sale: { entityId: barrett, lines: [{ ref: 'wpn_rifle', qty: 1 }] } },
    });
    expect(vendorEntity('ven_emporium')!.lists.stock).toBeUndefined();
  });

  // -- carts ----------------------------------------------------------

  it('lets a seat write its own cart and refuses it somebody else’s', async () => {
    await open();
    const hattie = session.create({ name: 'Hattie', lists: {} } as never, 'console').id;
    const seat = await screen('seat', { entityId: barrett });

    const mine = await call('PUT', `${door('cart')}/${barrett}`, {
      display: seat,
      body: { lines: [{ ref: 'amo_rounds', qty: 2 }], offered: true },
    });
    expect(mine.status).toBe(200);
    expect(mine.body.carts).toHaveLength(1);
    expect(mine.body.carts[0]).toMatchObject({ entityId: barrett, total: 100, offered: true });

    // The store's own law, decided against the `who` facts the host
    // handed in — never against a secret the plugin holds (rule 7).
    expect(
      (await call('PUT', `${door('cart')}/${hattie}`, { display: seat, body: { lines: [] } }))
        .status,
    ).toBe(401);
  });

  it('proposes a payment out of the purse, and says what is held when it cannot', async () => {
    await open();
    await call('PUT', `${door('cart')}/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'amo_rounds', qty: 3 }] },
    });
    const cart = (await call('GET', door('shop'), { key: true })).body.carts[0];
    // 3 × $0.50 = $1.50, out of 30 dollars and 4 dimes.
    expect(cart.total).toBe(150);
    expect(cart.held).toBe(3040);
    expect(cart.payment.paid).toBe(240);
    expect(cart.payment.change).toBe(90);

    // Beyond the purse: no proposal, but the door is not shut — a
    // shopkeeper may extend credit and teller may not decide he can't.
    await call('PUT', `${door('cart')}/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'wpn_rifle', qty: 3 }] },
    });
    const big = (await call('GET', door('shop'), { key: true })).body.carts[0];
    expect(big.total).toBe(6000);
    expect(big.payment).toBeUndefined();
  });

  it('shows the whole counter to the DM and one cart to a seat', async () => {
    await open();
    const hattie = session.create({ name: 'Hattie', lists: {} } as never, 'console').id;
    const seat = await screen('seat', { entityId: barrett });
    const table = await screen('table');
    for (const id of [barrett, hattie]) {
      await call('PUT', `${door('cart')}/${id}`, {
        key: true,
        body: { lines: [{ ref: 'amo_rounds', qty: 1 }] },
      });
    }
    expect((await call('GET', door('shop'), { key: true })).body.carts).toHaveLength(2);
    expect((await call('GET', door('shop'), { display: seat })).body.carts).toHaveLength(1);
    // Player-facing glass reads the `/public` snapshot, and only that:
    // the door is `role: 'prep'` and a passive screen never gets in.
    expect((await call('GET', door('shop'), { display: table })).status).toBe(401);
  });

  // -- the sale -------------------------------------------------------

  it('instantiates the WHOLE vendor at the first sale, and instantiates it THIN', async () => {
    await open();
    await call('PUT', `${door('cart')}/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'wpn_rifle', qty: 1 }, { ref: 'amo_rounds', qty: 4 }] },
    });
    const sold = await call('POST', door('sell'), {
      key: true,
      body: { sale: { entityId: barrett, counters: [{ name: 'Dollars', value: 8 }] } },
    });
    expect(sold.status).toBe(200);
    // The receipt names the entity that didn't exist when it was
    // written — `{{vendor}}`, substituted by the bridge on the way out.
    expect(sold.body.vendor.entityId).toMatch(/^ent_/);

    const live = vendorEntity('ven_general')!;
    expect(live).toBeDefined();
    expect(live.id).toBe(sold.body.vendor.entityId);
    expect(live.refs!.from).toEqual({ id: 'ven_general', name: "Curly's General Store" });
    // THIN: only the COUNTED line moved off its default. The unlimited
    // one is absent, which is what lets the pack add items for free.
    expect(live.lists.stock).toEqual([{ name: 'wpn_rifle', value: 2 }]);

    const shelf = (await call('GET', door('shop'), { key: true })).body;
    expect(shelf.vendor.live).toBe(true);
    expect(shelf.shelf.find((l: { ref: string }) => l.ref === 'wpn_rifle').qty).toBe(2);
    // The cart is cleared by the sale, not by the seat.
    expect(shelf.carts).toHaveLength(0);
  });

  it('takes the payment the DM confirmed, not the one it proposed (rule 1)', async () => {
    await open();
    await call('PUT', `${door('cart')}/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'amo_rounds', qty: 2 }] },
    });
    // The Warden haggled Curly down to nothing and typed a 30 back in.
    await call('POST', door('sell'), {
      key: true,
      body: { sale: { entityId: barrett, total: 0, counters: [{ name: 'Dollars', value: 30 }] } },
    });
    const buyer = session.campaign.get(barrett)!;
    expect(buyer.lists.resources.find((e) => e.name === 'Dollars')!.value).toBe(30);
    const receipt = session.campaign.events({ limit: 20 }).find((e) => e.kind === 'shop.sold')!;
    expect((receipt.payload as { total: number }).total).toBe(0);
  });

  it('hands over a thin child per unit, and consumes what the system says is consumed', async () => {
    await open();
    await call('PUT', `${door('cart')}/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'amo_rounds', qty: 2 }, { ref: 'svc_bath', qty: 1 }] },
    });
    const sold = await call('POST', door('sell'), {
      key: true,
      body: { sale: { entityId: barrett } },
    });
    expect(sold.body.carried).toHaveLength(2);

    const buyer = session.campaign.get(barrett)!;
    expect(buyer.children).toHaveLength(2);
    // Nobody carries a bath home — `store.consumes` said so.
    expect(buyer.children!.every((c) => c.name === 'Plain Rounds')).toBe(true);
    // THIN (§14/§K): a ref to the template and nothing else, so a
    // correction in the book reaches it forever.
    expect(buyer.children![0].lists).toEqual({});
    expect(buyer.children![0].refs!.from).toEqual({ id: 'amo_rounds', name: 'Plain Rounds' });
    // …and the reading fills the stats in from the catalogue.
    const read = session.reading(buyer);
    expect(read.children![0].lists.stats).toEqual([{ name: 'Cost', value: '$0.50' }]);
    // …counter and all. A box of rounds that arrives with nothing to
    // count is a box of rounds nobody can spend.
    expect(read.children![0].lists.counters).toEqual([{ name: 'Rounds', value: 3 }]);
  });

  it('refuses an empty cart, an unopened shop, and everyone but the DM', async () => {
    const seat = await screen('seat', { entityId: barrett });
    expect(
      (await call('POST', door('sell'), { key: true, body: { sale: { entityId: barrett } } }))
        .status,
    ).toBe(409);
    await open();
    expect(
      (await call('POST', door('sell'), { key: true, body: { sale: { entityId: barrett } } }))
        .status,
    ).toBe(400);
    // `role: 'dm'` in the manifest, enforced by the SERVER before the
    // plugin sees a byte.
    expect(
      (
        await call('POST', door('sell'), {
          display: seat,
          body: { sale: { entityId: barrett, lines: [{ ref: 'amo_rounds', qty: 1 }] } },
        })
      ).status,
    ).toBe(401);
  });

  it('names a counter it cannot find rather than inventing a list for it', async () => {
    await open();
    const sold = await call('POST', door('sell'), {
      key: true,
      body: {
        sale: {
          entityId: barrett,
          lines: [{ ref: 'amo_rounds', qty: 1 }],
          counters: [{ name: 'Doubloons', value: 3 }],
        },
      },
    });
    expect(sold.body.refused[0]).toContain('Doubloons');
    expect(Object.keys(session.campaign.get(barrett)!.lists)).toEqual(['resources']);
  });

  // -- and back again -------------------------------------------------

  it('is undoable, piece by piece, through the ordinary walk', async () => {
    await open();
    await call('PUT', `${door('cart')}/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'wpn_rifle', qty: 1 }] },
    });
    await call('POST', door('sell'), {
      key: true,
      body: { sale: { entityId: barrett, counters: [{ name: 'Dollars', value: 10 }] } },
    });

    // 1 — the buyer's write: money back, rifle gone. ONE step, because
    // the purchase is one write on the buyer (the old world's own
    // invariant, and it was right).
    expect(peekUndo(session)!.entityId).toBe(barrett);
    undo(session, 'test');
    const buyer = session.campaign.get(barrett)!;
    expect(buyer.children ?? []).toHaveLength(0);
    expect(buyer.lists.resources.find((e) => e.name === 'Dollars')!.value).toBe(30);

    // 2 — and the shop was never live. The shelf and the birth are ONE
    // step now, not two: the vendor is created carrying its depleted
    // counts, so a first sale is one write and undoing it removes the
    // whole shop rather than un-selling a rifle it still owns.
    undo(session, 'test');
    expect(vendorEntity('ven_general')).toBeUndefined();
  });

  it('keeps a live vendor out of the roster the room reads', async () => {
    await open();
    await call('POST', door('sell'), {
      key: true,
      body: { sale: { entityId: barrett, lines: [{ ref: 'amo_rounds', qty: 1 }] } },
    });
    // FURNITURE, not somebody at the table (`server/public.ts`) — and
    // teller's own word for it, which the plugin merely writes.
    const roster = (await call('GET', '/api/public', { key: true })).body.roster;
    expect(roster.map((e: { name: string }) => e.name)).toEqual(['Barrett']);
  });
});

// ---------------------------------------------------------------------
// What the TIER owes, which nothing owed before the store left the repo.

describe('the tier itself', () => {
  it('lists a plugin’s panes where a surface can use them, and serves their bytes', async () => {
    const listed = await call('GET', '/api/panes', { key: true });
    expect(listed.status).toBe(200);
    const byName = Object.fromEntries(listed.body.map((p: { name: string }) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(['Shop', 'store']);
    expect(byName.store).toMatchObject({ plugin: STORE, subject: 'none', label: 'Store' });
    // A seat's tab exists only while a shop is open, and the pane says
    // which door answers that question.
    expect(byName.Shop).toMatchObject({ subject: 'entity', when: 'shop' });

    for (const pane of Object.values(byName) as { code: { takeover: string } }[]) {
      expect(pane.code.takeover).toMatch(new RegExp(`^/plugin-code/${STORE}/panes/`));
      const res = await fetch(`${base}${pane.code.takeover}`);
      expect(res.status).toBe(200);
      expect((await res.text()).length).toBeGreaterThan(0);
    }
  });

  // THE DEGRADATION CONTRACT, and the reason the tier is allowed to
  // exist: a plugin is a thing you can switch off, and switching it off
  // takes the whole of it away without taking anything else with it.
  it('gives ALL of it back when a human switches it off — and nothing crashes', async () => {
    const pane = (await call('GET', '/api/panes', { key: true })).body[0].code.takeover;
    await open();
    expect((await call('GET', door('shop'), { key: true })).body).not.toBe(null);

    const off = await call('POST', `/api/plugins/${STORE}`, { key: true, body: { enabled: false } });
    expect(off.status).toBe(200);
    expect(off.body.running).toEqual([OVERREACH]);

    // No panes: every surface reading this list is simply shorter.
    expect((await call('GET', '/api/panes', { key: true })).body).toEqual([]);
    // No doors — by the ordinary path, because a plugin nobody enabled
    // isn't in `session.plugins` at all.
    for (const [method, path, body] of [
      ['GET', door('shop'), undefined],
      ['POST', door('shop'), { vendorId: 'ven_general' }],
      ['PUT', `${door('cart')}/${barrett}`, { lines: [] }],
      ['POST', door('sell'), { sale: { entityId: barrett } }],
      ['GET', door('vendors'), undefined],
    ] as [string, string, unknown][]) {
      expect((await call(method, path, { key: true, body })).status).toBe(404);
    }
    // No bytes.
    expect((await fetch(`${base}${pane}`)).status).toBe(404);
    // And the table plays on: everything that was never the store's is
    // exactly where it was.
    const still = await call('GET', '/api/public', { key: true });
    expect(still.status).toBe(200);
    expect(still.body.roster.map((e: { name: string }) => e.name)).toEqual(['Barrett']);

    // …and it all comes back, live, with no restart.
    await call('POST', `/api/plugins/${STORE}`, { key: true, body: { enabled: true } });
    expect((await call('GET', '/api/panes', { key: true })).body).toHaveLength(2);
    expect((await open()).status).toBe(200);
  });

  it('refuses an effect the manifest never declared, out loud, with nothing written', async () => {
    const grabbed = await call('POST', `/api/plugin/${OVERREACH}/grab`, {
      key: true,
      body: { id: barrett },
    });
    expect(grabbed.status).toBe(403);
    expect(grabbed.body.error).toContain('Overreach');
    expect(grabbed.body.error).toContain('entity.remove');
    expect(grabbed.body.error).toContain('write:entities');
    // NOTHING ran: the whole list is checked before any of it.
    expect(session.campaign.get(barrett)).toBeDefined();
    expect(session.campaign.events({ limit: 50 }).some((e) => e.actor === `plugin:${OVERREACH}`))
      .toBe(false);
  });

  it('holds a plugin’s memory of a table against the table, and drops it with it', async () => {
    await open();
    await call('PUT', `${door('cart')}/${barrett}`, {
      key: true,
      body: { lines: [{ ref: 'amo_rounds', qty: 1 }] },
    });
    expect(pluginState(session, STORE)).toMatchObject({ vendorId: 'ven_general' });

    // A campaign switch builds a new Session, and the WeakMap the
    // bridge keys by it means nobody had to remember to clear a cart.
    session = host.start('Another Table');
    expect(pluginState(session, STORE)).toBeUndefined();
    expect((await call('GET', door('shop'), { key: true })).body).toBe(null);
  });
});
