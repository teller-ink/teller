// The dice grid, SUMMONED rather than imported (§L phase 3.5) — one
// wrapper, every caller.
//
// It lived inside `encounters/Exchange.tsx`, which was fine while the
// runner was the only surface that let anyone say what the plastic
// showed. A seat firing its own weapon is the second, and a second copy
// of "ask the system, fall back to the floor" is how one system ends up
// drawing two different sets of dice on one table.
//
// The seam is one component wide and stays that way: `DiceFloor` is
// what happens when nobody supplies a face — the same recording
// instrument with no game in it.

import type { ComponentType } from 'react';
import { DiceFloor, type DicePoolProps } from './DiceFloor.tsx';
import { presentationOf, useSystemFaces } from '../lib/presentations.ts';

export type { DicePoolProps };

export function DicePool(props: DicePoolProps) {
  useSystemFaces(); // re-render when the system module lands (url-loaded, async)
  const Face = presentationOf<ComponentType<DicePoolProps>>('DicePool');
  return Face ? <Face {...props} /> : <DiceFloor {...props} />;
}
