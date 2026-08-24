// The turn's armed moves — what you've said you're doing before you do
// it. Ported from the old app's arming state (`src/components/counters/
// Sheet.tsx`), which held it on the seat rather than on a weapon.
//
// Three facts, and each one is a decision:
//
//   * **Armed is INTENT.** The reticle lights, every trigger reprices,
//     and NOTHING is written anywhere until the shot goes
//     (deduct-at-fire): an armed-then-abandoned Aim costs nothing, and
//     a table that rules it should is one stepper tap from charging it.
//   * **Armed is UI state, not a stored fact**, exactly as it was — the
//     old app kept it in component state and wrote none of it down.
//     Whether you've lined a shot up is the player's own reminder; the
//     cost counter is the shared truth. It lives module-level rather
//     than in one screen because an action is the TURN's, not the
//     weapon's — "arm it here or on any other weapon, same state, one
//     Aim" — and the carried screens are several components.
//   * **The once-a-turn lock RELEASES ON REFILL**, and that release is
//     derived rather than announced: the cost counter going UP is what
//     "your turn came back around" looks like in the data — the
//     cylinder's ↻, the console's stepper, an SSE edit from across the
//     room all read the same.

import { useEffect, useSyncExternalStore } from 'react';

type State = { armed: string[]; spent: string[] };

let state: State = { armed: [], spent: [] };
/** The last cost-counter balance anyone saw — a refill is a rise off this. */
let last: number | undefined;
/** Whose balance that was. */
let whose: string | undefined;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Arm or disarm one action by name. A spent one can't be re-armed this turn. */
export function toggleArmed(name: string): void {
  if (state.spent.includes(name)) return;
  set(
    state.armed.includes(name)
      ? { ...state, armed: state.armed.filter((n) => n !== name) }
      : { ...state, armed: [...state.armed, name] },
  );
}

/** The trigger went: what was armed is now spent, and nothing is armed. */
export function firedArmed(): void {
  if (!state.armed.length) return;
  set({ armed: [], spent: [...state.spent, ...state.armed] });
}

/** Everything back — the turn came round again. */
export function releaseArmed(): void {
  if (!state.armed.length && !state.spent.length) return;
  set({ armed: [], spent: [] });
}

/**
 * What's armed and what's spent, watching `available` for the refill
 * that releases the locks. Every screen may call it with the same
 * balance and the same `owner`; the second one in sees no change and
 * does nothing.
 *
 * `owner` is whose turn this is — a seat re-pointed at somebody else
 * is not still holding the last player's aim, and the balance it was
 * watching belonged to a different cylinder.
 */
export function useArmed(available: number | undefined, owner: string): State {
  const held = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (owner !== whose) {
      whose = owner;
      last = undefined;
      releaseArmed();
    }
    if (available !== undefined && last !== undefined && available > last) releaseArmed();
    last = available;
  }, [available, owner]);
  return held;
}
