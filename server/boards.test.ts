// The board doors — the asset half of §4, and what they must never do.
//
// What these pin is the SEAM. A board is a shelf row and the fight on it
// is campaign state, so deleting a board has to take the state with it,
// let go of the table, and leave the picture alone if another board
// still names it. Every one of those was a separate small decision and
// every one of them is invisible until something needs it back.
//
// Real files and a real server, same reasoning as `books.test.ts`: a
// content-hashed upload is a thing the FILESYSTEM does, and a test that
// stubbed the disk would pin a shape the running host never produces.

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShelf, type Shelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Host } from './session.ts';
import { tokenColor } from '../core/tokens.ts';
import {
  extFor,
  migrateBoardFog,
  saveBoardBytes,
  toGrid,
  toWidthInches,
  withDeployed,
  withoutEntities,
} from './boards.ts';
import { areaStatus, coverAll, RASTER_COLS, rasterOf, toFog } from '../core/fog.ts';
import { gridOf, imageSizeOf } from './geometry.ts';

let dir: string;
let shelf: Shelf;
let host: Host;
let server: Server;
let base: string;

const KEY = 'test-key-0123456789abcdef';

async function api(
  method: string,
  path: string,
  body?: unknown,
  key: string | null = KEY,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(key ? { 'x-teller-key': key } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** The smallest thing a browser will call a picture: a 1×1 png. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function upload(
  bytes: Buffer,
  type = 'image/png',
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api/boards/upload`, {
    method: 'POST',
    headers: { 'x-teller-key': KEY, 'Content-Type': type },
    body: new Uint8Array(bytes),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-boards-'));
  mkdirSync(join(dir, 'systems', 'wiw'), { recursive: true });
  writeFileSync(
    join(dir, 'systems', 'wiw', 'system.json'),
    JSON.stringify({ id: 'sys_wiw', name: 'The System', version: 1 }),
  );
  shelf = openShelf(dir);
  host = new Host(shelf, dir);
  server = serve(host, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  await api('POST', '/api/campaigns', { name: 'The Unlikely Duo', system: 'sys_wiw' });
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  host.session?.campaign.close();
  shelf.close();
});

describe('a picture arriving', () => {
  it('lands under map/, named by its own bytes, and twice is once', async () => {
    const first = await upload(PNG);
    expect(first.status).toBe(201);
    expect(first.body.key).toMatch(/^map\/[0-9a-f]{32}\.png$/);
    expect(existsSync(join(dir, first.body.key))).toBe(true);

    const again = await upload(PNG);
    expect(again.body.key).toBe(first.body.key);
  });

  it('refuses anything that isn’t a picture, and refuses strangers', async () => {
    const wrong = await upload(PNG, 'application/pdf');
    expect(wrong.status).toBe(415);

    const stranger = await fetch(`${base}/api/boards/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(PNG),
    });
    expect(stranger.status).toBe(401);
  });
});

describe('the row', () => {
  it('mints over an uploaded key and answers on the shelf', async () => {
    const { body: up } = await upload(PNG);
    const made = await api('POST', '/api/boards', {
      key: up.key,
      name: 'Copper Canyon',
      widthInches: 36,
    });
    expect(made.status).toBe(201);
    expect(made.body.id).toMatch(/^brd_/);
    expect(made.body.widthInches).toBe(36);

    const list = await api('GET', '/api/boards');
    expect(list.body.map((b: any) => b.name)).toContain('Copper Canyon');
  });

  it('will not mint over a picture that is not there', async () => {
    const made = await api('POST', '/api/boards', { key: 'map/nope.png', name: 'x' });
    expect(made.status).toBe(400);
    // …nor over a path that tries to leave the map folder.
    const escape = await api('POST', '/api/boards', { key: '../dm.key', name: 'x' });
    expect(escape.status).toBe(400);
  });

  it('takes a correction later — rule 1, every stat is typed over', async () => {
    const { body: up } = await upload(PNG);
    const { body: board } = await api('POST', '/api/boards', { key: up.key, name: 'Draft' });

    const named = await api('PATCH', `/api/boards/${board.id}`, {
      name: 'Mountain Pass',
      widthInches: 30,
      grid: { on: true, color: '#ffffff', opacity: 0.3 },
    });
    expect(named.body).toMatchObject({
      name: 'Mountain Pass',
      widthInches: 30,
      grid: { on: true, color: '#ffffff', opacity: 0.3 },
    });

    // An explicit null takes the width back off: no width is a real
    // answer (fit-to-screen, no cells), not a missing one.
    const cleared = await api('PATCH', `/api/boards/${board.id}`, { widthInches: null });
    expect(cleared.body.widthInches).toBeUndefined();
  });
});

