// The `.story` format itself — no store, no host, just bytes in and
// bytes out. What's pinned here is the part a reader on another machine
// depends on: the manifest survives, `contains` cannot lie about the
// body beside it, and reading stays forgiving no matter what arrives.

import { describe, expect, it } from 'vitest';
import {
  ALL_SECTIONS,
  MAX_ASSET_BYTES,
  STORY_VERSION,
  assembleStory,
  containsOf,
  isAssetKey,
  isStoryId,
  newStoryId,
  parseStory,
  storyFilename,
  storyKind,
  toManifest,
  toRights,
  toSections,
  withoutUndo,
  type StoryBody,
} from './bundle.ts';
import { writeArchive } from './archive.ts';

const manifest = {
  story: 'sto_0123456789ab',
  version: 1,
  name: 'The Unlikely Duo',
  requires: {},
  rights: { basis: 'personal' as const },
  exportedAt: '2026-08-20T00:00:00.000Z',
};

const body: StoryBody = {
  campaign: { id: 'ent_root', name: 'The Unlikely Duo', lists: {} },
};

describe('rights', () => {
  it('the pack vocabulary, verbatim — and absent reads personal', () => {
    expect(toRights(undefined)).toEqual({ basis: 'personal' });
    expect(toRights({ basis: 'homebrew' })).toEqual({ basis: 'homebrew' });
    expect(toRights({ basis: 'licensed', holder: 'A Publisher', terms: 'ask' })).toEqual({
      basis: 'licensed',
      holder: 'A Publisher',
      terms: 'ask',
    });
    // A word nobody declared is not a new basis — it's a personal story
    // with a typo in it.
    expect(toRights({ basis: 'whatever' })).toEqual({ basis: 'personal' });
    expect(toRights('homebrew')).toEqual({ basis: 'homebrew' });
  });
});

describe('sections', () => {
  it('everything defaults on; naming one switch turns off exactly one', () => {
    expect(toSections(undefined)).toEqual(ALL_SECTIONS);
    expect(toSections({ undo: false })).toEqual({ ...ALL_SECTIONS, undo: false });
    expect(toSections({ assets: false }).events).toBe(true);
  });

  it('undo cannot outlive the history it annotates', () => {
    expect(toSections({ events: false, undo: true })).toMatchObject({
      events: false,
      undo: false,
    });
  });

  it('strips the before-snapshot and keeps the event', () => {
    const event = { entityId: 'ent_1', actor: 'dm', kind: 'entity.updated', at: 'now', payload: { before: { x: 1 }, after: { x: 2 } } };
    expect(withoutUndo(event).payload).toEqual({ after: { x: 2 } });
    // A payload with nothing to strip travels untouched, including one
    // that isn't an object at all.
    expect(withoutUndo({ ...event, payload: 'raw' }).payload).toBe('raw');
  });
});

describe('identity', () => {
  it('mints sto_ ids and recognises them', () => {
    const id = newStoryId();
    expect(isStoryId(id)).toBe(true);
    expect(isStoryId('pak_0123456789ab')).toBe(false);
    expect(isStoryId(undefined)).toBe(false);
  });
});

describe('the kind is derived, never stored', () => {
  it('reads what is inside', () => {
    expect(storyKind(['campaign', 'templates'])).toBe('a starting kit');
    expect(storyKind(['campaign', 'templates', 'entities'])).toBe('a campaign');
    expect(storyKind(['campaign', 'entities', 'events'])).toBe('a table in progress');
    expect(storyKind(['campaign'])).toBe('an empty campaign');
  });
});

