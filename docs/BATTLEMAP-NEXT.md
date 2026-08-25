# BATTLEMAP-NEXT — the revamp, planned

**Status: PLAN, not shipped truth.** BATTLEMAP.md stays the record of
what exists; this file is the map of where it's going, written
2026-08-24 out of one long design conversation with Brian (TEL-94,
TEL-127, TEL-128), revised the same night after his review. When a
phase ships, its section moves into BATTLEMAP.md and dies here. Where
this file and a ticket disagree, check the dates and fix the loser.

## The one sentence

The battlemap stops being a picture with tokens on it and becomes a
**model of a place** — named areas, ground that means something,
things that stand on it, heights, and fog that matches how a table
actually hides things — rendering only where there's nothing physical
to defer to, computing whatever helps, and enforcing nothing over the
humans at the table.

## The three-tier law (settled; everything hangs off it)

- **Core carries the physics.** The grid, coordinates, areas, terrain
  data, elevation, object footprints and heights, z on placements,
  blocksSight. Core measures and stores; the humans outrank whatever
  it works out.
- **The system carries the meanings.** Mechanics attached to terrain
  kinds it recognizes; altitude-as-mechanics ('Submerged rolls 3G
  defense', 'Flying'); band translations over measured distance;
  station semantics. Declared, merged, campaign wins (rule 1).
- **The fight carries the changes.** Positions, damage, painted
  effects, fog state, altitude in play. All `board_state`, all logged
  (rule 3), all undoable — see the undo prerequisite below.

## The posture amendment this plan requires (Brian, 2026-08-24)

**The simulation restriction is dead; the authority rule is not.**
"The humans are the rules engine" was always about who WINS, not what
teller may compute (rule 1's 2026-08-10 amendment said so) — this
plan finishes that arc. Simulator territory is open: line-of-sight,
pathfinding, movement costs, vision — all computable. Three clauses
survive as the actual law:

1. Every computed output lands in a slot a human can overrule.
2. Nothing computed is ever enforced — no greyed buttons, no refused
   moves, no fog the Warden can't paint over.
3. **The floor never requires it.** teller with everything off is
   still the best bookkeeper at an in-person table; simulation is
   opt-in rungs above the floor, mostly as plugins.

**CLAUDE.md's thesis section and rule 1's framing must be amended to
say this** (and the whole file audited after, per its own
post-rewrite rule) — otherwise a future session will dutifully refuse
things this plan calls for.

## Areas — one naming layer under everything (new, settled)

An **area** is `{ id, name, cells }` on the BOARD. One list, many
consumers:

- **Fog** fogs and lifts areas ("lift the vault"), not anonymous
  cell-sets — as verbs over the dark set, since an area carries no fog
  state of its own (shipped; see BATTLEMAP.md).
- **Terrain** may claim an area (or paint anonymous cells; a name is
  optional).
- **The assistant** speaks area names — "it slides along the far bank
  toward the treeline" — which is TEL-93's shipped feature growing a
  real spine.
- Fog-region names and place names stop being two lists sharing
  words.

Phase 0 (fog) introduces the concept; phase 1 (terrain) adopts it.

## Phase 0 — fog is one set of dark cells (TEL-128) — SHIPPED

Smallest, standalone, and it was the live complaint. **Shipped
2026-08-24; its section now lives in BATTLEMAP.md and this one is
kept only for the record of what it was planned as and why that
changed.**

The plan said `Fog.base: 'dark' | 'clear'` — dark = today verbatim,
clear = a new default where unrevealed areas ARE the fog — with
freehand cells fight-side in `revealed[]`/`fogged[]` and per-area
fog state alongside them.

**The rethink, the same night (Brian, 2026-08-24), after the base had
shipped and run on real data.** The base model had four sources of
truth and a brush whose meaning depended on which one you were
standing in. It was replaced by:

```
Fog = { dark: Cell[] }
```

- A cell is dark iff it is in the set; the ground is always clear.
- **Two verbs, no modes**: darken and clear. The brush never changes
  meaning.
- **The dungeon posture is one tap, not a mode**: "cover all" is every
  cell of the calibrated grid. A "dark world" was never a different
  kind of map — just a map with a lot of dark paint on it.
- **Areas became pure geometry**: `{ id, name, cells }` on the board
  row, carrying no fog state anywhere. "Fog the vault" and "lift the
  vault" add and remove its cells; whether it is dark is DERIVED when
  someone asks. Plus a derived, un-storable "everywhere else" row, on
  the rule that **a derived selection may be acted on, never pointed
  at** — phase 1's terrain needs stable geometry, so the remainder is
  deliberately un-referenceable.
- Migration reads BOTH older shapes; the structural half needs the
  picture's proportions and runs at campaign open and after import.
- Public boundary: the set IS the mask, so flattening became a
  normalisation — players see WHERE the darkness is, never names or
  shapes. The hardening regression net grew fog cases.
- Vision-based auto-reveal is NOT built here — it arrives later as a
  plugin through the `fog.set` door (see the plugin contract below).

## Phase 0.5 — every board gets a paint raster (uncalibrated fog)

Cells only exist today when a board declares `widthInches` — no
calibration, no cells, no fog, no areas. Sane for tactical maps;
wrong for a WORLD map, where "reveal the Northern Reach as the posse
travels" is exactly area-fog and no 1-inch grid will ever exist
(Green Country's travel map is the live case).

The coupling is shallow: `{dark}` and `areas[].cells` just need A
LATTICE, and calibration is what makes the lattice physical, not what
makes it exist. So:

- Calibrated boards: the raster IS the inch grid. Zero change.
- Uncalibrated boards: an image-relative raster (fixed column count,
  square-ish by aspect), used ONLY for painting — fog, areas, later
  terrain. Grid overlay stays off; nothing tactical implied.
- Stated cost: calibrating a painted board later re-shapes its raster
  and the paint drifts. That wrinkle already exists (changing
  `widthInches` moves inch-cells today); best-effort remap through
  u/v, or a repaint — fog is tonight-state and areas are few. One
  editor warning at the crossing.

## Phase 1 — ground that means something (TEL-94)

- **Terrain lives on the BOARD row** (shelf-side, outlives the
  campaign, system-agnostic by construction): patches of
  `{ kind?, description?, elevation?, blocksSight?, cells | areaId }`.
- **Kinds are open data, not a registry** (Brian's call, and TEL-94's
  original text agrees): kind is free text with an editable
  **description** — "waist-deep, footing treacherous" — living on the
  board itself. The description is what GMs and agents read to decide
  how ground plays. A board imported under a different system keeps
  every kind, renders, and stays editable — nothing to resolve,
  nothing to fall back from.
- **Systems attach mechanics to kinds they recognize, by name** — an
  optional overlay, never a gate. Curated lists (teller's floor, the
  system's, a pack's) are picker SUGGESTIONS only; anything is
  typeable. Progressive exposure: type a word if you don't care,
  describe it if you do, let a system hang mechanics on it if it
  cares.
- **Creature-side "at home in"**: a generic field naming a terrain
  kind, so the Pondweed prose fix becomes data that scales.
- **Editor**: a terrain brush beside the effects brush, board-scoped,
  clearly labeled — this edits the MAP, not the fight.
- **Assistant**: ground() gains kinds, descriptions, elevations and
  area names; between() learns blockers. Facts and the author's own
  words — the model interprets, the Warden rules.

## Phase 2 — z (TEL-94 amendment)

- Terrain patches carry `elevation`, placements carry optional `z` —
  both in calibrated table units, so a 2-inch styrofoam cliff IS its
  scale height and inches→bands extends to height for free ("the
  tower is Short above you").
- Altitude as MECHANICS (Flying, Submerged) is a system-declared
  status — zero new machinery.
- Computed 3D line-of-sight is allowed (posture amendment) but ships
  as a consumer of this data — a plugin or a later core proposal —
  never as an enforcement.

## Phase 3 — objects, act one (TEL-127)

- **An object is an entity that got stamped, wearing a token.**
  Structures in a pack catalog (or the campaign's own), stamped like
  foes, linked to placements like creatures. Health on a barn door is
  a counter; notes, art, merge, undo, event log all inherited.
- **The core physics record**: footprint (multi-tile, rotatable),
  height, blocksSight. Core defines the shape; content fills values.
  Multi-tile footprint is the one real geometry extension.
- **Levels, cheap form**: child entities ("Ground floor", "Loft").
- **Objects are fight furniture** (Brian's call): boards never carry
  default objects — encounters STAGE them. Consequences: table/clear
  sweeps objects with everything else (no new keep-list fact needed),
  and clear-then-redeploy round-trips the ambush's wagon. Permanent
  scenery is the board's art plus terrain.
- **"Represented physically"**: a placement flag — geometry and
  bookkeeping kept, rendering skipped, because the terrain piece on
  the table is the display.
- Objects redact like everything non-party (the fail-closed rule
  already covers them); physics facts may travel, numbers don't.

## Phase 4 — objects, act two: levels link boards (TEL-127)

- A level may reference a board: "enter the windmill" switches the
  active scene to its interior. Objects become the connective tissue
  between boards; multi-floor buildings are an object whose levels
  link boards; the scene library is the machinery.
- The table shows ONE active scene (split-screen is deferred, below).
  Interior and exterior fog are independent facts on their own
  boards.

## Phase 5 — objects, act three: stations and vehicles (TEL-72, TEL-18)

- **Stations are system-level semantics on core primitives that
  already exist**: an object's stations are entries, occupants are
  refs — core adds NOTHING. The system declares what occupying one
  means (mounted weapons' costs and next-turn debt — which wants
  TEL-97's effect clocks first).
- Vehicles: objects that move with riders, take damage, carry
  stations — Mechs and Forstalls arrive as pack content on this
  machinery.
- Whether a piloted object joins the turn order is decided here, with
  the book open.

## Rendering — per-display, defaulting to the physical table's truth

Inherent data (terrain, elevation, areas) **can render — as a
choice, per display** (Brian, 2026-08-24, revising the earlier
"never renders"):

- Default OFF on the table TV at a physical table: the art and the
  styrofoam are the display.
- ON wherever there's nothing physical to defer to: a table playing
  without minis, and remote players (TEL-55/56) who otherwise see
  nothing at all.
- Console-driven, arrives over SSE like grid calibration; passive
  surfaces never grow controls.
- The render is a subtle data overlay (tints, contours, labels),
  never competing with the art.

## The plugin write contract (new, and it outlives this plan)

The posture amendment makes simulation plugins real, and the first
one that wants to CHANGE the table (vision revealing fog) sets the
pattern for all of them:

- **Plugins write through declared, scoped VERBS, never credentials.**
  A door is sized by the consent sentence a human reads at the
  needs-consent gate — "may reveal and hide fog" — not by API
  convenience. No plugin ever holds the DM key's authority or touches
  the database.
- First doors: **`fog.set`** (toggle existing areas revealed/hidden —
  what a vision plugin needs) and, separately, **`fog.paint`**
  (create/modify areas — a bigger power almost nothing should ask
  for). Approving the small one never grants the big one.
- Every use logs as an ordinary event (rule 3) and lands where the
  Warden sees it happen and can step it back (rule 1).
- **Prerequisite: board-write undo.** Board and fog writes are
  currently excluded from undo (a deliberate fold-era call, made when
  only the DM's own hands painted fog). A plugin writing fog with no
  undo is automation with a weak override — the fog door does not
  ship until board_state writes are undoable.
- This contract intersects TEL-125 (the plugin table-door boundary):
  write doors and read doors get the same discipline in the same
  pass.

## Deferred (wanted, not now)

- **Split-screen table rendering** (interior + exterior at once) —
  Brian wants it eventually; one-active-scene stands until it's
  designed on purpose.
- Vision/LoS/pathfinding plugins themselves — the doors and data land
  first; the plugins are their own projects.

## Refused on purpose (the shorter, truer list)

- **Enforcement of anything computed** — no refused moves, no greyed
  buttons, no auto-anything without a human-visible, human-reversible
  landing. This is the one refusal the posture amendment sharpens
  rather than removes.
- **A `windmill` or `vehicle` entity type** — objects are entities
  with a physics record, never a new schema kind (rule 2).
- **Plugin writes outside declared verbs** — no credential-holding
  plugins, ever (rule 7).

## Cross-cutting work (every phase touches these)

- **Migrations & sweep**: board rows gain areas + terrain
  (shelf-side, version-gated); fog became one dark set; placements
  gain z;
  packs may gain structures (packs/README.md and the file-split
  serialization grow; the split stays serialization, the model stays
  one RulesPack).
- **Public boundary tests**: every phase adds cases to the regression
  net (the fog set honest, terrain absent from passive
  payloads unless that display renders it — and then stripped of
  DM-only notes, object numbers redacted, no hidden structure leaking
  via area names).
- **Assistant snapshot**: grows per phase under the prompting laws —
  facts compound, prose doesn't; the author's description IS the
  interpretive layer; state facts, never verdicts.
- **CLAUDE.md amendment** (the posture change) + post-amendment
  audit of the whole file.
- **BATTLEMAP.md**: each shipped phase's section moves there; this
  file shrinks toward deletion.

## Open questions still genuinely open

1. **Terrain kind mechanics depth** — systems may declare as much as
   they want (settled); the open half is the record shape for those
   declarations (start: blocksSight + free text; grow when the
   assistant demonstrably needs a structured fact).
2. **Object interaction surface** — "open the door / damage the
   wall" via the object's sheet from its token (lean confirmed);
   detail at build time.
3. **Piloted objects and the turn order** — phase 5, book open.
4. **Split-screen's eventual shape** — deferred, undesigned.
