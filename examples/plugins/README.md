# Example plugins

teller ships with **zero** plugins, on purpose — none required, none
given by default. These folders are examples you install yourself:

```
cp -r examples/plugins/assistant ~/.teller-next/plugins/assistant
node server/index.ts --data ~/.teller-next --plugins            # see it discovered
node server/index.ts --data ~/.teller-next --enable <plg_id>    # trust it — a human act
node server/index.ts --data ~/.teller-next --configure <plg_id> --config '{"key":"…"}'
```

The assistant can also ride a Claude subscription instead of a metered
key: `--config '{"use":"cli","model":"sonnet"}'` shells out to a
logged-in Claude Code CLI (`npm i -g @anthropic-ai/claude-code`, run
`claude` once to /login). No key ever touches the shelf in that mode.

The sweep only ever DISCOVERS what's in `<data>/plugins/` — it cannot
enable anything (docs/CORE-NEXT.md §15). Enablement and config live on
the shelf, written only by you.

## What a plugin may be

Three kinds of thing, all declared in `plugin.json` and all checked
against the registry (`core/registry.ts` — a point not in that file
isn't a point):

- **`propose.*`** — a proposer. A snapshot goes in, words come back, a
  human decides. The assistant is two of these.
- **`pane.*`** — a SURFACE. A React component compiled at load and
  served to every screen, offered beside the merged panels: a console
  tab, a seat screen, something the DM can point a display at. A pane
  never rides the merge (§M-2) — it is provided, not declared, so it
  can't override anybody's panel and nobody's panel can override it.
- **`door.*`** — a REQUEST. `/api/plugin/<plg_id>/<door>` reaches it;
  the host resolves who is asking first and hands the plugin FACTS,
  never headers. A door answers with data, and with proposed EFFECTS
  the host executes through its own session doors as `plugin:<plg_id>`
  — so a plugin's write is an ordinary logged, undoable, overtypeable
  write, and a plugin never holds a live session.

### One thing to know before you write a pane

**Your pane may only wear the utility classes teller's own client
already uses.** Tailwind builds teller's stylesheet by scanning
teller's source, and your folder isn't in it — so `flex gap-2
text-stone-400` resolves, and `w-[19rem]` compiles to nothing at all.
The failure looks like a layout that collapsed for no reason, and it
points nowhere near the cause. Arbitrary values go in an inline
`style`, or in a stylesheet of your own: a pane may name a `style`
beside its `entry` and it is served and linked while the pane is
mounted (rung 3 of §E's ladder — and it is GLOBAL for that time, so
scope every selector under a class of your own).

`needs` is the app-permissions half and it is enforced, not decorative:
`read:` decides what the snapshot a door receives contains, and `write:`
decides which effects are allowed. An effect nobody declared is refused
with the plugin's name on it, and nothing runs.

The two examples are the two ends of that range: the **assistant** is
pure proposal, and **the counter** is the store — panes, doors, effects
and per-table memory, extracted out of teller whole (§15's "the store is
plugin №2, by extraction"). Read the counter when you want to know what
a full plugin looks like; read the assistant when you want the smallest
one that works.
