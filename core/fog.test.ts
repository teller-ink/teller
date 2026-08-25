// Fog, and the two things it must never get wrong: what an old board
// meant, and where the dark actually is.
//
// The migration cases are written as the promise they have to keep —
// a board written before the base existed must RENDER IDENTICALLY
// after it. That is a stronger claim than "the fields map across", and
// it is the one a DM would notice breaking, so the mask is what gets
// asserted rather than the shape.

import { describe, expect, it } from 'vitest';
import {
  areaFogged,
  flatFog,
  fogVisible,
  newAreaId,
  promoteRegions,
  toAreas,
  toFog,
  withAreaFogged,
  withoutArea,
  type Area,
  type Cell,
} from './fog.ts';

const A: Cell = [0, 0];
const B: Cell = [1, 1];
const C: Cell = [2, 2];

const area = (id: string, cells: Cell[]): Area => ({ id, name: id, cells });

describe('reading fog, whatever shape it was written in', () => {
  it('nothing at all is a clear map — which is no fog (rule 1)', () => {
    for (const raw of [undefined, null, 'fog', [], 42]) {
      const fog = toFog(raw);
      expect(fog).toEqual({ base: 'clear', revealed: [], fogged: [], areas: [] });
      expect(fogVisible(flatFog(fog, []))).toBe(false);
    }
  });

  it('the new shape survives a round trip, and a junk area entry does not', () => {
    const fog = toFog({
      base: 'dark',
      revealed: [A],
      fogged: [B],
      areas: [{ areaId: 'are_1', fogged: true }, { fogged: true }, 'nonsense'],
    });
    expect(fog).toEqual({
      base: 'dark',
      revealed: [A],
      fogged: [B],
      areas: [{ areaId: 'are_1', fogged: true }],
    });
  });

  it('an unknown base is not a base — it reads as the old shape', () => {
    expect(toFog({ base: 'twilight', on: true }).base).toBe('dark');
  });

  describe('the old world', () => {
    it('on:true is dark, and its revealed cells are still the light', () => {
      const fog = toFog({ on: true, revealed: [A, B] });
      expect(fog.base).toBe('dark');
      expect(flatFog(fog, [])).toEqual({ base: 'dark', revealed: [A, B], fogged: [] });
    });

    it('on:false is clear with NOTHING covered — off used to mean off', () => {
      const fog = toFog({
        on: false,
        revealed: [A],
        regions: [{ id: 'r1', name: 'the vault', cells: [B], revealed: false }],
      });
      expect(fog.base).toBe('clear');
      expect(fogVisible(flatFog(fog, []))).toBe(false);
    });

    it('a lit region folds into the freehand light, so a skipped migration still renders true', () => {
      const fog = toFog({
        on: true,
        revealed: [A],
        regions: [
          { id: 'r1', name: 'the vault', cells: [B], revealed: false },
          { id: 'r2', name: 'the porch', cells: [C], revealed: true },
        ],
      });
      const flat = flatFog(fog, []);
      expect(flat.revealed).toEqual([A, C]);
      expect(JSON.stringify(flat)).not.toContain('vault');
    });
  });
});

