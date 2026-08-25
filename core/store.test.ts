import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCampaign,
  listCampaigns,
  openCampaign,
  openShelf,
  validSlug,
  type Campaign,
} from './store.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-core-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the campaign file', () => {
  it('createCampaign seeds the manifest as the root entity', () => {
    const campaign = createCampaign(dir, 'unlikely-duo', 'The Unlikely Duo');
    const root = campaign.root();
    expect(root.name).toBe('The Unlikely Duo');
    expect(root.type).toBe('campaign');
    expect(campaign.events()[0]).toMatchObject({
      kind: 'campaign.created',
      entityId: root.id,
    });
    campaign.close();
  });

  it('a typo cannot mint a campaign, and a slug cannot walk out of campaigns/', () => {
    expect(() => openCampaign(dir, 'no-such')).toThrow(/no campaign/);
    expect(validSlug('../shelf')).toBe(false);
    expect(validSlug('Unlikely Duo')).toBe(false);
    expect(() => createCampaign(dir, '../evil', 'x')).toThrow(/slug/);
  });

  it('creating twice is refused', () => {
    createCampaign(dir, 'dup', 'Dup').close();
    expect(() => createCampaign(dir, 'dup', 'Dup')).toThrow(/already exists/);
  });

  it('listCampaigns shows the files, and an empty dir is just empty', () => {
    expect(listCampaigns(dir)).toEqual([]);
    createCampaign(dir, 'bravo', 'B').close();
    createCampaign(dir, 'alpha', 'A').close();
    expect(listCampaigns(dir)).toEqual(['alpha', 'bravo']);
  });

  it('survives a close and reopen — the file is the campaign', () => {
    const first = createCampaign(dir, 'keeps', 'Keeps');
    const rootId = first.root().id;
    first.create({ name: 'Barrett', type: 'character', lists: {} }, 'dm');
    first.close();
    const again = openCampaign(dir, 'keeps');
    expect(again.root().id).toBe(rootId);
    expect(again.children(rootId).map((e) => e.name)).toEqual(['Barrett']);
    again.close();
  });
});

describe('entities and the event log', () => {
  let campaign: Campaign;

  beforeEach(() => {
    campaign = createCampaign(dir, 'test', 'Test');
  });

  afterEach(() => {
    campaign.close();
  });

  it('every mutation appends — created, updated, deleted, each walkable backward', () => {
    const barrett = campaign.create(
      {
        name: 'Barrett',
        type: 'character',
        lists: { resources: [{ name: 'Grit', value: 2, max: 3 }] },
      },
      'dm',
    );
    campaign.save(
      { ...barrett, lists: { resources: [{ name: 'Grit', value: 1, max: 3 }] } },
      'seat:barrett',
    );
    campaign.remove(barrett.id, 'dm');

    const kinds = campaign
      .events({ entityId: barrett.id })
      .map((e) => e.kind);
    expect(kinds).toEqual(['entity.deleted', 'entity.updated', 'entity.created']);

    const updated = campaign.events({ entityId: barrett.id })[1];
    expect(updated.actor).toBe('seat:barrett');
    const payload = updated.payload as { before: { lists: { resources: { value: number }[] } } };
    expect(payload.before.lists.resources[0].value).toBe(2);
  });

  it('round-trips the whole entity shape through the row', () => {
    const made = campaign.create(
      {
        name: 'Barrett',
        type: 'character',
        lists: { standings: [{ name: 'Vargas Family', value: 'Revered' }] },
        notes: 'rides at dawn',
        children: [{ id: 'ent_gun', name: 'Rusty Pistol', lists: {} }],
        refs: { from: { id: 'npc_outlaw', name: 'Outlaw' } },
      },
      'dm',
    );
    const read = campaign.get(made.id);
    expect(read).toEqual(made);
  });

  it('save refuses an entity that was never created', () => {
    expect(() =>
      campaign.save({ id: 'ent_ghost', name: 'Ghost', lists: {} }, 'dm'),
    ).toThrow(/no entity/);
  });

  it('remove cascades through promoted children, logging each', () => {
    const barrett = campaign.create({ name: 'Barrett', lists: {} }, 'dm');
    const horse = campaign.create(
      { name: 'Clementine', type: 'mount', lists: {} },
      'dm',
      barrett.id,
    );
    campaign.remove(barrett.id, 'dm');
    expect(campaign.get(horse.id)).toBeUndefined();
    expect(
      campaign.events({ entityId: horse.id }).map((e) => e.kind),
    ).toContain('entity.deleted');
  });

  it('move reparents — handing the pistol over, history riding along', () => {
    const barrett = campaign.create({ name: 'Barrett', lists: {} }, 'dm');
    const sal = campaign.create({ name: 'Sal', lists: {} }, 'dm');
    const gun = campaign.create({ name: 'Rusty Pistol', lists: {} }, 'dm', barrett.id);
    campaign.move(gun.id, sal.id, 'dm');
    expect(campaign.children(sal.id).map((e) => e.id)).toContain(gun.id);
    expect(campaign.children(barrett.id)).toEqual([]);
    expect(campaign.parentOf(gun.id)).toBe(sal.id);
    expect(campaign.events({ entityId: gun.id })[0].kind).toBe('entity.moved');
  });

  it('app-level kinds come through the same door', () => {
    campaign.append(null, 'dm', 'turn.resolved', { round: 2 });
    expect(campaign.events({ limit: 1 })[0]).toMatchObject({
      kind: 'turn.resolved',
      entityId: null,
      payload: { round: 2 },
    });
  });
});

