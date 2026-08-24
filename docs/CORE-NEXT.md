# CORE-NEXT — the working doc

> **This is a workbench, not a spec.** It lives on `design/core-next` and
> nothing in it is built. Everything else in `docs/` describes what
> shipped; this describes where we're going and is expected to be wrong
> in places. Squash it into `main` when it stops being wrong.
>
> Started 2026-08-17 (Brian + Claude), out of a conversation that began
> as "rework the Warden console" and ended up two layers underneath it.

**Read first:** `docs/STORAGE.md` is the BEFORE picture and the evidence
base for everything here — mapped off a live install, not off the types.
`docs/ARCHITECTURE.md` is the law this has to satisfy.

**The working posture** (Brian, 2026-08-18): teller is pre-alpha, and
this doc is not chasing perfect or final. The bar is *thought through
enough that iteration is cheap when justified* — settle the shapes that
would be expensive to change (storage, references, the merge), stay
loose on everything that's one migration away, and expect "Settled"
sections to be amended by contact with WiW. Building starts before this
doc is finished, on purpose.

---

## Why this exists

Five bugs in one week, all the same bug:

1. Severity on the end of a tag string (`"Trapped 4"`)
2. A Talent's category behind a `"Talent: "` prefix
3. A status's relieving skill in a pack entry's free-text `meta`
4. A standing behind a `rep_` field-key prefix
5. Descriptors and conditions sharing one list, so **Gunslinger renders
   as a condition at severity 1** — still live

I kept calling this "a mechanic hiding in a text field," which is the
symptom. The cause:

> The character has four generic buckets. The system has 26 declarations,
> several of which are the same concept. Each concept lands in the
> nearest bucket, and whatever distinguishes it gets encoded into
> whatever that bucket allows — a string, a key prefix, a position.

The kind store (`worker/kinds.ts`, shipped) fixed the *storage* half for
two of them. It was scoped too small.

---

## What must remain true

Any proposal here has to satisfy all of these, or it's wrong:

- **The degradation contract.** Nothing above Core is required. A core
  type is the most a human can still operate with no help.
- **Rule 1.** Every value lands somewhere a human can type over.
- **Rule 2.** No game concept in Core. No `hp`, no Skill, no Trapped.
- **One merge shape.** system → packs (declared order) → campaign, later
  wins by name.
- **Reading forgiving, writing strict.** Permanently, not as a window.
- **Rule 7.** Authority is role-derived. Core still owns who may edit and
  who may see — that part is not "semantics."

---

## Settled

### 1 · Core has no semantics

Core **stores**. The system **declares meaning**. The panel **decides
presentation**. (Brian, 2026-08-17.)

The corollary that unlocked the rest: a discriminator like *"does zero
mean absent or mean zero?"* belongs on the **declaration**, not on each
stored value. On the value it's a mechanic hiding in a field; on the
declaration it's the system layer doing its job.

### 2 · Core stores named lists of named values, prose, and nested entities

```
entity {
  name
  lists   Record<string, Entry[]>     // 'skills' · 'resources' · 'conditions' · 'marks' · …
  notes   string
  children?                            // entities inside entities
}

Entry { name · value?: number | string · max? }
```

`fields`, `counters`, `tags` and `kinds` all collapse into `lists`.
`kinds` was already the right idea; it was scoped to two of the four.

Counter and Tag share one spine and differ **only in what zero means** —
a counter at zero is a fact you read off the sheet (a live character
holds seven at 0); a tag at zero is deleted, because absence *is* the
state. The ceiling differs only in scope: `Counter.max` is per instance,
`statuses.cap` is per kind.

### 3 · Entity, not character

Core has no concept of a character. Evidence, not preference:

- **Seven entity types already exist without a table** — blueprints,
  catalogue items, upgrades, encounters, vendors, scenes, handouts —
  each a named thing with its own id, stored as a JSON array inside
  `campaigns.data`. Only `characters` was ever promoted.
- An **Item** already carries its owner's primitive set.
- **`characters.kind`** (`pc` | `npc`) is the only type discriminator in
  the schema, gates 33 sites, and has no answer for a horse owned by a
  player (`docs/SYSTEMS.md` §18 refuses to decide entity-or-item).
- The **event log** — oldest part of the schema, foundation commit — has
  always said `entity_id`.

### 4 · Boards are assets; placements are live

A Scene today is a board with a fight smeared onto it:

```
id · key(image) · name · widthInches · grid      ← the BOARD
tokens[] · zones[] · terrain[] · fog · view      ← what's ON it now
```

Live proof: one scene mid-fight is 2,725 bytes; two empty ones are ~290.
The difference is entirely session state.

A board is an **asset**, the same category as a book or pack art —
reusable across campaigns, keyed by its image, referenced by id.
`widthInches` + `grid` + the display's `ppi` exist to make a screen
render *a real physical inch* so drawn squares line up with the minis.
That is calibration between pixels and the room: teller-the-program, not
campaign content.

```
board      { id · key(image) · name · widthInches · grid }
placement  { boardId · entityId? · u · v · sizeInches · rot · shape · hidden · label? · color? }
fog        per campaign + board
```

**Bug this fixes:** `worker/bundle.ts:288` writes the whole Scene into
`scenes.json`, so exporting a `.story` mid-fight ships token positions
and revealed fog. Session state inside a Campaign file, which the layer
stack forbids.

### 5 · A token links to an entity by id — and owns its own appearance

The link is already load-bearing (`TableView.tsx:266`). The split, which
the code already follows and nobody wrote down:

> **The token stores where it is and what it looks like. The entity
> supplies how it's doing.**

Derived through the link at render, never stored: status ring
(`linked.data.tags`), bloodied/critical/down glow (`vitality`), turn
highlight. So a token can't go stale.

The token keeps `label` and `color` because it must work **unlinked** (a
rock, something in the dark), and because colour is a deployment choice
about sides — three Bark Watchers wear amber, green and teal; four
Vargas-side tokens share one blue.

### 6 · Four tiers, each additive, none required

| tier | supplies | exists today |
|---|---|---|
| **Bare panel** | controls derived from the value's shape | ✅ 5 of 6 seat layouts |
| **System** | labels, order, caps, value domains, vocabulary | ✅ 26 keys, unorganised |
| **Plugin** | automation, mechanics, computed values | ⚠️ `assistant.ts` only |
| **Custom panel** | it looks like the paper | ✅ `sheet` + ~20 components |

We built the top first and never built the bottom for anything but
counters — that's the actual gap.

### 7 · The bare-panel rule

**The control follows the value's shape, not a declaration.**

| entry | bare control |
|---|---|
| `{name}` | a chip — tap to remove, `+ add` to create |
| `{name, value: number}` | the number, with − / + |
| `{name, value: number, max}` | a bar or a ring, capped |
| `{name, value: string}` | an inline text field |
| child entity | a titled sub-block, recursive |
| **ref** | **a link chip — cached name; marked when dangling; clear / retarget** |

List name → section heading. Entity name → title. Notes → textarea.
`type` → an editable word. Everything writes. That is a complete, ugly,
fully-operable sheet with zero declaration — the floor, made concrete.

*Checked against the full entity type, 2026-08-18 — it holds, with the
ref row added above and one scoping note:* the bare panel is an
**instance** surface (§13). Template halves — a pack's bestiary, the
campaign's own catalog — are authored on prep surfaces, which are the
console's business, not this rule's. Every field of
`Entity { name, type, lists, notes, children, refs }` now has a bare
control; the only thing never rendered is `id`.

Already shipped as proof: `Gauges`' own blurb is the rule out loud —
*"bars for anything with a ceiling; the rest tucked underneath."*

### 8 · Derived readings are computed at the point of use

Never stored. Confirmed: `vitality` is computed in `toPublicCharacter`
(`worker/db.ts:268`) and appears in **zero** rows, and the table has been
drawing token glow off it all along. That closes the question
`ARCHITECTURE.md` left open about Bloodied/Down returning as something
computed — it already did.

---

### 9 · An item is an entity; where it's stored is a promotion decision

*(Settled 2026-08-18 — was open questions A and B.)*

"Container or entity" turned out to be a false question conflating two
things that come apart:

- **What it IS:** an entity. Same type as its owner.
- **Where it's STORED:** inside the parent's blob vs its own row —
  which is **rule 8 applied to entities**: promote a nested entity to a
  row when something outside needs to address it, the same law that
  promotes a blob key to a column when a query needs it.

Containment is an ordinary relationship between entities, not a second
kind of thing. Authority follows it (rule 7 stays simple): a seat edits
its one entity and everything nested inside.

The evidence, from the live install:

- **Live items are stamps.** All 14 sampled: `from` set, zero local
  fields/counters — a name, a catalogue reference, a grouping word.
  And `Item.from` is `CharacterData.blueprintId` wearing another name:
  provenance of a stamp, typed values beating derived ones. One
  concept, currently two spellings.
- **Items already hold cross-references.** `loaded` points at a SIBLING
  (the comment says it: "a SELECTION, not containment"); `upgrades[].from`
  points into the catalogue; `worker/items.ts:719` addresses `item.id`
  from outside the owner.
- **`history` (Deeds) is a private event log** — `{what, where, round,
  when}` — re-implemented small inside the blob because an item had no
  `entity_id` to log against. Core already has that table.

What dissolves: Item-the-type (`fields/counters/tags/notes` → lists +
prose; `from` → provenance; `loaded`/`upgrades` → references; `history`
→ events; `kind` → question C). The horse hard case (an entity contained
by a character AND addressable on the board — promotion, not
reclassification). Trade-as-copy-and-delete (handing over a pistol is
reparenting; the history rides along).

This also settles old question A: **entries stay strictly name/value**,
because anything richer was an entity all along.

---

### 10 · The entity type, drafted — and every reference walks through it

*(2026-08-18. Settles B′'s shape question; C stays open and has a
marked slot.)*

```
Ref    { id · name }                     // id resolves; name degrades
Entry  { name · value?: number|string · max? }   // strictly a leaf (§9)
Entity {
  id · name · type?                      // type? = question C, unresolved
  lists    Record<string, Entry[]>
  notes?
  children? Entity[]                     // inline until promoted (rule 8)
  refs?    Record<string, Ref>           // 'from' · 'loaded' · 'system' · …
}
```

**The Ref shape was found, not invented**: encounter foes are already
`{blueprintId, name, u, v, hidden}` — id to resolve, cached name to
degrade to. The encounter runner needed it and built it locally.

Every existing reference, walked:

| today | becomes | degrades to |
|---|---|---|
| `Item.from` | `refs.from` | cached name; local values are all it has |
| `blueprintId` | `refs.from` — same slot | ordinary character |
| `Item.loaded` | `refs.loaded` | name shows; firing can't decrement |
| `FittedUpgrade` | child entity, `refs.from` + range entry | a named lump |
| placement `entityId` | already conforms — `label` is the degrade name | unlinked marker |
| encounter foes | already literally `{blueprintId, name}` | blank you type over |
| containment | inline children; promoted child carries parent ref | — |
| `campaign.system` | `refs.system` — door 2 becomes just another ref | vocabulary + dice lost, table plays on |

Two findings bigger than the walk:

**The campaign is the root entity.** Counters are lists, reference is
notes, npcs/encounters/vendors/scenes are children, books/packs/system
are refs. This dissolves STORAGE.md's headline anomaly: the seven
tableless entity types are children of the campaign entity, each
individually promotable under rule 8. `characters` is just the one
that got promoted first.

**Identity couples by id; vocabulary couples by name.** Entities point
at entities by Ref. Kind entries match declarations BY NAME — a
condition its StatusDef, a standing its party, a mark its category —
deliberately, because the whole merge system runs on later-wins-by-name
and a campaign overrides a status by restating it. A dangling ref
renders its cached name, marked missing — never dropped (rule 9),
never a bare id (degradation).

### 11 · The campaign is the file

*(2026-08-18. Brian: "go with it for now" — explicitly NOT 100% sold;
keep thinking. **Confirmed later the same day** ("yeah 11 is good"),
re-raised before H step 1 as the handoff required — no longer
provisional. The two probes that were chewed on: a character following
a player between tables is a file op, and switching campaigns is a
restart; both accepted.)*

A campaign row turned out to be: a small MANIFEST (name, system ref,
pack/book lists in precedence order, vocabulary, party counters), plus
everything it contains, plus a little live state. Of the three live
campaigns one is real and two are test furniture; nothing crosses
between them, and 35 of 42 displays belong to NO campaign — a symptom
of instance-level things stuffed into a campaign-scoped table.

So the campaign isn't a special table or a merged root row — **it's the
boundary of the database file.** Boot-time loading is the resolution law
finding its home: teller starts, reads the manifest, resolves
system/packs against the shelf, reports what's missing, degrades. Once,
at boot — not per-request. The CLI already half-says this: `teller host
[path]` exists so "a campaign can live on a stick you carry."

The split falls exactly on rule 9's line — what a publisher wrote stays
put (shelf), what you wrote travels (the campaign file):

```
~/.teller/
  shelf.db          books · packs · systems · boards · displays
  books/ packs/ art/ dm.key
  campaigns/
    the-unlikely-duo.db      entities · events · board_state
```

What it deletes: `root_id` from entities/events/board_state (scoping IS
the file); per-request campaign checks (rule 7's one key unlocks the
loaded campaign); the SSE scoping question; ever importing the Guidebook
twice. Backup becomes copying one file.

**The three costs, named:**

1. **Switching campaigns = restarting teller.** Probably correct — a
   game night is one campaign; `teller host` with no arg lists
   `campaigns/` and asks.
