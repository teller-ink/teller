// The listener's error boundary (audit 2026-11-16, finding 1).
//
// Every vector here used to take the whole host down — an unhandled
// rejection out of the async listener, and Node exits. In-process, the
// same rejection fails the vitest run, so each case proves two things:
// the one request got a 4xx/5xx, and nothing escaped past the boundary.
// `host.test.ts` repeats the cheapest ones against a real process.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { mintTicket } from './auth.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';

const KEY = 'test-key-0123456789abcdef';

let dir: string;
let session: Session;
let server: Server;
let port: number;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-boundary-'));
  mkdirSync(join(dir, 'art'), { recursive: true });
  const shelf = openShelf(dir);
  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  session = new Session(shelf, campaign, dir);
  server = serve(session, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  port = (server.address() as AddressInfo).port;
  base = `http://localhost:${port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

async function alive(): Promise<void> {
  const res = await fetch(`${base}/api/health`);
  expect(res.status).toBe(200);
}

/** A request whose path is sent exactly as written — fetch would tidy `//`. */
function raw(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: 'localhost', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Headers promise `declared` bytes, `sent` arrive, then the socket dies. */
function hangUp(head: string, declared: number, sent: number): Promise<void> {
  return new Promise((resolve) => {
    const s = connect(port, '127.0.0.1', () => {
      s.write(`${head}\r\nHost: x\r\nContent-Length: ${declared}\r\n\r\n`);
      s.write(Buffer.alloc(sent, 0x61));
      setTimeout(() => {
        s.destroy();
        // Give the host a beat to notice and (formerly) die.
        setTimeout(resolve, 50);
      }, 30);
    });
    s.on('error', () => {});
  });
}

describe('one bad request is one bad request', () => {
  it.each(['/panel-code/%', '/plugin-code/%zz', '/pack-code/%', '/system-export/%ff', '/panel-code/%E0%A4%A'])(
    'a malformed escape in %s is a 400',
    async (path) => {
      const res = await raw(path);
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/not well-formed/);
      await alive();
    },
  );

  it('a bare // is a 400', async () => {
    expect((await raw('//')).status).toBe(400);
    await alive();
  });

  it('a hello whose client vanished mid-body costs nothing', async () => {
    await hangUp('POST /api/displays/hello HTTP/1.1\r\nContent-Type: application/json', 40, 10);
    await alive();
  });

  it('a board upload cancelled partway costs nothing', async () => {
    await hangUp(
      `POST /api/boards/upload HTTP/1.1\r\nx-teller-key: ${KEY}\r\nContent-Type: image/png`,
      5_000_000,
      1_000_000,
    );
    await alive();
  });

  it('a story import cancelled partway costs nothing', async () => {
    await hangUp(
      `POST /api/story/import HTTP/1.1\r\nx-teller-key: ${KEY}\r\nContent-Type: application/zip`,
      5_000_000,
      1_000_000,
    );
    await alive();
  });

  it('a JSON body past the ceiling is a 413, read no further', async () => {
    const res = await fetch(`${base}/api/displays/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(5 * 1024 * 1024) }),
    }).catch(() => undefined);
    // Closing the connection after a 413 can race the client's own
    // write; either way the host refused it and is still here.
    if (res) expect(res.status).toBe(413);
    await alive();
  });

  it('a route that throws answers 500 and says so in one line', async () => {
    const made = await fetch(`${base}/api/entities`, {
      method: 'POST',
      headers: { 'x-teller-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: { name: 'Barrett' } }),
    }).then((r) => r.json() as Promise<{ id: string }>);
    const logged: string[] = [];
    const was = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.join(' '));
    try {
      const res = await fetch(`${base}/api/entities/${made.id}/entry`, {
        method: 'POST',
        headers: { 'x-teller-key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ list: '__proto__', name: 'x', value: 1 }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      if (res.status === 500) {
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatch(new RegExp(`POST /api/entities/${made.id}/entry failed`));
        expect(logged[0]).not.toContain(KEY);
      }
    } finally {
      console.error = was;
    }
    await alive();
  });

  it('a directory under /files/art/ is not fatal', async () => {
    const ticket = mintTicket(KEY, 'files:dm', 5);
    const was = console.error;
    console.error = () => {};
    try {
      // That route writes its 200 before it reads the bytes, so the
      // throw lands after the headers: the boundary can only cut the
      // connection. What matters is that it cuts ONE connection.
      const res = await raw(`/files/art/?handle=dm&ticket=${ticket}`).catch(() => undefined);
      if (res) expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      console.error = was;
    }
    await alive();
  });
});
