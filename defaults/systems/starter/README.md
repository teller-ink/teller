# Starter — the fully generic manual table, as a file

teller ships empty (§M-2). The install carries only the seven HOST
tools — boards, books, handouts, log, plugins, screens, shelf (in
`defaults/panels/`) — because those are the screens about this
*machine*, and they're meaningful before anyone has decided what game
is being played. Everything about PLAY — roster, runner, encounters,
bestiary, rules, and the entity arrangements (`sheet`, `bare`) — is a
**system-layer declaration** (§M-6). So a host with no system is a host
mid-setup: seven tabs, a shelf that says so, and nowhere to put a fight.

**This is the escape hatch.** Starter is a zero-IP system that declares
the generic play screens and nothing else, so the fully generic manual
table still exists — as a file teller loads, not as a hardcode in the
kernel. Sit down with it and you get every screen teller knows how to
draw, with none of anybody's game in them: you type in the lists, teller
keeps the books, and no declaration presumes what a number means.

**It ships with teller** (2026-08-21). This folder is in the INSTALL,
and teller reads it where it lies — the same treatment `defaults/panels/`
gets, and for the same reason (§M-6): defaults that are *seeded* into a
data dir go stale and resurrect, so nothing is ever written into
`~/.teller/systems/`. Starter is the LAST place the loader looks for
a system id — behind `systems/<name>/`, behind a pack-embedded
`system.json`, behind a `shelf.db` row — so a folder on your shelf
restating `sys_starter` wins outright, and deleting that folder falls
back here instead of resurrecting a copy. It upgrades when teller does.

## Use

Make a campaign on it from the console's campaign screen — on a host
with nothing else installed Starter is the only system, and the new-
campaign form picks it for you — or:

```
curl -X POST http://localhost:4526/api/campaigns \
  -H "x-teller-key: $(cat ~/.teller/dm.key)" \
  -H 'content-type: application/json' \
  -d '{"name":"My Table","system":"sys_starter"}'
```

Then, in the console: **Roster** → type a name, add → open the tile.
The sheet is the floor (below): **+ add list** makes a list with its
first entry (a number is a counter, a number with a max is a bar, words
are a plain value, blank is a chip); **+ add** puts another entry in a
list; **✕** takes one out. A list called `conditions` is the one list
Starter gives meaning to (below). **Bestiary → + new foe** writes down a
monster for this campaign — a name and a few counters — and
**Encounters** builds fights out of those.

**No trust row is needed.** Trust gates outside CODE, never data
(`core/panels-shelf.ts`, `core/boot.ts`): Starter carries no
`presentations/` and none of its panels carry blocks, so there is nothing
to enable. The install floor is data-only by construction — teller's own
installation may be read-only, so the sweep neither compiles code nor
copies art from it (`sweepSystemsIn`). A default that wants either wants
to be a folder on somebody's shelf.

## What's in it

```
system.json          sys_starter, and one kind declaration
panels/roster/       ─┐
panels/runner/        │ the play screens, each one small file
panels/encounters/    │ naming a teller tool
panels/bestiary/      │
panels/rules/        ─┘
panels/sheet/        the entity arrangement: the floor, below
panels/bare/         the same floor, under its own name
```

`system.json` declares exactly one thing: that a list called
`conditions` counts, and that easing an entry to zero CLEARS it rather
than storing a zero. That's what makes a condition either on or gone,
and it is the one piece of meaning a generic table still needs — every
other list is text or numbers and reads fine without a declaration
(§M-8: absent is zero, everywhere).

Nothing here names a condition, a stat, a skill or a resource. There is
no `statuses` list, no `dials`, no `pins`, no `dice`: those are all
statements about how one game works, and Starter is deliberately silent
on all of them. The consequence is the point — every face teller can
summon resolves to nothing, and every screen falls to the FLOOR (§L
phase 3): bars, steppers, chips and ledger rows, with every stored value
present.

The `sheet` panel is the `floor` block: who this is, then every list
the entity actually has, one section each, with a control to add an
entry, add a list, and remove an entry. On a system that knows nothing
about your lists, adding them has to happen somewhere, and the sheet
the roster opens is where a person looks (the 2026-11-16 audit's
stranger got names and a turn order and no way to type a number). The
moment you know your game has a Health and a Grit, the honest thing is
to say so in your own panel, not to make this one guess.

## Where to go from here

This folder is meant to be copied and renamed — it's the smallest legal
system, so it's the shortest path to your own. `teller where` prints two
folders: your data folder, and this install's `defaults/` (which is
where this file lives, after `brew install` as in a checkout). From a
checkout, run `./bin/teller` wherever it says `teller`.

