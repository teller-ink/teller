// The record doors over HTTP. They write no values — the runner moves
// those through the entry door — so what's tested is that a roll and an
// exchange land in the log, in their own shape, and that nothing but the
// key can file one.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';

describe('the record doors', () => {
  const KEY = 'test-key-0123456789abcdef';
  let dir: string;
  let session: Session;
  let server: Server;
  let base: string;
  let lurker: string;
  let ranger: string;

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
    dir = mkdtempSync(join(tmpdir(), 'teller-exchange-'));
    const shelf = openShelf(dir);
    const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
    session = new Session(shelf, campaign);
    lurker = session.create({ name: 'Bog Lurker', lists: {} }, 'console').id;
    ranger = session.create({ name: 'Ranger', lists: {} }, 'console').id;
    server = serve(session, 0, KEY);
    await new Promise((r) => server.on('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    session.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a roll lands in the log, filed against whoever threw it', async () => {
    const posted = await call('POST', '/api/rolls', {
      key: true,
      body: {
        by: lurker,
        byName: 'Bog Lurker',
        pool: '2G',
        faces: ['hit', 'ace'],
        total: 3,
        unit: 'Hits',
        for: 'Coil damage',
        round: 2,
      },
    });
    expect(posted.status).toBe(200);

    const events = await call('GET', `/api/events?entity=${lurker}`, { key: true });
    const roll = events.body.find((e: any) => e.kind === 'dice.rolled');
    expect(roll.payload).toMatchObject({ pool: '2G', faces: ['hit', 'ace'], total: 3 });
  });

  it('an exchange is filed against the one it happened TO', async () => {
    await call('POST', '/api/exchange', {
      key: true,
      body: {
        by: lurker,
        byName: 'Bog Lurker',
        target: ranger,
        targetName: 'Ranger',
        action: 'Coil',
        hits: 4,
        blocked: 1,
        damage: 3,
        vital: { name: 'Vigor', from: 7, to: 4 },
        statuses: [{ name: 'Snared', severity: 2 }],
        spend: [{ counter: 'Wind', amount: 4, on: 'Coil' }],
      },
    });
    const events = await call('GET', `/api/events?entity=${ranger}`, { key: true });
    const turn = events.body.find((e: any) => e.kind === 'turn.resolved');
    expect(turn.payload).toMatchObject({
      by: lurker,
      damage: 3,
      vital: { name: 'Vigor', from: 7, to: 4 },
      statuses: [{ name: 'Snared', severity: 2 }],
    });
  });

  it('a blast files everyone it caught, against the first of them', async () => {
    const drover = session.create({ name: 'Drover', lists: {} }, 'console').id;
    const posted = await call('POST', '/api/exchange', {
      key: true,
      body: {
        by: lurker,
        byName: 'Bog Lurker',
        action: 'Mire',
        targets: [
          { target: ranger, targetName: 'Ranger', hits: 0, blocked: 0, damage: 0, statuses: [{ name: 'Snared', severity: 4 }] },
          { target: drover, targetName: 'Drover', hits: 0, blocked: 0, damage: 0, statuses: [{ name: 'Snared', severity: 2 }] },
        ],
        // Paid ONCE, however many it caught.
        spend: [{ counter: 'Wind', amount: 4, on: 'Mire' }],
      },
    });
    expect(posted.status).toBe(200);
    const events = await call('GET', `/api/events?entity=${ranger}`, { key: true });
    const turn = events.body.find((e: any) => e.kind === 'turn.resolved');
    expect(turn.payload.targets).toHaveLength(2);
    expect(turn.payload.targets[1]).toMatchObject({ target: drover, statuses: [{ name: 'Snared', severity: 2 }] });
    expect(turn.payload.spend).toEqual([{ counter: 'Wind', amount: 4, on: 'Mire' }]);
  });

  it('a turn aimed at nobody is still a turn, and files against its actor', async () => {
    await call('POST', '/api/exchange', {
      key: true,
      body: { by: lurker, byName: 'Bog Lurker', action: 'slipped into the reeds', spend: [{ counter: 'Wind', amount: 2, on: 'moving' }] },
    });
    const events = await call('GET', `/api/events?entity=${lurker}`, { key: true });
    expect(events.body.some((e: any) => e.kind === 'turn.resolved')).toBe(true);
  });

  it('refuses the malformed, and refuses anyone without the key', async () => {
    expect((await call('POST', '/api/rolls', { key: true, body: { faces: [] } })).status).toBe(400);
    expect((await call('POST', '/api/exchange', { key: true, body: { action: 'x' } })).status).toBe(400);
    expect((await call('POST', '/api/rolls', { body: { pool: '1B' } })).status).toBe(401);
    expect((await call('POST', '/api/exchange', { body: { by: lurker } })).status).toBe(401);
  });
});
