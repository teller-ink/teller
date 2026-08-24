// One merge shape: system → packs (declared order) → campaign, later
// wins by name.
//
// This is the resolution law (`docs/ARCHITECTURE.md`) as a function.
// Everything template-shaped resolves through it — kind declarations,
// bestiaries, statuses, catalogues — which is what makes "the campaign
// overrides a status by restating it" one rule instead of four
// implementations that drift.
//
// Names match case-insensitively, because "trapped" and "Trapped" are
// one condition and always were. A later layer's entry replaces an
// earlier one IN PLACE — the book's ordering survives a correction —
// and genuinely new names append in the order their layer declared.

// The coupling line (§10) decides the key: VOCABULARY couples by name —
// a campaign overrides a status by restating it — while IDENTITY
// couples by id — a campaign overrides a pack's monster by carrying the
// same minted id. Two keys, one merge.

export function mergeBy<T>(
  keyOf: (item: T) => string,
  ...layers: (readonly T[] | undefined)[]
): T[] {
  const out: T[] = [];
  for (const layer of layers) {
    if (!layer) continue;
    for (const item of layer) {
      const key = keyOf(item);
      const at = out.findIndex((held) => keyOf(held) === key);
      if (at < 0) out.push(item);
      else out[at] = item;
    }
  }
  return out;
}

/** Vocabulary-coupled content — statuses, kind declarations. */
export function mergeNamed<T extends { name: string }>(
  ...layers: (readonly T[] | undefined)[]
): T[] {
  return mergeBy((item) => item.name.trim().toLowerCase(), ...layers);
}

/** Identity-coupled content — bestiaries, catalogues, anything stamped. */
export function mergeById<T extends { id: string }>(
  ...layers: (readonly T[] | undefined)[]
): T[] {
  return mergeBy((item) => item.id, ...layers);
}

// ---------------------------------------------------------------------
// The same law, one level finer.
//
// Replacing whole entries answers "who wins" and nothing else, and that
// costs a later layer everything it didn't restate. The statuses lesson
// (CLAUDE.md rule 4) is the general case: the SYSTEM carries the
// mechanic and the PACK carries the book's words about it, and neither
// half should have to copy the other's to state its own. So a layer
// REFINES: it wins every field it names, and leaves the fields it
// doesn't alone.
//
// Arrays and scalars replace whole — a list is a statement about all of
// it, and merging two lists position by position means nothing. Only
// plain objects refine, and they refine all the way down.

function plain(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `later` laid over `earlier`, field by field, recursively. */
export function refine<T>(earlier: T, later: T): T {
  const under = plain(earlier);
  const over = plain(later);
  if (!under || !over) return later;
  const out: Record<string, unknown> = { ...under };
  for (const [key, held] of Object.entries(over)) {
    out[key] = key in under ? refine(under[key], held) : held;
  }
  return out as T;
}

/** `mergeBy`, refining instead of replacing — the fine-grained reading. */
export function layerBy<T>(
  keyOf: (item: T) => string,
  ...layers: (readonly T[] | undefined)[]
): T[] {
  const out: T[] = [];
  for (const layer of layers) {
    if (!layer) continue;
    for (const item of layer) {
      const key = keyOf(item);
      const at = out.findIndex((held) => keyOf(held) === key);
      if (at < 0) out.push(item);
      else out[at] = refine(out[at], item);
    }
  }
  return out;
}
