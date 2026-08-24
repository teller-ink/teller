// The rung-4 public API (§E UN-DEFERRED): panel code's `import … from
// 'teller'` resolves here via the import map. This IS the promotion the
// ladder described as happening "deliberately, later" — later is now,
// and the seam freezes as it stands: whatever this file exports is what
// a custom block or takeover may touch. Nothing else in client/ is
// reachable from panel code (it's built external — panels-shelf.ts's
// `EXTERNAL` — so nothing but these three specifiers even resolves).
//
// Riding the SAME rollup build as the app (see runtime/react.ts) also
// means this file's own imports (React components, `api`, `useLive`, …)
// are the app's own instances — no second copy of anything here either.

// -- the ui grammar (className tokens; client/lib/ui.ts) --------------------
export * from '../lib/ui.ts';

// -- api + live data ----------------------------------------------------------
export { api, fileUrl } from '../lib/api.ts';
// `fileUrl` with a React shape on it: the pictures a record names, as
// ticketed urls. A system's own face draws its art off its own record,
// and without this it would have to hand-roll the ticket dance that
// `/files/…` requires (rule 7) — one hook is cheaper than every
// presentation reimplementing it slightly differently.
export { useArtMap } from '../lib/art.ts';
export { useLive } from '../lib/use-session.ts';

// The two declaration readers every standard sheet block already uses:
// the pack's caption under a heading, and its rule text by name. A
// custom block that couldn't reach these could not reproduce the sheet
// it's replacing a piece of — the captions ARE the sheet.
export { usePanelNote, useRuleLookup, useRuleSections } from '../lib/rules.ts';
export type { RuleEntry, RuleHit, RuleSection } from '../lib/rules.ts';

// -- the neutral floor (§L: shape-derived, no system's vocabulary) -----------
// A bar for anything with a ceiling, a stepper for anything you count, a
// chip for anything you either have or don't, a ledger line, a clock, and
// the plate chrome every block on a printed sheet wears. Nothing here
// knows a game — which is exactly the test for whether it belongs.
export { VitalBar, CounterStepper } from '../components/Vitals.tsx';
export { TagSection } from '../components/TagSection.tsx';
export { BigGauge, LedgerRow, SkillRow } from '../components/Counters.tsx';
export { ClockFace } from '../components/ClockFace.tsx';
export { SheetPanel } from '../components/sheet/SheetPanel.tsx';
// The mark set is teller's; the ASSIGNMENT is the system's (`icons`, or
// a screen's own `icon`). A shelf-side `ScreenBar` drawing its own tabs
// needs the same glyphs the floor draws, or a themed bar costs a table
// its icons — so the set is part of the import contract.
export { Glyph } from '../components/sheet/glyphs.tsx';
export { SheetGauge } from '../components/sheet/SheetGauge.tsx';

// A system's dice, as DATA (§J) — the pool spelling, the tally, and the
// throw teller is allowed to make for foes. Neutral for the same reason
// the `dice` record is: the faces and what they're worth both arrive
// from the system, so nothing here knows a B from a G.
export { expandPool, isPool, rollPool, tallyFaces } from '../lib/dice.ts';
export type { DiceRecord } from '../lib/dice.ts';

// -- declared advancement, interpreted (core/effects.ts) --------------------
// A system's `spends` menu turned into ordinary writes: what a purchase
// costs, what it would change, and what it can't do said out loud. Pure
// declaration-reading — it never names a counter, a rung or a tier, so a
// pack's own `SpendMenu` composes its LOOK on top of teller's arithmetic
// rather than reimplementing the arithmetic to get the look.
export {
  affordable,
  amendPool,
  costWrites,
  describeEffect,
  isRefusal,
  locate,
  needsChoice,
  spendOptions,
  tierAt,
  toSpends,
} from '../../core/effects.ts';
export type {
  EntryWrite,
  SpendEffect,
  SpendItem,
  SpendOption,
  SpendPlan,
  SpendTier,
  SpendWorld,
  SpendsDecl,
  StampWrite,
} from '../../core/effects.ts';

// The two floors those declarations fall to, exported so a pack's own
// face can wrap, extend or fall back to one instead of starting from a
// blank div — and so its props type IS the contract it must satisfy.
export { SpendFloor } from '../components/SpendFloor.tsx';
export type { SpendMenuProps } from '../components/SpendFloor.tsx';
export { LadderFloor, ladderList, toLadder } from '../components/LadderFloor.tsx';
export type { LadderDecl, LadderPanelProps, LadderStep } from '../components/LadderFloor.tsx';

// The entity leaf helpers a face needs to read what it was handed.
export { findEntry, formatEntry, numberOf, sameName } from '../../core/entity.ts';
export type { Entity, Entry, Ref } from '../../core/entity.ts';

// -- the summoning seam (§L phase 3) -----------------------------------------
// What draws a face called X — the active system's presentations first,
// teller's fallback registry second (empty since phase 3.5), `undefined`
// third. Panel code that wants a system's own vocabulary should
// `import { … } from 'system'` directly; this is for code that must
// survive not finding it.
export { presentationOf, suppliedPresentations } from '../lib/presentations.ts';

// **The four are GONE** (§L phase 3.5, 2026-08-19). `DicePool`,
// `HealthPanel`, `StatusPanel` and `Cylinder` were exported from here
// under a deprecation notice saying they would go when the fallback map
// did; the map is empty and so are they. They were never teller's — a
// HealthPanel is one printed sheet's health box, a Cylinder is a
// revolver — and they live on their system's shelf now.
//
// This is a BREAK in a frozen import contract, taken deliberately and
// with the notice served: `import { HealthPanel } from 'teller'` now
// fails to link, and the fix is the one the notice always named —
// `from 'system'`. Nothing on the shelf did it (checked); everything
// there already imported them from `system`.
//
// What teller ships instead is the FLOOR each of them falls to, and
// those are plain imports above, not summoned names: `VitalBar` and
// `CounterStepper` for a counter, `TagSection` for a chip strip,
// `DiceFloor` for a declared pool.
export { DiceFloor } from '../components/DiceFloor.tsx';
export type { DicePoolProps } from '../components/DiceFloor.tsx';

// -- items (§K furniture) ---------------------------------------------------
export { ItemTile } from '../components/items/ItemTile.tsx';
export { CarriedScreen } from '../components/items/Screen.tsx';
export * from '../components/items/Track.tsx';
export * from '../components/items/Purse.tsx';

// -- the blocks helpers already exported from panels/blocks.tsx --------------
export { entriesOf, entryNamed, accentOf, dialOf, pinsOf, shaped } from '../panels/blocks.tsx';
// What draws a DIALLED counter, with teller's own floor controls under
// it (the hand of cards): a panel asking for `dials[name]` gets the
// system's face if it ships one and teller's if it doesn't, rather than
// each panel testing for one word it knows.
export { dialFace } from '../panels/blocks.tsx';
// What the subject is WEARING, worked out against their own stats — the
// reading a printed sheet's plate shows beside a stored value (§K's
// `refs.worn`). Exported because the sheet that draws Defense is the
// SYSTEM's own block, not teller's, and a reading it cannot reach is a
// reading nobody sees.
export { useWorn } from '../panels/blocks.tsx';
export type { Amendment } from '../../core/effects.ts';

// -- the render seam (client/panels/render.tsx) ------------------------------
export { registerBlock, Refusal, RenderBlock, PanelSurface } from '../panels/render.tsx';
export type { BlockCtx, Glass, CustomBlockComponent, TakeoverComponent } from '../panels/render.tsx';
