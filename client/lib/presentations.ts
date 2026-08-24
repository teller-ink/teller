// The summoning seam (§L phase 3) — one place that answers "what draws
// a thing called X?", and one resolution order for every caller.
//
// §L's settlement: **data-generic was conflated with belongs-to-teller.**
// A component parameterized by records is still VOCABULARY — HealthPanel
// is the WiW printed sheet's health box, the Cylinder is a revolver —
// and vocabulary lives on the SYSTEM layer, shipped as pack-carried code
// (`packs/<name>/presentations/*.tsx`, compiled by the same sweep, gated
// by the same trust row). teller keeps the neutral floor: bars,
// steppers, chips, ledger rows, the plate chrome.
//
// So a face is SUMMONED BY NAME, exactly as `dials`/`pins` already
// summon by name, and resolution is the same later-wins stack as
// everything else, one rung shorter:
//
//   1. the active system's presentations (`import * as system`)
//   2. teller's own fallback registry, below — EMPTY as of phase 3.5
//   3. nothing — and the caller falls to its neutral rendering
//
// Step 3 is the point of the whole exercise, and since phase 3.5 it is
// the ONLY thing under step 1: a system with no code of its own still
// plays, and every caller of `presentationOf` must have an answer for
// `undefined` that a table could sit down at. A face is dressing; the
// stored value is the sheet.

import { useSyncExternalStore } from 'react';

// The system module is fetched BY URL, dynamically — never as a bare
// `import 'system'` from the app's own code. A static bare import made
// the MAIN BUNDLE depend on import-map support, which blanked the whole
// app on any glass older than Safari 16.4 — and rule 6 says the dumbest
// panel in the room runs the core app, full stop. Import maps remain
// the contract for PANEL/PACK code (which degrades to a Refusal when
// they're absent); the app itself must boot everywhere.
//
// The load is async, so early renders see only the fallbacks — the
// same one-frame settle code panels already have. `useSystemFaces()`
// re-renders subscribers when the module lands.
let supplied: Record<string, unknown> = {};
let version = 0;
const listeners = new Set<() => void>();

// A VARIABLE specifier on purpose: TS resolves a literal path and finds
// no module (the host generates it per request); a variable makes this
// the plain runtime fetch it really is.
const SYSTEM_URL = '/pack-code/system.js';
import(/* @vite-ignore */ SYSTEM_URL)
  .then((mod: Record<string, unknown>) => {
    supplied = mod;
    version += 1;
    for (const fn of listeners) fn();
  })
  .catch(() => {
    // No system module (or no import support for it) — the floor holds.
  });

/** Subscribe a component to the system module's arrival. */
export function useSystemFaces(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

/**
 * **Empty, and that is the finished state (§L phase 3.5, 2026-08-19).**
 *
 * This map held teller's own copies of the four faces the WiW system now
 * carries — `Cylinder`, `HealthPanel`, `StatusPanel`, `DicePool`. They
 * were a DEMOTION, not a home: phase 3 moved the components onto the
 * system layer and kept these wired so that a host mid-migration
 * rendered the sheet it rendered yesterday. Phase 3.5 is the deletion,
 * taken once a SECOND system existed to prove the point
 * (`defaults/systems/starter/`), and the four files are gone from
 * `client/components/` along with their exports from the `teller`
 * module.
 *
 * The seam stays because the seam was never the problem: `presentationOf`
 * still asks system-then-fallback-then-nothing, and a table's own
 * client build may legitimately want to answer here. What may NOT go in
 * is what came out — vocabulary. A face teller genuinely owns is a
 * neutral primitive with a plain import (`VitalBar`, `SpendFloor`,
 * `DiceFloor`), not a name someone has to summon.
 */
export const FALLBACK_PRESENTATIONS: Record<string, unknown> = {};

/**
 * The face named `name`, or `undefined` if nobody supplies one.
 *
 * A `dials` value is a lowercase noun the way a person writes it
 * (`"cylinder"`, `"cards"`); a presentation FILE is named for its export
 * and so is a JS identifier (`Cylinder.tsx`). Rather than making packs
 * choose, both spellings resolve: the exact name first, then the same
 * word capitalized. Nothing else is inferred — a record saying `"cards"`
 * on a host whose pack ships no `Cards.tsx` gets `undefined`, and the
 * caller draws the floor.
 */
export function presentationOf<T = unknown>(name: string): T | undefined {
  const word = name.trim();
  if (!word) return undefined;
  const capitalized = word.charAt(0).toUpperCase() + word.slice(1);
  const hit =
    supplied[word] ??
    supplied[capitalized] ??
    FALLBACK_PRESENTATIONS[word] ??
    FALLBACK_PRESENTATIONS[capitalized];
  return hit as T | undefined;
}

/** Which names the active system actually supplied — the console's business to say out loud. */
export function suppliedPresentations(): string[] {
  return Object.keys(supplied).sort();
}
