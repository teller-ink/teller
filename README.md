# teller

**The table plays; teller keeps the books.**

teller is a companion for in-person tabletop RPGs. Not a virtual
tabletop — the opposite of one. The dice stay physical. The minis stay
physical. The rulings stay human. What goes on screens is the part
nobody romanticizes: initiative, hit points, conditions, ammo, fog,
who's up and who's on deck.

> Anything players physically touch stays physical. Anything that's
> bookkeeping goes virtual. **The humans at the table are the rules
> engine.**

Tools like Foundry are simulation engines built for remote play. An
in-person table needs something else: presentation and bookkeeping that
serve the room without competing with it.

## How a table works

One person runs the host — on a laptop, a Pi, anything with Node.
It prints an address. **Every screen in the room opens that one
address**, shows a short pairing code, and the GM types the code into
their console to adopt it. What a screen *is* — console, table display,
a player's seat — is an assignment the GM makes and can change at will.
No installs on anyone's device, no accounts, no cloud in the play path.
A table with no internet works completely.

| Screen    | What it is |
|-----------|------------|
| `console` | The GM's seat of power — roster, encounter runner, boards, books, the works. Can be split one pane per screen for a digital GM screen. |
| `table`   | The shared display under the minis: the active map, full bleed, at true physical scale on a calibrated screen — one drawn inch is one real inch. Nothing else. |
| `seat`    | One player's own card: their sheet, gear, dice, and self-serve counters. Runs on a phone, a tablet, or a mounted touch bar. |
| `board`   | A player-facing companion display — turn order, public state, the GM's notices. Player-safe by construction. |
| `art`     | A fullscreen frame for the current handout. |
| `badge`   | An outward-facing nameplate per player. |

Passive screens never grow buttons. Everything they show arrives from
the console, live.

## The house rules

- **Override is the architecture.** teller may roll dice, measure
  ranges, derive defaults — but every result lands somewhere a human
  can type over, and the stored value always wins. It never decides
  something nobody can change.
- **Every mutation is logged**, and `/undo` walks it back — deploys,
  deletions, turns, rolls, all of it, coherently.
- **One secret.** The GM's key, minted on first run. Everything else is
  an assignment the server checks: a seat may edit its one character
  and nothing else; passive screens get a redacted snapshot with
  hidden things actually *stripped*, not hidden with CSS.
- **Your data is a folder.** A campaign is a SQLite file. Back up
  `~/.teller`, or carry it on a stick.

## teller ships empty

No game, no vocabulary, nobody's book. A character is named lists of
named entries — what a list *means* is a declaration a **system**
ships. Content is files on your shelf (`~/.teller/`), installed by
dropping a folder in:

- **A system** — how one game works: its dice, its distance bands, its
  conditions, its screens. Pure mechanics, no publisher text, freely
  shareable by construction.
- **A pack** — what exists in a world: bestiary, items, prose, art,
  and the branded look, layered over the system. What a pack may carry
  is its author's affair; teller's repo carries nobody's book, ever.
- **A story** — one table's campaign, exportable as a single `.story`
  file that references systems and packs by id and carries only what
  *you* wrote.
- **A plugin** — extended function at declared seams, with declared
  needs you approve once: an AI assistant that *proposes* a monster's
  turn (the table decides), a store, whatever you build. teller ships
  with zero.

Rulebook PDFs attach by content hash and get full-text search — your
book, on your host, one download.

Every layer merges, and later wins: teller's floor < system < packs <
campaign < the table's own files. Restate one name in a file and it's
yours, from a single JSON tweak up to a full React takeover — and the
table can still override the fanciest custom screen with one line.

## Install

```bash
brew install teller-ink/tap/teller
teller host        # prints the address every screen opens
teller key         # the one secret; the GM's device unlocks with it
```

Data lives in `~/.teller/` by default; `teller host /Volumes/CARD`
serves a table off a stick.

## Hardware, if you're that kind of table

Nothing requires special hardware — phones and a TV do everything. But
teller is built to be *worth* hardware: a TV under a sheet of acrylic
becomes a calibrated battlemat, mounted touch bars at each seat become
player consoles that sit under the sightline, and any screen that can
open a browser can be adopted. The design target for seats is a
short-and-wide strip precisely so the glass stays subordinate to the
table — a screen that competes with the minis has lost the argument
this project is making.

## Contributing

Node ≥ 24, pnpm.

```bash
pnpm install
pnpm host          # serve a table from this checkout
pnpm client:dev    # client dev server against a running host
pnpm typecheck     # two projects: host (core + server), client
pnpm test          # vitest
```

`core/` is the kernel (storage, the merge, the event log, the small
evaluators), `server/` is the doors, `client/` is the React app,
`defaults/` ships with the install as the floor layer, and `examples/`
is source you copy onto your own shelf.

`CLAUDE.md` holds the thesis and the rules of the road;
`docs/CORE-NEXT.md` is the canonical data model and its decision
record. The one absolute rule: **no publisher text in this repo** —
content lives on shelves, not in git.

## License

[AGPL-3.0](LICENSE) © Brian Corbin. Fork it, run it, mod it — but if you
serve a modified teller to others, share your changes the same way.
