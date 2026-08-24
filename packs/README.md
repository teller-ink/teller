# Packs

A pack is **the unit of content** for a system: the distilled rulings
that come up mid-game, and the bestiary that goes with them. Rulebook
excerpts for your own table, or homebrew.

**A pack is an archive — and a folder.** Drop a `.pack` into
`~/.teller/packs/` and the host sweeps it in; drop an unzipped
*directory* there and it installs identically. The sweep runs on boot
and on demand (`POST /api/shelf/sweep`, from the console's shelf), and
it is VERSION-GATED — bump `version` in `pack.json` or the edit won't
reinstall. There is deliberately no upload door: a pack arrives on the
filesystem, the way a book does.

The two forms are the same format for different jobs:

- **A folder is what you author in.** Open `bestiary.json`, fix the foe,
  bump `version` in `pack.json`, sweep — live. No zipping, no copying,
  no upload.
- **An archive is what you hand someone.** `GET /api/packs/:id/export`
  builds one on demand, art included. (There is no `.system` export to
  match it — doors 2 and 3 hold that until the kind declaration is
  settled, so a `systems/<name>/` folder is the only serialization
  there is.)

```
wiw-guidebook/            ← or wiw-guidebook.pack, zipped
  pack.json               id, system, name, version, rights, books
  sections.json           the rulings
  statuses.json           conditions this pack adds
  bestiary.json           the foes
  catalog.json            items and upgrades
  trades.json             the playable trades
  creation.json           the creation flow's own prose
  notes.json              the sheet's panel captions
  art/                    the pictures
  presentations/          the book's own faces — see below
```

**A system is no longer part of a pack.** It lives beside it, in its own
shelf folder — `~/.teller/systems/<name>/` — because the two halves have
different rights and different lives:

```
systems/wiw/
  system.json             sys_ id, name, version, and the record slots
  presentations/          functional, unbranded components
  panels/                 the system's own `.panel` folders
  art/                    only what function demands
```

A **system is pure function**: kinds, dice, effects, the vocabulary, the
mechanics code. Mechanics aren't protectable expression, so a system
with no prose and no book art is anyone's to hand on. A **pack is the
book's stuff**: monsters, items, sections, pictures, and the faces that
ape the printed page — rights follow the content, as they always have.

A `system.json` sitting inside a pack folder still works and always
will (it is how the first conversion wrote things). The system folder
simply wins if both exist, per id: **`systems/<name>/` > a pack's
embedded `system.json` > a `shelf.db` row.**

Only `pack.json` is required. Everything else is optional and a pack
declares itself by what it contains — a bestiary-only pack and a whole
core book are the same format.

A pack needs **no PDF at all** to be useful — most Wardens own paper.
A book, when you have one, attaches by hash and adds the page and the
art. Enrichment, never a prerequisite.

**A pack may contain IP. The repo may not.** That's the whole of rule 4
(rewritten 2026-08-14), and the two halves are worth stating separately
because they used to be one blurry sentence:

- **The repo carries nobody's book — absolute.** `*.json` here is
  gitignored on purpose. Keep authoring copies in this folder locally;
  the host's own shelf is `~/.teller/packs/`; git never sees either.
- **A pack carries whatever its author has the right to put in it.**
  Rules, prose, descriptions, stat blocks — the lot. A pack built from
  a book you own is personal use, exactly like the notebook it replaces.
  A pack a publisher sanctions can carry their whole book.

What *does* vary is who may hand the file to someone else, and since
that outlives whoever knew, the pack says so itself — see `rights`.

A `.story` **references** packs and never carries them, so back up
`~/.teller/packs/` alongside your bundles — the bundle alone won't
rebuild a table. That's the price of the file being safe to hand to
anyone, and it's the same deal books have always had.

## Format

`pack.json` — who this pack is, and nothing else:

```json
{
  "id": "pak_4f1c9a2b7e03",
  "system": "wiw",
  "name": "My Guidebook Pack",
  "version": 1,
  "rights": { "status": "personal", "holder": "Example Games Ltd" },
  "books": ["bok_a23d630c48f7"]
}
```

`sections.json` — the rulings:

```json
[
  {
    "title": "Statuses",
    "entries": [
      {
        "name": "Example Status",
        "meta": "Nerve",
        "text": "Your own words — short enough to read aloud mid-turn.",
        "page": 62
      }
    ]
  }
]
```

`bestiary.json` — the foes:

```json
[
  {
    "id": "npc_example_varmint",
    "name": "Example Varmint",
    "lists": {
      "defense": [{ "name": "Defense", "value": "3G" }],
      "counters": [{ "name": "Health", "value": 24, "max": 24 }],
      "conditions": []
    },
    "page": 186
  }
]
```

Each part file holds a bare array or object — no wrapper key, because
the file name already said what it is. `catalog.json`, `trades.json`,
`creation.json` and `notes.json` follow the same rule.

**The file name IS the slot name**, and that's the whole rule — there is
no list of permitted files. Drop `upgrades.json` beside the others and
the pack has an `upgrades` slot; the files above are simply the ones
anything reads today. Two names are reserved, because they carry
identity rather than content: `pack.json` and `system.json`.

### `system.json` — the system, in its own folder

Written in `systems/<name>/system.json`, beside the pack rather than
inside it. (A copy inside a pack folder is still read, for packs
exported before the split — the system folder wins where both exist.)

```json
{
  "id": "sys_example",
  "name": "Example System",
  "version": 3,

  "vocabulary": { "conditions": "Afflictions" },
  "dials": { "Grit": "cylinder" },
  "kinds": [{ "name": "conditions", "domain": { "kind": "count", "zero": "clears" } }]
}
```

`id`, `name` and `version` are the system's identity and are reserved;
**every other key is a record slot, inline**. That's the one place this
format differs from the pack half, and deliberately: a pack's slots are
long lists that each want a file (65 foes do not belong beside an id),
while a system's are a dozen small records read and edited together —
`dials` is four lines. One file keeps the whole vocabulary in one
editor buffer, which is what editing a system actually looks like.

A system whose id matches one already on the shelf REPLACES it while the
folder is there: the folder is the authoring copy, so the folder wins.
Most packs carry no system of their own at all — a bestiary for a system
that arrived some other way is the ordinary case.

A system folder may also carry `presentations/` and `panels/`, on
exactly the terms below: same sweep, same esbuild, same trust row —
keyed by the `sys_` id instead of a `pak_` one.

**The edit recipe**, which is the point of all of this:

1. edit `~/.teller/packs/<name>/<file>.json`
2. `POST /api/shelf/sweep`
3. it's live

A file that doesn't parse is reported in the sweep's answer and costs
exactly that slot — the rest of the pack loads. Broken loudly beats
missing quietly.

### `statuses.json` — conditions this pack adds

Usually absent, and that's correct. **Statuses belong to the SYSTEM**,
not to a pack: Trapped and Poisoned are how Wild Imaginary West works,
and a host with the system and no pack still has them. What a pack
carries is the book's WORDS about them, in `sections.json`.

This file is for a pack that genuinely introduces one — a supplement
adding a condition the base game doesn't have. Restating one the
system already declares is also fine; that's how a pack corrects a
spelling or supplies a visual the system left off.

```json
[
  { "name": "Cursed", "relief": "Nerve", "effect": "fade" }
]
```

`relief` is free text in the book's own words ("Finesse or Nerve") —
teller shows it and never evaluates it. `effect` is the visual, one of
`wound` `burn` `chill` `daze` `mark` `fade`. The system's list, then
packs in the campaign's declared order, then the campaign's own — later
wins on a name collision.

### `art/` — the pictures

Anything under `art/` travels with the pack, at whatever paths the pack
refers to:

```
art/
  logo.png
  wiw/trd_gunslinger.png
```

**Reference art relative to the pack** — `"art": "art/logo.png"` — and
never as a global key. teller resolves it to `art/<pak_id>/…` in the
object store when the pack is installed, and turns it back into a
relative path on export. That's what lets two packs both carry an
`art/logo.png` without meeting, and lets the same file install on any
host and still find its own pictures.

For a folder that means the sweep COPIES `art/` into the host's own
`art/<pak_id>/`, file by file, skipping anything already newer than its
source — so the picture is served from the one place the file route
looks, and an untouched folder costs nothing on the next sweep. Not a
symlink: a symlink survives neither a zip nor a copy to a stick, and it
would ask the serving route to follow a path out of the data dir, which
is the exact check that route exists to make.

A book does NOT travel with a pack. It's referenced by hash, because a
book is something the recipient owns; a monster portrait isn't.

### `presentations/` — components, on either shelf

A counter is a counter everywhere, but a *revolver* is not. teller ships
the neutral floor — bars, steppers, chips, ledger rows — and whatever
wants its own face brings it, as code:

```
systems/wiw/presentations/
  StatusPanel.tsx         severity boxes with a relief caption each
  HealthPanel.tsx         a capped gauge with its declared pins beside it
  DicePool.tsx            the declared dice, as a tappable grid

packs/wiw-guidebook/presentations/
  Cylinder.tsx            a revolver: six chambers, spend one, reload
```

**Which shelf a file belongs on is one question: is anything about it
branded?** A severity-boxed status plate is how the mechanic works, so
it is the system's. Drawing a spend dial as a *revolver* is the book's
picture, so it is the pack's — and a pack SKINS the system by restating
the filename, because the merge puts the system's presentations first
and the packs' after, later winning.

**The file name is the summoning name, three times over**: it is the
export name, it is what `import { Cylinder } from 'system'` gives a
panel, and it is the word a record uses to ask for a face. A `dials`
entry of `{"Grit": "cylinder"}` finds `Cylinder.tsx` (the exact word or
that word capitalized — a pack needn't choose a spelling). Rename the
file and nothing finds it.

Each file **default-exports** its component. A file with no default
export supplies nothing.

Four rules, and each one is load-bearing:

- **The host compiles it, at sweep.** esbuild builds each `*.tsx` into
  `.build/presentations/`, rebuilding when the source is newer. There is
  no toolchain for the author: edit the file on the shelf, sweep, look.
  A compile error is a line in the load report, never a crash.
- **A human enables it.** Code arriving from outside sits behind the
  trust gate (the plugins tool, same row a code-carrying `.panel`
  rides — keyed by the `pak_` or `sys_` id whose folder carries the
  file). Until it's enabled the DATA loads and the code does not — the
  console says so rather than pretending the folder is inert.
- **Four specifiers resolve, and bare `system` is not one of them for a
  pack.** `react`, `react/jsx-runtime`, `teller`, and `system/<name>` —
  one file from the active system's `exports/` folder, named RELATIVELY
  (§M-4a: the system's id is spelled once, in `pack.json`, so the
  declaration and the import can never disagree). Bare `system` is the
  merged presentation index, which a pack RIDES — importing it is a
  cycle, and the compiler refuses it out loud (`PACK_IMPORTS` in
  `core/compile.ts`). A missing export refuses out loud too, naming all
  three parties. Anything else you import gets bundled into the output.
- **A presentation carries no facts.** Entity, records, catalogue, the
  write door — all arrive as props. The folder owns look and behaviour;
  the campaign owns the numbers.

A host whose system and packs supply no presentations still plays:
teller falls back to the floor, and a counter with nobody's face on it is drawn as a
bar you can still edit. A face is dressing; the stored value is the
sheet.

Every value above is invented. A pack's contents are somebody's rules
text, and this file is public — so the example teaches the shape and
nothing else (rule 4).

- `system` matches a template's system id (`wiw`, `dnd5e`, …).
- `meta` is an optional short qualifier rendered next to the name
  (associated Skill, Grit cost, tier…).

### `id` — the pack's permanent name

`pak_` + 12 random hex, **assigned once and never changed**. Leave it out
and the host mints one on first sweep and writes it back into your file;
after that it's yours forever.

Deliberately *not* a content hash, unlike a book's id. A book never
changes, so hashing its bytes is a perfect name for it. A pack gets
edited — the day after the WiW pack was written, two page numbers were
corrected — and a content hash would have minted a new identity for it
and orphaned every reference. **Identity is the id, never the name**, so
renaming a pack is just a rename, and two people's homebrew "Bestiary"
don't collide.

`version` is yours to bump. It's what makes a campaign's `requires` list
a real statement, and it's how a file decides whether it supersedes what
the host already has: a file only overwrites a stored pack when its
version is strictly **greater**. Equal versions leave the stored one
alone, because it may have been edited on the host and that edit is a
person's decision (rule 1) — which is why an unbumped edit doesn't
reinstall, and why bumping is the whole ritual.

### Which packs a campaign uses

A campaign declares its packs by id, **in precedence order**, in the
console's shelf tool under THIS CAMPAIGN. When two packs print the same
foe, **the later one wins** — name the base, then what layers on top.
Per-foe exceptions are the "printed in 2 books" picker in the bestiary.

Declare nothing and every pack for the system applies, in the order they
arrived on the host. A one-pack host should never make anyone tick a box.

### `rights` — is this mine to share?

The one question a pack can't answer by being opened, and the one whose
answer outlives everybody who knew it. Three statuses, no fourth:

| `status` | what it means | may it travel? |
| --- | --- | --- |
| `homebrew` | the author's own work | yes, anywhere |
| `personal` | someone else's IP, for the author's own table | **no** |
| `licensed` | someone else's IP, sanctioned to travel | yes, on its `terms` |

```json
"rights": {
  "status": "licensed",
  "holder": "Example Games Ltd",
  "terms": "Distributed by the publisher; see examplegames.com/vtt"
}
```

`holder` is attribution in plain words. `terms` is prose on purpose —
the real answers are wider than an enum survives.

**Absent means unknown, and unknown reads as `personal`.** That's the
safe default both for packs that predate the field and for anything a
stranger hands you.

Three things this is NOT:

- **Not verified.** It's the author's claim, and teller has no way to
  check it. Anything showing it says *the author says* — never a badge
  implying somebody checked.
- **Not a gate.** A pack with no `rights` works completely: foes deploy,
  pages open, nothing asks permission. Same bargain `books` makes — the
  reference identifies, it never authorises.
- **Not enforcement.** It can't stop a file being copied and isn't
  trying to. It exists so an export path can warn you, and so the
  honest answer is in the file instead of in someone's memory.

### `books` — which rulebook this is about

A list of book ids. A book id is `bok_` + the first 12 hex of the
**sha-256 of the PDF's own bytes**, so it identifies a book without any
registry: two people who own the same file derive the same id without
ever talking to each other.

It's a LIST because the hash is of exact bytes — a corrected re-upload,
or the same book bought from a different store, is a different hash for
the same book. Attach both.

The reference identifies; it never authorises. A pack whose book isn't
on this host works completely — the console just says the book is
missing instead of offering a page you can't open.

### `bestiary.json` — the foes the pack brings

Entity-shaped templates: `id`, `name`, optional `type`, `lists`,
`notes`, `children`, plus the shelf limbs (`group`, `page`, `slots`).
Having the pack means having the foes, the way having the book on the
shelf does, instead of every new campaign starting empty.

Ids must be **stable** — `npc_<system>_<name>` is the convention — and
they're what a campaign's own copy collides with. On a collision **the
campaign wins** (rule 1): retuning a foe for your table survives the
pack being updated underneath it.

**A reprint reuses the original's id.** When an adventure's appendix
reprints a creature from the core book, give it the SAME id, not a fresh
one. The id names the creature; it isn't a pointer. Both directions then
work: the adventure pack alone is still self-sufficient (a complete foe,
not a dangling reference), and holding both packs collapses them to one
bestiary entry that can open either page instead of two entries with the
same name.

This is convention, not enforcement, and it's meant to be: a stranger's
homebrew Bark Watcher carries its own id and shows up separately —
which is correct, because it genuinely is a different creature.

### `trades` and `creation` — starting kits (TEL-75)

The system's playable trades/classes, as data a creation flow composes
from. A trade **references the catalogue instead of carrying it**:

```json
{
  "trades": [
    {
      "id": "trd_example",
      "name": "Example Trade",
      "tagline": "Two-Word Category",
      "page": 10,
      "skills": { "Charm": "3B", "Nerve": "2B" },
      "abilities": ["abl_ex_first", "abl_ex_second"],
      "aceInTheHole": ["abl_ex_big", "abl_ex_bigger"]
    }
  ],
  "creation": {
    "page": 12,
    "start": { "abilities": 1, "aceInTheHole": 1 },
    "map": { "trade": "Class", "wallet": "Coins", "prestige": ["XP"] },
    "wallet": { "roll": "2B", "values": { "Ace": 2, "Hit": 1 } },
    "weapons": ["itm_ex_rustysword"],
    "equipmentPacks": ["itm_ex_wandererbundle"],
    "keepsakes": ["An example memento, in your own words"],
    "names": { "first": ["例"], "last": ["Example"] },
    "questions": ["An example prompt for the prose panels?"],
    "tiers": [
      {
        "name": "Example Tier", "prestige": 0,
        "ranged": "Basic", "melee": "Basic",
        "scrap": 0, "wallet": 5, "packs": 1, "items": 0
      }
    ]
  }
}
```

Again, every value is invented — the shape is public, the contents are
the book's. `skills` is keyed by whatever field labels the system's
sheet already uses; `abilities`/`aceInTheHole` are catalog item ids
(`kind: "ability"`, `group` = the trade's name), **in the printed
order — order is load-bearing**: `creation.start` counts how many of
each list a new character begins with, taken from the FRONT, preset
rather than picked (further unlocks are Prestige spends);
`creation.tiers` is the
starting-loadout table for a posse beginning at higher Prestige (its
`packs` column counts equipment-pack picks).

A catalog entry may be a **bundle**: `contents: ["itm_…", …]` lists
the catalog ids it unpacks into when acquired — an equipment pack
becomes its blanket, rations and compass as separate carried items,
never one word in an inventory. An id may repeat ("2× Pain Pills"
lists it twice, and grants two). The bundle entry itself is the picker
card; the contents are what land.

The rest of `creation` keeps teller generic (rule 2): `map` says where
tier numbers LAND (creation-schema key → this system's own counter and
field names, so no code ever knows a counter is called anything);
`wallet` is the starting-money roll — the player rolls PHYSICAL dice
and taps the result, teller does the face arithmetic; `weapons` and
`equipmentPacks` are catalog references; `keepsakes`, `names` (the
"gimme a name" well — personalities/features ride along for NPC
sparks) and `questions` are flavor lists the flow offers as chips and
prompts. Everything here **seeds ordinary editable state** — a created
character is a normal character, and none of this is enforced
afterward (rule 1).

### `page` — where it's printed

Optional, on entries and on foes. When the pack's book is on the host,
the console offers "open the book here" — for the art, the sidebar, and
everything the digest left out. A foe can override `book` too, if one
pack covers more than one book.

**Take these from the book's own index if it has one.** Counting where a
name appears most does not work: a status is named in every stat block
that inflicts it, so its *definition* loses to the bestiary by fifty to
one. Index folios are printed page numbers and `page` is the PDF page —
measure the offset from the folios themselves rather than assuming it,
and leave `page` out when you aren't sure. A wrong jump is worse than
no jump.
