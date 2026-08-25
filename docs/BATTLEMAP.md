# Battlemap design

Designed 2026-08-08 (TEL-20), built out 2026-08-08/09. These decisions
are settled — reference, don't relitigate. Where the original design
and the shipped system differ, this doc follows what shipped and says
why. The thesis still governs: the table TV is the GROUND; physical
minis and terrain are the actors; everything here is presentation +
bookkeeping.

**Where it's going**: the revamp — areas, terrain, z, objects — is
planned in `BATTLEMAP-NEXT.md` (2026-08-24). This file stays the record
of what SHIPPED; phases land here as they ship.

**The design did not change in the fold; the facts moved house**
(2026-08-24, ported end to end). A **board** is a shelf ASSET — the
picture, its physical width, its grid style — reusable across
campaigns and referenced by a minted `brd_` id (`server/boards.ts`).
What's on it right now — placements, fog, zones, the view — is
`board_state`, one row per board per campaign, and it never travels in
a `.story`. The shapes live in `client/components/board/model.ts`, the
player-safe stripping in `server/public.ts`, the console's workshop in
`client/tools/boards.tsx`. Wherever this doc says "scene" read
"board", and wherever it says "token" the stored word is `placement`.

## Coordinate spaces

Three spaces, three jobs — never mix them:

- **Map space** — positions of things ON the map (tokens, painted
  ground, fog cells): normalized image coordinates `u, v ∈ 0..1` of the
  source image, or 1-inch cell indices `[col, row]` from the map
  origin. Resolution-independent (re-upload a higher-res map, nothing
  moves) and re-declaration-safe (fix `widthInches` later, tokens stay
  glued to the painted features they stand on).
- **Physical space** — SIZES in inches (token bases, grid squares).
  An inch is an inch on every display, via that display's calibrated
  ppi.
- **Glass space** — the viewport maps one onto the other.

## Scale: one fact per board, one fact per display

