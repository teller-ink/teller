# teller

**teller.ink** — an in-person TTRPG companion. The table plays; teller
keeps the books.

Dice stay physical. Minis stay physical. The bookkeeping — initiative,
HP, conditions, party resources — goes on screens: a DM console, a
table display, and a per-player seat card that runs on anything with a
browser.

**teller runs on the table's own machine.** One person starts the host;
every other screen in the room opens the address it prints and pairs
with a code. There is no cloud in the play path, and a table with no
internet works fine.

System-agnostic by construction: an entity is named lists of named
entries, and what a list MEANS is a declaration a system ships. teller
ships empty — no game, no vocabulary, nobody's book. Systems, packs,
panels and plugins are files you put on your own shelf.

## Install

```bash
brew install teller-ink/tap/teller
teller host        # prints the address every screen opens
teller key         # the one secret; the DM's device unlocks with it
```

Your table lives in `~/.teller/` — campaigns, systems, packs, panels,
plugins, books, art. Carry it on a stick if you like: `teller host
/Volumes/…`.

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
`docs/CORE-NEXT.md` is the canonical data model.

## License

[AGPL-3.0](LICENSE) © Brian Corbin. Fork it, run it, mod it — but if you
serve a modified teller to others, share your changes the same way.
