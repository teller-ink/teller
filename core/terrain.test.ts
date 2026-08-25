// TERRAIN — the ground, narrowed and resolved.
//
// Three things are worth pinning here and the third is the reason the
// file exists. The serializer, because a board row is read at both edges
// (rule 8) and a patch that loses its description on a round trip loses
// the only field teller cannot regenerate. Resolution, because "which
// cells is this patch on" has exactly one answer and two callers who
// must agree. And the DANGLING BIND — a patch pointing at an area
// somebody deleted — because the honest answer is "nothing, and here is
// why", and the tempting wrong answers are a crash and a silent
// fallback onto cells the author moved away from.

import { describe, expect, it } from 'vitest';
import type { Area } from './fog.ts';
import {
  labelTerrain,
  newTerrainId,
  resolveTerrain,
  terrainCellKeys,
  terrainLabel,
  TERRAIN_KINDS,
  toTerrain,
  toTerrainPatch,
} from './terrain.ts';

const areas: Area[] = [
  { id: 'are_vault', name: 'the vault', cells: [[1, 1], [1, 2]] },
  { id: 'are_porch', name: 'the porch', cells: [] },
];

describe('minting and narrowing', () => {
  it('mints ter_ ids the shape are_ ids are', () => {
    expect(newTerrainId()).toMatch(/^ter_[0-9a-f]{12}$/);
    expect(newTerrainId()).not.toBe(newTerrainId());
  });

  it('keeps every authored field, and mints an id for a patch that arrived without one', () => {
    const patch = toTerrainPatch({
      kind: 'deep water',
      description: 'waist-deep, footing treacherous',
      elevation: -2.5,
      blocksSight: true,
      cells: [[3, 4]],
    })!;
    expect(patch.id).toMatch(/^ter_[0-9a-f]{12}$/);
    expect(patch.kind).toBe('deep water');
    expect(patch.description).toBe('waist-deep, footing treacherous');
    expect(patch.elevation).toBe(-2.5);
    expect(patch.blocksSight).toBe(true);
    expect(patch.cells).toEqual([[3, 4]]);
  });

  it('an empty field is an absent one — never a stored empty string', () => {
    const patch = toTerrainPatch({ id: 'ter_a', kind: '   ', description: '' })!;
    expect(patch).toEqual({ id: 'ter_a' });
  });

  it('elevation is a number or nothing — zero is a real height and survives', () => {
    expect(toTerrainPatch({ id: 't', elevation: 0 })!.elevation).toBe(0);
    expect(toTerrainPatch({ id: 't', elevation: 'high' })!.elevation).toBeUndefined();
    expect(toTerrainPatch({ id: 't', elevation: Number.NaN })!.elevation).toBeUndefined();
  });

  it('keeps BOTH cells and an areaId, so unbinding gives the brushwork back', () => {
    const patch = toTerrainPatch({ id: 't', cells: [[0, 0]], areaId: 'are_vault' })!;
    expect(patch.cells).toEqual([[0, 0]]);
    expect(patch.areaId).toBe('are_vault');
  });

  it('drops junk and duplicate ids rather than merging them', () => {
    const list = toTerrain([
      { id: 'ter_a', kind: 'mud' },
      'nonsense',
      null,
      { id: 'ter_a', kind: 'sand' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('mud');
    expect(toTerrain(undefined)).toEqual([]);
  });

  it('round-trips through JSON unchanged, which is what the column stores', () => {
    const list = toTerrain([
      { id: 'ter_a', kind: 'scree', description: 'loose', elevation: 3, blocksSight: true, cells: [[1, 1]] },
      { id: 'ter_b', areaId: 'are_vault' },
    ]);
    expect(toTerrain(JSON.parse(JSON.stringify(list)))).toEqual(list);
  });

  it('offers a short floor of suggestions and validates against none of it', () => {
    expect(TERRAIN_KINDS.length).toBe(6);
    // Anything typeable is a kind. The list is a datalist, not a gate.
    expect(toTerrainPatch({ id: 't', kind: 'shimmering nonsense' })!.kind).toBe(
      'shimmering nonsense',
    );
  });
});

describe('where a patch actually is', () => {
  it('a patch with its own cells covers exactly those', () => {
    const [row] = resolveTerrain(toTerrain([{ id: 't', cells: [[5, 5], [5, 6]] }]), areas);
    expect(row.cells).toEqual([[5, 5], [5, 6]]);
    expect(row.missingArea).toBeUndefined();
  });

  it('a patch bound to an area covers the AREA’s cells, and follows it when it moves', () => {
    const patches = toTerrain([{ id: 't', areaId: 'are_vault', cells: [[9, 9]] }]);
    expect(resolveTerrain(patches, areas)[0].cells).toEqual([[1, 1], [1, 2]]);
    const moved: Area[] = [{ id: 'are_vault', name: 'the vault', cells: [[7, 7]] }];
    expect(resolveTerrain(patches, moved)[0].cells).toEqual([[7, 7]]);
  });

  it('an area with no cells yet is an empty patch, not an error', () => {
    expect(resolveTerrain(toTerrain([{ id: 't', areaId: 'are_porch' }]), areas)[0].cells).toEqual(
      [],
    );
  });

  // The tempting wrong answers, both refused: throwing, and quietly
  // falling back to the cells the author explicitly bound away from.
  it('a dangling areaId covers nothing and SAYS so — no crash, no silent fallback', () => {
    const [row] = resolveTerrain(
      toTerrain([{ id: 't', areaId: 'are_gone', cells: [[9, 9]] }]),
      areas,
    );
    expect(row.cells).toEqual([]);
    expect(row.missingArea).toBe('are_gone');
    // The brushwork is still on the row, so rebinding or unbinding
    // restores it.
    expect(row.patch.cells).toEqual([[9, 9]]);
  });

  it('a patch with neither cells nor a bind covers nothing quietly — it is being drawn', () => {
    const [row] = resolveTerrain(toTerrain([{ id: 't', kind: 'mud' }]), areas);
    expect(row.cells).toEqual([]);
    expect(row.missingArea).toBeUndefined();
  });

  it('collects every covered cell as one key set', () => {
    const resolved = resolveTerrain(
      toTerrain([{ id: 'a', cells: [[0, 0], [1, 0]] }, { id: 'b', areaId: 'are_vault' }]),
      areas,
    );
    expect([...terrainCellKeys(resolved)].sort()).toEqual(['0,0', '1,0', '1,1', '1,2']);
  });
});

describe('what to call a patch', () => {
  it('the kind, else the area it claims, else an honest placeholder', () => {
    expect(terrainLabel({ id: 't', kind: 'ford' }, areas)).toBe('ford');
    expect(terrainLabel({ id: 't', areaId: 'are_vault' }, areas)).toBe('the vault');
    expect(terrainLabel({ id: 't' }, areas)).toBe('unnamed ground');
    // A bind nobody can resolve names nothing, so it falls all the way
    // through rather than printing an id at a human.
    expect(terrainLabel({ id: 't', areaId: 'are_gone' }, areas)).toBe('unnamed ground');
  });

  // Downstream facts are keyed by name; two rows wearing one word is an
  // ambiguous aggregate, and those teach wrong answers.
  it('makes labels unique on a collision and leaves them alone otherwise', () => {
    const labels = labelTerrain(
      toTerrain([
        { id: 'a', kind: 'water' },
        { id: 'b', kind: 'water' },
        { id: 'c', kind: 'scree' },
      ]),
      areas,
    );
    expect(labels.get('a')).toBe('water');
    expect(labels.get('b')).toBe('water (2)');
    expect(labels.get('c')).toBe('scree');
  });
});
