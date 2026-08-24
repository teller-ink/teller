// What one use of a carried thing COSTS, counter by counter.
//
// A system may price a single use in more than one currency: the thing
// carries a stat per price, and the `use` record says which counter
// each of those stats is spent from. The law this file exists to hold:
//
//   **A price is spent against ITS OWN counter, and labelled with its
//   own name. Amounts are only ever added together when they name the
//   SAME counter.**
//
// That sounds obvious written down, and it was got wrong the moment the
// prices lived in two places — the tile summed everything into one
// number, printed it against the first counter's name, and the screen
// then also debited the second counter, so a thing priced 2 of one and
// 6 of another read as "−8" of the first and cost 8 + 6.
//
// So the ledger is computed ONCE, here, and the same list is what gets
// drawn, what decides the trigger's disabled state, and what gets
// written. Nothing in this file knows a counter's name, which is what
// lets it sit in core (§L): every word arrives from the declaration.
//
// Rule 1, as ever: this only ADDS UP. Whether the table lets the shot
// happen with an empty pocket is the table's call, and the steppers are
// right there.

/** One price, against the counter it comes out of. */
export type Price = { counter: string; amount: number };

/**
 * The prices folded onto their own counters — first-seen order kept,
 * so the thing's main price leads and its extras follow in declared
 * order, and nothing positive is ever lost.
 *
 * Two prices naming the same counter DO add up (an armed move costing
 * the same currency as the trigger is one debit, one event, one undo).
 * Two prices naming different counters never do.
 */
export function ledgerOf(prices: Price[]): Price[] {
  const out: Price[] = [];
  for (const price of prices) {
    if (!price.counter || !(price.amount > 0)) continue;
    const held = out.find(
      (p) => p.counter.toLowerCase() === price.counter.toLowerCase(),
    );
    if (held) held.amount += price.amount;
    else out.push({ counter: price.counter, amount: price.amount });
  }
  return out;
}

/**
 * Which of a ledger's counters the holder can't cover — the names, in
 * the ledger's order, for the trigger to say out loud. A counter
 * nobody holds reads as zero, because "you don't have any" and "you
 * have none left" spend the same.
 */
export function shortOf(
  ledger: Price[],
  balances: Record<string, number | undefined>,
): string[] {
  const held = new Map(
    Object.entries(balances).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return ledger
    .filter((p) => (held.get(p.counter.toLowerCase()) ?? 0) < p.amount)
    .map((p) => p.counter);
}

/** "2 Grit and 6 Aces" — one ledger said aloud, for a label. */
export function sayLedger(ledger: Price[]): string {
  return ledger.map((p) => `${p.amount} ${p.counter}`).join(' and ');
}