describe('assemble and parse', () => {
  it('round-trips a whole body', () => {
    const full: StoryBody = {
      campaign: { id: 'ent_root', name: 'Duo', lists: { resources: [{ name: 'Supplies', value: 2 }] } },
      templates: [{ slot: 'bestiary', entry: { id: 'npc_1', name: 'Lurker' } }],
      entities: [
        { entity: { id: 'ent_a', name: 'Barrett', lists: {} }, parent: null },
        { entity: { id: 'ent_b', name: 'Pistol', lists: {} }, parent: 'ent_a' },
      ],
      turn: { order: [], turn: null, round: 3 },
      boards: [{ id: 'brd_1', key: 'map/x.png', name: 'Canyon', state: { tokens: [] } }],
      events: [{ entityId: null, actor: 'dm', kind: 'dice.rolled', at: 'then', payload: { pool: '2d6' } }],
      assets: [{ name: 'art/handouts/a.png', data: Buffer.from('bytes') }],
    };
    const file = parseStory(assembleStory(manifest, full));
    expect(file.manifest.teller).toBe(STORY_VERSION);
    expect(file.manifest.story).toBe(manifest.story);
    expect(file.campaign).toEqual(full.campaign);
    expect(file.templates).toEqual(full.templates);
    expect(file.entities).toEqual(full.entities);
    expect(file.turn).toEqual(full.turn);
    expect(file.boards).toEqual(full.boards);
    expect(file.events).toEqual(full.events);
    expect(file.assets.get('art/handouts/a.png')?.toString()).toBe('bytes');
  });

  it('contains is computed from the body, so the two cannot disagree', () => {
    expect(containsOf(body)).toEqual(['campaign']);
    const file = parseStory(assembleStory(manifest, body));
    expect(file.manifest.contains).toEqual(['campaign']);
    expect(file.templates).toEqual([]);
    expect(file.turn).toBeUndefined();
  });

  it('refuses anything that is not a story, and says which way it is wrong', () => {
    expect(() => parseStory(Buffer.from('nonsense'))).toThrow(/not an archive/);
    const zip = writeArchive([{ name: 'pack.json', data: Buffer.from('{}') }]);
    expect(() => parseStory(zip)).toThrow(/not a \.story/);
  });

  it('refuses a pre-fold bundle by name, not as a corrupt file', () => {
    // The old world's manifest was teller.json (versions 1-2). "Not a
    // .story" would be true and useless — the refusal names the format
    // and the way through.
    const old = writeArchive([
      { name: 'teller.json', data: Buffer.from(JSON.stringify({ teller: 2, name: 'x' })) },
    ]);
    expect(() => parseStory(old)).toThrow(/pre-fold/);
  });

  it('reads forgivingly: a garbled section is empty, not fatal', () => {
    const zip = writeArchive([
      { name: 'story.json', data: Buffer.from(JSON.stringify({ ...manifest, teller: 2 })) },
      { name: 'entities.json', data: Buffer.from('{ not json') },
      { name: 'events.json', data: Buffer.from('"a string"') },
    ]);
    const file = parseStory(zip);
    expect(file.manifest.teller).toBe(2);
    expect(file.entities).toEqual([]);
    expect(file.events).toEqual([]);
  });

  it('an asset can only live under the two roots that serve them', () => {
    expect(isAssetKey('art/handouts/a.png')).toBe(true);
    expect(isAssetKey('map/canyon.png')).toBe(true);
    expect(isAssetKey('books/secret.pdf')).toBe(false);
    expect(isAssetKey('art/../../etc/passwd')).toBe(false);
    // …and the guard runs on the way in as well as on the way out.
    const zip = assembleStory(manifest, {
      ...body,
      assets: [
        { name: 'books/whole-rulebook.pdf', data: Buffer.from('nope') },
        { name: 'art/ok.png', data: Buffer.from('yes') },
        { name: 'art/huge.png', data: Buffer.alloc(MAX_ASSET_BYTES + 1) },
      ],
    });
    const file = parseStory(zip);
    expect([...file.assets.keys()]).toEqual(['art/ok.png']);
  });
});

describe('the manifest', () => {
  it('reads what a past shape wrote, and refuses what has no version at all', () => {
    expect(toManifest({ teller: 2, name: 'Old', requires: { packs: [{ id: 'pak_1' }] } })).toMatchObject({
      teller: 2,
      name: 'Old',
      version: 1,
      rights: { basis: 'personal' },
      requires: { packs: [{ id: 'pak_1', name: 'pak_1' }] },
    });
    expect(toManifest({ name: 'no teller number' })).toBeUndefined();
    expect(toManifest('nonsense')).toBeUndefined();
  });
});

describe('the filename', () => {
  it('looks like what it is when it lands in Downloads', () => {
    expect(storyFilename('The Unlikely Duo')).toBe('the-unlikely-duo.story');
    expect(storyFilename('  ')).toBe('campaign.story');
  });
});
