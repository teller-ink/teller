// Fog, and the three things it must never get wrong: where the dark
// actually is, what an old board meant, and what an area's state is
// when nobody stored one.
//
// The migration cases are written as the promise they have to keep — a
// board written under either older shape must RENDER IDENTICALLY after
// it. That is a stronger claim than "the fields map across", and it is
// the one a DM would notice breaking, so the resulting set is what gets
// asserted rather than the shape.

import { describe, expect, it } from 'vitest';
import {
  allCells,
  areaStatus,
  clear,
  coverAll,
  darken,
  fogVisible,
  migrateFog,
  newAreaId,
  restCells,
  toAreas,
  toFog,
  type Area,
  type Cell,
  type Grid,
} from './fog.ts';

const A: Cell = [0, 0];
const B: Cell = [1, 1];
const C: Cell = [2, 2];

const area = (id: string, cells: Cell[]): Area => ({ id, name: id, cells });
/** Three across, two down — small enough to write the whole map out. */
const GRID: Grid = { cols: 3, rows: 2 };
const ALL: Cell[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [2, 1],
];

describe('the set, and the two verbs', () => {
  it('a new board has no fog, and nothing to draw', () => {
    for (const raw of [undefined, null, 'fog', [], 42, {}]) {
      expect(toFog(raw)).toEqual({ dark: [] });
      expect(fogVisible(toFog(raw))).toBe(false);
    }
  });

  it('darken adds, clear removes, and neither is a mode', () => {
    let fog = darken({ dark: [] }, [A, B]);
    expect(fog.dark).toEqual([A, B]);
    fog = clear(fog, [A]);
    expect(fog.dark).toEqual([B]);
    expect(fogVisible(fog)).toBe(true);
  });

  it('darkening a cell twice leaves one of it', () => {
    const fog = darken(darken({ dark: [] }, [A]), [A, B]);
    expect(fog.dark).toEqual([A, B]);
  });

  it('clearing a cell nobody darkened is a no-op', () => {
    const fog = { dark: [A] };
    expect(clear(fog, [C]).dark).toEqual([A]);
    expect(clear(fog, [])).toBe(fog);
  });

  it('cover all is every cell of the grid; no grid is no cells, so no fog', () => {
    expect(coverAll(GRID).dark).toEqual(ALL);
    expect(coverAll(null).dark).toEqual([]);
    expect(fogVisible(coverAll(undefined))).toBe(false);
  });

  it('a fractional row count rounds UP — the last strip of map is still map', () => {
    expect(allCells({ cols: 2, rows: 1.4 })).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it('the round trip through the serializer keeps the set', () => {
    expect(toFog({ dark: [A, C] })).toEqual({ dark: [A, C] });
  });
});

describe("an area's state, derived and never stored", () => {
  const vault = area('a1', [A, B]);

  it('every cell dark is fogged, no cell dark is lifted, some is partial', () => {
    expect(areaStatus({ dark: [A, B] }, vault)).toBe('fogged');
    expect(areaStatus({ dark: [] }, vault)).toBe('lifted');
    expect(areaStatus({ dark: [C] }, vault)).toBe('lifted');
    expect(areaStatus({ dark: [A] }, vault)).toBe('partial');
  });

  it('a room being drawn is not a room in darkness', () => {
    expect(areaStatus({ dark: [A, B] }, area('a2', []))).toBe('lifted');
  });

  it('fogging and lifting an area is just the two verbs on its cells', () => {
    const fog = darken({ dark: [] }, vault.cells);
    expect(areaStatus(fog, vault)).toBe('fogged');
    expect(areaStatus(clear(fog, vault.cells), vault)).toBe('lifted');
  });

  it('an area carries no state, so deleting it changes nothing about the dark', () => {
    // Which is the whole claim: areas are geometry. Forgetting the name
    // leaves the paint exactly where it was.
    const fog = darken({ dark: [] }, vault.cells);
    expect(fog.dark).toEqual([A, B]);
  });
});

describe('everywhere else — derived at ask-time, never stored', () => {
  it('is the map minus every area, and moves when an area does', () => {
    const vault = area('a1', [
      [0, 0],
      [1, 0],
    ]);
    const porch = area('a2', [[2, 0]]);
    expect(restCells(GRID, [])).toEqual(ALL);
    expect(restCells(GRID, [vault])).toEqual([
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    // Draw another room and the remainder shrinks; forget it and the
    // remainder takes those cells back. Nothing was written either way.
    expect(restCells(GRID, [vault, porch])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(restCells(GRID, [porch])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it('a board with no grid has no remainder — no cells, no fog', () => {
    expect(restCells(null, [area('a1', [A])])).toEqual([]);
  });

  it('areas and the remainder partition the map, which is why cover-all is one fill', () => {
    const vault = area('a1', [
      [0, 0],
      [2, 1],
    ]);
    const covered = darken(darken({ dark: [] }, vault.cells), restCells(GRID, [vault]));
    expect(new Set(covered.dark.map(String))).toEqual(new Set(coverAll(GRID).dark.map(String)));
  });
});

// ---------------------------------------------------------------------
// The migrations. Two old shapes, both of which ran on real data.

describe('migrating the pre-phase-0 shape { on, revealed, regions }', () => {
  it('reads lazily as far as it honestly can', () => {
    // A clear world reads exactly; a dark one has no cells written down
    // and waits for the grid rather than inventing bounds.
    expect(toFog({ on: false, revealed: [A] })).toEqual({ dark: [] });
    expect(toFog({ on: true, revealed: [A] })).toEqual({ dark: [] });
  });

  it('on:true is everything dark, minus the revealed cells', () => {
    const done = migrateFog({ on: true, revealed: [A] }, [], GRID)!;
    expect(done.fog.dark).toEqual([
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(done.areas).toEqual([]);
  });

  it('a region becomes an AREA, and its reveal flag becomes light', () => {
    const done = migrateFog(
      {
        on: true,
        revealed: [A],
        regions: [
          { id: 'r1', name: 'the vault', cells: [[2, 1]], revealed: false },
          { id: 'r2', name: 'the porch', cells: [[1, 1]], revealed: true },
        ],
      },
      [],
      GRID,
    )!;
    expect(done.areas).toEqual([
      { id: 'r1', name: 'the vault', cells: [[2, 1]] },
      { id: 'r2', name: 'the porch', cells: [[1, 1]] },
    ]);
    // The promise: it renders exactly as the old shape did — everything
    // dark but the freehand cell and the lit room.
    expect(done.fog.dark).toEqual([
      [1, 0],
      [2, 0],
      [0, 1],
      [2, 1],
    ]);
    expect(areaStatus(done.fog, done.areas[0])).toBe('fogged');
    expect(areaStatus(done.fog, done.areas[1])).toBe('lifted');
  });

  it('under on:false the shapes survive and nothing goes dark — off meant off', () => {
    const done = migrateFog(
      { on: false, regions: [{ id: 'r1', name: 'the vault', cells: [B], revealed: false }] },
      [],
      GRID,
    )!;
    expect(done.areas.map((a) => a.name)).toEqual(['the vault']);
    expect(fogVisible(done.fog)).toBe(false);
  });

  it('an area a human already authored is not replaced by one this invented', () => {
    const mine = area('r1', [C]);
    const done = migrateFog(
      { on: true, regions: [{ id: 'r1', name: 'renamed', cells: [B], revealed: true }] },
      [mine],
      GRID,
    )!;
    expect(done.areas).toEqual([mine]);
    // And the stored cells are the ones that get lifted, not the file's.
    expect(areaStatus(done.fog, mine)).toBe('lifted');
  });

  it('a region with no id gets one rather than being dropped', () => {
    const done = migrateFog(
      { on: false, regions: [{ name: 'the vault', cells: [B], revealed: true }] },
      [],
      GRID,
    )!;
    expect(done.areas[0].id).toMatch(/^are_[0-9a-f]{12}$/);
  });
});

describe('migrating the phase-0 shape { base, revealed, fogged, areas }', () => {
  const vault = area('a1', [[2, 1]]);
  const porch = area('a2', [[1, 1]]);

  it('reads lazily as far as it honestly can', () => {
    expect(toFog({ base: 'clear', fogged: [A], revealed: [B] })).toEqual({ dark: [A] });
    expect(toFog({ base: 'dark', revealed: [A] })).toEqual({ dark: [] });
  });

  it("base:'clear' is the painted darkness plus the areas marked covered", () => {
    const done = migrateFog(
      {
        base: 'clear',
        revealed: [],
        fogged: [A],
        areas: [{ areaId: 'a1', fogged: true }, { areaId: 'a2', fogged: false }],
      },
      [vault, porch],
      GRID,
    )!;
    expect(done.fog.dark).toEqual([A, [2, 1]]);
    expect(done.areas).toEqual([vault, porch]);
    expect(JSON.stringify(done.fog)).not.toContain('areaId');
  });

  it("base:'dark' is everything minus the revealed cells and the lifted areas", () => {
    const done = migrateFog(
      { base: 'dark', revealed: [A], fogged: [], areas: [{ areaId: 'a2', fogged: false }] },
      [vault, porch],
      GRID,
    )!;
    expect(done.fog.dark).toEqual([
      [1, 0],
      [2, 0],
      [0, 1],
      [2, 1],
    ]);
    // An area nobody ruled on matched its base, and still does.
    expect(areaStatus(done.fog, vault)).toBe('fogged');
    expect(areaStatus(done.fog, porch)).toBe('lifted');
  });

  it('a cell somebody revealed stays revealed even inside a covered area', () => {
    const done = migrateFog(
      { base: 'dark', revealed: [[2, 1]], areas: [{ areaId: 'a1', fogged: true }] },
      [vault],
      GRID,
    )!;
    expect(areaStatus(done.fog, vault)).toBe('lifted');
  });
});

describe('when the migration declines to write', () => {
  it('refuses anything that is already a set', () => {
    expect(migrateFog({ dark: [A] }, [], GRID)).toBeUndefined();
    expect(migrateFog({ dark: [] }, [], GRID)).toBeUndefined();
    expect(migrateFog(null, [], GRID)).toBeUndefined();
  });

  it('leaves a blob that means "no fog" and promotes nothing where it lies', () => {
    // Rewriting it would put every board on the host into the event log
    // to say that nothing changed.
    expect(migrateFog({ on: false, revealed: [A] }, [], GRID)).toBeUndefined();
    expect(migrateFog({ base: 'clear', fogged: [] }, [], GRID)).toBeUndefined();
  });

  it('is a no-op when the board has no grid — no cells was never any fog', () => {
    expect(migrateFog({ on: true, revealed: [] }, [], null)).toBeUndefined();
  });

  it('is idempotent: what it writes, it will not rewrite', () => {
    const done = migrateFog({ on: true, revealed: [A] }, [], GRID)!;
    expect(migrateFog(done.fog, done.areas, GRID)).toBeUndefined();
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