describe('promoting regions to board areas', () => {
  it('refuses anything that already has a base, and anything with no regions', () => {
    expect(promoteRegions({ base: 'dark', revealed: [], fogged: [], areas: [] }, [])).toBeUndefined();
    expect(promoteRegions({ on: true, revealed: [A] }, [])).toBeUndefined();
    expect(promoteRegions(null, [])).toBeUndefined();
  });

  it('under dark, a region becomes an area and its reveal flag becomes fight-side fog', () => {
    const promoted = promoteRegions(
      {
        on: true,
        revealed: [A],
        regions: [
          { id: 'r1', name: 'the vault', cells: [B], revealed: false },
          { id: 'r2', name: 'the porch', cells: [C], revealed: true },
        ],
      },
      [],
    )!;
    expect(promoted.areas).toEqual([
      { id: 'r1', name: 'the vault', cells: [B] },
      { id: 'r2', name: 'the porch', cells: [C] },
    ]);
    expect(promoted.fog.base).toBe('dark');
    expect(areaFogged(promoted.fog, 'r1')).toBe(true);
    expect(areaFogged(promoted.fog, 'r2')).toBe(false);
    // The promise: it renders exactly as the old shape did.
    expect(flatFog(promoted.fog, promoted.areas)).toEqual({
      base: 'dark',
      revealed: [A, C],
      fogged: [],
    });
  });

  it('under off, the shapes survive as areas and nothing goes dark', () => {
    const promoted = promoteRegions(
      { on: false, regions: [{ id: 'r1', name: 'the vault', cells: [B], revealed: false }] },
      [],
    )!;
    expect(promoted.areas.map((a) => a.name)).toEqual(['the vault']);
    expect(promoted.fog.base).toBe('clear');
    expect(fogVisible(flatFog(promoted.fog, promoted.areas))).toBe(false);
  });

  it('an area a human already authored is not replaced by one this invented', () => {
    const mine = area('r1', [A, B, C]);
    const promoted = promoteRegions(
      { on: true, regions: [{ id: 'r1', name: 'renamed', cells: [B], revealed: true }] },
      [mine],
    )!;
    expect(promoted.areas).toEqual([mine]);
  });

  it('a region with no id gets one rather than being dropped', () => {
    const promoted = promoteRegions(
      { on: true, regions: [{ name: 'the vault', cells: [B], revealed: true }] },
      [],
    )!;
    expect(promoted.areas[0].id).toMatch(/^are_[0-9a-f]{12}$/);
    expect(promoted.fog.areas[0].areaId).toBe(promoted.areas[0].id);
  });
});

describe('the effective mask', () => {
  const vault = area('a1', [B]);
  const porch = area('a2', [C]);

  it('under dark, freehand light and lifted areas are the light', () => {
    const fog = withAreaFogged(toFog({ base: 'dark', revealed: [A] }), 'a2', false);
    expect(flatFog(fog, [vault, porch])).toEqual({
      base: 'dark',
      revealed: [A, C],
      fogged: [],
    });
  });

  it('under clear, freehand darkness and covered areas are the dark', () => {
    const fog = withAreaFogged(toFog({ base: 'clear', fogged: [A] }), 'a1', true);
    expect(flatFog(fog, [vault, porch])).toEqual({
      base: 'clear',
      revealed: [],
      fogged: [A, B],
    });
  });

  it('an area nobody has ruled on matches its base', () => {
    expect(areaFogged(toFog({ base: 'dark' }), 'a1')).toBe(true);
    expect(areaFogged(toFog({ base: 'clear' }), 'a1')).toBe(false);
    // Which is to say: authoring an area changes nothing on the table.
    expect(flatFog(toFog({ base: 'clear' }), [vault, porch]).fogged).toEqual([]);
    expect(flatFog(toFog({ base: 'dark' }), [vault, porch]).revealed).toEqual([]);
  });

  it('freehand and areas combine rather than one winning', () => {
    let fog = toFog({ base: 'clear', fogged: [A] });
    fog = withAreaFogged(fog, 'a1', true);
    fog = withAreaFogged(fog, 'a2', true);
    expect(flatFog(fog, [vault, porch]).fogged).toEqual([A, B, C]);
  });

  it('forgetting an area forgets its state too', () => {
    const fog = withAreaFogged(toFog({ base: 'clear' }), 'a1', true);
    expect(withoutArea(fog, 'a1').areas).toEqual([]);
    expect(flatFog(withoutArea(fog, 'a1'), [porch]).fogged).toEqual([]);
  });

  it('setting an area twice leaves one ruling, not two', () => {
    const fog = withAreaFogged(withAreaFogged(toFog({ base: 'clear' }), 'a1', true), 'a1', false);
    expect(fog.areas).toEqual([{ areaId: 'a1', fogged: false }]);
  });
});

describe('areas, narrowed at both edges', () => {
  it('keeps what it can read and mints what it must', () => {
    const areas = toAreas([
      { id: 'a1', name: 'the vault', cells: [A] },
      { name: 'nameless id' },
      { id: 'a1', name: 'a second claim on one id' },
      'nonsense',
      null,
    ]);
    expect(areas).toHaveLength(2);
    expect(areas[0]).toEqual({ id: 'a1', name: 'the vault', cells: [A] });
    expect(areas[1].id).toMatch(/^are_/);
    expect(areas[1].cells).toEqual([]);
    expect(toAreas('nope')).toEqual([]);
  });

  it('mints ids the shape everything else in teller mints', () => {
    expect(newAreaId()).toMatch(/^are_[0-9a-f]{12}$/);
    expect(newAreaId()).not.toBe(newAreaId());
  });
});
