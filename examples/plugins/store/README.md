# The Counter — plugin №2

The store: shops as written, a shelf a player browses, a cart put on the
counter, and the sale the Warden rules on. It was teller's own furniture
for a day and a half; it is a plugin now, and teller ships with no store
again (docs/CORE-NEXT.md §15, 2026-08-20).

```
cp -r examples/plugins/store ~/.teller-next/plugins/store
node server/index.ts --data ~/.teller-next --enable plg_57012c4ab8e3
```

Enable it and a **Store** tab appears on the console and a **Shop** tab
appears at every seat while a shop is open. Disable it and both are
gone, its doors 404, and nothing else changes — a teller with no plugins
isn't degraded, it's complete.

## What's in it

```
plugin.json      what it provides, and every last thing it touches
host.mjs         the four doors: shop · cart · sell · vendors
store.mjs        the law — was `server/store-flow.ts`, moved whole
panes/store.tsx  the DM's side of the counter (console)
panes/shop.tsx   the seat's shelf (a player's own screen)
store.test.mjs   the law's own tests, which need no server at all
```

## The two things the extraction changed

**It reads a snapshot, not a session.** Every function takes the slice
of the table the host pushed in, assembled from what `needs` declares —
the vendors, the catalogue, three records, and the top-level entities in
both readings. A plugin never queries.

**It returns effects, not writes.** `sell` used to call
`session.create`; it describes one, and the host runs it as
`plugin:plg_…`. Every figure that moves still came off a console where a
human could type over it first (rule 1), every write is still one row in
the log that `/undo` steps back (rule 3) — more reliably than before,
because now there is no other way for a write to happen.

## What it needs, and why each

Read `plugin.json`; the sentences there are the whole answer and they
are what a human is shown before enabling it. The one worth calling out
is `write:entities`: a shop becomes an ENTITY at its first transaction
(§14 — browsing must never instantiate), and it instantiates thin,
carrying only the counts it has sold down. That is the one durable thing
this plugin ever makes.

## What stayed behind

teller's public snapshot no longer announces that a shop is open — a
passive board can't say "the general store is open" any more, because
knowing that was store knowledge living in teller. The `vendor` type
word survives in `server/public.ts` as a convention: an entity typed
`vendor` is furniture, not somebody at the table, and stays out of the
public roster. Whether a plugin should be able to contribute a line to
the public snapshot is a real question, and an open one.