2. **Displays move to the shelf** — fixes the orphan problem (a kiosk is
   the ROOM's, pairs once, survives switches), and a stale assignment
   pointing into an unloaded campaign is just a dangling ref: cached
   name, degrade to standby. The model handles it for free.
3. **Cloudflare doesn't do multiple database files.** D1 is one binding.
   Costs nothing today (play is local-first; CF is the landing page) but
   it is the dual-runtime seam genuinely strained for the first time —
   written down here so it's a decision, not a discovery.

Also: `cmp_` ids stop scoping requests, which touches most route
signatures — so this lands WITH the entity migration in H, not
separately.

### 12 · The table schema, after

*(As amended by §11. Nine tables become 4 + 4, split by file.)*

**`campaigns/<name>.db` — one campaign:**

```sql
entities (
  id          TEXT PRIMARY KEY,   -- ent_…
  parent_id   TEXT,               -- containment when promoted (§9); NULL at root
  name        TEXT NOT NULL,
  type        TEXT,               -- question C — loose; nothing branches on it
  data        TEXT NOT NULL,      -- { lists, notes, refs, children[] inline }
  created_at, updated_at
)
events      ( id, entity_id, actor, kind, payload, created_at )   -- unchanged shape
board_state ( board_id PRIMARY KEY, data )                        -- placements + fog + view; a .story SECTION, on for a backup, off for a handout (TEL-87 2026-08-16/20 — "everything, live state is fine" superseded the old NEVER)
templates   ( id, slot, name, data, … )                           -- the template half; slot is a COLUMN (contact log)
```

The campaign manifest is the root entity row (`parent_id IS NULL`).
Characters are promoted children. `children` holds INSTANCES only
(§13): the campaign's own blueprints, encounters, vendors and catalog
are its TEMPLATE half — first written as "live in the manifest", which
contact proved unbuildable (see the log); they live in the `templates`
table, one table for the whole half, the slot a column. **No new table
per TYPE, ever.**

Promoted columns, each earning its keep: `parent_id` (fetch children),
`type` (filter + strip). Everything else is blob (rule 8).

**`shelf.db` — this machine:**

```sql
systems  ( id sys_…, name, version, data, builtin )   -- door 2 done: minted id, 'wiw' demotes to a name
packs    ( id pak_…, system, name, data, … )          -- unchanged
books    ( id bok_…, … ) + book_pages                 -- unchanged
boards   ( id brd_…, key, name, width_inches, grid )  -- NEW: the asset half of §4
displays ( id, name, color, role, params, code, ppi… )-- campaign_id GONE; the room's screens
```

Gone entirely: `characters` (→ entities), `campaigns` (→ the file),
Scene-as-campaign-content (→ boards + board_state), `do_storage`
(session state; the DO's cache lives wherever the runtime puts it).

**Fork noted, default standing:** placements stay a blob per board
(rule 8 — nothing addresses one from outside yet; a player moving only
their own token would be the promotion trigger).

### 13 · An entity is an instance

*(Brian, 2026-08-18: "an entity is simply an instantiated instance of
something else… the monster in a bestiary is NOT an entity; the
instantiated version that has hp and statuses and exists in an
encounter is." Confirmed, with two sharpenings.)*

> **An entity is a thing in play at this table — usually stamped from a
> template, never required to be.** `refs.from` is the stamp mark; its
> absence is fine (a character invented at the table has no template,
> and degradation demands templates stay optional).

| template (content) | instance (entity) |
|---|---|
| bestiary blueprint | the foe on the board, at Health 5 |
| trade | the character a player built from it |
| catalogue item | the pistol in Barrett's belt |
| encounter | the deployed fight |
| board (asset) | board_state |

The encounter runner proves it was already true: an encounter's foes
are `{blueprintId, name, u, v}` — instructions for instantiation — and
deploying stamps real characters.

**The campaign layer has two halves.** Its OWN bestiary, catalog and
statuses are templates — the campaign's contribution to the merge
(system → packs → campaign, wins on collision), authored content that
travels. Its characters and deployed foes are instances — in no merge,
because they aren't content, they're the game. Templates change by
version bump; instances change by logged, undoable events (rule 3).
This is also why a blueprint correction never reaches creatures already
on the table — `blueprintId` was documented "provenance, not a live
link" from the start.

**Amendment to §12:** `children` holds INSTANCES only. The campaign's
template half (own blueprints, encounters, vendors, catalog, statuses)
lives in the manifest, not as child entities. A vendor is the boundary
case that shows the seam working: the shop-as-written is template; the
moment the table tracks depleted stock, THAT is the instantiation.

Noted for later, not pursued now: prep vs play — the console split
Brian asked for at the very start — is exactly template vs instance.
Prep authors templates and arrangements; play manipulates instances.

### 14 · The stamp — one link, variable thickness

*(2026-08-18, out of "how does the gun know its template, how does the
npc know its monster, and should a store instantiate whole?")*

**The link is always `refs.from`**, holding a template id minted at
authoring (`npc_wiw_bark_watcher`, a catalogue `id`) plus the cached
name. Resolution goes through **the same merge that presents content**
(the `bestiaryFor`/`catalogOf` path) — deliberately, because that is
how corrections propagate: fix a stat in the pack and every thin stamp
reads the fix at render. The cached name degrades it when the pack is
gone. "Stock is part of the store" is the OTHER relationship —
containment — and stock lines match template lines by name (vocabulary
coupling, §10).

**Thickness is a property of the stamping ACTION, not the link.** Today
there are secretly two behaviours: the gun is a THIN stamp (stores only
overrides, derives the rest through `from`, rule 1), and the character
is a THICK one (creation copies everything at birth; `blueprintId` is
documented "provenance, not a live link"). Unified: everything derives
through `from` and stored values win — a thick stamp is just a stamp
that stored every value at birth. The character behaves exactly as
today, but stops being a special case.

> Copy as little as the thing's nature allows. Characters copy
> everything, because creation is authorship. Guns copy nothing,
> because it's the book's gun until the table says otherwise. Shops
> copy nothing and instantiate late.

**Vendors, settled concretely** (amends the lazy-per-line sketch in
§13's vendor note): instantiate the WHOLE vendor as an entity at first
transaction or first DM edit — never on browse — so "the shop went
live" is one event, addressable and undoable, and the console can show
as-written vs live. But instantiate THIN: store only depleted counts
(`VendorLine.qty` is the template default; an entry exists only once it
moves off it — the defaultStep pattern). A thick-copied shop would be
frozen at instantiation day; a thin one carries the pack's new items
automatically.

### 15 · How a plugin loads

*(2026-08-18, confirmed. The assistant is the proof port.)*

A plugin is a **folder on the shelf** — `~/.teller/plugins/<name>/` —
manifest beside code: `plugin.json` (`plg_` id, name, version, tiers,
`provides`, `needs`) + `host.mjs` (proposer/effectful entry) +
`panel.mjs` (surface entry, served to the browser). *(That last name
was a sketch; when the surface tier was actually built it became a
`pane.*` provision naming any `.tsx` in the folder, compiled at load
— see the contact log below.)*

**The sweep DISCOVERS; only a human ENABLES.** Discovery lists it as
available in the console; enabling is an explicit per-plugin act where
the manifest's claims are shown app-permissions style (`needs: []` is a
meaningful, checkable claim). Enablement lives in **shelf.db, never the
campaign** — trust is a fact about this machine. Content may REQUIRE a
plugin by ref; requirement is a claim and cannot grant trust. Missing or
disabled → reported and degraded, like a missing pack. Uninstall-and-look
stays the compliance test.

**Boot:** read enabled list → `import()` each entry → the module exports
implementations keyed by **extension point**:

```js
export const provides = {
  'propose.turn':  (snapshot, question) => …,
  'control.clock': …,   // served from panel.mjs, client-registered
  'pane.scan':     …,
}
```

Points live in ONE registry file (the `panes.ts` precedent: a point not
in the registry isn't a point), starting tiny — `propose.*`, `control.*`
(generalising `dials`), `pane.*` — growing only when a real plugin needs
a real point.

**The call boundary is async and message-shaped from day one** —
serializable snapshots in, proposals out, no live objects — even though
v1 runs in-process. Moving to `worker_threads`/subprocess later is then
a transport change, not an API break. Stated honestly: in-process code
is NOT sandboxed; pre-alpha, the enable gate is the security model, and
real isolation arrives with the transport swap, before any registry of
third-party plugins exists.

**Held line:** plugins get snapshots PUSHED; they never query. It keeps
proposers pure, portable, cacheable. The first plugin that genuinely
can't live with it makes the argument (the empirical-ceiling rule).

**The argument arrived: the STORE is plugin №2, by extraction**
(2026-08-20, Brian: "let it finish up, then after it's done we can
extract it into a plugin"). The store/vendor flow lands first as
ordinary furniture — mechanics in their own server module, the panel
declared at the SYSTEM layer so an undeclaring system pays nothing —
because the plugin runtime can't host it yet: a store needs session
state (carts), doors seats hit, and SURFACES (a console counter, a
seat shelf), which is everything the held line excludes and exactly
what the sketched `control.*`/`pane.*` points were reserved for. So
the store is the DESIGNATED FIRST CUSTOMER of the plugin UI tier:
build `pane.*` (a plugin declares panels/screens) and whatever session
seam carts prove to need, against this concrete case, then extract the
store wholesale — the §L pattern again (right home eventually, working
code now, notice served). Until the extraction, the store's residence
in teller's client registry is a SQUATTER'S, not precedent; and the
generic counter stays generic (currency record + catalog in, no WiW
words), so WiW's flavor rides data and pack panels over it, the same
way the sheet wears its book.

**DONE, 2026-08-20 — both halves, the day after the plan was written.**
The tier is built and the store is extracted whole; the squatter moved
out. The contract AS BUILT is the contact log at the end of this
section, and that is the thing to read before adding a point.

**Plugin №1 is the assistant.** It already passes the three-question
test, already has the config precedent (`assistant.json` — absent means
no button), and already is two proposers: `suggestTurn` and
`narrateOutcome` are `propose.turn` and `propose.narrate` wearing
today's names. Porting it validates manifest, enable gate, registry and
degradation against working code. Per-plugin config generalises
`assistant.json`: one blob per plugin id, on the shelf.

**There are no builtin plugins, and there never will be** (Brian,
2026-08-18: "None required or given by default. Download/install the
ones you want"). teller ships with ZERO plugins — the same posture rule
4 takes for content, now taken for code: teller ships empty and stays
empty, in both domains. Two consequences:

- The assistant is not ported INTO the new core; it is ported OUT of
  teller. `worker/assistant.ts` dies in the sweep, and the assistant
  becomes an ordinary installed plugin — first among equals, no
  special discovery path, the same enable gate as anything else. Its
  authoring copy lives where a pack's does: the shelf folder IS the
  authoring copy. Distribution, when it matters, is the
  already-deferred answer (a git repo, not a platform).
- The degradation contract gets its strongest reading for free: a
  teller with no plugins isn't degraded, it's COMPLETE.

**Sequencing amendment (contact, same day):** the assistant port rides
BEHIND the minimal loop, not ahead of it. `propose.turn` wants a
session snapshot — turn order, the round — and session state doesn't
exist in the new core until the server layer ports (DO → class, step
3). The load path is already proven against real fixture plugins; the
assistant is the proof of the SNAPSHOT CONTRACT, and that contract has
nothing to describe until there's a session to describe. Step 2's
machinery half is done; its proof half lands with step 3.

#### Contact log — the UI tier, and the store extracted *(2026-08-20)*

The designated first customer arrived and the tier was built against
it, exactly as the block above said it would be. What follows is the
contract AS BUILT — the newest settled ground in this section, and the
thing to read before adding a point.

**Two new families, and a family is a new kind of registry entry.**
`core/registry.ts` used to hold fixed names only, each owning its own
payload contract. `pane.` and `door.` are FAMILIES: the registry fixes
the SHAPE, the plugin brings the word (`pane.store`, `door.cart`), and
the suffix is checked as a usable one (`^[a-z0-9][a-z0-9-]*$` — a door
name becomes a path segment). The `panes.ts` law is untouched: a
family that isn't declared there isn't a point, and a claim against
one is refused out loud at load with its own name in the report.
`control.*` still isn't a point, because nothing has asked.

**`pane.*` — surfaces come from the REGISTRY, never the merge.** A
pane provision carries what a tool declaration carries — `name`,
`label`, `blurb`, `order`, `subject`, plus `icon` for a seat's tab bar
— and one thing a declaration never needs: `entry`, the source file,
compiled at load by the same esbuild pass a `.panel` folder gets
(`PLUGIN_IMPORTS`, into `.build/panes/`, served at
`/plugin-code/<plg_id>/…`, `?v=<mtime>`-stamped like everything else).
A pane is always a TAKEOVER (§E rung 5): it brought a component, not
an arrangement, so `client/lib/panes.ts` turns a provision into a
`PanelDef` carrying `code.takeover` and the existing renderer draws it
without having learned that plugins exist.

Every consumer of the merged `panels` slot now reads TWO sources and
sorts the union with the one comparator (`byPanelOrder`): the console
tab bar, the `#panel=` route, the Screens assignment picker, and the
seat's screen bar. **§M-2 stays crisp** — the merge is content and
provisions are function — and the consequence is the one that matters:
a provision cannot override a declaration by restating its name,
because it was never in that argument. A plugin providing `store`
while a system declares `store` yields two tabs with one word. That
reads odd exactly once and it reads TRUE; the fix is to stop declaring
the one you replaced, which is what this day did to the system-layer
store panels.

**`when` — the conditional surface, generalised.** The seat's shop tab
existed while a shop was open and not otherwise: a fact about the
moment, hard-coded into `SeatChrome`. A pane may now name a door in
`when`, and the surface offers it only while that door answers
non-null. One declared word replaced a hard-coded screen, and the next
plugin wanting a tab that comes and goes writes `when` instead of a
patch to the seat chrome.

**`system` IS importable from a pane, and the call is deliberate.** A
plugin is the one container that is system-agnostic (§M-2), which
makes `import … from 'system'` read like a contradiction. It isn't: a
pane is client code rendering AT A TABLE, and a table always has a
system (§M-6). The specifier resolves to a module the host generates,
empty when nothing supplies a presentation, so importing it never 404s
and never REQUIRES anything. Leaving it out would have banned the good
case — a pane dressing itself in the book's face — to prevent no bad
one.

**Found by building it, and it will bite every pane author once: a
pane may only wear the utility classes teller's own client already
uses.** Tailwind builds teller's stylesheet by SCANNING teller's
source; a plugin's pane is compiled separately and a shelf folder is in
nobody's scan, so a utility no file under `client/` mentions any more
simply does not exist in the served CSS. The store's panes were the
proof: `w-[19rem]` and `text-[11px]` were deleted along with the files
that used them, and the seat's shelf came back as unstyled vertical
slivers — a diagnostic that points nowhere near its cause. The rule
that falls out is the one the shelf already lived by (`wiw-sheet` ships
a `style.css` and uses plain `grid gap-3`): **ordinary utilities are
fine, arbitrary values ride an inline style or rung 3's own
stylesheet.** A pane may declare `style` beside `entry` for exactly
that, served and linked like a panel's own.

**`door.*` — request in, effects out.** A door handler is an ordinary
provide in `host.mjs`, and everything that makes it a door is on the
host's side of the existing `structuredClone` boundary
(`server/plugin-bridge.ts`). The request is data:

```
{ door, method, path[], body, who: { actor, role, entityId? },
  table: <the snapshot>, state: <this plugin's memory for this table> }
```

**Authority is resolved by the SERVER, first, and the plugin is handed
facts rather than headers** — it cannot re-derive authority because it
is given nothing to derive it from (rule 7). Which of teller's gates a
door sits behind is DECLARED per door (`role: 'dm' | 'prep' |
'table'`) and enforced before the handler runs; **absent means `dm`**,
the only safe default. Anything finer is the plugin's own law, decided
against `who` — the store's whose-cart-is-whose is exactly that, and
it is right that it lives there rather than in teller.

**The result vocabulary** is `{ status?, body?, state?, effects?,
changed? }`, and **the effects vocabulary is the whole of what a
plugin may ask for**:

```
entity.create { draft, parentId?, as? }   entity.save { entity }
entity.remove { id }                      entry.write { entityId, list, name, value?, max?, remove? }
template.save { slot, template, as? }     template.remove { slot, id }
log { entityId?, kind, payload? }
```

Every member maps onto a door teller already had (`Session.create`,
`save`, `remove`, `writeEntry`, `Campaign.putTemplate`,
`removeTemplate`, `append`), which is what makes **rule 1 and rule 3
structural here rather than promised**: a plugin's write is an
ordinary write — logged, invertible, typed over afterwards — and there
is no other way for a plugin to change anything. The effects run as
actor **`plugin:<plg_id>`**, so history says the counter moved the
money rather than that "dm" mysteriously did. `as` + `{{label}}` is
the one piece of plumbing: an effect that mints something may label
it, and later effects — plus the answer on its way out — get the
minted id substituted in. It exists because the first sale
instantiates the vendor and then names it in the receipt.

**`needs` stopped being decorative.** The grammar is
`<read|write>:<subject>[/<slot>] — note`, the note is what a human
reads at the enable gate, and both halves are enforced: `read:` decides
what the snapshot CONTAINS (a slot nobody asked for simply isn't
there), and `write:` decides which effects are allowed. **The whole
effect list is checked before any of it runs**, so a plugin asking for
one thing it never declared doesn't get the other three through the
door first; the refusal is a 403 with the plugin's name on it. A need
that doesn't parse grants nothing and is still shown, because an
author's typo must never widen what a plugin may touch and must never
silently narrow the sentence they wrote either.

**State lifetime: per Session, and it dies with the campaign.** A door
receives its plugin's memory and may replace it; the bridge holds it in
a `WeakMap<Session, …>`. That is the carts' own precedent kept exactly
(`server/notes.ts`) — a campaign switch builds a new Session, so every
plugin's memory of the old table is unreferenced without anything
having to remember to clear it. The boundary is CALL SHAPE, not
statelessness: a plugin may remember, it just may not remember across
tables, and losing it on a reboot is fine because it holds what nobody
is owed.

**What the store proved.** It is the whole tier's justification and it
exercised every piece: two panes (a console tool and a conditional seat
screen), four doors across three access levels, per-table memory
(carts), five of the seven effects, and a first sale that mints an
entity and names it in the same answer. `server/store-flow.ts` and its
routes are DELETED, the client's store tool and shop block with them,
`client/lib/money.ts` with them, and the system-layer `store` panel
declarations went too — the pane supersedes them, and a panel naming a
`tool` teller no longer registers would have rendered a refusal.
**teller ships with no store again**, and the compliance test is the
one it has always been: uninstall and look.

Two things stayed behind, both on purpose and both named here so they
don't get lost. The public snapshot's `shop` line is GONE — a passive
board no longer announces that the store is open, because knowing that
was store knowledge living in teller, and half a store left behind
would be worse than the loss. And `server/public.ts` still knows the
word `vendor`, as a CONVENTION rather than machinery: an entity typed
`vendor` is furniture, not somebody at the table, and stays out of the
public roster the same way `foe` is a word that file already reads.
Whether a plugin should be able to contribute to the public snapshot
is a real question and an open one.

### 16 · One runtime — Cloudflare is a brochure

*(Brian, 2026-08-18: "CF doesn't need to know anything at all about
teller as a program. It's just a landing page." Supersedes the
dual-runtime rule in CLAUDE.md — **folded 2026-08-24**.)*

"One codebase, two runtimes, no fork" existed only to keep play possible
on Cloudflare, and play left. Consequences:

- `host/*.mjs` stop being shims and become the implementation:
  `node:sqlite` direct, no D1 interface contract, no boolean-bind
  coercion, `CampaignDO` → a plain class.
- "Keep route handlers runtime-agnostic or this dies" — retired.
- §11 cost 3 (D1 can't do per-campaign files) — evaporates.
- §15's CF caveat — evaporates.
- The landing page is a static site with zero teller code.

**The nuance kept:** TEL-84 (remote reachability) may someday put a
relay on teller.ink for remote seats. A relay is a dumb pipe —
rendezvous infrastructure, not teller-the-program.

> **teller.ink may carry bytes; it never runs the game.**

---

## Open — with what would settle each

### B′ · References — shape settled in §10; two residues

One Ref shape covers all five existing cases (see §10's walk). Left:

- Does a Ref ever need to say what it EXPECTS to point at? (C's
  territory — a typed ref is half an entity type.)
- Staleness: the cached `name` goes stale on rename while the target
  is still present. Refresh on write? On read? Never (it only matters
  when dangling)? Leaning: refresh opportunistically on any write that
  touches the ref, accept staleness otherwise — it is display, not
  identity.

### C · Does an entity have a TYPE, and whose is it?

Core needs none for storage. But something has to answer "is this a
party member, a foe, a horse, a scene?" for filtering and for the
player-safe snapshot. Candidates: a Core field; a system declaration; or
list-membership (the campaign holds a `party` list of references).

Note `pc | npc` is already too coarse — a horse owned by a player is
neither, and gets stripped or exposed wrongly either way.

*Settles by:* §18 (horses). It's the first real thing the binary can't
hold.

### D · The unified kind declaration

The three kinds share a spine — **a population** (`list` / `categories`
/ pack `section`), **a value domain** (count-with-cap / none / ordered
steps), **a label and note**. Per-kind extras (`relief`, `effect`, `mod`)
ride on the entries.

Open: whether the kind declares its **control** or only its value
domain, with the control derived. `dials` (`counter → 'cylinder' |
'cards'`) already does the former, for counters, in two lines.

### E · What `.panel` actually is — SETTLED (2026-08-18, with Brian)

Six ad-hoc `Record`s already did this job: `groups`, `accents`, `pins`,
`dials`, `icons`, `screens`. `.panel` is their **consolidation**, not a
new invention. The blocker ("settles by doing D first") dissolved when
D got its real contact, and the precondition of step 5 ("once real
panels exist to arrange") was met the same day: two seat layouts and
eight console panels existed as code. Brian: do the format now.

**A `.panel` is a named declaration that arranges components on a
surface.** It rides the same stack as every other declaration —
vocabulary-coupled, merged by NAME, later wins — in a `panels` slot on
any layer. teller itself supplies the STANDARD collection as a base
layer BELOW the system (`core/panels.ts`, source `teller`), so a
system, pack, or campaign overrides a standard panel by restating its
word. Furniture, not content: shipping arrangements is teller's job;
they gate nothing and a human's layer always wins (rule 1 for UI).

```jsonc
{
  "name": "sheet",            // the word; restate it to override
  "label": "Sheet",
  "blurb": "Arranged like the paper you already know.",
  "subject": "entity",        // what it arranges: 'entity' | 'none'
  "mounted": [ …blocks ],     // TWO AUTHORED ARRANGEMENTS —
  "held":    [ …blocks ]      //   never one responsive layout
}
```

The constraints from `ARCHITECTURE.md` hold structurally:

- **Mounted / held are authored separately.** The sheet's brief
  media-query era is repealed: a renderer picks the arrangement by
  which family of glass the ASSIGNMENT says this screen is
  (`params.glass`, defaulting by aspect), and never reflows one layout
  into the other.
- **A panel proposes; the role decides.** A `.panel` never grants: a
  seat rendering `sheet` still edits only its one entity, a passive
  screen showing a panel still writes nothing. Surface follows
  assignment (`params.pane` for a console slice, `params.layout` for a
  seat), and the same merged list feeds the console directory, the
  hash routes, and the Screens panel's assignment picker — the
  `panes.ts` law: a panel nobody can be assigned to doesn't exist.
- **Layout + components only, never control flow.** Blocks are nouns:
  `columns` (layout), `header`, `list` (with `list` name, a
  presentation word `as`: `auto · chips · rows · bars · big · ledger`,
  and an optional `filter`: `capped · uncapped`), `statuses` (the
  system list with a severity box each), `rest` (every list not placed
  elsewhere — strays SURFACE, the degradation contract applied to
  arrangement), `notes`, `children`, `turn`, and `tool` (a named
  built-in component: `roster · runner · encounters · screens · shelf
  · plugins · boards · log`). `as: 'auto'` means §7's grammar — the
  floor is the default presentation, declarations only dress it.
- **Degradation.** A block kind this build doesn't know renders as a
  labeled refusal, out loud (the registry posture). A panel that fails
  entirely falls back to the bare panel. A subject-entity panel with
  no entity says so. Nothing blank, nothing silent.

**Two kinds of panel, one collection.** Arrangement panels (`sheet`,
`bare`) declare blocks over an entity. Tool panels (`screens`,
`plugins`, `shelf`, …) are teller furniture whose body is one `tool`
block — declared in the same collection so they're addressable,
assignable and overridable like everything else, while their behavior
stays code. §15's "enablement is a human act in the console" finally
has its room: the `plugins` tool panel.

**E extended — the ladder (2026-08-18, with Brian): a `.panel` may
carry code, and the client goes React.**

The vanilla client failed the visual bar (Brian, end of the porting
day: "all of the visual shit so far since this rework is pretty bad
and not at all like how it was before" — the old `src/` components are
the REFERENCE, not inspiration). Post-morteming WHY settled more than
styling. The buildless client was guarding hackability of the
customization surface — but the customization surface is the
DECLARATION, which never involved a toolchain anyway. Two different
audiences were conflated in one word, "the client": the panel author,
who touches data, and teller's own renderer, whose implementation no
author ever sees. Brian: "I don't care about buildless purity. I love
React. We should be using it." Pulling the audiences apart gives the
format its real shape:

**A `.panel` is an escalation ladder, and every rung is optional.**
The file is exactly as complicated as what it's trying to do (the
single-file-component move — Svelte, MDX — applied to arrangement):

1. **Arrangement** — blocks as nouns, `subject`, mounted/held. Pure
   data. The default, forever. Built.
2. **Vocabulary** — the records layer (`accents`, `dials`, …): a
   system recolors and re-skins with no code. Built; the Grit
   revolver is the proof a record beats a generic rendering.
3. **Style** — a `.panel` carries CSS scoped to itself.
4. **Custom blocks** — a `.panel` ships a React component for ONE
   noun, slotted into a declared arrangement. The arrangement stays
   the spine; you replaced a word in the sentence, not the sentence.
5. **Takeover** — the panel IS a component. Pixel-level, on your own.

The property that keeps this a ladder and not a cliff: **each rung
keeps everything below it for free** — data plumbing, subject
resolution, theming, glass handling — and gives up only what it
overrides. A rung-4 block receives its data as props; it does not
reimplement SSE.

Three decisions that came with it, each load-bearing:

- **The props contract becomes public API the day rung 4 exists.**
  What a custom block receives — resolved subject, loaded records, a
  sparse-write function, mounted/held — can never casually break once
  one person has written a panel against it. Corollary for the visual
  port: the old components come across as *the component library
  custom panels will compose from* (`Vitals`, `DicePool`,
  `Statblock` as importable primitives is what makes "full
  customization" mean "rearrange good parts" rather than "start from
  a blank div"). Port for fidelity first; PROMOTE to public API
  deliberately, later — but keep every block's props boundary clean
  (subject + records + write fn in, no reaching into globals) so
  promotion stays possible.
- **Code needs the trust gate; data doesn't.** A declaration-only
  panel is inert and auto-applies by name, as designed. Rung 3 and up
  is code running on every screen at the table — it sits behind §15's
  line: the sweep discovers, only a human enables. CSS counts as code
  (exfiltration via `url(…)` is real); the gate starts at rung 3.
  Custom blocks are a CLIENT-side extension point — §15's registry
  enforces its boundary with `structuredClone`, which a live component
  can't cross, so this is a sibling extension point, not a new
  provide.
- **The host compiles at sweep time.** JSX doesn't run raw; esbuild
  becomes a dependency and the ten-second sweep rebuilds a `.panel`
  edited in place. The pack precedent applies whole: a `.panel` is an
  archive and equally a folder (`panel.json` beside optional
  `style.css` and `blocks/*.tsx`), same sweep, no toolchain for the
  AUTHOR either. The person installing still just copies a file and
  enables it.

**This settles the client build story.** teller's own client is
React, bundled — Vite back in `server/`'s world, the standard blocks
are the old components ported at full fidelity, and a released teller
serves `dist/` exactly as the old world did. "View-source is the
source" is retired for teller's internals; it was only ever
load-bearing for the authoring surface, which stays data. The bare
panel's derivation (§7) survives as a React component — the floor is
a renderer, not a runtime commitment.

**Rungs 3–5 are NOT built now.** The settlement exists so the visual
port doesn't paint the format into a corner. First real customer for
rung 4 is likely the Aces `cards` fan — design the contract against
that concrete case when it arrives, not in the abstract.

**UN-DEFERRED (Brian, 2026-08-19): the first customer arrived, and it
is the WiW player sheet itself** — "everything it needs should be
self contained in its .panel file." The rungs build now, against that
concrete case: a `wiw-sheet.panel` folder carrying arrangement + its
own compiled blocks + its own style + its own art, edited in place on
the shelf. The contract, settled here so the machinery and the client
build to the same seam:

- **Compile at sweep**: esbuild (a dependency now) builds a panel
  folder's `blocks/*.tsx` / `panel.tsx` (takeover) / `style.css` into
  `<folder>/.build/`; rebuilt when sources are newer. A compile error
  is a load-report problem, out loud, never a crash.
- **Served plain** at `/panel-code/<pan_id>/…` — panel code is app
  code, not player-secret content; only `.build` outputs are
  reachable.
- **Declared to the client**: a code-carrying panel's `PanelDef`
  gains `code: { style?, blocks?: {name → url}, takeover? }` — added
  at load, and ONLY once the panel is trusted; untrusted code-panels
  surface as needing enablement instead.
- **Trust rides the plugins table** (§15's own line): the sweep
  discovers, only a human enables — one toggle, remembered, in the
  plugins tool. Teller's own seeded defaults arrive trusted.
- **The import contract is the rung-4 public API**: panel code
  imports `react`, `react/jsx-runtime`, and `teller` (the component
  library — the ported blocks and primitives, the ui grammar, the
  BlockCtx seam) via an import map the client serves; a custom block
  default-exports a component receiving the BlockCtx props. This is
  the promotion §E said would happen "deliberately, later" — later is
  now, and the seam freezes as it stands.
- **A panel never carries the data it renders** (Brian, 2026-08-19,
  confirming the seam). Entity, records, catalog — all arrive through
  the props contract; the folder owns look and behavior, never facts.

**E extended again (2026-08-18, Brian): the defaults are `.panel`
files too, and a panel owns its assets.**

- **Nothing is gatekept.** teller's standard panels ship as `.panel`
  files a host owner can open, edit, or duplicate — "ship" means SEED
  (the `seedSystems` posture: insert-or-ignore, never clobber; rule 1
  for files). Your edited `sheet` survives every upgrade; duplicate
  and rename to make a variant, or restate the name to override the
  default for every screen that asks for it. The end state is that
  teller's client is the RUNTIME plus the standard component library,
  and every panel — teller's own included — is a file. Two steps:
  arrangements as seeded files (pure data, cheap, soon); tool-panel
  BODIES as file-carried code (lands with the compile rung, not
  before — until then their behavior compiles into the client and
  their declarations ride the collection like everything else).
- **The trust gate is consent for code arriving from OUTSIDE** — the
  sweep discovers, a human enables. It is not a ceremony for your own
  hands: shipped defaults are trusted because you installed teller,
  and your edits are trusted because they're yours. The gate exists
  for the `.panel` someone hands you.
- **A `.panel` carries its art**, the pack precedent applied whole:
  `art/` in the folder, referenced RELATIVE inside, refs rewritten to
  a namespaced key at install, reversed on export. Which requires the
  pack's identity move too: a minted **`pan_` id**, assigned once at
  authoring and baked in — a panel is edited, so hashing would rename
  it on every correction. The NAME stays the merge key (vocabulary);
  the ID namespaces assets and names the file.

### F · `Field`'s key/label split

`Field` is `{key, label, value}`; Entry is `{name, …}`. §10's coupling
line sharpens this: `key` exists so DECLARATIONS could match a field
while its label stayed editable — the id-vs-name split, inside a leaf.
Under name-coupling, renaming an entry breaks its declaration match
(rename Charm and `groups.skills` loses it). One known tension now,
not a smell. Options: entries keep an optional stable key; or renames
are edits to the DECLARATION layer, not the entry; or accept the break
and let strays-promise catch it.

### G · Where prose lives

One `notes` per entity, or a note per list, or notes as a list of their
own? Prose is the ultimate degradation target and shouldn't be squeezed.

### H · The path — a clean break at the core *(drafted 2026-08-18)*

**The premise changed and the plan changed with it.** Convergence was
chosen to protect a live table; Brian, 2026-08-18: nothing is live,
nothing is shared, all testing. So: **rebuild the data core in place as
a break** — delete the old types, write the new core fresh, seed a fresh
database, let typecheck drive the sweep. No migrations, no
views-over-lists shims, no reading two shapes. The tags refactor proved
the method; this is the same move at full scale.

NOT a rewrite of the repo: SSE/leader election, display pairing and
tickets, battlemap rendering, dice, pack sweep, book FTS, the builder,
the sheet components — working, orthogonal, kept. The shelf's packs and
books are template content and survive as-is.

**The last free format break** (dated, deliberate): with no third-party
files in existence, `.story`, `.pack` and the db may all break once,
cleanly. The moment anything is shared — a playtester, the Boylei
proposal — the window closes and reading-forgiving hardens into the
permanent contract it was written to be.

**Parallel worlds:** the rebuild runs against `--data ~/.teller-next`
from day one; old teller keeps running against `~/.teller` as the
reference. The clean break's classic failure (a long dark stretch with
nothing runnable) is mitigated by never turning the old one off and by
lighting a minimal loop early.

*(Both worlds ended 2026-08-24: the old one was folded after the
fold-gate audit below, and the data dir default came back to
`~/.teller`. `~/.teller-next` throughout this doc is the parallel
world's name for what is now simply the shelf.)*

**The porting filter IS the console redesign.** Surfaces port one at a
time, and porting is an editorial act: every pane answers "does this
earn porting, and is it prep or play?" (template vs instance, §13). The
"full" pane doesn't get ported; it gets deleted — which is what the
redesign was going to do anyway.

The sequence:

1. **The core, fresh** — Entity/Entry/Ref, the kind declaration, stamp/
   resolve (§14), the merge, shelf.db + campaign files (§11/12), boards
   + board_state, events. Single-runtime (§16): `node:sqlite` direct,
   DO → class. Headless-testable. *Settles D and F by contact; G falls
   out.*
2. **Plugin registry + the assistant ported as plugin №1** (§15) —
   proves the load path while the surface area is small.
3. **The bare panel** — first UI on the new core; the floor (§7).
   *Minimal loop lights up here: console roster + one bare seat + a
   board.*
4. **Port surfaces through the filter** — seat layouts, table/board/
   badge, console panes in dependency order; design tokens ride along;
   delete what doesn't earn porting. *Settles C when the first horse
   gets stamped.*
5. **Declared panels** — the six layout Records consolidate into
   `.panel`-shaped declarations once real panels exist to arrange.
   *Settled — see E; pulled forward by Brian the same day step 4
   landed, once two seat layouts and eight console panels existed.*

### Contact log — H step 1 *(started 2026-08-18, `feat/core-next`, `core/`)*

The doc said building would amend it. What building found, first day:

- **A ref slot holds one ref OR an ordered list** (`Ref | Ref[]`).
  §10's drafted `Record<string, Ref>` had no home for the campaign's
  packs, where precedence order is the whole point. `refIn`/`refsIn`
  are the two readers.
- **Question D has a draft** (`core/kind.ts`): the spine is
  name/label/note + a domain — `count` (with `zero: 'clears' | 'stays'`
  and a presented-never-enforced `cap`), `steps` (with `rest`, the
  defaultStep pattern generalised), or `text`. The zero rule sits on
  the declaration exactly as §1 demanded. The UNDECLARED default is
  `'stays'`: deleting a value nobody declared deletable is automation
  past a human, so an undeclared list behaves like the old counters and
  a system opts a kind into clearing.
- **A value write never re-spells the name.** `setEntry` keeps the
  stored entry's own casing when updating in place — caught by a test
  asserting `charm` over `Charm`; changing a value is not permission to
  re-case the table's word.
- **Event ids are the rowid** — a single-writer local file wants
  insertion order, not minted strings. Updates log `{before, after}`,
  deletes log `{before}` and cascade one event per row, so `/undo`
  stays a reader of the log rather than a feature.
- **`core/` imports carry explicit `.ts` extensions** so node's native
  type stripping runs the core with no build step —
  `node core/anything.ts` is the whole harness. Headless-testable,
  literally.
- **`core/` typechecks as its own project** (`tsconfig.core.json`,
  node types): workers-types and node ambients can't share a tsconfig.
  A deliberate scar of the half-done sweep — it retires with `worker/`
  when §16 finishes. *(Retired 2026-08-24: two projects now, root
  (core + server) and client.)*

Second pass, same day — the boot loader (`core/boot.ts`):

- **The template half's home.** §12/§13 said the campaign's own
  bestiary/statuses/catalog "live in the manifest" — unbuildable: the
  manifest is an entity row, entries are strictly leaves, and
  entity-shaped content cannot ride through the coercer. It lives in a
  fourth campaign table, `templates (id, slot, name, data)` — ONE table
  for the whole half, the slot ('bestiary' · 'statuses' · …) a column
  and the format's word. "No new table per type" holds; §12 amended in
  place. Rows log `template.updated`/`.deleted` like everything else.
- **The coupling line reached storage**: `mergeNamed` (vocabulary) and
  `mergeById` (identity) are one `mergeBy` with two keys. A campaign
  overrides a status by restating its NAME and a pack's monster by
  restating its ID — both verified in tests.
- **`loadCampaign(shelf, campaign)` is the resolution law, once**:
  resolves the manifest's refs, reports `missing` as `{slot, ref}`
  (never dropped), degrades (a missing system loads with empty
  declarations and the table plays on), and with NO declared pack list
  applies every pack for the system in arrival order. `Loaded` hands
  out `declarations(slot)` (by name), `templates(slot)` (by id),
  `templateOf(…slots)` for `resolve()`, and `sourceOf(slot, name)` —
  provenance, so a console can say "campaign, overriding the
  Guidebook".

Third pass — the plugin load path (`core/registry.ts`,
`core/plugins.ts`; step 2's machinery, ahead of the assistant port):

- **"The sweep discovers; only a human enables" is structural now**:
  discovery reads disk and the trust table and writes NEITHER — a
  trust row exists only once a human acted, so the sweep cannot enable
  anything even by bug. Trust and per-plugin config live in a
  `plugins` table on the shelf (config generalises `assistant.json`).
- **The registry opens with two points** — `propose.turn`,
  `propose.narrate` — exactly what plugin №1 needs and nothing
  speculative. A provide against an unregistered point is refused out
  loud in the load report (tested with a plugin claiming
  `decide.turn`, a name chosen to remember why).
- **The message boundary is enforced, not promised**: every call
  crosses `structuredClone` both ways, so a plugin returning a live
  object fails TODAY, in process — not the day the transport changes.
  Tested.
- **A broken plugin degrades like a missing pack**: import throws, no
  entry file, malformed manifest — each a problem in the report, none
  a crash.

**Noted for the porting era** (Brian, 2026-08-18): retiring the old
Guidebook pack via a conversion script — `fields`/`counters`/`tags` →
`lists` — is the FIRST EXERCISE of the new pack format, not a chore.
It lands with step 4 / the WiW move-in, inside the last free format
break.

Fourth pass — **the minimal loop is lit** (`server/`, H step 3):

- **`CampaignDO` became `Session`** — a plain class holding one loaded
  campaign and an SSE subscriber set; every mutation is a store-write
  plus a room-nudge, so forgetting to broadcast is unrepresentable.
  The server is `node server/index.ts --data ~/.teller-next --campaign
  <slug>` — no build, no bundler. Deliberately keyless for exactly one
  day — rule 7 ported in the fifth pass, below.
- **The bare panel exists and is the floor made real** (`server/
  public/panel.js`, vanilla ESM, view-source IS the source): every
  §7 control derived from value shape alone, everything writes,
  verified live — a Grit bump through the bar landed in the store and
  the log with its actor. **The Gunslinger bug is structurally dead**:
  descriptors render as chips in their own list, conditions count in
  theirs, and there is no un-kinded bucket for them to collide in.
- **A thin stamp's panel is honest and nearly empty** — stored values
  only, the `from` chip, and a read-only "reads as" block showing the
  resolved reading. Editing resolved values while storing only what
  you touch (resolve-with-sparse-write) is SEAT design work for step
  4, deliberately not smuggled into the floor.
- **The board view derives `who` through the link** (§5) at render —
  a placement shows its entity's current name, `label` covers the
  unlinked rock, and a dangling `entityId` prints as missing rather
  than as a bare id.

Green at day's end: 72 tests (`pnpm test`), both typecheck projects,
and the loop live at `localhost:4526` against `~/.teller-next` —
console roster, stamping from the merged bestiary, two seats' worth of
entities, a board with placements, and the event log rendering rule 3
back at you.

Fifth pass — **H step 4, the porting era** (2026-08-18, evening — auth,
seat, runner, plugin №1, and the old world moving in):

- **Rule 7 ported, and the move SIMPLIFIED it**: displays lost their
  campaign column. The room's screens belong to the machine (rule 9),
  the host runs one campaign at a time, so "bring a screen over" — the
  old cross-campaign dance — dissolved; adoption is a consumed pairing
  code, and `adopted(display)` is just "has no code". Tickets went
  `node:crypto`-synchronous. The one key prints at boot: the host's
  terminal IS the DM's device. A seat's actor is derived from its
  assignment, never from what the client claims.
- **Resolve-with-sparse-write got its design, and it's per-entry
  copy-on-write**: the seat edits the READING; touching an entry that
  lives only in the template copies exactly that entry down into the
  stored half first — max and spelling ride along — then the write goes
  through `setEntry`, so a declared kind's zero-rule answers the same
  at the seat as everywhere. One door: `POST /entities/:id/entry`.
  **Known hole, deliberately open**: storing "absent" over a template
  that has the entry (a tombstone) has no spelling yet — removing a
  stored entry resurrects the template's reading. Nothing at the table
  needs it yet; design it when something does.
- **The turn order ported with its home upgraded** (rule 5): the op
  machine moved verbatim from the v0 runner — every case was found by a
  real fight — but state lives in a campaign-file table now and every
  op lands in the event log, which the old DO never managed. Entries
  link entities and derive names at render (§5). An encounter is PREP —
  a campaign template in slot `encounters`; deploy stamps numbered thin
  instances and the recipe stays pristine. A seat may say exactly one
  thing into the order: a score for its own row.
- **Plugin №1 exists and is NOT a builtin** (`examples/plugins/
  assistant/` — source you copy onto your own shelf). Contact finding:
  a plugin had no way to receive its CONFIG, so the load path now hands
  it to every call as a cloned second argument — the plugin never reads
  the shelf, and the clone boundary guards config exactly as it guards
  payloads. The propose route assembles its snapshot server-side
  (resolved acting sheet, named order), because a fact the host holds
  and doesn't pass on is a fact the model invents.
- **The old world moved in, and the conversion taught three things**
  (`scripts/convert-pack.mjs`, `scripts/port-campaign.mjs`): the old
  statuses META (stack/cap/uncapped) was a kind declaration all along —
  it converts straight into `kinds: [{name: 'conditions', domain:
  {count, zero: 'clears', cap: 6}}]` with per-status `uncapped` riding
  on the status's own declaration. Severity hiding in tag strings gets
  unwound at the border (a trailing number becomes the value). And the
  id-coupling paid off in the wild: the Duo pack restates three
  Guidebook creature ids, 59 + 9 merge to 65, campaign pack winning —
  nobody had to be taught anything.
- **The sheet layout ported as the seat's first real arrangement**:
  layouts are data again (`sheet` · `bare`, on `params.layout` — a
  seat renders its assignment and doesn't negotiate), the skills ARE
  the left-hand column, and the statuses panel is the system list with
  a severity box each — a menu of what can happen, not a report of what
  has. Verified live on Barrett Vargas's ported sheet: Poisoned + wrote
  severity 1 through the conditions kind; easing to nothing cleared it
  by the declaration, not by the UI.

Sixth pass — **E settles: the collection is the console** (2026-08-18,
late — Brian pulled it forward the moment its precondition existed):

- **`.panel` is real** (§E above for the format). teller's standard
  collection is a base layer BELOW the system (`core/panels.ts`) — the
  one slot teller declares for itself — and `sourceOf('panels', …)`
  says `teller` until a layer restates the word. Ten panels: two
  arrangements (`sheet`, `bare`) and eight tools. *(Superseded by
  §M-6 the next day: teller now seeds only the five host tools;
  the play screens ride the system layer.)*
- **The console is a directory of the merged collection**, `#panel=`
  routes each panel, and the Screens tool offers the same list when
  assigning — one list, three consumers, the `panes.ts` law kept.
- **The media query is repealed**: `mounted` and `held` are authored
  separately in the declaration, the assignment (or aspect) picks, and
  mounted glass CLIPS overflow — the FitBox law, now in CSS.
- **Plugins management left the CLI**: toggle and config over HTTP
  reload the load path LIVE, so the enable gate and the running set
  cannot drift. §15's "enablement is a human act in the console" is now
  literally true; the CLI flags remain as the headless road.
- **D's open edge closed by contact — the dial beats the arrangement's
  generic word.** Control resolution is `dials[name]` → `block.as` →
  value-shape auto: the system knows Grit is a cylinder; the panel only
  knows it wanted something big. An unknown dial word falls through.
  The cylinder control itself is teller furniture (a radial segmented
  counter, animated), joined the `as` registry; `cards` awaits its
  control the same way.
- **The art pipeline landed** (rule 4a made real): a pack's `art/`
  installs under `art/<pak_id>/…`, references are rewritten to the
  installed key at install time, and bytes serve from `/files/…` behind
  the same ticket law as the stream (an `<img>` can't send headers —
  second subject, same key). The converter now writes `brand` and
  `portraits` records from what the pack carries; the standard sheet
  leads with a `brand` block that renders nothing when no pack brought
  a mark. Verified live: the WiW logo, a Marshal portrait ringed in
  Marshal blue, and Grit as a revolver that turns before the write
  lands.
- **The identity came back, split three ways** (Brian's question
  "does theming belong in the .panel?" — answered no, and the no is
  load-bearing): teller's IDENTITY is tokens in its own stylesheet
  (ink-and-brass, ported from ui.ts); the SYSTEM'S visual vocabulary
  (`accents`, `icons`) is declarations read through the new
  `Loaded.record(slot)` — shallow-merge, later layer wins per key —
  and consumed by blocks (a Marshal's sheet wears Marshal blue from
  the stack, verified live); the `.panel` stays arrangement only,
  never palette, so restating a panel can't fork the look.

### I · Statblock semantics — SETTLED (2026-08-18, Brian): attacks are entities

Found by the console port: the WiW converter flattened every foe's
attacks into ONE `traits` entry whose value is prose — "Melee — Big
Foot (3 Grit): 2B2G damage + Dazed [2] · …" — five machine-relevant
facts per attack (band, name, cost, pool, inflicted status) hiding in
a text field, the recurring bug by its textbook definition. The old
world regex-parsed it back apart (`src/lib/statblock.ts`); the new
world does not get a parser.

Brian, 2026-08-18: **model attacks as actual entities. Words as
words, mechanics as structured info.** §9's own line decides the
shape — anything richer than a name, a value and a ceiling was an
entity all along — so an attack is a CHILD entity of the foe
template, with its own little lists (cost, pool, damage, inflicts);
the statblock renders semantically with zero parsing, and a runner
can offer the attack (propose, never decide — rule 1). The book's own
wording — Features, Trophies, flavor — stays prose and renders as
prose. The fix site is the CONVERTER (re-runnable by design), plus
the statblock renderer learning attack children; design the attack
shape against SYSTEMS.md's actual WiW attack grammar before writing
it.

**The shape (designed 2026-08-18 against the full live bestiary —
every fact fits the existing leaf, nothing new is invented):** an
attack is a child of the foe template, `type: 'attack'`, two lists —
`profile` ({Band (steps: Melee·Short·Long), Cost (count, Grit),
Damage (pool string), AOE (bare), Piercing (count)}) and `inflicts`
(status name → severity, where `Entry.value: number | string` already
carries both `Dazed [2]` and `Afraid [4B]`). The system declares the
kinds; the statblock groups bands by the declared step order. Found
alongside: **Tolerances is mechanics-in-text too** (`Afraid [3G],
Burned [2B]`) and becomes a plain `tolerances` list of entries — no
children needed; Features/Trophies/Frenzy are genuinely words and
stay prose. Prerequisite: `Template`/`toTemplate` (core/stamp.ts)
currently DROP children while `resolve()` already recurses them —
the template learns to carry what resolution already honors. The
parse happens ONCE, in the converter, at the boundary — never at
render.

### J · Dice are a record — designed 2026-08-18, not yet built

The old world already settled where dice live (rule 4: in the system
row, as data) and the shape is proven — port it, don't redesign it.
`worker/templates.ts` (old, reference): `dice: { faces: {B: [...6
face names], G: [...]}, values: {hit: 1, ace: 2, blank: 0, spur: 0},
unit: 'Hits', track: 6, trackBonus: 1, banks: [{face: 'ace', counter:
'Aces'}] }` — plus the documented subtlety that Spurs are NOT in a
reroll list because teller rolls for foes and foes have no Talents; a
player reading their own Talent simply rolls again.

In the new world this is a **`dice` record on the system layer** —
shallow-merged, later wins, like accents and dials. The generic
`/api/stack/record/<type>` endpoint already serves any slot, so the
server needs NOTHING. The work is: the converter writes the record
from the old system row; the client consumes it — interactive
DicePool (die art, tap-to-cycle faces, tally in `unit`), SkillRow
face-awareness, and the runner ROLLING for foes (crypto-random over
`faces`, sum by `values`, written into turn scores as proposals a
human can drag past — rule 1). `marks` (Talents) ports the same way:
a `marks` record, the ✶-box rendering, `banks` wiring Ace faces to
the Aces counter. Blocked only on the converter being free
(builder-attacks owns it today).

### K · Carried things — SETTLED (2026-08-19, with Brian): items are flat children; containment is always refs

The catalog already converted entity-shaped (301 templates —
weapon/ammo/ability/gear/trap/service, stats as entries), so "what is
an item" was answered before the question was asked. What K settles is
how CARRIED items behave:

- **A carried item is a child entity of the character, stamped from
  the catalog** — §14's stamp, applied to children: thin, `refs.from`
  → the template, stats read through `resolve()`, the instance's own
  lists carrying only what is the instance's own (rounds loaded, uses
  left, notes). Buying or picking = stamping a child; homebrew = a
  thick child. Attacks proved the machinery; items reuse it whole.
- **Items are FLAT children — containment is always refs, never
  nesting** (Brian, 2026-08-19). §9's inline criterion cuts this way
  itself: the outside world addresses upgrades (inventory lists them,
  kitbash moves them), so they are not inline. A weapon's chambered
  ammo is `refs.chambered` → the ammo child; its fittings are
  `refs.upgrades` → an ordered ref list. Fit/unfit and chambering are
  the SAME kind of edit — a ref flip — and an upgrade never teleports
  between containers; the Inventory screen shows the complete asset
  roster, fitted pieces wearing a "fitted to …" chip. A dangling ref
  renders as missing, never silently dropped.
- **Ammo counts live on the ammo item** ("Items merely counts the
  rounds" — the old design's own words): an ammo child's value/max,
  fired from any compatible weapon.
- **Stamped thin, stored-wins on touch**: a catalog correction
  reaches every carried Used Pistol until an edit copies down — then
  the table's copy is authoritative (rule 1; identical to foes).
- **The fire button is flow, not shape**: read Grit + range pool
  through resolve, PROPOSE the Grit spend and the ammo decrement into
  ordinary slots, a human confirms. One-slot-per-upgrade-type is
  presented, never enforced.
- **Deferred, noted**: the mounted-weapon crewed Grit DEBT ("operator
  2 pays from their NEXT turn" — nothing models a deferred spend, and
  the old world punted too) and dual-pistol slot pooling (two items;
  probably fine forever).
- **Two things are called "a child" and only one is a thing you
  carry** (found by the spends work, 2026-08-19): `POST /api/stamp`
  with `parentId` makes a STORED entity row in the campaign's parent
  tree (the roster's shape); a CARRIED thing is an inline child of
  the character's own blob — §K's kind. Client code that gives a
  character something goes through `addChild()` in
  `client/lib/refs.ts`, never the stamp route. Also noted there:
  a multi-write SpendPlan applies one entry at a time (cost first) —
  not atomic; a failed later write leaves ordinary, fixable values,
  and atomicity would be a server-side batch door if ever wanted.
  And SYSTEMS.md §15's `rep_` field-prefix scheme is SUPERSEDED:
  standings are entries in a ladder-named list, off-default storage
  via the `steps` kind's resting rung.

**CARRY STATES LANDED 2026-08-24** — where a thing is, what that
changes, and what it costs to change it. Four pieces, and every rule in
them arrives as data:

- **A carry state is a ref ON THE PERSON** (`refs.worn`, `refs.wielded`,
  `refs.holstered`), which is §K's own law applied one level out:
  containment is refs, and "held" is containment. The vocabulary is the
  system's `carry` record (`core/carry.ts`) — states with a count limit
  or a HANDS budget, the stat a thing prices itself in
  (`handsStat`/`hands`), the kinds that are carried at all, which state
  `amends` its carrier, and what a swap into a state costs. teller
  enforces nothing: a state over its budget is REPORTED on the tiles in
  it, in the system's own sentence, and the swap price is a one-tap
  proposal that debits through the ordinary entry door.
- **The hands budget is doing the work of three printed rules.** "One
  weapon unless you're dual-wielding pistols" and "two-handed gear pairs
  with nothing" are the same arithmetic once a thing says how many hands
  it takes — so the declaration needs no exception list, and the shelf's
  catalogue grew a `Hands` stat on the things that take two.
- **Defense reads what's WORN** — the seam `client/lib/amend.ts` left
  open, wired: an amending state's items contribute their template
  effects to the CARRIER's stats through the same `amendStats` a
  weapon's pools go through, and the plate's popover shows the ledger
  ("0 innate · Defense +1G Basic Armor"). No type filter: anything worn
  and effect-bearing counts. Core learned one thing to make it work —
  **zero is the EMPTY pool**, so a printed `0` can be amended at all.
- **A weapon's trigger became one button per BAND** (`core/bands.ts` —
  the ladder moved here from `server/geometry.ts`, one parser for one
  declaration). The rungs a thing reaches are its printed stats matched
  to the system's `bands` by the same name-matching effects use, and
  **a rung that begins away from you is one you reach across** — which
  is what tells a knife from a pistol without any weapon carrying a
  flag. Pressing one opens the dice (`DicePool`, summoned, `DiceFloor`
  beneath — extracted from the runner rather than copied), records a
  `dice.rolled`, and spends the ledger exactly once. `POST /api/rolls`
  now accepts a SEAT filing its own roll, the same shape the turn door
  already takes for a score.

- **An armed move's GRANT is said where it applies, and carried out
  where teller may** (added 2026-08-24, Brian). The door names what's
  armed — a chip per move, wearing the system's own words — and a move
  that lets you throw a die again says so with a NUMBER on the action
  record (`reroll: 1`), never by anyone reading its prose: the same
  grant is written twice, once for a person and once for the surface,
  and parsing the first is the mechanics-in-text bug §I is named after.
  Over real dice the grant stays a HINT (you throw the die in your hand
  and retype the face — there is nothing for teller to do); over dice
  teller threw it becomes a button per die, spent once, and declining
  is the default. The reroll rides into the record honestly
  (`RollRecord.rerolls` — what it was, what it became, what granted
  it), because a pool that quietly improved between the throw and the
  record is a history that lies to the one reader who can't ask.

Gaps flagged, deliberately not invented: **throwable-to-Short** exists
only as pack prose ("melee weapons can be thrown to Short Range"), so a
melee weapon offers only the rungs it prints — a per-weapon flag would
be teller guessing. And **ammo-vs-weapon compatibility** ("don't shoot
arrows from a shotgun") is nowhere in the data; the chamber select is
scoped to weapons that reach across ground and no further. Both want an
optional pack field before either can be honest.

**The `cards` control got its body** (2026-08-24), which §D's contact
log had been waiting on: teller ships a small registry of FLOOR dial
controls, each declaring its own fitness, and `dialFace()` is the one
resolution — the system's face first, teller's floor second, the
arrangement's `as` after that. **A declared dial now beats a shape
heuristic**: the Ace tally was being caught by `boxable` and drawn as
tick boxes although the system had asked for a hand of cards. What
`shaped()` decides is deliberately NOT generalized — that is which
counters earn a place on the printed sheet, a different question from
what a dial draws as.

### L · The library conflation — SETTLED in principle (2026-08-19, Brian), migration phased

"StatusPanel, HealthPanel, DicePool, Vitals… those are NOT generic
things. Those ARE specific to WiW, and should be contained within its
scope. Eventually we will have other systems, and they don't all have
vitals, or statuses, or health."

He's right, and the error has a name: **data-generic was conflated
with belongs-to-teller.** A component parameterized by records is
still VOCABULARY — HealthPanel is the WiW printed sheet's health box,
the Cylinder is a revolver — and vocabulary lives on the system
layer. These components sit in teller's client for one historical
reason: the library was ported from an app built for one WiW table.

**Target state:** teller ships only shape-derived, neutral primitives
(bars, steppers, chips, ledger rows, the floor — a capped counter
with no system-supplied face falls back to a bar); a SYSTEM ships its
presentations as pack-carried CODE — the panel compile/trust
machinery generalized to packs, same sweep, same esbuild, same gate —
and the `dials`/`pins` records summon pack-supplied components by
name exactly as they summon by name today. Panels compose from the
system's vocabulary plus teller's primitives.

**Why phased:** the WiW components are consumed by teller furniture
today (the standard sheet's faces, roster cards, the runner stage),
so they cannot leave the client until packs can carry code. Order:
(1) packs get the compile/trust machinery; (2) WiW presentations
migrate from `client/components/` into the WiW pack, teller's library
slims to the neutral floor; (3) the summoning seam — a record naming
a presentation resolves pack-supplied first, teller fallback second,
same later-wins stack as everything else. Until (2) lands, the
library's WiW-flavored pieces are understood as SQUATTERS, not
precedent — the boundary question ("is this primitive neutral, or
WiW wearing teller's badge?") gets asked every time the library
grows.

**Step 0 landed (2026-08-19): a pack is a FOLDER again.** Before packs
can carry code they have to be somewhere a person can put code, and in
the new world they weren't — pack and system content existed only as
converter-written `shelf.db` rows, so every WiW vocabulary edit was a
round trip through `scripts/convert-pack.mjs` and a restart. Now
`~/.teller-next/packs/<name>/` is swept by `core/packs-shelf.ts` and a
folder BEATS a row of the same id, which is what makes the migration
safe one pack at a time: anything not yet folder-ized still loads from
the database, and the shadowed rows cost nothing.

The format is rule 4a's, extended by exactly one file: **`system.json`**
beside `pack.json`, carrying the `sys_` id and the record slots inline,
so one folder yields both shelf entities the way the converter always
produced both from one source. Every other `*.json` is a slot named by
its file — the file split stays a serialization, and `boot.ts` never
learned it happened. `POST /api/shelf/sweep` is the door (DM only,
answers with the load report); the plugin-enable POST stops doing double
duty as a rebuild.

What the later phases inherit: the folder is now the obvious home for a
system's presentation CODE — `packs/<name>/presentations/*.tsx` compiled
by the same esbuild pass and gated by the same trust row
`panels-shelf.ts` already reuses, one sweep, no second machinery.
Nothing about that was built here, and the seam is the sweep itself.

**Steps 1–3 landed (2026-08-19). The migration is done; the demotion
is the part that's still pending.**

*Step 1 — a pack carries code.* `core/compile.ts` is the one esbuild
pass both shelves share, differing in exactly one thing: what a file
may import. `PANEL_IMPORTS` is react + react/jsx-runtime + teller +
`system`; `PACK_IMPORTS` is the neutral three and **not** `system`,
because a pack's presentations ARE the system and the cycle would be
incoherent — leaving it out of the externals IS the enforcement, and
esbuild says so out loud in the load report. `/pack-code/<pak_id>/…`
serves `.build` output only; `/pack-code/system.js` is GENERATED per
request from whatever the campaign's trusted packs resolve to, so it
can never drift from what's loaded, and it answers `export {};` rather
than 404 when there's nothing — importing `system` must never break a
panel.

*Step 2 — the components moved.* `Cylinder`, `HealthPanel`,
`StatusPanel` and `DicePool` moved to
`~/.teller-next/packs/wiw-guidebook/presentations/`, one file each,
**filename = export name = the name a record summons**. (They moved
AGAIN when the system/pack split landed — §M-4's sort sent the
unbranded four to `systems/wiw/`, and §M-3's second correction sent
the Cylinder back to the pack, where it now stays.) They import
`teller` for the neutral parts (`SheetPanel`, the dice helpers) and
carry no facts: entity, records and the write door all arrive as props.

*Step 3 — the summoning seam.* `client/lib/presentations.ts` is the one
place that answers "what draws a thing called X?", and every caller goes
through it: `presentationOf(name) → system[Name] ?? fallback[Name] ??
undefined`. A `dials` word resolves both spellings (`"cylinder"` and
`Cylinder.tsx`) so a pack needn't choose. Every consumer has an answer
for `undefined` and it is the FLOOR: a pinned or dialled counter with no
face draws as a stepper, a `statuses` block with no face draws the
stored list in the floor's own grammar. Verified by disabling the pack's
trust and emptying the fallback — the sheet degrades to bars and chips
and every number stays present and editable. That screenshot is "other
systems don't all have vitals" made visible.

**What is NOT done, and is deliberately not done: the deletion.**
teller's copies of the four are still in `client/components/`, still
exported from `client/runtime/teller.ts` (marked deprecated, pointing
at `system`), and still wired as `FALLBACK_PRESENTATIONS`. They are
DEMOTED, not resident: the map is the transitional floor so this phase
regressed nothing on a day nobody asked it to. **Emptying that map is
phase 3.5** — a one-line change, plus deleting four files and four
export lines — and it should happen when a second system exists to
prove the point. Until then the boundary question stays live: the
library's WiW-flavoured pieces are squatters with a notice served, not
precedent.

Two things flagged in passing rather than churned now:

- **`SkillRow`** stays in the library, but its dice-track and starburst
  are WiW-born. It degrades to a plain row when no `dice` record exists,
  which is the neutral behaviour, so it isn't wrong — it's the next
  candidate. Same for `SheetPanel`'s corner-tick plate, which is one
  book's page furniture teller happens to draw.
- **`dialable()`** (a ring past twelve chambers stops being countable)
  gates EVERY dial, not just the cylinder — one face's constraint
  wearing the seam's clothes. The honest fix is a face declaring its own
  fitness.

**Second landmine, found by phase 3.5 landing** (2026-08-19, evening —
the giant Grit): **shelf-carried code cannot rely on teller's Tailwind
utilities.** teller's stylesheet is generated by scanning teller's OWN
sources; a class in a pack/system presentation is only styled if the
app happens to use the same utility somewhere. While the four §L twins
lived in `client/components/` their classes were generated FOR the
shelf copies by coincidence — deleting the twins deleted fourteen
utilities out from under the shelf's files, and the Cylinder's
`max-w-[min(13rem,60cqw)]` cap vanished, which is why the revolver
swallowed the roster. The law: **in shelf code, layout that must hold
rides `style`, not a utility class** — inline styles owe nothing to
anyone's build. All four presentation files were converted the same
evening. Open question for later: whether the sweep should LINT for
this (warn when compiled shelf code carries class strings teller's CSS
doesn't define), or whether packs grow their own `style.css` support
the way panels already have one.

**Client tests: deferred on purpose** (2026-08-20, Brian: "fine
leaving out for now"). `vitest` covers `core/`, `server/` and
`scripts/`; nothing tests the React client, and that is a DECISION,
not an accident: component tests are real machinery for a pre-alpha UI
still being reshaped weekly, and the browser-verification discipline
(verify live, screenshot, restore state) is carrying that load for
now. The giant-Grit incident is the cost of this posture, recorded
above. Revisit when the client's shape settles — the first candidates
are `client/lib/`'s pure logic (face counting, art maps, the stream
election's timing rules), which need only a jsdom project, not a
component harness.

**Landmine found and fixed on the way through** (2026-08-19), because
it would have made all of this dead on arrival in a released teller:
`vite.client.config.ts` now sets `preserveEntrySignatures: 'strict'`.
Vite's app default is `false`, which treats every entry as a script
nobody imports and licenses Rollup to rename or drop its exports — and
it did both. The built `runtime-teller.js` was emitting
`export{lt as G, Ct as P, …}`, so EVERY panel and pack module failed to
link in production with "does not provide an export named 'SheetPanel'",
while dev (which serves the transformed source, exports intact) looked
perfect. The `wiw-sheet` panel had been rendering its
code-failed-to-load refusal in every build since rung 4 landed and
nobody had looked at a built client. **The rung-4/§L import contract is
a public API and its entry signature is load-bearing — say so in the
bundler config, or the bundler will assume otherwise.**

### M · The grand scope, re-drawn — RATIFIED 2026-08-19 (Brian: "commit to it and let's make it happen")

Two days of locally-right decisions quietly turned teller into a
platform; this section makes that deliberate, and it amends the
thesis itself. This IS the constitution now — the ARCHITECTURE rewrite and the
CLAUDE.md fold happen against it.

**1 · The simulation ban is repealed. The manual floor is the
contract.** (Brian: "It should be able to fully simulate everything.
It just shouldn't be required. As a base teller core, it just works.
All manual. All user driven. Done.")

The old sentence "teller is not a simulation engine" was amended
twice and both times the survivor was the AUTHORITY half, never the
capability half. So, finally said straight: **simulation capacity is
unlimited; simulation requirement is zero.** Base teller works fully
manual forever — that floor is a contract, not a starting point. A
system may automate as much as it likes ABOVE the floor, and the
**automation level is a table setting** — manual by default, dialed
up per table, per taste. Rule 1 does not bend for any of it: every
automated result lands in a slot a human can overtype, the event log
carries it, and teller still never decides what nobody can change.
The thesis's play-half ("what's physical stays physical") becomes the
DEFAULT POSTURE of the shipped floor, not a ceiling on what a system
may build.

**2 · The containers, final form.** One kernel, four kinds of cargo,
one merge:

- **teller (the kernel)** — storage, the merge, the event log,
  roles/pairing, the neutral floor, the small evaluators (dice,
  effects), sweep/compile/trust, the frozen import contract. Owns no
  game, ships no vocabulary. "Ships empty" is now a product
  description, not just an IP rule.
- **A SYSTEM — pure function, zero IP.** The logic and code (or just
  declarations — a system that is one JSON file is a full citizen)
  for running one game on the kernel: kinds, dice, effects, mechanics
  code, and PANELS — functional, unbranded ("here's the encounters
  panel and how it works", "a generic character panel", "the NPC
  details layout"), with assets only where function demands them. No
  prose, no book art, no branding. **Consequence, load-bearing:
  mechanics aren't protectable expression, so a no-IP system is
  freely distributable by ANYONE** — the community-distribution
  deferral, grown teeth. One system active per campaign; the system
  is a LAYER in the merge.
- **A PACK — the book's stuff, rights follow it.** Monsters, NPCs,
  items, stores, prose, art — and BRANDED panels, each its own
  self-contained collection of code/art/rules. Rule 4 unchanged:
  what a pack may carry is its author's affair; who may hand it on
  follows the content.
- **A PLUGIN — art-agnostic extended function**, usable with any
  system: the assistant, a soundboard, a dice camera. NOT in the
  merge — it provides at registry points (§15). Any number per
  table.
- **A STORY** — one table's arrangement, referencing everything by
  id (unchanged; TEL-87 still owns its manifest questions).
- **The TABLE'S layer** — the host's own panels folder, the
  campaign's overrides — always wins (rule 1 for everything).

The merge, after: **teller floor < system (function) < packs
(content, declared order) < campaign < table.**

**Systems vs plugins — same plumbing, different role.** Folders,
sweep, esbuild, trust rows: identical machinery. The distinction is
two properties, both crisp: CARDINALITY (one system — it IS the
game's identity; N plugins) and POSITION (the system rides the
merge and owns vocabulary; a plugin never touches the merge and
provides only at points). Do not collapse the concepts.

**A pack CARRYING a plugin — deferred by contact rule, shape noted
(2026-08-20, Brian: "a pack can probably contain whatever the author
wants… maybe that's okay? idk").** The synthesis that keeps both laws:
a pack may carry a plugin as CARGO, the way it carries panels — rule 4
governs contents ("whatever its author has the right to put in it") —
while the plugin still BEHAVES as a plugin: loads through the plugin
machinery, provides at points, never rides the merge. The wrinkle that
stops it being built casually is trust: pack-carried PANELS ride the
pack's toggle because panel code runs in browsers, but a plugin runs
on the HOST and declares `needs` — folding that into the pack's one
checkbox would grant host-side capability nobody read about, so a
carried plugin wants its own app-permissions moment. Decide when a
real pack wants to ship one — the natural first customer is TEL-108's
encounter-builder tuned to WiW. Until then, content REQUIRING a
plugin by ref (§15 — a claim, never a grant) covers the actual need.

**3 · The function/flavor line — CORRECTED (2026-08-19, the
Cylinder), then FINISHED (2026-08-20, the Cylinder again).** The
first sort used "function vs flavor" and put the revolver in the
pack; Brian's correction exposed that as a PROXY for the real test:
**rights**. *Can this container's author freely share everything in
it?* **Theme ≠ IP: a system may have all the personality its author
owns; what it may not carry is anything only a rightsholder could
hand on.** That stands — as a CEILING. What the next day added
(Brian: "it's weird that there is one piece of branded thing in all
of the default system") is that the ceiling was being read as a
placement rule, and it isn't: **rights answer what a container MAY
carry; they don't say what the default SHOULD look like.** The
Cylinder's personality is Brian's own invention and could legally
live anywhere — and it moved to the PACK anyway, because the system
should read fully generic and the book's face rides with the book.
Two questions at every future sort, in order: "whose is this,
really?" bounds where it MAY go; "does the unbranded layer want to
wear it?" decides where it DOES. (Sorted: StatusPanel, HealthPanel,
DicePool, SpendMenu, LadderPanel → system; Cylinder → pack, both
tests agreeing with the very first instinct after all.)

**4 · On disk, eventually** — a fourth shelf dir:

```
~/.teller-next/
├── systems/wiw/        function: declarations + mechanics code +
│                       unbranded panels   (freely shareable)
├── packs/wiw-guidebook/ content: bestiary, art, sections, branded
│                       panels             (rights follow content)
├── plugins/            cross-system function
├── panels/             the table's own furniture + teller's two
└── campaigns/          the facts
```

Today's `packs/wiw-guidebook/` merges both halves (`system.json`
inside the pack folder — phase 1's right-for-the-migration choice,
now known-temporary). The split is a folder move plus the sweep
learning `systems/`; nothing about the loaded model changes.

**LANDED on disk, 2026-08-19.** `core/systems-shelf.ts` sweeps
`~/.teller-next/systems/<name>/` — `system.json` (read by the SAME
`systemFrom` a pack-embedded one is, so the reserved-keys rule has one
implementation), `presentations/*.tsx` (the shared `core/compile.ts`
pass, `PACK_IMPORTS` — no bare-`system` self-import, though §M-4a
now opens the narrower `system/<name>` door), `panels/`
(ordinary `.panel` folders via a `sweepPanelsIn` extracted for the
purpose; their declarations ride the system layer's `panels` slot and
their code takes the same trust row), and `art/` (installed under
`art/<sys_id>/…`, the pack copier reused). Precedence per id:
**`systems/<name>/` > pack-folder-embedded `system.json` > `shelf.db`
row** — the fallback is tested, so an export written before today keeps
working. Trust is one `pluginTrust` row keyed by the `sys_` id; the
`/pack-code/` and `/panel-code/` routes gained a second place to look
rather than a second route, and `POST /api/plugins/<sys_id>` is the
toggle. `sys_wiw`'s row was enabled by hand on Brian's own shelf (his
own files, rule 7's "a table's own files are its own").

`Loaded#presentations()` now merges **system first, then packs in
declared order, later winning** — brand beats generic on a name
collision, never the reverse. (The revolver was the motivating case;
since its 2026-08-20 re-sort there's no system dial under it, but the
order is what lets any pack skin any system name.)

**The sort calls, one line each** (the code was the evidence, not the
header comments — every one of these files was *described* as the
book's face while containing no branded string):

- `StatusPanel.tsx` → **system**. Severity-counted statuses with a named
  relief is the mechanic; the names and reliefs arrive as declarations.
- `HealthPanel.tsx` → **system**. A capped gauge with declared pins
  beside it. Nothing in it names Health or Defense — `pins` does.
- `DicePool.tsx` → **system**. The `dice` record is system data and this
  draws it. *Known gap recorded in the file*: the special die is tinted
  by a hardcoded `letter === "G"` — a mechanic hiding in a comparison;
  the fix is a per-die accent in the record.
- `SpendMenu.tsx` → **system**. The judgment call §M expected: the
  header claimed the book (p. 32–34, Tenderfoot…Legend), but the tier
  names, purchases, costs and words all arrive from `spends`, and the
  arithmetic was already teller's. Unbranded code drawing a declared
  ladder = function.
- `LadderPanel.tsx` → **system**, same test. Rungs, modifiers and the
  roster are all data; the parties and their write-ups stay pack-side in
  `sections.json`.
- `Cylinder.tsx` → **the pack**, finally and settled (2026-08-20,
  Brian — after a day in the system under the rights reading; see
  point 3's second correction). The six-slot reloading dial is a
  mechanic the system DECLARES (`dials: {…: "cylinder"}`); the
  revolver drawing it is the book's face and ships with the book.

Next steps this leaves: (1) ~~the system has no unbranded `Cylinder`
for the pack to skin~~ — DISSOLVED 2026-08-20 rather than filled: no
unbranded system dial gets built, deliberately. A host with the
system and no pack falls through to teller's stepper floor for the
dial, which is the floor doing its job — a +/− that always works
beats a de-branded revolver nobody asked for; (2) `client/lib/presentations.ts`'s
`FALLBACK_PRESENTATIONS` is still §L's transitional floor, and phase 3.5
(emptying it) is now cheaper to argue for, since a *system* exists to
own those files; (3) nothing yet exports a `.system` archive — Door 2/3
above still stand, and the folder is the only serialization.

**4a · The system's export surface — packs build on declared
function** (2026-08-20, Brian, ratified in conversation; the relative
form was argued and he took it: "yeah okay, go for it").

A system may publish code for the packs that run on it. The
declaration is a directory: **`exports/*.ts(x)`** on the system's
shelf, swept and compiled exactly like presentations, the filename the
export name. Pack code imports it as **`system/<name>`** — a RELATIVE
reference into the pack's *declared* system, never a search. The
system id is spelled once, in `pack.json`; the import grammar cannot
restate it, so the declaration and the import can never disagree.
(Brian proposed `system:wiw:creation` for disambiguation; the
namespace he wanted turned out to already exist — it IS `pack.json`'s
`system` field — and baking the id into every specifier would have
added a representable mismatch plus a sed-sweep on every house-fork.
Spelled with a slash, not a colon, because import maps resolve prefix
mappings natively on `/`.)

- **Resolution follows the bare-`system` trick**: import-map prefix →
  a no-store shim per export → the stamped immutable module. The
  active system can change at runtime and the shim always points at
  whoever is active.
- **Bare `system` (the merged presentation index) stays closed to
  pack PRESENTATIONS.** A presentation importing the merge it rides
  in is a cycle by construction. Sharpened 2026-08-24 (the docs fold
  found the wording wider than the code): pack PANELS may import bare
  `system` like any panel code — a panel never rides the presentation
  index, so no cycle is possible; `PACK_IMPORTS` (presentations) and
  `PANEL_IMPORTS` (panels, any layer) differ on exactly this point
  and both are right. `system/<name>` is safe for everyone:
  `exports/` is system-tier only, so that arrow only ever points DOWN
  the merge.
- **A missing export refuses out loud, at load** — a problem-report
  entry and a labeled render-site refusal naming all three parties:
  "wiw-guidebook needs `creation` from wiw, which this version doesn't
  export." Same idiom as dangling includes. **No version ranges,
  deliberately** — the refusal tells you to update the system;
  dependency resolution is not being built, and if that ever hurts we
  add it then, not now.
- **The fork property**: house-fork a system under a new id, keep
  exporting the same names, update `pack.json`'s one field, and every
  pack import keeps working. The requirement is on the surface, not on
  the bytes that shipped it.
- **Flat names are a convention engine**: `system/creation` can mean
  "this system's character-creation engine" in every ecosystem —
  WiW's and a future DnD's packs spell the identical specifier and
  each gets their own. Docs and examples stay portable across games.

First customer: **creation phase 2**. The engine moves from the WiW
system's `presentations/creation.ts` to `exports/creation.ts` (the
dialog keeps a relative import — bundled, as ever), and the
Guidebook's branded rail builder ("what's yer trade?") arrives as a
PACK panel importing `system/creation`. One small composite-grammar
companion ships with it: an optional **`draft` key on the composite**
naming a panel that takes the seat over while the subject entity
carries the draft flag — absent, the floor is today's behavior
unchanged. That is how a pack's builder gets the whole strip during
creation and hands it back at "saddle up."

**5 · Guard rails restated**, so the platform stays teller:

- Everything computes; everything PROPOSES-or-is-overridable;
  nothing decides what a human can't change. This binds system and
  plugin code exactly as it binds teller.
- The manual floor is compatibility law too: teller's own bundle
  never requires what the fanciest rung needs (the import-map
  lesson), and a campaign with a data-only system plays fully.
- Trust gates every arrival of outside code — system, pack panel,
  plugin — one human toggle each; a table's own files are its own.
- The one-table test: none of this platform shape may cost the
  actual Wednesday table. Build single-table-first; the platform is
  what falls out.

**5a · The seat dissolves into files — composites, and five chrome
seams** (2026-08-20, Brian, ratified in conversation: "that NEEDS to
be in the wiw character panel… the navigation should be in the panel
also… so long as we can override the you're-up ring, note banner,
glass container… I'd like things to be as modular as possible").

The seat's chrome was the last un-authorable surface — plate, cost
chips and the segmented bar hardcoded in `SeatChrome` while every
screen behind them rode the ladder. It dissolves along the same line
as everything else: **facts stay teller's, rendering is summonable.**

- **Five seams**, each a presentation resolved system-first,
  pack-override, teller floor: `Header` (identity + chips),
  `ScreenBar` (tabs/current/onGo as props — teller assembles the tab
  LIST, the theme only draws it), `TurnCall` ({up, onDeck, rolling,
  submitScore} in; a ring, a banner, a spinning revolver out),
  `NoteBanner` (payload + dismiss in), `SeatFrame` (the container's
  look). A theme may quiet or even suppress a delivery affordance —
  rule 1 for UI, the author's own table.
- **One law stays structural, not themeable**: the outer glass clip.
  Mounted glass never page-scrolls, and teller holds the overflow
  boundary OUTSIDE whatever the frame renders — rule 6 enforced by
  the frame the author renders within, the same way the effects
  vocabulary enforces rule 3 on plugins.
- **The COMPOSITE panel** declares the seat: subject `entity`, an
  ordered `tabs` list of panel NAMES, and an optional `chrome` map
  naming seam presentations. Three refinements are load-bearing:
  (1) sub-panels merge independently by name — a pack restates one
  screen without owning the set, and the composite itself merges by
  name so a table reorders everyone's tabs in four lines of json;
  (2) **strays surface**: an entity-subject panel not listed in
  `tabs` APPENDS rather than vanishing (the `rest` law applied to
  navigation; explicit exclusion exists for the author who means it);
  (3) `chrome` keys are OVERRIDE hooks, not requirements — absent,
  each seam resolves the normal way, so the themed set arrives with
  zero composite edits.
- Consequences: `More` stops being code and becomes a system `.panel`
  file; the carried screens enter the same tab namespace; and with NO
  composite declared the floor is exactly the SHIPPED old behavior —
  the assigned arrangement as 'Sheet', the declared carried screens,
  provided panes, and More — so a data-only system loses nothing.
  (First drafted as "every entity panel a tab", which was a paraphrase
  the build correctly declined to invent; the floor is what was, not
  what a summary said. Corrected 2026-08-20.)

**A seat takes no layout** (2026-08-20, Brian, ratified in
conversation). A seat screen takes exactly two things from the DM —
the role, and which character — and the Screens tool's "layout"
dropdown on a seat row offered it every entity-subject panel as a
choice: `Seat`, `Character Sheet`, `Sheet`, `Shop`, `More`, as though
any of those were a way to arrange a seat. That was the console-pane
law (a pane nobody can be assigned to is a pane that doesn't exist)
leaking into a role it was never written for. **Panels are offered in
exactly ONE dropdown — the console role's pane picker — and nowhere
else.** The seat resolves its own shape instead: the merged
collection's entity-subject panel carrying `tabs` if one exists, and
otherwise the floor assembly around `sheet`, unchanged. More than one
composite is possible, so the tie-break is stated rather than left to
the sweep's folder order — the one named `seat`, else the lowest
`order`, else the earliest in the merge — and it lives in core beside
`draftTakeover` (`seatComposite`). `params.layout` is retired for
seats: no longer read, and no stored value touched, because nobody's
display should need a migration to stop being asked a question that
was never theirs.

**5a′ · The include — panels nest, atoms stay atoms** (2026-08-20,
Brian: "everything becomes just modular levels of nested panels…
[and] this doesn't stop people from just not using panels like this").

A new block noun, `{ block: 'panel', name: '…' }`: an arrangement may
include another panel by name, inheriting the subject/records/write
context it's placed in. Every level of COMPOSITION is now a named,
mergeable file — composite → tabs → fragments → fragments — and
later-wins reaches INSIDE arrangements: a pack restating
`vitals-strip` updates every arrangement that includes it, without
those arrangements being restated. The honest floor: blocks are the
atoms and the include — `list`, `header`, `statuses` are renderer
primitives, the alphabet something must eventually draw with. Guards:

- **Fragments aren't surfaces.** `surface: false` on a declaration:
  merged and overridable as ever, never offered as a tab, a console
  pane, or an assignment. The panes.ts law, inverted on purpose — a
  fragment is deliberately not a place anyone can be pointed.
- **Cycles and dangling includes refuse out loud** — a labeled
  refusal in the load report and at the render site, never a crash,
  never a blank.
- **Trust never launders through an include** — each panel's code
  gates on its own row, exactly as before.

And the property that keeps it teller's (Brian, same conversation):
**the grammar is an offer, not a discipline.** A rung-5 takeover that
draws its own header, tabs and everything inside remains fully legal —
one panel that chose to be opaque. Includes exist for the author who
wants some pieces custom and the rest default, mixing freely, because
an include resolves whatever the name merges to without caring which
rung built it.

**6 · The play screens are the system's** (2026-08-19, Brian, the
first cut made under this section — "when you load a system, it adds
the extra console screens it needs").

teller seeds ONLY the host-level tools — **boards, log, plugins,
screens, shelf**: the screens about the HOST (its glass, its files,
its layers, its history), which are meaningful on a bare install and
say nothing about any game. Everything that's about PLAY — roster,
runner, encounters, bestiary, rules, and the entity arrangements
(`sheet`, `bare`) — is a **system-layer declaration**: a system ships
them as `panels/<name>/` folders on its own shelf (§15-adjacent
machinery that already existed in `core/systems-shelf.ts`), and the
console's tab bar is still nothing but the merged `panels` slot
filtered by subject. The tool IMPLEMENTATIONS stay in teller's client
registry — a system's roster declaration is one small file naming a
teller tool — and a system wanting a different runner restates the
name and wins, as ever.

This sharpens where point 1's floor ATTACHES, without touching its
capacity/requirement language: **the manual floor is per-block
degradation within a resolved system, not a systemless play path.** A
host with no system is a host mid-setup — five tabs, a shelf that
says so, nowhere to put a fight — and that's correct, because "sit
down and play with nothing" was never a real table; every table has
a system, even if that system is one json file of pure vocabulary.
Which is the escape hatch, and it's already sanctioned: a zero-IP
"starter" system that declares the generic screens and nothing else
is freely distributable BY CONSTRUCTION (point 3), so the fully
generic manual table still exists — as a file on the shelf, not as a
hardcode in the kernel. The floor lives one layer up now, and it
lives there as data.

What was found the same day, and survives the move: teller's default
`sheet` declaration renders no identity block — a card is skills,
resources and statuses, and never the NAME — and offers no way to
hand-add an entry. That's now the shipping system-layer sheet's bug
to fix (WiW's, and the starter's when it exists), not the kernel's;
noted here so it doesn't get lost in the handoff between layers.
(There IS a `header` block in the grammar — name, type, portrait —
the declaration just never asked for it; Brian is adding it by hand,
which is the ladder working as designed.)

**Packs carry panels too** (same day, the moment the sort test was
applied to a real file): `packs/<name>/panels/` sweeps exactly as a
system's does, the declarations ride the PACK's layer — so a pack's
panel beats the system's on a name collision, branded over unbranded,
which is the point — and panel code takes the pack's trust. The
`wiw-sheet` panel moved off the table's shelf into the Guidebook pack
where it always belonged: it is the BOOK's sheet (its layout
language, its look), and "whose is this, really?" answers `pak_`, not
`panels/`. The table's `panels/` dir now holds only teller's five
seeds plus whatever a table writes for itself.

Two wrinkles found by this work — **both DISSOLVED the same day by
the layer split** (Brian: "there needs to be a different spot for
default panels… then it follows the hierarchy of overrides, all the
way up to the TABLE panels"):

- **Defaults ship WITH teller** — real `.panel` folders in the repo
  (`defaults/panels/`), loaded from the INSTALL as the floor layer,
  versioned and upgraded with the software. Seeding into the data
  dir is GONE, and with it both wrinkles: nothing is ever written
  into `panels/` by teller, so nothing goes stale and nothing
  resurrects. "The defaults are .panel files too" stays literally
  true — open the install and read them.
- **The data dir's `panels/` is the TABLE layer, at the TOP.** The
  full merge order, finally rule-1-shaped end to end:
  `teller (install) < system < packs < campaign < table` — the
  table restating ANY name wins, including a default's and a
  system's. The counterargument was heard and priced (edit-in-place
  on a seeded copy dies; discovery from an empty dir costs): the
  five host tools are FURNITURE, which wants to upgrade with the
  software, and customizing one becomes copy-up-and-restate. The
  concession owed: a **copy-to-table affordance** in the console, so
  discovering and duplicating a default never requires finding the
  install dir. Queued, not built.

**6b · The starter system ships too — the floor got a floor**
(2026-08-21, built against this section rather than decided anew).

§M-6 left a hole its own logic had opened: the play screens moved to
the system layer, so a host with no system has nowhere to put a fight
— correct — and the sanctioned escape hatch was a zero-IP starter
system that *nothing installed*. It sat in `examples/systems/starter/`
as source to copy, campaign creation validates against the shelf, and a
virgin `~/.teller-next` therefore offered ZERO systems on the one screen
a bare host has. First run dead-ended.

**Decided: the starter ships WITH teller, exactly as the default panels
do.** `examples/systems/starter/` → `defaults/systems/starter/`, read
from the INSTALL by the same sweep (`sweepSystemsIn`, split out the way
`sweepPanelsIn` was), never seeded into a data dir — so both §M-6
wrinkles stay dead: nothing goes stale, nothing resurrects, and the
folder upgrades with the software.

**But not as a LAYER — as the bottom of a per-id FALLBACK**, and that
distinction is the whole of the doctrine question. Panels merge, so
teller's can be a floor layer under everyone. Systems don't merge: a
campaign names ONE by id, so there is no "under" for a shipped system to
sit in. `loadCampaign` resolves an id in the order it always did —
`systems/<name>/` > pack-embedded `system.json` > `shelf.db` row — and
only then asks the install. A shelf system restating `sys_starter`
therefore wins OUTRIGHT and the shipped copy contributes nothing behind
it, which is what §M-4's precedence rule and rule 4's "a system a person
added and one that shipped with teller are the same kind of thing"
between them require. Nothing teller ships can outrank or resurrect over
an edit.

The honest fallback (a console "install the starter" one-tap that copies
it to the shelf) was NOT taken: it is a seed by another name, and the
copy it makes is the stale copy §M-6 killed. Copying remains how you
FORK the starter — `cp -R` it under a new id and edit — which is the act
that genuinely wants a copy.

One price, stated where it will be found: **the install floor is
DATA-ONLY.** teller's own installation may be read-only (a brew cellar),
and both art install and code compile WRITE, so `sweepSystemsIn` does
neither for the install root. A shipped system wanting presentations or
art wants to be a folder on somebody's shelf; better to hit that in the
open than to have teller quietly try to write into itself.

**The punchline the whole section was building toward** (Brian:
"Full control if you care, simple controls if you don't. You choose
how much to expose yourself to as the author"): customization is a
GRID, and its two axes are independent. The LAYER answers *who wins*
— teller < system < pack < campaign < table, ownership all the way
up. The RUNG answers *how deep* — rearrange json → restate records →
style → custom blocks → takeover, exposure chosen by the author. Any
cell is legal: a pack may take a screen over entirely; a table may
nudge one line of json over that takeover and still win, because
**precedence comes from the merge, never from how much code you
wrote — later beats fancier.** And the floor holds it all up: the
app never requires what the fanciest rung needs, so the author who
never learns React and the author who rebuilds every pixel are both
first-class, on the same host, at the same table.

**6a · Trades are the system's, and the pack's `sheet` is the sheet**
(2026-08-20, Brian, two rulings ratified together — the statuses
precedent and §M-6's own rule, each applied to the first file that
tested it).

**A. The trades moved to the system.** Same line rule 4 drew for
Trapped and Afraid: *the system carries the mechanic, the pack carries
the book's words about it.* A Wild Imaginary West character without a
trade is not a WiW character, so the seven trades are not optional
content a book brings — and they had ended up in the Guidebook for
exactly the reason the statuses did, because they arrived attached to
their prose. The test at every field was "numbers and rules, or words
and pictures?":

- **To `systems/wiw/`** — the trade's `id` and `name`, its quick-build
  `skills` spread, its `abilities` and `aceInTheHole` id lists; and from
  `creation`, the `start` counts, the six `tiers`, the `map` of which
  counter a tier's numbers land in, the `wallet` roll, the starting
  `weapons` and `equipmentPacks` ids, and the `skills` budget.
- **Left in the Guidebook** — `tagline`, `page`, `text`, `overview`,
  `art`; and from `creation`, the `keepsakes`, the name wells, the
  `questions`, the `welcome`, the `prefaces`, the die `marks`, and the
  page citations beside the mechanics they cite. Not one word of prose
  was edited — only moved, or left where it was.

The merge does the rest, **by name and field by field** (`layerBy` in
`core/merge.ts`): the system states a Doctor's spread, the pack states
what a Doctor's life is like, and neither restates the other's half to
say its own. That is a change to the resolution law and worth naming —
a declaration used to be REPLACED whole by a later layer, which quietly
charged every layer for everything it didn't mention. Records refine the
same way, one key deep and then further (the system rolls `6B`, the book
says page 8, both survive). **`panels` is the one exception, and it is
about CODE**: a panel declaration carries compiled urls and a trust row
belonging to whoever shipped it, so a later layer replaces one whole.
Trust never launders through a merge any more than it does through an
include (§M-5a′).

With NO pack installed, the unbranded creator now produces a complete
character — seven trades, spreads, tiers, wallet, a typed name — and the
kit it can't describe is REPORTED rather than dropped: "4 of this kit
isn't on this host — … The system names them; the pack that describes
them isn't installed." The system names starting gear by catalogue id
and the catalogue is the book's, so that gap is structural and the
honest thing is to say so where the picker would have been (rule 9's
"you don't have this beats forgetting it existed", `absentIds`).

One mechanism landed under this: **a system folder reads sibling
`*.json` files as slots**, exactly as a pack folder does, so
`systems/wiw/trades.json` sits beside `system.json` instead of inside
it. The reason `system.json` carries its slots inline is that twenty
small records want one editor buffer; a list of seven trades with their
spreads does not. `system.json` still wins a name collision — it is the
file a person hand-edits. The file split is a serialization, not a data
model (rule 4a), and nothing downstream learned it happened.

**B. `wiw-sheet` is now `sheet`.** §M-6 already said a pack's panel
beats the system's on a name collision, branded over unbranded — the
Guidebook's coded sheet just wasn't taking the offer. It shipped under
its own word and was therefore `omit`ted from the seat composite and
reachable only by pointing a screen at it by hand, while the seat's
Sheet tab drew the system's data-only arrangement. Renaming the
declaration to `sheet` is the rule applied rather than a new rule: the
pack's coded sheet IS the sheet tab on a table with the Guidebook
installed, and the system's is what a host without it falls back to. The
`pan_` id is unchanged — **trust rides the id, never the word** — so the
enablement a human already gave it carries across the rename, and the
composite's `omit` list is down to `bare`.

**7 · The table picks its campaign at the door** (2026-08-19, Brian:
"dynamically select which campaign is selected from like, a 'login'
screen").

One host, one ACTIVE campaign, every screen follows it — rule 9 was
already shaped this way (displays live on the SHELF, not in any
campaign, so screens survive a switch without re-pairing). What's new
is that the choice is runtime, not boot-time: the session is
swappable under a `Host` (subscribers hoisted into a `Room` that
outlives any one campaign), the active choice persists in the shelf's
`settings` so a reboot resumes it, `--campaign` is an override, and a
host with NO campaign boots into the picker instead of dying. The
campaign screen is APP CHROME, not a panel — it exists before any
campaign resolves, so it cannot come from the panels merge; it's the
one screen that stands outside the collection, beside the key gate.
Everything that needs a table answers 503 ("no table right now")
when none is active — a different fact from 404, and the client
treats it so.

With it came the management §M had left as data-only: the shelf
tab's THIS CAMPAIGN edits the manifest's `system` and `packs` refs
(precedence arrows, add/remove, and "use all" restoring the sacred
no-list default — a host with one pack never makes anyone tick a
box), and the plugins tab lists ENABLED content code (`sys_`/`pak_`/
`pan_`) with a disable — trust finally revocable from the console,
same door, opposite direction. Creating a campaign takes a name and
a system off the shelf, and activates — the DM made it to play it.

**8 · Absent is zero** (2026-08-19, Brian, ruled while structuring
frenzies: "absent should always be zero, for all npcs and characters.
0 is the default").

A delta applied to a stat, tolerance or counter that doesn't exist
treats the base as ZERO — for every entity, every layer, everywhere
the arithmetic runs. This came from a real foe (Lurking Moss gains
"+1 Sweep Tolerance" over a base that lists no Sweep tolerance at
all), but it's stated as a convention because the alternative — every
consumer inventing its own reading of absence — is the recurring bug
class this codebase keeps paying for. Absence is not "untracked,
N/A"; absence is the number zero, and a delta lands on it normally.
The result is a stored value like any other (rule 1): if zero was the
wrong base, the Warden types over the outcome.

### The fold-gate audit — 2026-08-24, three adversarial passes

Before retiring the old world, three independent auditors (client
surfaces, server contract, docs-promises) tried to refute "everything
is ported." They succeeded — and everything they found in Tier 1
(table correctness) was FIXED the same day: deploy-as-reset with
one-row undo + missing-foes-named, upgrade/ammo `effects` amending
pools at the point of use, the Aim armed reticle as a generic
`use.actions` consumer, measured range-to-target in the exchange flow,
the reconnecting pill on passive glass, the campaign notice (shared
glass, presets from a `notices` declaration — never the kernel's
words), handouts on the board view, and the starter system as an
install-floor fallback (§M-6b). Tests 719 → 756 across the day.

**Tier 2 — real, queued, post-fold is fine** (filed to Linear
2026-08-24 as TEL-111…TEL-124; the camera overlay stays TEL-77 and
the readable log stays TEL-5 — Linear is the queue, this list is the
record of what the audit found):

- One-press `table/clear` (old: delete all NPCs + tokens + order rows).
- Campaign DELETE and a dedicated rename door.
- The notch/deeds ritual + weapon history faces ("isn't part of this
  port" — client/components/items file headers say so).
- Party resources: a console editor + board pin for root-entity
  counters (old BoardView pinned them; no located new surface).
- The ten-second sweep (now boot/manual-only; books dropped mid-session
  are invisible until a sweep is pressed).
- Entity duplicate door; `GET /api/health`.
- Camera overlay (TEL-77): the `rnd/camera` solver survived, nothing
  renders it, the console→table broadcast door is gone.
- Seat preview / true-size rig (old SeatPreview + SizeFrame).
- Encounters panel can't STAGE placements (u/v/hidden) or per-foe
  overrides — deploy honors staged data; nothing authors it yet.
- Assistant residue: sub-band closing invisible in band-only phrasing
  (`MoveFacts` carries the inches); same-named zones merge in
  crossings; TEL-5's readable combat log still renders for nobody.
- Aim/Dodge arming flag: ~~"flat numeric cost" arms both~~ — DONE
  2026-08-24: `arms: true` on the action record; the system says what
  arms, a cost's shape never did.
- Token-as-zone (found by the docs fold, 2026-08-24): the old world
  let a placement carry an `effect` so a token IS environmental ground
  that moves with a physical mini; the new placement has `shape`/`rot`
  but no effect — painted `zones` are the only environmental ground.
  Recorded in BATTLEMAP.md too.
- Door 2 residue, restated by the fold: `systemFrom` requires a
  hand-written `sys_` id and never mints one (a `pak_` is minted on
  first sweep); two authors can still collide. Consistent with Door 2
  standing open — but §M's prose reads more settled than the code is.

**Tier 3 — deliberate, recorded so nobody re-finds them as bugs:**

- Six runtime seat layouts → panels-as-files (per-player runtime CHOICE
  is gone; a different arrangement is now an authoring act).
- Book/pack installs are filesystem+sweep only, no upload doors —
  deliberate posture, but it means an iPad-console DM cannot add a
  book remotely. Revisit if it hurts.
- Assistant + store are plugins; an old-world `assistant.json` is NOT
  migrated; a fresh install has neither until enabled.
- Undo deliberately cannot step back board/fog writes (new undo is
  broader everywhere else; board writes log the fact without a before).
- Combat resolution is N entry writes, not the old atomic `/resolve` —
  partial-apply over flaky LAN is representable now; accepted.
- Vitality-glow thresholds (0.5/0.25) hardcoded in the kernel where the
  old world declared them per-system — doctrine drift to fix when
  state-suggestion derivation gets built.
- Campaign notices are session-ephemeral (die with the server) — a
  break announcement is over when the table is.

**Unswept residue** (audits ran static-only; nobody proved these
either way): old-`.story`/`.tell` → new import round-trip; ticket TTL
parity; handout-upload file roots vs `/files/` serving roots; store
purchase arithmetic vs old `worker/items.ts` field-by-field; public
redaction field-by-field against a live payload; BadgeView and
BookReader fine-detail parity; the sha-256 display handle's URL role.

### Still open from `ARCHITECTURE.md`

- **Door 2** — system identity is a hand-chosen slug; mint `sys_`.
- **Door 3** — don't serialise `.system` until the kind declaration
  exists, or two prefixes get frozen into a public format.

---

## Considered and rejected

- **Merging Counter and Tag into one primitive with a data flag.** The
  flag would be a mechanic hiding in a field. The zero-rule belongs on
  the declaration instead — which then makes the merge fine (settled §1).
- **Moving statuses into `kinds.status` under the CURRENT model.**
  Correct call at the time, and `ARCHITECTURE.md` recorded `tags` as
  "kind zero." **This doc supersedes that** — under §2 there is no
  un-kinded bucket, because every list is a list. Conditions and
  descriptors become two declared lists, which is what actually fixes
  the Gunslinger bug. *(`ARCHITECTURE.md` folded 2026-08-24; the
  section now records the supersession instead of arguing the other
  way.)*
- **A clean-slate rewrite of the seat.** Convergence instead: every step
  ships and the table keeps working.

---

## Evidence index

Everything above that cites a number comes from `docs/STORAGE.md`, which
was mapped from `~/.teller` on 2026-08-17: 3 campaigns · 37 characters ·
42 displays (35 blank) · 3,387 events · 2 packs · 10 books · 417 indexed
pages. Guidebook pack 273 KB against an 8 KB campaign.