describe('taking one off the shelf', () => {
  it('takes the fight with it and lets the table go', async () => {
    const { body: up } = await upload(PNG);
    const { body: board } = await api('POST', '/api/boards', { key: up.key, name: 'Clearing' });

    await api('PUT', `/api/board-state/${board.id}`, {
      data: { placements: [{ label: 'a rock', u: 0.5, v: 0.5 }] },
    });
    await api('PUT', '/api/campaign/refs', { board: board.id });
    const showing = await api('GET', '/api/public');
    expect(showing.body.board?.board.id).toBe(board.id);

    const gone = await api('DELETE', `/api/boards/${board.id}`);
    expect(gone.status).toBe(200);

    // The table is idle again rather than pointed at nothing…
    const after = await api('GET', '/api/public');
    expect(after.body.board).toBeNull();
    // …the state went with it…
    const state = await api('GET', `/api/board-state/${board.id}`);
    expect(state.body).toBeNull();
    // …and so did the bytes, since nothing else named them.
    expect(existsSync(join(dir, up.key))).toBe(false);
  });

  it('leaves the picture alone while another board still names it', async () => {
    const { body: up } = await upload(PNG);
    const { body: lit } = await api('POST', '/api/boards', { key: up.key, name: 'Lit' });
    await api('POST', '/api/boards', { key: up.key, name: 'Dark' });

    await api('DELETE', `/api/boards/${lit.id}`);
    expect(existsSync(join(dir, up.key))).toBe(true);
  });

  it('logs what happened, every time (rule 3)', async () => {
    const { body: up } = await upload(PNG);
    const { body: board } = await api('POST', '/api/boards', { key: up.key, name: 'Logged' });
    await api('PATCH', `/api/boards/${board.id}`, { name: 'Still Logged' });
    await api('DELETE', `/api/boards/${board.id}`);

    const kinds = (host.session?.campaign.events({ limit: 50 }) ?? []).map((e: any) => e.kind);
    expect(kinds).toContain('board.added');
    expect(kinds).toContain('board.edited');
    expect(kinds).toContain('board.removed');
  });
});