1. Copy it onto your shelf. With the default data folder:

   ```
   mkdir -p ~/.teller/systems
   cp -R "$(teller where --defaults)/systems/starter" ~/.teller/systems/mygame
   ```

   (`teller host` makes `systems/` on its first boot; the `mkdir` is
   there so this works before that too. Hosting with `--data <path>`?
   Use `<path>/systems/mygame`.) Then change `id` and `name` in
   `~/.teller/systems/mygame/system.json` — the id to a `sys_` string of
   your own. Two systems may not share a `sys_` id; the folder name is
   not the identity, and a copy that keeps `sys_starter` simply
   replaces Starter on this host.
2. Add records to `system.json` — only the slots in the reference below
   are read by teller. They're read and edited together, which is why
   they live inline in one file; a longer one may be its own
   `<slot>.json` beside it. The only reserved keys are `id`, `name` and
   `version`.
3. Restate a panel by keeping its `name` and changing the blocks. A
   system's `sheet` beats teller's floor; a pack's beats the system's;
   the table's `panels/` beats them all — precedence comes from the
   merge, never from how much you wrote.
4. Press **sweep the folders** in the console's Shelf tab (or restart
   the host). The sweep's answer lists every problem, and warns about
   any slot or block name nothing reads — it never refuses one.
5. Only if you want a face teller doesn't ship: add
   `presentations/<Name>.tsx`, where the filename is the name a `dials`
   or `pins` record summons. That's the rung where trust starts
   mattering, and it's the last rung, not the first.

## Reference — what teller reads

Derived from the code that reads it (`/api/stack/record|declarations|
templates/<slot>` and their callers), not from a wish list. A slot or
block not listed here still loads; the sweep warns, because nothing in
teller will look at it (a plugin, or your system's own `exports/`, may).
`core/packs-shelf.ts` (`KNOWN_SLOTS`) and `core/panels-shelf.ts`
(`KNOWN_BLOCKS`, `KNOWN_TOOLS`) hold the lists the sweep checks.

**Records** — one object each, merged key by key, later layer wins:

| slot | shape |
|---|---|
| `dice` | `{faces: {<letter>: string[]}, values: {<face>: number}, unit?, track?, trackBonus?, banks?: [{face, counter}]}` — notation is `<n><letter>` |
| `initiative` | `{field?, highWins?}` |
| `dials` | `{<entry name>: <presentation name>}` |
| `pins` | `{<entry name>: string[]}` — entries drawn inside another's panel |
| `accents` · `icons` · `portraits` | `{<name or type>: string}` (a colour, an icon, an `art/…` path) |
| `brand` | `{logo?: <art path>}` |
| `use` | `{costField?, costCounter?, consumesKind?, verb?, verbs?, costs?: [{field, counter}], actions?: [{name, cost, text?}]}` |
| `currency` | `{symbol?, denominations?: [{counter, value}]}` |
| `marks` | `{text?, list?, categories?: string[]}` |
| `groups` | `{<group>: string[]}` |
| `notes` | `{<name>: string}` — captions |
| `defenses` · `carry` · `spends` | passed whole to the system's own readers |
| `vocabulary` | fetched by the sheet; nothing reads it yet |
| `space` | one string |

**Declarations** — lists of objects merged by `name`, later wins:

| slot | shape |
|---|---|
| `kinds` | `{name, label?, note?, domain: {kind: "count", zero?: "clears" \| "stays", cap?} \| {kind: "steps", steps, rest?} \| {kind: "text"}}` |
| `statuses` | `{name, relief?, effect?, uncapped?}` |
| `bands` | `{name, from?, to?, world?}` |
| `ladders` | `{name, label?, list?, section?, text?, steps: [...], defaultStep?}` |
| `screens` | `{name, icon?, kinds?, counters?, arms?, rest?}` |
| `sections` | `{name, entries: [{name, meta?, text, page?}]}` — the rules tab |
| `notices` | a string, or `{text}` |
| `trades` · `creation` | read by a system's own creation code; `trades` names also mark the party |
| `panels` | panel declarations — usually folders under `panels/`, not a slot |

**Templates** — lists of `{id, name, type?, lists?, notes?, children?}`,
merged by `id`: `bestiary` (foes), `catalog` (items), `upgrades`.

**Panel blocks** (`mounted` and `held` in a `panel.json`, each
`{"block": "<name>", …}`): `header` · `brand` · `floor` · `rest`
(`except: [list names]`) · `list` (`list`, `as`, `filter`, `names`) ·
`statuses` · `notes` · `children` · `carried` (`screen`) · `aside`
(`text`) · `spend-door` · `ladders` · `columns` (`columns: [[blocks],
…]`) · `panel` (`name` — include another panel) · `turn` · `tool`
(`tool`: one of `roster`, `runner`, `encounters`, `bestiary`, `rules`,
`boards`, `books`, `handouts`, `log`, `plugins`, `screens`, `shelf`). A
panel's own `blocks/<Name>.tsx` adds a block only that panel can name.

## Rights

Zero IP, by construction — no prose, no art, no book's words, nothing
anyone but teller wrote. Mechanics aren't protectable expression and
there are barely any here anyway, so this system is freely
distributable by anybody, which is exactly the property §M-2 wanted a
system to have.
