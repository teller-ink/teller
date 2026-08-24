import { describe, expect, it } from 'vitest';
import { counterIn, gateOf, readGate } from './gate.ts';

// The Pondweed Peril, as it stands on the table: Lake Sludge waits on
// Health 18, and the Peril is at 17 of 34.
const frenzy = {
  lists: { gate: [{ name: 'Health', value: 18 }] },
};
const sheet = (health: number) => ({
  resources: [
    { name: 'Health', value: health, max: 34 },
    { name: 'Grit', value: 6, max: 6 },
  ],
});

describe('gateOf', () => {
  it('reads the counter and the number off the declared list', () => {
    expect(gateOf(frenzy)).toEqual({ counter: 'Health', at: 18 });
  });

  it('is nothing without a gate, and nothing when the gate holds no number', () => {
    expect(gateOf({ lists: {} })).toBeUndefined();
    expect(gateOf({})).toBeUndefined();
    expect(gateOf({ lists: { gate: [{ name: 'Health', value: 'half' }] } })).toBeUndefined();
  });
});

describe('counterIn — the counter, wherever the system files it', () => {
  it('finds it across lists, by name, case-insensitively', () => {
    expect(counterIn(sheet(17), 'health')).toBe(17);
    expect(counterIn({ pools: [{ name: 'Health', value: 3 }] }, 'Health')).toBe(3);
  });

  it('is nothing when nobody holds it — absent is not zero', () => {
    expect(counterIn(sheet(17), 'Sanity')).toBeUndefined();
    expect(counterIn(undefined, 'Health')).toBeUndefined();
  });
});

describe('readGate — at the number or below, it opens', () => {
  it('is met at 17 of 34 against a gate of 18', () => {
    expect(readGate(frenzy, sheet(17))).toEqual({
      counter: 'Health',
      at: 18,
      current: 17,
      met: true,
    });
  });

  it('opens exactly ON the number, and not one above it', () => {
    expect(readGate(frenzy, sheet(18))?.met).toBe(true);
    expect(readGate(frenzy, sheet(19))?.met).toBe(false);
  });

  it('a counter nobody can find is never met, and says so by having no current', () => {
    const reading = readGate(frenzy, { resources: [{ name: 'Grit', value: 0 }] });
    expect(reading).toEqual({ counter: 'Health', at: 18, met: false });
  });

  it('no gate, no reading', () => {
    expect(readGate({ lists: {} }, sheet(1))).toBeUndefined();
  });
});
