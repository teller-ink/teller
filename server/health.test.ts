// `GET /api/health`, and the fallback that used to be silent.
//
// Two things that only look unrelated: both are about a host telling the
// truth about itself to somebody who isn't in the room yet. Health is
// what a kiosk's watchdog asks with no headers at all; the stale-client
// warning is what the terminal owes a DM whose `dist` was never built.
//
// The health assertions are deliberately EXACT — `toEqual` on the whole
// body, and a key-set check beside it. A test that only asserted the
// three expected fields were present would pass the day a fourth one
// carrying the DM key was added, and this route's entire reason for
// being unauthenticated is that it hands out nothing.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShelf, type Shelf } from '../core/store.ts';
import { serve, staleClientWarning, tellerVersion } from './index.ts';
import { Host } from './session.ts';

let dir: string;
let shelf: Shelf;
let host: Host;
let server: Server;
let base: string;

const KEY = 'test-key-0123456789abcdef';

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-health-'));
  shelf = openShelf(dir);
  host = new Host(shelf, dir);
  server = serve(host, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  host.session?.campaign.close();
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('answers a bare request — no key, no display, no headers at all', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      app: 'teller',
      version: tellerVersion(),
      campaign: null,
    });
  });

  it('names the loaded campaign, and still nothing else', async () => {
    await fetch(`${base}/api/campaigns`, {
      method: 'POST',
      headers: { 'x-teller-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'The Unlikely Duo' }),
    });

    const body = (await (await fetch(`${base}/api/health`)).json()) as Record<string, unknown>;
    expect(body.campaign).toBe(host.session?.campaign.slug);
    // The whole answer, and no more of it than that.
    expect(Object.keys(body).sort()).toEqual(['app', 'campaign', 'version']);
    // Belt and braces: the key is the one secret there is (rule 7), and
    // it must not be anywhere in these bytes under any name.
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('carries a real version, not the string "unknown"', () => {
    expect(tellerVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('the stale-client warning', () => {
  it('fires when dist has no index.html, and says the way through', () => {
    const empty = join(dir, 'no-dist');
    mkdirSync(empty, { recursive: true });
    const said = staleClientWarning(empty);
    expect(said).toBeTruthy();
    expect(said).toContain('pnpm client:build');
    expect(said).toContain(empty);
    // Loud means several lines, not a sentence lost in the boot log.
    expect(said!.split('\n').length).toBeGreaterThan(4);
  });

  it('stays silent once the client has been built', () => {
    const built = join(dir, 'dist');
    mkdirSync(built, { recursive: true });
    writeFileSync(join(built, 'index.html'), '<!doctype html>');
    expect(staleClientWarning(built)).toBeUndefined();
  });
});
