// `system/<name>` at the door (§M-4a) — the two urls the specifier
// actually travels through.
//
//   /system-export/<name>   the shim: no-store, resolved against the
//                           ACTIVE system, re-exporting the stamped
//                           module by its exact names
//   /pack-code/<sys_id>/exports/<name>.js   the bytes, immutable and
//                           trust-gated, through the code door that
//                           already existed
//
// Real folders, real esbuild, real trust rows, for `plugins.test.ts`'s
// reason: a compiled export is a thing the SWEEP makes, and a test that
// hand-wrote the urls would pin a state the running host can't produce.

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

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function json(path: string, value: unknown): void {
  write(path, JSON.stringify(value, null, 2));
}

const ENGINE = `export const rung = 4;\nexport default function compose() { return rung; }\n`;

/** Boot a host over the shelf as it stands, and open a campaign on it. */
async function start(system = 'sys_a'): Promise<void> {
  shelf = openShelf(dir);
  host = new Host(shelf, dir);
  server = serve(host, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  await fetch(`${base}/api/campaigns`, {
    method: 'POST',
    headers: { 'x-teller-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'The Table', system }),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-export-'));
  const sys = join(dir, 'systems', 'a');
  json(join(sys, 'system.json'), { id: 'sys_a', name: 'Test System', version: 1 });
  write(join(sys, 'exports', 'creation.ts'), ENGINE);
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  host.session?.campaign.close();
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Trust the system's code the way a human ticking the box would. */
function trust(): void {
  const s = openShelf(dir);
  s.setPluginEnabled('sys_a', true);
  s.close();
}

describe('the shim', () => {
  it('re-exports the stamped module by its exact names, and never caches', async () => {
    trust();
    await start();

    const res = await fetch(`${base}/system-export/creation`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('javascript');
    const body = await res.text();
    expect(body).toMatch(/\/pack-code\/sys_a\/exports\/creation\.js\?v=[a-z0-9]+/);
    expect(body).toContain('export { rung }');
    // The default is named explicitly — `export *` would have dropped it.
    expect(body).toContain('export { default }');
  });

  it('an export nobody has is a module that THROWS, naming both parties', async () => {
    trust();
    await start();

    const res = await fetch(`${base}/system-export/nowhere`);
    // 200, deliberately: a 404 rejects the import with a message that
    // names nothing, and this one has to be readable at the render site.
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/^throw new Error\(/);
    expect(body).toContain('Test System');
    expect(body).toContain('nowhere');
  });

  it("a system whose code nobody enabled says so — it doesn't pretend to be empty", async () => {
    await start();
    const body = await fetch(`${base}/system-export/creation`).then((r) => r.text());
    expect(body).toMatch(/^throw new Error\(/);
    expect(body).toContain('awaiting enablement');
  });

  it('no active system at all is its own sentence', async () => {
    trust();
    await start('sys_missing');
    const body = await fetch(`${base}/system-export/creation`).then((r) => r.text());
    expect(body).toContain('no active system');
  });
});

describe('the bytes', () => {
  it('the existing code door serves them, once the system is trusted', async () => {
    trust();
    await start();
    const url = (await fetch(`${base}/system-export/creation`).then((r) => r.text()))
      .match(/'([^']+)'/)![1];

    const res = await fetch(`${base}${url}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('rung');
  });

  it('untrusted, they 404 exactly as a presentation does', async () => {
    await start();
    const res = await fetch(`${base}/pack-code/sys_a/exports/creation.js`);
    expect(res.status).toBe(404);
  });
});