describe('the pattern a screen is asked to draw', () => {
  it('reaches the one screen it was aimed at, and nobody else', async () => {
    const hello = await api('POST', '/api/displays/hello', {});
    const id = hello.body.display.id;
    await api('POST', '/api/displays/claim', { code: hello.body.display.code });

    // Nothing in flight is the normal state of the world.
    const quiet = await fetch(`${base}/api/displays/calibration`, {
      headers: { 'x-teller-display': id },
    });
    expect(await quiet.json()).toBeNull();

    const aimed = await api('POST', `/api/displays/${id}/calibrate`, {
      pattern: { step: 'across', ppi: 96, ppiY: 96, inches: 12 },
    });
    expect(aimed.status).toBe(200);

    const drawing = await fetch(`${base}/api/displays/calibration`, {
      headers: { 'x-teller-display': id },
    });
    expect(await drawing.json()).toEqual({ step: 'across', ppi: 96, ppiY: 96, inches: 12 });

    // A second screen is answered about ITSELF and never about the first.
    const other = await api('POST', '/api/displays/hello', {});
    await api('POST', '/api/displays/claim', { code: other.body.display.code });
    const elsewhere = await fetch(`${base}/api/displays/calibration`, {
      headers: { 'x-teller-display': other.body.display.id },
    });
    expect(await elsewhere.json()).toBeNull();

    // And null gives the screen back to itself.
    await api('POST', `/api/displays/${id}/calibrate`, { pattern: null });
    const done = await fetch(`${base}/api/displays/calibration`, {
      headers: { 'x-teller-display': id },
    });
    expect(await done.json()).toBeNull();
  });

  it('refuses a pattern nobody could draw, and refuses strangers', async () => {
    const hello = await api('POST', '/api/displays/hello', {});
    const id = hello.body.display.id;
    await api('POST', '/api/displays/claim', { code: hello.body.display.code });

    const nonsense = await api('POST', `/api/displays/${id}/calibrate`, {
      pattern: { step: 'sideways', ppi: 96, ppiY: 96, inches: 12 },
    });
    expect(nonsense.status).toBe(400);

    const absurd = await api('POST', `/api/displays/${id}/calibrate`, {
      pattern: { step: 'across', ppi: 0, ppiY: 96, inches: 12 },
    });
    expect(absurd.status).toBe(400);

    const stranger = await api(
      'POST',
      `/api/displays/${id}/calibrate`,
      { pattern: null },
      null,
    );
    expect(stranger.status).toBe(401);
  });

  it('writes the RESULT through the ordinary display door', async () => {
    const hello = await api('POST', '/api/displays/hello', {});
    const id = hello.body.display.id;
    await api('POST', '/api/displays/claim', { code: hello.body.display.code });

    const saved = await api('PATCH', `/api/displays/${id}`, { ppi: 108.4, ppiY: 106.9 });
    expect(saved.body).toMatchObject({ ppi: 108.4, ppiY: 106.9 });

    const list = await api('GET', '/api/displays');
    expect(list.body.find((d: any) => d.id === id)).toMatchObject({ ppi: 108.4 });
  });
});

describe('reading an author defensively', () => {
  it('narrows the grid to its own vocabulary', () => {
    expect(toGrid({ on: true, color: '#fff', opacity: 0.3 })).toEqual({
      on: true,
      color: '#fff',
      opacity: 0.3,
    });
    // Not a colour, out of range, and a passenger nobody asked for.
    expect(toGrid({ color: 'red', opacity: 4, sneak: 'x' })).toBeUndefined();
    expect(toGrid('nope')).toBeUndefined();
  });

  it('tells "no width" apart from "no opinion"', () => {
    expect(toWidthInches(36)).toBe(36);
    expect(toWidthInches('36')).toBe(36);
    expect(toWidthInches(null)).toBeNull();
    expect(toWidthInches('')).toBeNull();
    expect(toWidthInches(undefined)).toBeUndefined();
    expect(toWidthInches(-2)).toBeUndefined();
  });

  it('knows a picture from anything else', () => {
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(extFor('image/png; charset=binary')).toBe('png');
    expect(extFor('text/html')).toBeUndefined();
  });

  it('hashes the same bytes to the same name', () => {
    const a = saveBoardBytes(dir, PNG, 'png');
    const b = saveBoardBytes(dir, PNG, 'png');
    expect(a).toBe(b);
  });
});