- Board: optional `widthInches` (the map's intended physical width),
  on the board ASSET, not in the state.
  Read it off the file — print-destined maps carry DPI, so
  `pixels ÷ dpi` (Boylei's are 10800px @ 300dpi = 36"). No value →
  fit-to-screen, and no cells, so no grid/painting/fog.
- Display: calibrated `ppi` (and `ppiY`) on the display row itself —
  `server/calibration.ts` — derived from the table's self-reported
  viewport ÷ its diagonal size.
- True scale factor = `ppi × widthInches / imageWidthPx`.

## The grid belongs to the MAP, not the screen

Originally the grid was drawn glass-space (screen-fixed, hand-panned
with ox/oy). That could only line up with painted cells by luck, and
the console preview and the table visibly disagreed. **There is now
one grid**, drawn in map space inside the same transformed layer as
tokens, ground and fog. It matches every painted cell by construction,
and at true scale one cell is exactly one calibrated inch.

Per board: `grid: { on, color?, opacity? }` — a dark cave wants pale
lines, bright sand wants dark ones. It rides the board asset, beside
`widthInches`, because both are calibration between pixels and the
room rather than anything about a fight. The screen-fixed grid's
pan offsets are gone; only the display's `ppi` still matters.

## Viewport

Per board, remembered across switches:
`view: { mode: 'fit' | 'true', zoom, cu, cv, locked? }`
(`cu, cv` = map-space point at the viewport centre; `zoom` multiplies
true scale — 1.0 is exact).

**Physical minis pin the map.** Panning mid-combat slides the ground
out from under real minis, so framing is a between-moments tool:

- `locked` — while set, nothing in the editor can re-aim the table.
- Soft lock — while initiative is running, framing asks for
  confirmation. Never hard-disabled (the human is the rules engine).
- Aiming the table is its own tool. The default tool drags tokens and
  pans the WORKSHOP view, so a stray drag can't move the table.

Digital tokens live in map space and move with the map. Physical minis
live on glass and don't.

## Fog: one set of dark cells, and named areas over it

The original design called for vector strokes. Tile painting landed
first and proved itself, so fog reuses it: same cells, same brush, and
it agrees with the grid players actually see. Soft edges come from
blurring the mask, not from smaller geometry.

**The whole model is one set** (TEL-128, shipped 2026-08-24):

```
fog: { dark: [col,row][] }
```

A cell is dark iff it is in the set. The ground is always clear. That
is all of it — `core/fog.ts` holds the vocabulary and the arithmetic,
because the console, the server and the table all have to agree about
where the dark is.

**The rethink, hours after the first cut** (Brian, 2026-08-24, worth
recording because the discarded model was the plan and shipped). Fog
first landed with a BASE — `dark` worlds you painted light into,
`clear` worlds you painted darkness onto — plus a freehand `revealed`
list, a freehand `fogged` list and a per-area `AreaFog` state. Four
sources of truth and a brush whose meaning depended on which one you
were standing in. All of it was accidental complexity: a "dark world"
is not a different KIND of map, it is a map with a lot of dark paint
on it, and the dungeon posture the base existed to serve is ONE TAP —
cover all — not a mode.

- **Two verbs, no modes.** `darken` puts cells in; `clear` takes them
  out. The brush never changes meaning. "Cover all" is every cell of
  the map, "clear all" is the empty set, and both are bounded by the
  board's lattice — see the raster rule below.
- **The set is FIGHT-SIDE**, in `board_state` with the tokens.
  Painting the dark back mid-fight is a gesture at speed and it must
  never write the shelf — play residue is not geography.
- **Areas are BOARD-SIDE and PURE GEOMETRY**: `{ id, name, cells }` on
  the shelf row, authored in prep, outliving the campaign, carrying no
  fog state anywhere. Paint a patch, NAME it, and fog or lift the whole
  room with one tap. Terrain claims the same list next
  (docs/BATTLEMAP-NEXT.md phase 1).
- **An area's state is DERIVED, never stored** (`areaStatus`): every
  cell in the set is `fogged`, no cell is `lifted`, some is `partial`.
  So authoring an area changes nothing on the table, and deleting one
  changes nothing either — forgetting a name is not a ruling about the
  light.
- **"Everywhere else" is a derived row**, not a place: the grid minus
  every area's cells, computed when the panel asks (`restCells`). It
  can be fogged and lifted like any area, and its cell count is the
  prep progress bar — partition the map into rooms and watch it fall
  to nothing. It has no id, no row, and is never serialized, on a rule
  worth keeping: **a derived selection may be ACTED ON, never POINTED
  AT** — a stored reference to shifting geometry changes meaning the
  moment somebody draws a new area.
- Areas are DM-only: `publicBoardState` ships the set (which IS the
  mask, so there is nothing to flatten) and `publicBoardRow` strips the
  areas off the row, so the name and shape of an unentered room never
  reach the table.
- **Migration reads both older shapes.** Pre-phase-0 `{ on, revealed,
  regions }` and phase-0 `{ base, revealed, fogged, areas }` are read
  lazily by `toFog` as far as they can be, and finished structurally by
  `migrateBoardFog` (`server/boards.ts`) at campaign open and after a
  story import — the only moments the board row, the fight state and
  the picture are all in hand. The picture is the load-bearing part: a
  world that was DARK has no cells written down, and "everything"
  only becomes a set once the map's proportions say how big it is
  (`imageSizeOf`, `gridOf`). Old regions become board areas in the same
  pass; old per-area fog state is consumed and ceases to exist.
- **EVERY BOARD HAS A PAINT LATTICE, calibrated or not** (phase 0.5,
  2026-08-24). A cell is an index into a lattice, and `rasterOf`
  (`core/fog.ts`) is the one place either end derives which lattice a
  board has: **calibrated** (`widthInches` set) means the raster IS the
  1-inch grid, unchanged in every respect; **uncalibrated** means an
  image-relative raster — `RASTER_COLS` (40) columns across the
  picture, rows following the aspect so a cell is exactly square — used
  ONLY for painting: fog, areas, painted ground, and terrain later.
  Nothing tactical follows from it: the grid overlay, token snapping,
  true scale and every measured distance still read `inchGrid` and stay
  calibration-gated exactly as they were. A world map can now be
  fogged and its regions named ("reveal the Northern Reach as the posse
  travels"), which is what the coupling was costing. Only a board whose
  picture can't be measured has no cells.
- **Calibrating a painted board re-shapes its lattice, and the editor
  says so.** The same indices land in different cells, so the fog and
  areas drift. There is no honest remap of a brushstroke and none is
  attempted: `paintDrifts` answers whether a width change would move
  existing paint, and the editor asks before writing it (never
  refuses — rule 1). It stays quiet when nothing is painted, and when
  the lattice comes out the same shape anyway. A repaint is a real
  answer; fog is tonight's and areas are few.
- Fog never switches itself on. A new board's set is empty, which is no
  fog at all; reaching for the tool or shaping an area leaves the table
  showing its map, and every black cell is one somebody painted.
- No vision simulation SHIPPED — the Warden's finger is the vision
  system. ("Ever" died with the simulation restriction, 2026-08-24:
  vision may arrive as a plugin through the `fog.set` door,
  `docs/BATTLEMAP-NEXT.md` — proposing reveals the Warden sees happen
  and can step back, never replacing the finger.)

## Terrain: the ground's own words (shipped 2026-08-24, TEL-94 phase 1)

Terrain lives on the BOARD row beside areas (`core/terrain.ts`):
patches of `{ id, kind?, description?, elevation?, blocksSight?,
cells? | areaId? }`. Kind is FREE TEXT with picker suggestions only —
open data a board keeps under any system — and `description` is the
author's own words for how the ground plays, passed to the assistant
verbatim (`how it plays:`), never parsed. A patch claims its own
brushed cells or a stored area (never the derived "everywhere else");
a dangling `areaId` resolves empty and is REPORTED, not guessed at.
`elevation` is stored now, interpreted in phase 2.

Terrain renders in the EDITOR only (`T`, emerald tint + word). The
table, board, art and seat show nothing — the art and the styrofoam
are the display; per-display rendering is a later, deliberate choice
(BATTLEMAP-NEXT). The public boundary ships none of it:
`publicBoardRow` strips terrain with areas, pinned at both doors.

The assistant's snapshot (under the existing `read:board` grant)
carries the patches with descriptions, each token's `inTerrain`,
`between` entries flagged `blocksSight` — stated as facts, never
verdicts — and per-area fog status: which named places the posse has
not seen, framed as the posse's knowledge rather than the creature's.

## Tokens and painted ground

Placements: `{ id, entityId?, label, color, u, v, sizeInches, shape?,
rot?, hidden? }` — `client/components/board/model.ts`. Coloured discs;
images are someday. No vision, no auras-as-data, no pathing — ever.

- `entityId` unlocks **reactive effects**, pure render on the table
  from state already streaming over SSE: amber pulse on whoever's turn
  it is; red glow when the linked entity is bloodied/critical. How the
  entity is DOING is derived through the link at render and never
  stored, so a token cannot go stale (§5).
  Vitality is derived SERVER-side as a qualitative state from the first
  max-bearing counter, so NPC numbers never leak.
- A token could also BE an environmental zone (fire, oil, smoke, ice,
  poison, water) with a shape and rotation — triangle + rotation is a
  cone — which worked identically under a PHYSICAL mini: the token
  became the ground marker the mini stood on. **That half did not come
  across in the fold**: a placement carries `shape` and `rot` but no
  `effect`, so environmental ground is painted `zones` only. Recorded
  here rather than quietly dropped.

Painted ground: `zones: { id, effect, cells, hidden? }[]`. **Identity
is the id, not the effect** — two fires in different corners are two
layers, independently shown, hidden, deleted and painted into.
Adjacent cells of a layer merge into one organic blob via an SVG
blur+alpha-contrast filter (opaque fills through the filter,
translucency applied after — semi-transparent input dies in the alpha
contrast).

## Hidden means absent, not dimmed

Hidden tokens, hidden ground layers and the board's area NAMES (with
their shapes) are all STRIPPED server-side in `server/public.ts`; fog
leaves as the bare set of dark cells and nothing else.
The table client never receives them, so nothing is discoverable in
devtools. New tokens start hidden.

## Where state lives

Split, and the split is the point (§4). The board — picture,
`widthInches`, `grid` — is a SHELF row, because a board outlives the
campaign that showed it. Everything a fight does to it is
`board_state`, one blob of `{ placements, view, fog, zones }` per
campaign, which is why deploying foes and deleting an entity are pure
functions over that blob (`server/boards.ts`) instead of console-only
edits. The row grew `areas` alongside fog's rethink (TEL-128) and the
line held: a named place is inherent to the map, a brushstroke is what
happened tonight, and the editor writes each through its own door. Console edits → write → event log → SSE poke → refetch. Only
the ACTIVE board flows to `/public` (`activeBoard`, `server/public.ts`);
the board LIBRARY stays DM-only, which is what makes off-table prep
safe.

## Console surface

The **boards tool** IS the workshop — not a modal (`client/tools/
boards.tsx` over `client/components/board/BoardEditor.tsx`). A
fullscreen canvas with floating tool overlays, editing whatever board
you select, which is deliberately independent of what's on the table
(putting it on the table promotes it). Edits are LIVE and debounced, with an in-editor undo
stack (⌘Z) rather than save/cancel, so you can iterate against the
real table without a round trip.

Tools: select (drag tokens, pan view) · frame (aim the table) · lock ·
pan · paint · fog · add token · snap · grid. Panels: board (width,
calibration, grid style, clear) · ground (layers) · fog (brush,
cover/clear all, name-this-patch, areas + everywhere else) · tokens.

## Build order

1. **Scale + viewport** — SHIPPED
2. **Tokens + reactive effects** — SHIPPED
3. **Fog** — SHIPPED as one set of dark cells (TEL-128, 2026-08-24)
4. Effect polish (tag-driven auras, transitions) — open
5. Someday: the overhead camera proposes token positions (proposal
   only, as always). Its boot sequence — showing a known pattern and
   solving the homography — would also replace display calibration
   entirely.
