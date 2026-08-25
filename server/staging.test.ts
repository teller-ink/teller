// Staging a fight ON the map — what the recipe has to survive.
//
// The console arranges an encounter by dragging ghosts around the board
// workshop and saving through the ordinary templates door
// (`client/tools/encounters.tsx`). Two things about that are load-
// bearing and neither is visible until a fight deploys wrong at a
// table:
//
//   * the door has to KEEP what staging writes. `boardId` and every
//     foe's `u`/`v`/`hidden` go out through the same POST that saves a
//     name, and a serializer that quietly dropped one would leave the
//     panel looking right and the recipe empty.
//   * expanding a count into chips and collapsing it back has to be
//     NAME-STABLE. Spreading three watchers across the ford splits
//     `count: 3` into three rows of one, and if those rows deploy under
//     different names than the unsplit row did, every note the Warden
//     wrote about "Bark Watcher 2" points at nobody.
//
// The stamping half (deploy switching to the recipe's board, and
// refusing loudly when this host hasn't got it) is pinned next door in
// `deploy.test.ts`.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShelf, type Shelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Host } from './session.ts';

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
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'x-teller-key': KEY,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** The fight, saved the way the panel saves it. */
const put = (template: unknown) =>
  api('POST', '/api/templates/encounters', { template });

const encounters = async (): Promise<any[]> =>
  (await api('GET', '/api/templates/encounters')).body;

/** The roster, by name — who a deploy actually put on the table. */
const roster = (): string[] =>
  host
    .session!.campaign.children(host.session!.campaign.root().id)
    .map((e) => e.name)
    .sort();

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-staging-'));
  mkdirSync(join(dir, 'systems', 'wiw'), { recursive: true });
  writeFileSync(
    join(dir, 'systems', 'wiw', 'system.json'),
    JSON.stringify({ id: 'sys_wiw', name: 'The System', version: 1 }),
  );
  shelf = openShelf(dir);
  shelf.putPack({
    id: 'pak_guide',
    system: 'sys_wiw',
    name: 'Guidebook',
    data: {
      bestiary: [
        {
          id: 'npc_watcher',
          name: 'Bark Watcher',
          type: 'foe',
          lists: { resources: [{ name: 'Health', value: 12, max: 12 }] },
        },
      ],
    },
  });
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
  rmSync(dir, { recursive: true, force: true });
});

describe('the recipe keeps what staging wrote', () => {
  it('round-trips the fight’s map through the templates door', async () => {
    const board = shelf.putBoard({ key: 'map/lake.png', name: 'The Lake' });
    const made = await put({ name: 'The Lake', boardId: board.id, foes: [] });
    expect(made.status).toBeLessThan(300);

    const [saved] = await encounters();
    expect(saved.boardId).toBe(board.id);

    // And back off again — mapless is a state you can return to, not a
    // door that only opens one way.
    await put({ ...saved, boardId: null });
    expect((await encounters())[0].boardId ?? null).toBeNull();
  });

  it('round-trips every foe’s square and whether it is waiting out of sight', async () => {
    const made = await put({
      name: 'The Ford',
      foes: [
        { templateId: 'npc_watcher', count: 2, u: 0.25, v: 0.5 },
        { templateId: 'npc_watcher', name: 'Lurker', u: 0.8, v: 0.125, hidden: true },
      ],
    });
    expect(made.status).toBeLessThan(300);

    const [saved] = await encounters();
    expect(saved.foes).toEqual([
      { templateId: 'npc_watcher', count: 2, u: 0.25, v: 0.5 },
      { templateId: 'npc_watcher', name: 'Lurker', u: 0.8, v: 0.125, hidden: true },
    ]);
  });

  it('lets a fight be taken back off the map without losing the fight', async () => {
    await put({
      name: 'The Ford',
      foes: [{ templateId: 'npc_watcher', count: 3, u: 0.25, v: 0.5, hidden: true }],
    });
    const [staged] = await encounters();
    await put({ ...staged, foes: [{ templateId: 'npc_watcher', count: 3 }] });

    const [cleared] = await encounters();
    expect(cleared.foes).toEqual([{ templateId: 'npc_watcher', count: 3 }]);
  });
});

// Expanding a count into chips is the panel's business, but the NAMES
// it expands to are deploy's, and the two must agree forever: a fight
// spread across the ford deploys the same four creatures it deployed
// while they were all stacked on one square.
describe('spreading a count out changes where they stand, not who they are', () => {
  const deploy = async (id: string) =>
    (await api('POST', `/api/encounters/${id}/deploy`)).body;

  it('names split rows exactly as the unsplit count did', async () => {
    const made = await put({
      name: 'The Ford',
      foes: [{ templateId: 'npc_watcher', count: 3 }],
    });
    await deploy(made.body.id);
    const together = roster();
    expect(together).toEqual(['Bark Watcher 1', 'Bark Watcher 2', 'Bark Watcher 3']);

    // Now as the staging mode writes it once the chips disagree: three
    // rows of one, each carrying the name the count would have given it.
    const [saved] = await encounters();
    await put({
      ...saved,
      foes: [
        { templateId: 'npc_watcher', name: 'Bark Watcher 1', count: 1, u: 0.2, v: 0.2 },
        { templateId: 'npc_watcher', name: 'Bark Watcher 2', count: 1, u: 0.4, v: 0.3 },
        { templateId: 'npc_watcher', name: 'Bark Watcher 3', count: 1, u: 0.6, v: 0.4, hidden: true },
      ],
    });
    await deploy(made.body.id);
    expect(roster()).toEqual(together);
  });

  it('puts each one on its own square, and the hidden one hidden', async () => {
    const board = shelf.putBoard({ key: 'map/ford.png', name: 'The Ford' });
    const made = await put({
      name: 'The Ford',
      boardId: board.id,
      foes: [
        { templateId: 'npc_watcher', name: 'Bark Watcher 1', count: 1, u: 0.2, v: 0.2 },
        { templateId: 'npc_watcher', name: 'Bark Watcher 2', count: 1, u: 0.4, v: 0.3 },
        { templateId: 'npc_watcher', name: 'Bark Watcher 3', count: 1, u: 0.6, v: 0.4, hidden: true },
      ],
    });
    const out = await deploy(made.body.id);
    expect(out.placed).toBe(3);

    const state = host.session!.campaign.boardState(board.id) as any;
    expect(state.placements.map((p: any) => [p.u, p.v])).toEqual([
      [0.2, 0.2],
      [0.4, 0.3],
      [0.6, 0.4],
    ]);
    expect(state.placements.map((p: any) => p.hidden ?? false)).toEqual([false, false, true]);
  });
});