// The two edits a fight makes to a board without anyone opening the
// editor. Both are pure, so they're pinned here rather than through a
// deploy: what matters is the SHAPE — whose tokens move, whose don't.
describe('what a fight does to the state on a board', () => {
  const state = {
    placements: [
      { id: 'plc_a', entityId: 'ent_watcher', u: 0.1, v: 0.2 },
      { id: 'plc_b', label: 'a boulder', u: 0.5, v: 0.5 },
      { id: 'plc_c', entityId: 'ent_barrett', u: 0.9, v: 0.4 },
    ],
    fog: { on: true, revealed: [] },
    view: { mode: 'fit', zoom: 1, cu: 0.5, cv: 0.5 },
  };

  it('takes a deleted entity’s tokens and leaves everything else alone', () => {
    const next = withoutEntities(state, new Set(['ent_watcher'])) as typeof state;
    expect(next.placements.map((p) => p.id)).toEqual(['plc_b', 'plc_c']);
    // The rest of the blob is untouched — fog and view are nobody's foe.
    expect(next.fog).toEqual(state.fog);
    expect(next.view).toEqual(state.view);
    // A board the deletion never touched is not written at all.
    expect(withoutEntities(state, new Set(['ent_nobody']))).toBeUndefined();
    expect(withoutEntities(null, new Set(['ent_watcher']))).toBeUndefined();
  });

  it('places a staged foe with the strip’s own defaults', () => {
    const { data, placed } = withDeployed(state, [
      { entityId: 'ent_new', u: 0.25, v: 0.75 },
      { entityId: 'ent_lurker', u: 0.3, v: 0.8, hidden: true },
    ]);
    const placements = (data as typeof state).placements;
    expect(placed).toBe(2);
    expect(placements).toHaveLength(5);
    const [fresh, lurker] = placements.slice(3) as any[];
    expect(fresh).toMatchObject({ entityId: 'ent_new', u: 0.25, v: 0.75, sizeInches: 1 });
    expect(fresh.id).toMatch(/^plc_/);
    // Hidden is the recipe's, not a default: on the table unless said.
    expect(fresh.hidden).toBe(false);
    expect(lurker.hidden).toBe(true);
    // Colour continues the palette from what's already standing.
    expect(fresh.color).toBe(tokenColor(3));
    expect(lurker.color).toBe(tokenColor(4));
  });

  it('never puts a second token down for one foe', () => {
    const { data, placed } = withDeployed(state, [
      { entityId: 'ent_watcher', u: 0.4, v: 0.4 },
      { entityId: 'ent_new', u: 0.4, v: 0.5 },
      { entityId: 'ent_new', u: 0.6, v: 0.5 },
    ]);
    expect(placed).toBe(1);
    const ids = (data as typeof state).placements.map((p: any) => p.entityId);
    expect(ids.filter((id: string) => id === 'ent_watcher')).toHaveLength(1);
    expect(ids.filter((id: string) => id === 'ent_new')).toHaveLength(1);
    // The one already standing did not move to where the recipe said.
    const watcher = (data as typeof state).placements.find(
      (p: any) => p.entityId === 'ent_watcher',
    ) as any;
    expect([watcher.u, watcher.v]).toEqual([0.1, 0.2]);
  });

  it('starts a board that has never been played on', () => {
    const { data, placed } = withDeployed(undefined, [
      { entityId: 'ent_new', u: 0.5, v: 0.5 },
    ]);
    expect(placed).toBe(1);
    expect((data as any).placements[0].color).toBe(tokenColor(0));
  });
});

describe('areas — the named layer, and which door it comes in through', () => {
  async function board(): Promise<string> {
    const { body } = await upload(PNG);
    const made = await api('POST', '/api/boards', { key: body.key, name: 'The Crossing' });
    return made.body.id;
  }

  it('an area is authored on the BOARD, and survives a reread', async () => {
    const id = await board();
    const patched = await api('PATCH', `/api/boards/${id}`, {
      areas: [{ id: 'a1', name: 'the vault', cells: [[9, 9]] }],
    });
    expect(patched.status).toBe(200);
    expect(patched.body.areas).toEqual([{ id: 'a1', name: 'the vault', cells: [[9, 9]] }]);
    expect(shelf.board(id)?.areas).toEqual([{ id: 'a1', name: 'the vault', cells: [[9, 9]] }]);
  });

  it('mints an id for a patch that arrived without one, and drops the junk', async () => {
    const id = await board();
    const { body } = await api('PATCH', `/api/boards/${id}`, {
      areas: [{ name: 'the porch', cells: [[1, 1]] }, 'nonsense'],
    });
    expect(body.areas).toHaveLength(1);
    expect(body.areas[0].id).toMatch(/^are_[0-9a-f]{12}$/);
  });

  it('deleting them all clears the column rather than storing an empty list', async () => {
    const id = await board();
    await api('PATCH', `/api/boards/${id}`, { areas: [{ id: 'a1', name: 'v', cells: [] }] });
    const { body } = await api('PATCH', `/api/boards/${id}`, { areas: [] });
    expect(body.areas).toBeUndefined();
    expect(shelf.board(id)?.areas).toBeUndefined();
  });

  it('a board patched for something else keeps its areas', async () => {
    const id = await board();
    await api('PATCH', `/api/boards/${id}`, { areas: [{ id: 'a1', name: 'v', cells: [[0, 0]] }] });
    const { body } = await api('PATCH', `/api/boards/${id}`, { widthInches: 24 });
    expect(body.areas).toHaveLength(1);
  });

  // The editor's round trip, through the two doors it actually uses:
  // paint the dark into the FIGHT, name the patch onto the BOARD, then
  // forget the name. What this pins is the seam — naming a patch and
  // forgetting it are both writes to the map and NEITHER touches the
  // dark, because an area is geometry and carries no fog state at all.
  it('promoting a patch and dropping it again never moves the dark', async () => {
    const id = await board();
    const session = host.session!;
    const dark = [
      [0, 0],
      [1, 1],
    ];
    session.putBoardState(id, { fog: { dark } }, 'console');

    const named = await api('PATCH', `/api/boards/${id}`, {
      areas: [{ name: 'the vault', cells: dark }],
    });
    const area = named.body.areas[0];
    expect(area.id).toMatch(/^are_/);
    expect(areaStatus(toFog((session.campaign.boardState(id) as any).fog), area)).toBe('fogged');
    expect((session.campaign.boardState(id) as any).fog).toEqual({ dark });

    await api('PATCH', `/api/boards/${id}`, { areas: [] });
    expect(shelf.board(id)?.areas).toBeUndefined();
    expect((session.campaign.boardState(id) as any).fog).toEqual({ dark });
  });
});

