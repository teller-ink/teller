// §15 over HTTP: the host assembles the snapshot, config rides in as
// the second argument, and a proposal is words — never a write.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enablePlugin, loadPlugins } from '../core/plugins.ts';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';

const KEY = 'test-key-0123456789abcdef';

let dir: string;
let session: Session;
let server: Server;
let base: string;

async function call(
  method: string,
  path: string,
  opts: { key?: boolean; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.key) headers['x-teller-key'] = KEY;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-propose-'));
  const shelf = openShelf(dir);
  shelf.putSystem({ id: 'sys_wiw', name: 'WiW', version: 1, data: {} });
  shelf.putPack({
    id: 'pak_guide',
    system: 'sys_wiw',
    name: 'Guidebook',
    data: {
      bestiary: [
        {
          id: 'npc_watcher',
          name: 'Bark Watcher',
          lists: { resources: [{ name: 'Health', value: 12, max: 12 }] },
        },
      ],
    },
  });

  // An echo plugin: proposes back exactly what it was handed.
  const plug = join(dir, 'plugins', 'echo');
  mkdirSync(plug, { recursive: true });
  writeFileSync(
    join(plug, 'plugin.json'),
    JSON.stringify({
      id: 'plg_echo00000001',
      name: 'Echo',
      version: 1,
      provides: ['propose.turn'],
      needs: [],
    }),
  );
  writeFileSync(
    join(plug, 'host.mjs'),
    `export const provides = {
      'propose.turn': (snapshot, config) => ({ saw: snapshot, config }),
    };`,
  );
  enablePlugin(dir, shelf, 'plg_echo00000001', true);
  shelf.setPluginConfig('plg_echo00000001', { style: 'laconic' });

  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  campaign.save(
    { ...campaign.root(), refs: { system: { id: 'sys_wiw', name: 'WiW' } } },
    'host',
  );
  session = new Session(shelf, campaign, dir);
  const plugins = await loadPlugins(dir, shelf);
  expect(plugins.problems).toEqual([]);
  session.plugins = plugins.loaded;
  server = serve(session, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('propose.turn over HTTP', () => {
  it('assembles the snapshot — resolved acting sheet, named order — and hands config through', async () => {
    const stamped = await call('POST', '/api/stamp', {
      key: true,
      body: { slot: 'bestiary', templateId: 'npc_watcher', name: 'Watcher 1' },
    });
    session.turnOp({ op: 'add', entityId: stamped.body.id }, 'console');
    session.turnOp({ op: 'next' }, 'console');

    const { status, body } = await call('POST', '/api/propose/turn', {
      key: true,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.providers).toBe(1);
    const saw = body.proposals[0].proposal.saw;
    // The acting sheet arrives RESOLVED — the thin stamp's template
    // values are facts the model would otherwise invent.
    expect(saw.acting.lists.resources).toEqual([
      { name: 'Health', value: 12, max: 12 },
    ]);
    expect(saw.order).toEqual([
      { name: 'Watcher 1', score: null, acting: true },
    ]);
    expect(saw.round).toBe(1);
    // And what the human configured came in beside it, cloned.
    expect(body.proposals[0].proposal.config).toEqual({ style: 'laconic' });
  });

  it('is the DM\'s to ask, and an unknown point is named', async () => {
    expect((await call('POST', '/api/propose/turn', { body: {} })).status).toBe(401);
    expect(
      (await call('POST', '/api/propose/decide', { key: true, body: {} })).status,
    ).toBe(404);
  });

  it('is one door for the whole family — a point nobody provides answers with nobody', async () => {
    // The echo plugin provides only propose.turn. `narrate` is a real
    // point, so it routes; it just has no providers, which is a 200 with
    // zero proposals and never a 404.
    const { status, body } = await call('POST', '/api/propose/narrate', {
      key: true,
      body: { payload: { outcome: 'the Peril let go' } },
    });
    expect(status).toBe(200);
    expect(body).toEqual({ point: 'propose.narrate', providers: 0, proposals: [] });
  });

  it('carries what the surface knows into the snapshot — the DM\'s own call included', async () => {
    const { body } = await call('POST', '/api/propose/turn', {
      key: true,
      body: { payload: { intent: 'it dives and flings sludge' } },
    });
    expect(body.proposals[0].proposal.saw.intent).toBe('it dives and flings sludge');
  });
});

// The needs gate, applied to a proposal.
//
// `propose.turn` used to hand every provider everything the host could
// assemble, which was fine while everything was the round and one sheet
// and stopped being fine the moment it included where every foe is
// standing. The gate is the same one a door goes through: a plugin gets
// what its manifest named, and a slot it never asked for is ABSENT.
describe('what a proposer is granted', () => {
  /** A second plugin, declaring the two reads the first one didn't. */
  async function seer(needs: string[]) {
    const plug = join(dir, 'plugins', 'seer');
    mkdirSync(plug, { recursive: true });
    writeFileSync(
      join(plug, 'plugin.json'),
      JSON.stringify({
        id: 'plg_seer000000001',
        name: 'Seer',
        version: 1,
        provides: ['propose.turn'],
        needs,
      }),
    );
    writeFileSync(
      join(plug, 'host.mjs'),
      `export const provides = { 'propose.turn': (snapshot) => ({ saw: snapshot }) };`,
    );
    enablePlugin(dir, session.shelf, 'plg_seer000000001', true);
    const reloaded = await loadPlugins(dir, session.shelf);
    expect(reloaded.problems).toEqual([]);
    session.plugins = reloaded.loaded;
  }

  /** One board, one placed foe — enough ground to be granted or not. */
  async function deploy() {
    mkdirSync(join(dir, 'map'), { recursive: true });
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.write('IHDR', 12);
    png.writeUInt32BE(1200, 16);
    png.writeUInt32BE(900, 20);
    writeFileSync(join(dir, 'map', 'field.png'), png);
    const row = session.shelf.putBoard({
      key: 'map/field.png',
      name: 'Open Field',
      widthInches: 40,
    });
    const root = session.campaign.root();
    session.save(
      { ...root, refs: { ...root.refs, board: { id: row.id, name: row.name } } },
      'test',
    );
    session.reload();
    const stamped = await call('POST', '/api/stamp', {
      key: true,
      body: { slot: 'bestiary', templateId: 'npc_watcher', name: 'Watcher 1' },
    });
    session.turnOp({ op: 'add', entityId: stamped.body.id }, 'console');
    session.turnOp({ op: 'next' }, 'console');
    session.putBoardState(
      row.id,
      { placements: [{ id: 'plc_a', entityId: stamped.body.id, u: 0.1, v: 0.5 }] },
      'test',
    );
  }

  it('hands the ground and the sheets only to a plugin that asked', async () => {
    await deploy();
    await seer(['read:board — where everyone stands', 'read:entities — how they are doing']);

    const { body } = await call('POST', '/api/propose/turn', { key: true, body: {} });
    expect(body.providers).toBe(2);
    const byPlugin = Object.fromEntries(
      body.proposals.map((p: any) => [p.plugin, p.proposal.saw]),
    );

    // Echo declared `needs: []`, so it sees the round and the order and
    // nothing it never asked for — not an error, an absence.
    expect(byPlugin['plg_echo00000001'].board).toBeUndefined();
    expect(byPlugin['plg_echo00000001'].order[0].vitals).toBeUndefined();
    expect(byPlugin['plg_echo00000001'].order[0].entityId).toBeUndefined();
    expect(byPlugin['plg_echo00000001'].round).toBe(1);

    // The seer asked, so it is TOLD — measured, and labelled.
    const saw = byPlugin['plg_seer000000001'];
    expect(saw.board.present).toBe(true);
    expect(saw.board.board.name).toBe('Open Field');
    expect(saw.board.measuredFrom).toBe('Watcher 1');
    expect(saw.board.tokens[0].cell).toEqual([4, 15]);
    expect(saw.order[0].vitals).toEqual([{ name: 'Health', value: 12, max: 12 }]);
  });

  it('states the absence of a board rather than omitting it', async () => {
    await seer(['read:board — where everyone stands']);
    const { body } = await call('POST', '/api/propose/turn', { key: true, body: {} });
    const saw = body.proposals.find((p: any) => p.plugin === 'plg_seer000000001').proposal
      .saw;
    expect(saw.board).toEqual({
      present: false,
      why: 'no board is showing at this table',
    });
  });

  it('never leaves the DM\'s screen — hidden tokens ride a DM-gated door', async () => {
    await deploy();
    await seer(['read:board — where everyone stands']);
    // The one door that assembles this is `POST /api/propose/*`, and it
    // is `canDm` before a plugin is reached at all. No key, no ground.
    expect((await call('POST', '/api/propose/turn', { body: {} })).status).toBe(401);
  });
});

// The question a surface asks before it draws a box: is this point
// provided by anything running? Never "is the assistant installed" —
// a tool must not be able to learn what answers it (§15).
describe('GET /api/points — what this build can be asked', () => {
  it('lists every registry point with its live provider count', async () => {
    const { status, body } = await call('GET', '/api/points', { key: true });
    expect(status).toBe(200);
    const byPoint = Object.fromEntries(body.map((p: any) => [p.point, p]));
    expect(byPoint['propose.turn'].providers).toBe(1);
    expect(byPoint['propose.turn'].blurb).toBeTruthy();
    // Declared but unprovided — the point exists, nobody answers it, and
    // the surface that would draw a box for it draws nothing.
    expect(byPoint['propose.narrate'].providers).toBe(0);
    // And it never names who provides anything.
    expect(JSON.stringify(body)).not.toContain('plg_');
  });

  it('follows the enable gate: disabling the plugin empties the point', async () => {
    await call('POST', '/api/plugins/plg_echo00000001', {
      key: true,
      body: { enabled: false },
    });
    const { body } = await call('GET', '/api/points', { key: true });
    expect(body.find((p: any) => p.point === 'propose.turn').providers).toBe(0);
  });

  it('is the DM\'s to ask', async () => {
    expect((await call('GET', '/api/points')).status).toBe(401);
  });
});

describe('plugin management over HTTP (§15 in the console)', () => {
  it('lists, toggles live, and reconfigures without a restart', async () => {
    const listed = await call('GET', '/api/plugins', { key: true });
    expect(listed.status).toBe(200);
    expect(listed.body.found.map((f: any) => f.manifest.id)).toEqual(['plg_echo00000001']);
    expect(listed.body.running).toEqual(['plg_echo00000001']);

    // Disable: the running set follows the human act immediately.
    const off = await call('POST', '/api/plugins/plg_echo00000001', {
      key: true,
      body: { enabled: false },
    });
    expect(off.body.running).toEqual([]);
    const silent = await call('POST', '/api/propose/turn', { key: true, body: {} });
    expect(silent.body.providers).toBe(0);

    // Re-enable with new config: the next call sees it.
    await call('POST', '/api/plugins/plg_echo00000001', { key: true, body: { enabled: true } });
    await call('PUT', '/api/plugins/plg_echo00000001/config', {
      key: true,
      body: { config: { style: 'grim' } },
    });
    const loud = await call('POST', '/api/propose/turn', { key: true, body: {} });
    expect(loud.body.proposals[0].proposal.config).toEqual({ style: 'grim' });

    // And none of it is a stranger's business.
    expect((await call('GET', '/api/plugins')).status).toBe(401);
  });
});

// THE SYSTEM'S OWN LAW, and what already happened.
//
// Every failure this covers is the same failure wearing a new hat: a
// fact teller held and did not pass on is a fact the reader invents.
// Handed band NAMES with nothing behind them, a proposer said "the
// snapshot gives no inch value for the bands — I am assuming" in the
// middle of a live fight, and never once considered moving, because
// nothing told it a step could be bought.
describe('what the snapshot says about how this system works', () => {
  /** A system with a spatial law: rungs, prose, a menu, and conditions. */
  function lawful() {
    session.shelf.putSystem({
      id: 'sys_wiw',
      name: 'WiW',
      version: 2,
      data: {
        bands: [
          { name: 'Close', to: 1, world: 'within reach' },
          { name: 'Short', from: 1, to: 6, world: 'up to 30 yards' },
        ],
        space: 'Moving costs one per Short, by speed.',
        use: { costCounter: 'Grit', actions: [{ name: 'Move', cost: 1, text: 'one Short.' }] },
        statuses: [{ name: 'Trapped', relief: 'Finesse', uncapped: true }],
        defenses: { Cover: '1B' },
      },
    });
    session.reload();
  }

  async function seer(needs: string[]) {
    const plug = join(dir, 'plugins', 'seer');
    mkdirSync(plug, { recursive: true });
    writeFileSync(
      join(plug, 'plugin.json'),
      JSON.stringify({
        id: 'plg_seer000000001',
        name: 'Seer',
        version: 1,
        provides: ['propose.turn', 'propose.narrate'],
        needs,
      }),
    );
    writeFileSync(
      join(plug, 'host.mjs'),
      `export const provides = {
        'propose.turn': (snapshot) => ({ saw: snapshot }),
        'propose.narrate': (snapshot) => ({ saw: snapshot }),
      };`,
    );
    enablePlugin(dir, session.shelf, 'plg_seer000000001', true);
    const reloaded = await loadPlugins(dir, session.shelf);
    expect(reloaded.problems).toEqual([]);
    session.plugins = reloaded.loaded;
  }

  const sawBy = (body: any, id: string) =>
    body.proposals.find((p: any) => p.plugin === id).proposal.saw;

  it('carries the bands, the prose, the action menu and the conditions — to whoever asked', async () => {
    lawful();
    await seer(['read:records — how far is far, and what a turn buys']);
    const { body } = await call('POST', '/api/propose/turn', { key: true, body: {} });

    const saw = sawBy(body, 'plg_seer000000001');
    expect(saw.records.bands).toEqual([
      { name: 'Close', to: 1, world: 'within reach' },
      { name: 'Short', from: 1, to: 6, world: 'up to 30 yards' },
    ]);
    expect(saw.records.space).toBe('Moving costs one per Short, by speed.');
    expect(saw.records.use.actions).toEqual([{ name: 'Move', cost: 1, text: 'one Short.' }]);
    expect(saw.records.statuses[0]).toMatchObject({ name: 'Trapped', uncapped: true });
    expect(saw.records.defenses).toEqual({ Cover: '1B' });

    // Echo declared nothing, so the law is absent for it — not an error.
    expect(sawBy(body, 'plg_echo00000001').records).toBeUndefined();
  });

  it('gates records per slot, the way a door’s are gated', async () => {
    lawful();
    await seer(['read:records/bands — only the ladder']);
    const { body } = await call('POST', '/api/propose/turn', { key: true, body: {} });
    const saw = sawBy(body, 'plg_seer000000001');
    expect(Object.keys(saw.records)).toEqual(['bands']);
  });

  it('hands over what already happened, only to a plugin that asked for the log', async () => {
    const stamped = await call('POST', '/api/stamp', {
      key: true,
      body: { slot: 'bestiary', templateId: 'npc_watcher', name: 'Watcher 1' },
    });
    session.turnOp({ op: 'add', entityId: stamped.body.id }, 'console');
    session.turnOp({ op: 'next' }, 'console');
    await call('POST', '/api/exchange', {
      key: true,
      body: {
        by: stamped.body.id,
        byName: 'Watcher 1',
        action: 'Claw',
        targets: [{ target: 'ent_x', targetName: 'Hosa', hits: 3, blocked: 1, damage: 2 }],
        spend: [{ counter: 'Grit', amount: 2, on: 'Claw' }],
        round: 1,
      },
    });

    await seer(['read:log — where a condition came from']);
    const { body } = await call('POST', '/api/propose/turn', { key: true, body: {} });
    // Oldest LAST: the freshest thing that happened is the final line.
    const history = sawBy(body, 'plg_seer000000001').history;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      kind: 'turn.resolved',
      byName: 'Watcher 1',
      action: 'Claw',
      spend: [{ counter: 'Grit', amount: 2, on: 'Claw' }],
    });
    expect(sawBy(body, 'plg_echo00000001').history).toBeUndefined();
  });

  it('says how fast everyone is — a value with no ceiling is a stat, not nothing', async () => {
    const stamped = await call('POST', '/api/stamp', {
      key: true,
      body: { slot: 'bestiary', templateId: 'npc_watcher', name: 'Watcher 1' },
    });
    await call('POST', `/api/entities/${stamped.body.id}/entry`, {
      key: true,
      body: { list: 'stats', name: 'Speed', value: 'Fast' },
    });
    session.turnOp({ op: 'add', entityId: stamped.body.id }, 'console');
    session.turnOp({ op: 'next' }, 'console');

    await seer(['read:entities — the sheets']);
    const { body } = await call('POST', '/api/propose/turn', { key: true, body: {} });
    expect(sawBy(body, 'plg_seer000000001').order[0].stats).toEqual([
      { name: 'Speed', value: 'Fast' },
    ]);
    // And it is one of the things `read:entities` buys, so a plugin
    // that never asked never sees it.
    expect(sawBy(body, 'plg_echo00000001').order[0].stats).toBeUndefined();
  });

  it('gives the NARRATION the same table — the dice do not make the ground stop mattering', async () => {
    lawful();
    const stamped = await call('POST', '/api/stamp', {
      key: true,
      body: { slot: 'bestiary', templateId: 'npc_watcher', name: 'Watcher 1' },
    });
    session.turnOp({ op: 'add', entityId: stamped.body.id }, 'console');
    session.turnOp({ op: 'next' }, 'console');
    await seer(['read:records — the law', 'read:entities — the sheets']);

    const { body } = await call('POST', '/api/propose/narrate', {
      key: true,
      body: { payload: { outcome: 'it takes 2', preface: 'the branches shift' } },
    });
    const saw = sawBy(body, 'plg_seer000000001');
    expect(saw.acting.name).toBe('Watcher 1');
    expect(saw.records.space).toBe('Moving costs one per Short, by speed.');
    // And what only the console could know rides in beside it.
    expect(saw.outcome).toBe('it takes 2');
    expect(saw.preface).toBe('the branches shift');
  });
});
