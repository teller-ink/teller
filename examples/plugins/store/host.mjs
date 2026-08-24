// THE STORE'S DOORS — plugin №2's host half (docs/CORE-NEXT.md §15).
//
// Four doors, and they split exactly the way the law in `store.mjs`
// splits. Opening a vendor and moving a cart touch NOTHING durable —
// browsing must never instantiate (§14) — so those two answer out of
// the plugin's own per-table memory and propose no effects at all.
// Selling is the transaction, is DM-only, and is the one door here that
// asks for anything to change. Authoring a shop is prep, and writes a
// declaration.
//
// WHO MAY KNOCK is declared in `plugin.json` and enforced by the HOST
// before any of this runs (`role: 'prep' | 'dm'`), which is why nothing
// below re-checks the key: a door handler that could decide it was
// talking to the DM would be re-deriving authority from something it
// holds, and it holds nothing (rule 7). What it does decide is the one
// thing that is genuinely the store's law rather than teller's —
// **whose cart is whose** — and it decides it against the `who` facts
// the host handed in.
//
// The shape of every handler is the point of the tier: a request comes
// in as data, an answer goes out as data, and anything that must CHANGE
// goes out as a proposed effect the host executes through its own
// session doors. This module never sees a session, never holds an
// entity it didn't receive, and could run in another process tomorrow
// without one line of it changing.

import {
  formatPrice,
  noShop,
  openShop,
  ownVendors,
  sell,
  setCart,
  shopView,
  toVendor,
  vendorOf,
  vendorsOf,
} from './store.mjs';

/** The shop this table has open, out of the plugin's own memory. */
function shopIn(state) {
  return state && typeof state === 'object' && state.vendorId ? state : undefined;
}

const answer = (body, extra = {}) => ({ body, ...extra });
const refuse = (status, error) => ({ status, body: { error } });