// TERRAIN comes in through the BOARD door for the same reason areas do
// — a ford is where it is whoever is playing — so it is pinned the same
// way: authored, reread, id-minted, and untouched by a patch aimed at
// something else. The one case that is terrain's own is the BIND: a
// patch may claim a stored area, and the row keeps its brushwork so
// unbinding gives it back.
describe('terrain — the ground, through the board door', () => {
  async function board(): Promise<string> {
    const { body } = await upload(PNG);
    const made = await api('POST', '/api/boards', { key: body.key, name: 'The Crossing' });
    return made.body.id;
  }

  it('a patch is authored on the BOARD, with the author’s own words intact', async () => {
    const id = await board();
    const patch = {
      id: 'ter_a',
      kind: 'deep water',
      description: 'waist-deep, footing treacherous',
      elevation: -2,
      blocksSight: true,
      cells: [[4, 4]],
    };
    const patched = await api('PATCH', `/api/boards/${id}`, { terrain: [patch] });
    expect(patched.status).toBe(200);
    expect(patched.body.terrain).toEqual([patch]);
    expect(shelf.board(id)?.terrain).toEqual([patch]);
  });

  it('mints a ter_ id for a patch that arrived without one, and drops the junk', async () => {
    const id = await board();
    const { body } = await api('PATCH', `/api/boards/${id}`, {
      terrain: [{ kind: 'scree' }, 'nonsense'],
    });
    expect(body.terrain).toHaveLength(1);
    expect(body.terrain[0].id).toMatch(/^ter_[0-9a-f]{12}$/);
  });

  it('deleting them all clears the column rather than storing an empty list', async () => {
    const id = await board();
    await api('PATCH', `/api/boards/${id}`, { terrain: [{ id: 'ter_a', kind: 'mud' }] });
    const { body } = await api('PATCH', `/api/boards/${id}`, { terrain: [] });
    expect(body.terrain).toBeUndefined();
    expect(shelf.board(id)?.terrain).toBeUndefined();
  });

  it('a board patched for something else keeps its terrain, and vice versa', async () => {
    const id = await board();
    await api('PATCH', `/api/boards/${id}`, {
      areas: [{ id: 'a1', name: 'the ford', cells: [[2, 2]] }],
      terrain: [{ id: 'ter_a', kind: 'mud', cells: [[0, 0]] }],
    });
    const { body } = await api('PATCH', `/api/boards/${id}`, { widthInches: 24 });
    expect(body.terrain).toHaveLength(1);
    expect(body.areas).toHaveLength(1);
  });

  it('a patch bound to an area keeps its brushwork, so unbinding gives it back', async () => {
    const id = await board();
    const { body } = await api('PATCH', `/api/boards/${id}`, {
      areas: [{ id: 'a1', name: 'the ford', cells: [[2, 2]] }],
      terrain: [{ id: 'ter_a', kind: 'water', areaId: 'a1', cells: [[9, 9]] }],
    });
    expect(body.terrain[0].areaId).toBe('a1');
    expect(body.terrain[0].cells).toEqual([[9, 9]]);
    const unbound = await api('PATCH', `/api/boards/${id}`, {
      terrain: [{ id: 'ter_a', kind: 'water', cells: [[9, 9]] }],
    });
    expect(unbound.body.terrain[0].areaId).toBeUndefined();
    expect(unbound.body.terrain[0].cells).toEqual([[9, 9]]);
  });
});