describe('board state — the live half of §4', () => {
  it('placements live in the campaign file, keyed by board, and clear as one act', () => {
    const campaign = createCampaign(dir, 'fight', 'Fight');
    const placements = {
      placements: [{ entityId: 'ent_foe', u: 3, v: 4, sizeInches: 1 }],
      fog: { revealed: [[0, 0]] },
    };
    campaign.putBoardState('brd_canyon', placements, 'dm');
    expect(campaign.boardState('brd_canyon')).toEqual(placements);
    campaign.clearBoardState('brd_canyon', 'dm');
    expect(campaign.boardState('brd_canyon')).toBeUndefined();
    expect(campaign.events({ entityId: 'brd_canyon' }).map((e) => e.kind)).toEqual([
      'board.cleared',
      'board.updated',
    ]);
    campaign.close();
  });
});

describe('the shelf', () => {
  it('boards are assets: put, read back, list, remove', () => {
    const shelf = openShelf(dir);
    const board = shelf.putBoard({
      key: 'map/canyon.png',
      name: 'Copper Canyon',
      widthInches: 36,
      grid: { inches: 1 },
    });
    expect(board.id).toMatch(/^brd_/);
    expect(shelf.board(board.id)).toEqual(board);
    expect(shelf.boards()).toHaveLength(1);
    shelf.removeBoard(board.id);
    expect(shelf.boards()).toEqual([]);
    shelf.close();
  });

  // Both edges coerce (rule 8), so the geography a board carries has to
  // survive the column it is stored in — and an EMPTY list has to come
  // back absent rather than as `[]`, because "no terrain" and "a terrain
  // list with nothing in it" would then be two answers to one question.
  it('a board carries its areas and its terrain through the column', () => {
    const shelf = openShelf(dir);
    const board = shelf.putBoard({
      key: 'map/crossing.png',
      name: 'The Crossing',
      areas: [{ id: 'are_ford', name: 'the ford', cells: [[5, 15]] }],
      terrain: [
        {
          id: 'ter_water',
          kind: 'deep water',
          description: 'waist-deep, footing treacherous',
          elevation: -1,
          blocksSight: false,
          areaId: 'are_ford',
        },
        { id: 'ter_ridge', kind: 'ridge', blocksSight: true, cells: [[12, 15]] },
      ],
    });
    const read = shelf.board(board.id)!;
    expect(read.areas).toEqual([{ id: 'are_ford', name: 'the ford', cells: [[5, 15]] }]);
    expect(read.terrain).toEqual([
      {
        id: 'ter_water',
        kind: 'deep water',
        description: 'waist-deep, footing treacherous',
        elevation: -1,
        // `false` is not a fact worth storing — absent reads as "does
        // not block", the way an absent Defense reads as zero (§M-8).
        areaId: 'are_ford',
      },
      { id: 'ter_ridge', kind: 'ridge', blocksSight: true, cells: [[12, 15]] },
    ]);

    shelf.putBoard({ ...read, terrain: [] });
    expect(shelf.board(board.id)?.terrain).toBeUndefined();
    shelf.close();
  });

  it('systems and packs hold their template blob for boot-time resolution', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({
      id: 'sys_wiw',
      name: 'Wild Imaginary West',
      version: 22,
      builtin: true,
      data: { kinds: [{ name: 'conditions' }] },
    });
    shelf.putPack({
      id: 'pak_guide',
      system: 'sys_wiw',
      name: 'Guidebook',
      data: { bestiary: [] },
    });
    expect(shelf.system('sys_wiw')?.version).toBe(22);
    expect(shelf.system('sys_wiw')?.data).toEqual({
      kinds: [{ name: 'conditions' }],
    });
    expect(shelf.pack('pak_guide')?.system).toBe('sys_wiw');
    expect(shelf.packsFor('sys_wiw')).toEqual(['pak_guide']);
    expect(shelf.system('sys_missing')).toBeUndefined();
    shelf.close();
  });

  it('putting a system twice upgrades in place — arrival is a proposal, identity is the id', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_x', name: 'X', version: 1, data: {} });
    shelf.putSystem({ id: 'sys_x', name: 'X, renamed', version: 2, data: {} });
    expect(shelf.system('sys_x')).toMatchObject({ name: 'X, renamed', version: 2 });
    shelf.close();
  });
});