export const provides = {
  // ---- the counter: what's open, and whose carts are on it -----------
  //
  // ONE payload to everybody who may read it, filtered by the asking
  // screen's own assignment — the DM's answer carries the whole
  // counter, a seat's carries its own row, and there is no way to
  // phrase the question about somebody else's.
  //
  // This is also the door the seat's `pane.shop` names in `when`: a
  // null answer means no shop is open, which means no tab. One door,
  // two jobs, and the second one falls out of the first being honest.
  'door.shop': (req) => {
    const shop = shopIn(req.state);

    if (req.method === 'GET') {
      if (!shop) return answer(null);
      return answer(shopView(req.table, shop, req.who) ?? null);
    }

    if (req.method === 'POST') {
      if (req.who.role !== 'dm') return refuse(401, 'only the DM opens a shop');
      const id = typeof req.body.vendorId === 'string' ? req.body.vendorId.trim() : '';
      if (!id) {
        // Closing. Logged even though it stored nothing: "the shop shut"
        // is table history worth reading back, and the log is the only
        // history there is (rule 3).
        if (!shop) return answer(null, { state: noShop(), changed: ['shop'] });
        const vendor = vendorOf(req.table, shop.vendorId);
        return answer(null, {
          state: noShop(),
          changed: ['shop'],
          effects: [
            {
              effect: 'log',
              kind: 'shop.closed',
              payload: { vendorId: shop.vendorId, ...(vendor ? { vendorName: vendor.name } : {}) },
            },
          ],
        });
      }
      const vendor = vendorOf(req.table, id);
      if (!vendor) return refuse(404, `no vendor ${id}`);
      const opened = openShop(id);
      return answer(shopView(req.table, opened, req.who) ?? null, {
        state: opened,
        changed: ['shop'],
        effects: [
          {
            effect: 'log',
            kind: 'shop.opened',
            payload: { vendorId: vendor.id, vendorName: vendor.name },
          },
        ],
      });
    }

    return refuse(405, `the shop door doesn't take ${req.method}`);
  },

  // ---- one cart, replaced whole --------------------------------------
  //
  // `PUT /api/plugin/<id>/cart/<entityId>`. The DM may put anything on
  // anyone's counter (handing a cart back is the DM's own move); a seat
  // may touch its own and nothing else. That second half is the store's
  // own law and the host cannot make it for us — it knows the seat's
  // entity, but not that this path segment is meant to BE it.
  'door.cart': (req) => {
    const entityId = req.path[0];
    if (!entityId) return refuse(400, 'which cart?');
    if (req.who.role !== 'dm' && req.who.entityId !== entityId) {
      return refuse(401, 'that is somebody else’s cart');
    }
    const shop = shopIn(req.state);
    if (!shop) return refuse(409, 'no shop is open');

    const lines = [];
    for (const raw of Array.isArray(req.body.lines) ? req.body.lines : []) {
      const line = raw && typeof raw === 'object' ? raw : {};
      const ref = String(line.ref ?? '').trim();
      const qty = Math.floor(Number(line.qty ?? 0));
      if (ref && qty > 0) lines.push({ ref, qty: Math.min(qty, 99) });
    }
    const next = setCart(
      shop,
      entityId,
      lines,
      typeof req.body.offered === 'boolean' ? req.body.offered : undefined,
    );
    return answer(shopView(req.table, next, req.who) ?? null, {
      state: next,
      changed: ['shop'],
    });
  },

  // ---- the sale ------------------------------------------------------
  //
  // Every figure of it came off the console, where a human could type
  // over it first (rule 1). What comes back is a receipt plus the
  // effects that make it true, and the host runs them as
  // `plugin:<plg_id>` so the log says who moved the money.
  'door.sell': (req) => {
    const shop = shopIn(req.state);
    if (!shop) return refuse(409, 'no shop is open');
    const vendor = vendorOf(req.table, shop.vendorId);
    if (!vendor) return refuse(404, `no vendor ${shop.vendorId}`);

    const sale = req.body.sale && typeof req.body.sale === 'object' ? req.body.sale : {};
    const out = sell(req.table, vendor, sale, shop);
    if (out.error) return refuse(400, out.error);

    // The cart comes off the counter here rather than in `sell`: what
    // was bought is durable and what was gathered is not, and this is
    // the seam between them.
    return answer(out.receipt, {
      state: setCart(shop, sale.entityId, []),
      effects: out.effects,
      changed: ['entities', 'shop'],
    });
  },

  // ---- the shops, as written -----------------------------------------
  //
  // Prep. Reading says which layer each shop came from, so the console
  // can offer "edit" only on the campaign's own; writing goes through
  // the ordinary declaration slot, as a proposed effect like everything
  // else.
  //
  // The campaign's own rows go out RAW underneath the normalised
  // reading, so whatever else was authored on them — an old world's
  // key, something this build has never heard of — survives the
  // console's edit-and-save round trip instead of being quietly deleted
  // by a form that only knew about four fields.
  'door.vendors': (req) => {
    if (req.method === 'GET') {
      const own = new Map(
        ownVendors(req.table).map((t) => [String(t?.id ?? ''), t]),
      );
      return answer(
        vendorsOf(req.table).map((v) => ({ ...(own.get(v.id) ?? {}), ...v, own: own.has(v.id) })),
      );
    }

    if (req.who.role !== 'dm') return refuse(401, 'shops are the DM’s to write');

    if (req.method === 'POST') {
      const template = req.body.template;
      if (!template || typeof template !== 'object') return refuse(400, 'a shop needs a body');
      // Named defensively rather than trusted: a shop with no name is
      // an unopenable row, and the id (when absent) is the host's to
      // mint through the ordinary template door.
      if (!String(template.name ?? '').trim()) return refuse(400, 'a shop needs a name');
      return answer(
        { id: template.id ?? '{{made}}' },
        {
          changed: ['templates'],
          effects: [{ effect: 'template.save', slot: 'vendors', template, as: 'made' }],
        },
      );
    }

    if (req.method === 'DELETE') {
      const id = req.path[0];
      if (!id) return refuse(400, 'which shop?');
      return answer(
        { ok: true },
        {
          changed: ['templates'],
          effects: [{ effect: 'template.remove', slot: 'vendors', id }],
        },
      );
    }

    return refuse(405, `the vendors door doesn't take ${req.method}`);
  },
};

// Re-exported so the panes can share the plugin's own arithmetic rather
// than reimplementing it in the browser (esbuild bundles what a pane
// imports relatively; only `react`, `teller` and `system` stay
// external). One spelling of a price, on both sides of the wire.
export { formatPrice, toVendor };
