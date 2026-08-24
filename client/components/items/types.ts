// Shared shapes for the carried-things screens — the system's own
// `screens`/`use`/`currency` records, read forgivingly the same way
// every other stack record is (nothing here throws on a shape it
// doesn't recognise, it just doesn't offer what it can't find).

/** One declared carried-screen (`SystemTemplate.screens`, ported). */
export type ScreenDecl = {
  name: string;
  icon?: string;
  kinds?: string[];
  counters?: string[];
  /** This screen offers the chamber select + trigger. */
  arms?: boolean;
  /** The junk-drawer screen: kinds nobody else claimed land here. */
  rest?: boolean;
};

/** `/api/stack/record/use` — what firing/using a carried thing spends. */
export type UseRecord = {
  costField?: string;
  costCounter?: string;
  consumesKind?: string;
  verb?: string;
  verbs?: Record<string, string>;
  costs?: { field: string; counter: string }[];
  actions?: {
    name: string;
    cost: number;
    text?: string;
    arms?: boolean;
    /**
     * How many dice this move lets you throw again. STRUCTURAL on
     * purpose: the same grant is written in the action's own `text`
     * ("Reroll 1 die in your next Attack"), and reading a mechanic out
     * of prose is the recurring bug this model exists to end (§I). The
     * text is what a person reads; this is what the surface acts on,
     * and an action that declares no number gets a name chip and no
     * button.
     */
    reroll?: number;
  }[];
};

/**
 * One of the system's per-turn moves, as declared — read off `use`
 * rather than restated, so a tile and the door it opens are looking at
 * the same row.
 */
export type ActionDecl = NonNullable<UseRecord['actions']>[number];

/** `/api/stack/record/currency` — the purse's denominations. */
export type CurrencyRecord = {
  symbol?: string;
  denominations?: { counter: string; value: number }[];
};
