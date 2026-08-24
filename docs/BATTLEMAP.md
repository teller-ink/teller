# Battlemap design

Designed 2026-08-08 (TEL-20), built out 2026-08-08/09. These decisions
are settled — reference, don't relitigate. Where the original design
and the shipped system differ, this doc follows what shipped and says
why. The thesis still governs: the table TV is the GROUND; physical
minis and terrain are the actors; everything here is presentation +
bookkeeping.

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

## Fog: 1-inch cells, plus named areas

The original design called for vector strokes. Tile painting landed
first and proved itself, so fog reuses it: same cells, same brush, and
it agrees with the grid players actually see. Soft edges come from
blurring the reveal mask, not from smaller geometry.

`fog: { on, revealed: [col,row][], regions? }`

- Stored as what's REVEALED — the common case is a mostly-dark map, so
  a fresh cover costs one flag, not nine hundred cells.
- **Areas** (`regions: { id, name, cells, revealed }`) — paint a room
  once during prep, reveal the whole thing with one tap when the posse
  walks in. Brian's design; the reason fog is usable at speed.
- Areas are DM-only structure: `publicBoardState` flattens fog to plain
  revealed cells, so the name and shape of an unentered room never
  reach the table.
- Fog never switches itself on. Reaching for the tool or shaping an
  area leaves the table clear; blacking it out is a decision.
- No vision simulation, ever — the Warden's finger is the vision
  system.

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

Hidden tokens, hidden ground layers and unrevealed fog areas are
STRIPPED server-side in `server/public.ts`. The table client never receives
them, so nothing is discoverable in devtools. New tokens start hidden.

## Where state lives

Split, and the split is the point (§4). The board — picture,
`widthInches`, `grid` — is a SHELF row, because a board outlives the
campaign that showed it. Everything a fight does to it is
`board_state`, one blob of `{ placements, view, fog, zones }` per
campaign, which is why deploying foes and deleting an entity are pure
functions over that blob (`server/boards.ts`) instead of console-only
edits. Console edits → write → event log → SSE poke → refetch. Only
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
calibration, grid style, clear) · ground (layers) · fog (areas) ·
tokens.

## Build order

1. **Scale + viewport** — SHIPPED
2. **Tokens + reactive effects** — SHIPPED
3. **Fog** — SHIPPED
4. Effect polish (tag-driven auras, transitions) — open
5. Someday: the overhead camera proposes token positions (proposal
   only, as always). Its boot sequence — showing a known pattern and
   solving the homography — would also replace display calibration
   entirely.