// PHASE 0.5 — a board with no declared width is paintable now. What
// this pins is the whole round trip through the real doors: the fog
// goes in, the area goes on the row, both come back, and the lattice
// the server derives for that board is the picture's raster and not
// nothing. It is written end-to-end because the old coupling
// (calibration OR no cells) lived in four places and only one of them
// was a function.
describe('an uncalibrated board, painted', () => {
  async function worldMap(): Promise<string> {
    const { body } = await upload(PNG);
    // No widthInches: a world map has no inches and never will.
    const made = await api('POST', '/api/boards', { key: body.key, name: 'The Green Country' });
    expect(made.body.widthInches).toBeUndefined();
    return made.body.id;
  }

  it('has a lattice from its picture alone, so cover-all has bounds', async () => {
    const id = await worldMap();
    const row = shelf.board(id)!;
    const raster = rasterOf(row.widthInches, imageSizeOf(join(dir, row.key)));
    expect(raster).toEqual({ cols: RASTER_COLS, rows: RASTER_COLS });
    expect(coverAll(raster).dark).toHaveLength(RASTER_COLS * RASTER_COLS);
    // …and the INCH grid is still absent, because nothing here is inches.
    expect(gridOf(row.widthInches, imageSizeOf(join(dir, row.key)))).toBeUndefined();
  });

  it('takes fog through the state door and an area through the board door', async () => {
    const id = await worldMap();
    const painted = await api('PUT', `/api/board-state/${id}`, {
      data: { fog: { dark: [[30, 12], [31, 12]] } },
    });
    expect(painted.status).toBe(200);
    const named = await api('PATCH', `/api/boards/${id}`, {
      areas: [{ id: 'a1', name: 'the Northern Reach', cells: [[30, 12], [31, 12]] }],
    });
    expect(named.status).toBe(200);

    const back = await api('GET', `/api/board-state/${id}`);
    expect(toFog(back.body.fog).dark).toEqual([
      [30, 12],
      [31, 12],
    ]);
    // The area reads as fogged off the set — derived, as it is everywhere.
    const area = shelf.board(id)!.areas![0];
    expect(areaStatus(toFog(back.body.fog), area)).toBe('fogged');

    // Lifting it is the same two verbs, and leaves the row alone.
    await api('PUT', `/api/board-state/${id}`, { data: { fog: { dark: [] } } });
    const lifted = await api('GET', `/api/board-state/${id}`);
    expect(areaStatus(toFog(lifted.body.fog), area)).toBe('lifted');
    expect(shelf.board(id)!.areas).toHaveLength(1);
  });
});

