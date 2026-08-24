// A gate — the counter a thing waits on, and the number it waits for.
//
// `gate` is a kind the SYSTEM declares ("Health 30" is a Frenzy that
// opens at 30 Health or below), and the thing that waits is a CHILD
// entity carrying that list beside its prose (`type: 'frenzy'`). This
// file is the READ for it, and it sits beside `stepOf` for the same
// reason: the declaration says what the value means, so the arithmetic
// belongs next to the declaration rather than copied into whichever
// surface happens to ask.
//
// It used to be a mechanic hiding in a text field — "at 18 Health or
// less" inside a paragraph — which is the recurring bug this model
// exists to end. Split, it is four lines of arithmetic.
//
// Nothing here decides anything. A gate that is met LIGHTS UP; crossing
// it is the table's act (rule 1). Every surface that draws one shows the
// Warden where the line is and lets them cross it early.

import { numberOf, sameName, type Entry } from './entity.ts';

export type Gate = {
  /** The counter it watches — the pack's own word, never a game concept. */
  counter: string;
  /** At this value or below, it opens. */
  at: number;
};

export type GateReading = Gate & {
  /** What that counter reads right now, or nothing when it holds no number. */
  current?: number;
  /** Open. A counter nobody can find is never "met" — absent is not zero. */
  met: boolean;
};

/** The gate a child waits on, if it declares one. */
export function gateOf(child: {
  lists?: Record<string, Entry[]>;
}): Gate | undefined {
  for (const entry of child.lists?.gate ?? []) {
    const at = numberOf(entry);
    if (at !== undefined) return { counter: entry.name, at };
  }
  return undefined;
}

/**
 * That counter's value, wherever the parent keeps it.
 *
 * Searched across every list rather than a named one: which list holds
 * Health is the system's business (`resources` here, something else
 * elsewhere), and a gate names the COUNTER, not its filing.
 */
export function counterIn(
  lists: Record<string, Entry[]> | undefined,
  counter: string,
): number | undefined {
  for (const entries of Object.values(lists ?? {})) {
    for (const entry of entries) {
      if (!sameName(entry, counter)) continue;
      const value = numberOf(entry);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

/** The gate, read against the sheet it waits on. */
export function readGate(
  child: { lists?: Record<string, Entry[]> },
  lists: Record<string, Entry[]> | undefined,
): GateReading | undefined {
  const gate = gateOf(child);
  if (!gate) return undefined;
  const current = counterIn(lists, gate.counter);
  return { ...gate, ...(current === undefined ? {} : { current }), met: current !== undefined && current <= gate.at };
}
