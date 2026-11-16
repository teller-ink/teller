import { describe, expect, it } from 'vitest';
import { typedValue } from './typed.ts';

describe('typedValue', () => {
  it('reads a bare number as exactly that number', () => {
    expect(typedValue('25', 34)).toBe(25);
    expect(typedValue('  0 ', 34)).toBe(0);
    expect(typedValue('2.5', 0)).toBe(2.5);
  });

  it('never clamps what a human typed', () => {
    expect(typedValue('40', 34)).toBe(40);
    expect(typedValue('-40', 34)).toBe(-6);
  });

  it('reads a leading sign as relative to what is stored', () => {
    expect(typedValue('-9', 34)).toBe(25);
    expect(typedValue('+3', 34)).toBe(37);
    expect(typedValue('- 9', 34)).toBe(25);
    expect(typedValue('−9', 34)).toBe(25);
  });

  it('takes `=` as the way to an exact negative', () => {
    expect(typedValue('=-2', 5)).toBe(-2);
    expect(typedValue('=7', 5)).toBe(7);
  });

  it('cancels on anything that is not a number', () => {
    for (const t of ['', '   ', 'abc', '5-', '--3', '+', '=', '1e3', '3 4', '=+2']) {
      expect(typedValue(t, 10)).toBeNull();
    }
  });
});