// The structural migrations. A fog region is a named place and a named
// place belongs to the map; a world that was DARK has no cells written
// down at all. Both run at campaign open, because that is the only
// moment the board row, the fight state and the picture's own
// proportions are all in hand — and both must leave the table looking
// exactly as it did.
describe('old fog, migrated at campaign open', () => {
  /** A board with a declared width, so the picture gives it a grid. */
  async function board(name: string, widthInches = 3): Promise<string> {
    const { body } = await upload(PNG);
    const made = await api('POST', '/api/boards', { key: body.key, name, widthInches });
    return made.body.id;
  }

  it('moves the shapes to the board, the flags into the set, and changes nothing visible', async () => {
    const id = await board('The Crossing');
    const session = host.session!;
    const before = {
      placements: [{ entityId: 'ent_1', u: 0.5, v: 0.5 }],
      fog: {
        on: true,
        revealed: [[0, 0]],
        regions: [
          { id: 'r1', name: 'the vault', cells: [[2, 2]], revealed: false },
          { id: 'r2', name: 'the porch', cells: [[1, 1]], revealed: true },
        ],
      },
    };
    session.campaign.putBoardState(id, before, 'console');

    expect(migrateBoardFog(shelf, session.campaign, dir)).toBe(1);

    const areas = shelf.board(id)!.areas!;
    expect(areas.map((a) => a.name)).toEqual(['the vault', 'the porch']);
    const after = session.campaign.boardState(id) as any;
    // The fight keeps its own half and nothing else moved.
    expect(after.placements).toEqual(before.placements);
    expect(after.fog.regions).toBeUndefined();
    expect(after.fog.on).toBeUndefined();
    // The 1×1 picture at 3 inches wide is a 3×3 map: everything dark
    // but the freehand cell and the lit porch, exactly as it rendered.
    expect(toFog(after.fog).dark).toEqual([
      [1, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(areaStatus(toFog(after.fog), areas[0])).toBe('fogged');
    expect(areaStatus(toFog(after.fog), areas[1])).toBe('lifted');

    // Idempotent: the migrated fog is a set, so a second open is a read
    // and nothing more.
    expect(migrateBoardFog(shelf, session.campaign, dir)).toBe(0);
  });

  it('turns the phase-0 base into the same set, and eats its per-area state', async () => {
    const id = await board('The Vault');
    const session = host.session!;
    await api('PATCH', `/api/boards/${id}`, {
      areas: [{ id: 'a1', name: 'the vault', cells: [[2, 2]] }],
    });
    session.campaign.putBoardState(
      id,
      {
        fog: { base: 'clear', revealed: [], fogged: [[0, 0]], areas: [{ areaId: 'a1', fogged: true }] },
      },
      'console',
    );

    expect(migrateBoardFog(shelf, session.campaign, dir)).toBe(1);
    const after = session.campaign.boardState(id) as any;
    expect(after.fog).toEqual({ dark: [[0, 0], [2, 2]] });
    expect(JSON.stringify(after.fog)).not.toContain('areaId');
    // The area itself is untouched — it was always just geometry.
    expect(shelf.board(id)!.areas).toEqual([{ id: 'a1', name: 'the vault', cells: [[2, 2]] }]);
    expect(migrateBoardFog(shelf, session.campaign, dir)).toBe(0);
  });

  it('leaves a board that meant no fog entirely alone', async () => {
    const id = await board('Quiet');
    const session = host.session!;
    session.campaign.putBoardState(id, { fog: { on: false, revealed: [] } }, 'console');
    expect(migrateBoardFog(shelf, session.campaign, dir)).toBe(0);
    expect(shelf.board(id)?.areas).toBeUndefined();
  });

  // Phase 0.5: an uncalibrated board HAS a lattice now — the picture's
  // own raster — so "the world was dark" finally has cells to become.
  // It used to be a no-op here for want of bounds, which meant a world
  // map's darkness quietly evaporated on the way across.
  it('a dark world on an uncalibrated board covers the image raster', async () => {
    const id = await board('Unmeasured', 0);
    const session = host.session!;
    session.campaign.putBoardState(id, { fog: { on: true, revealed: [] } }, 'console');
    expect(migrateBoardFog(shelf, session.campaign, dir)).toBe(1);
    const after = session.campaign.boardState(id) as any;
    // A 1×1 picture: RASTER_COLS across and the same down, since the
    // raster squares itself against the aspect.
    expect(after.fog.dark).toHaveLength(RASTER_COLS * RASTER_COLS);
    expect(after.fog.dark[0]).toEqual([0, 0]);
    // And it stays idempotent — the second pass sees a `dark` list.
    expect(migrateBoardFog(shelf, session.campaign, dir)).toBe(0);
  });
});
