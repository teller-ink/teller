import { describe, expect, it } from 'vitest';
import { ledgerOf, sayLedger, shortOf, type Price } from './spend.ts';

// Deliberately NOT one system's counters: the arithmetic must never
// have learned a vocabulary, so the fixture invents its own.
const PRICES: Price[] = [
  { counter: 'Vigour', amount: 2 },
  { counter: 'Sparks', amount: 6 },
];

describe('ledgerOf', () => {
  it('keeps each counter its own — never sums across two', () => {
    expect(ledgerOf(PRICES)).toEqual([
      { counter: 'Vigour', amount: 2 },
      { counter: 'Sparks', amount: 6 },
    ]);
  });

  it('adds up two prices that name the SAME counter', () => {
    expect(
      ledgerOf([
        { counter: 'Vigour', amount: 2 },
        { counter: 'Vigour', amount: 1 },
        { counter: 'Sparks', amount: 6 },
      ]),
    ).toEqual([
      { counter: 'Vigour', amount: 3 },
      { counter: 'Sparks', amount: 6 },
    ]);
  });

  it('folds on the counter, not on its spelling, and keeps the first spelling', () => {
    expect(
      ledgerOf([
        { counter: 'Vigour', amount: 2 },
        { counter: 'vigour', amount: 1 },
      ]),
    ).toEqual([{ counter: 'Vigour', amount: 3 }]);
  });

  it('drops what costs nothing, and anything nameless', () => {
    expect(
      ledgerOf([
        { counter: 'Vigour', amount: 0 },
        { counter: 'Sparks', amount: -1 },
        { counter: '', amount: 4 },
        { counter: 'Sand', amount: 1 },
      ]),
    ).toEqual([{ counter: 'Sand', amount: 1 }]);
  });

  it('leads with the first price given — the main one, then the extras', () => {
    expect(ledgerOf(PRICES).map((p) => p.counter)).toEqual(['Vigour', 'Sparks']);
  });
});

describe('shortOf', () => {
  it('names only the counters that cannot cover their own price', () => {
    expect(shortOf(ledgerOf(PRICES), { Vigour: 9, Sparks: 2 })).toEqual(['Sparks']);
  });

  it('is silent when every counter clears', () => {
    expect(shortOf(ledgerOf(PRICES), { Vigour: 2, Sparks: 6 })).toEqual([]);
  });

  it('reads a counter nobody holds as empty', () => {
    expect(shortOf(ledgerOf(PRICES), { Vigour: 9 })).toEqual(['Sparks']);
  });

  it('finds a balance whatever its spelling', () => {
    expect(shortOf(ledgerOf(PRICES), { vigour: 2, SPARKS: 6 })).toEqual([]);
  });

  it('never judges a counter no price named — a rich pocket is not short', () => {
    expect(shortOf([], { Vigour: 0 })).toEqual([]);
  });
});

describe('sayLedger', () => {
  it('says each price against its own counter', () => {
    expect(sayLedger(ledgerOf(PRICES))).toBe('2 Vigour and 6 Sparks');
  });
});
