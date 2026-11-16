// The host as a PROCESS — what `teller host` does with its own life.
//
// Everything else in this suite boots `serve()` in-process, which can't
// see the things the 2026-11-16 audit found: a host that exits on one
// bad request, a `.db` that isn't the campaign until somebody folds the
// `-wal` back in, two hosts on one folder, a banner printed for a port
// that was never ours. So these spawn the real thing and watch it.

import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(ROOT, 'bin', 'teller');
const ENTRY = join(ROOT, 'server', 'index.ts');

let dir: string;
const running: ChildProcess[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-host-'));
});

afterEach(() => {
  for (const child of running.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

type Host = { child: ChildProcess; port: number; base: string; out: () => string };

/** A real host on port 0, resolved once it has printed where it is. */
function host(data: string): Promise<Host> {
  const child = spawn(process.execPath, [ENTRY, '--data', data, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);
  let out = '';
  return new Promise((resolve, reject) => {
    const seen = (chunk: Buffer) => {
      out += chunk.toString();
      const m = /http:\/\/localhost:(\d+)/.exec(out);
      if (m) {
        child.stdout!.off('data', seen);
        const port = Number(m[1]);
        child.stdout!.on('data', (c: Buffer) => (out += c.toString()));
        resolve({ child, port, base: `http://localhost:${port}`, out: () => out });
      }
    };
    child.stdout!.on('data', seen);
    child.stderr!.on('data', (c: Buffer) => (out += c.toString()));
    child.on('exit', (code) => reject(new Error(`host exited ${code} before listening:\n${out}`)));
  });
}

/** `teller …` to completion — what a human at the terminal would see. */
function teller(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  running.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (c: Buffer) => (stdout += c.toString()));
  child.stderr!.on('data', (c: Buffer) => (stderr += c.toString()));
  return new Promise((resolve) => child.on('exit', (code) => resolve({ code, stdout, stderr })));
}

function exited(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.on('exit', (code) => resolve(code)));
}

async function health(base: string): Promise<number> {
  return (await fetch(`${base}/api/health`)).status;
}

function rawStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: 'localhost', port, path }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('one bad request against the real process', () => {
  it('a bare //, a broken escape and a half-sent hello leave it serving', async () => {
    const h = await host(dir);
    expect(await rawStatus(h.port, '//')).toBe(400);
    expect(await rawStatus(h.port, '/panel-code/%')).toBe(400);
    await new Promise<void>((resolve) => {
      const s = connect(h.port, '127.0.0.1', () => {
        s.write(
          'POST /api/displays/hello HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n' +
            'Content-Length: 40\r\n\r\n{"id":"abc',
        );
        setTimeout(() => {
          s.destroy();
          setTimeout(resolve, 100);
        }, 100);
      });
    });
    expect(h.child.exitCode).toBe(null);
    expect(await health(h.base)).toBe(200);
  }, 20_000);
});

describe('a clean stop leaves the campaign one whole file', () => {
  it('ctrl-c folds the WAL in, and the .db alone holds every write', async () => {
    const h = await host(dir);
    const key = readFileSync(join(dir, 'dm.key'), 'utf8').trim();
    const post = (path: string, body: unknown) =>
      fetch(`${h.base}${path}`, {
        method: 'POST',
        headers: { 'x-teller-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post('/api/campaigns', { name: 'Whole' })).status).toBe(201);
    for (let i = 0; i < 25; i++) {
      expect((await post('/api/entities', { draft: { name: `Barrett ${i}` } })).status).toBe(201);
    }
    // A screen with its stream open must not hold the stop hostage.
    const slips = (await fetch(`${h.base}/api/ticket`, {
      headers: { 'x-teller-key': key },
    }).then((r) => r.json())) as { ticket: string };
    const stream = new AbortController();
    const open = await fetch(`${h.base}/api/stream?handle=dm&ticket=${slips.ticket}`, {
      signal: stream.signal,
    });
    expect(open.status).toBe(200);

    const campaigns = join(dir, 'campaigns');
    expect(existsSync(join(campaigns, 'whole.db-wal'))).toBe(true);

    h.child.kill('SIGINT');
    expect(await exited(h.child)).toBe(0);
    stream.abort();

    for (const left of ['whole.db-wal', 'whole.db-shm']) {
      expect(existsSync(join(campaigns, left))).toBe(false);
    }
    expect(existsSync(join(dir, 'shelf.db-wal'))).toBe(false);
    expect(existsSync(join(dir, 'host.lock'))).toBe(false);

    // The file ALONE, carried somewhere with nothing beside it.
    const stick = join(dir, 'stick');
    mkdirSync(stick);
    copyFileSync(join(campaigns, 'whole.db'), join(stick, 'whole.db'));
    const db = new DatabaseSync(join(stick, 'whole.db'));
    try {
      const entities = db.prepare('SELECT count(*) AS n FROM entities').get() as { n: number };
      const created = db
        .prepare("SELECT count(*) AS n FROM events WHERE kind = 'entity.created'")
        .get() as { n: number };
      // The manifest plus the twenty-five.
      expect(entities.n).toBe(26);
      expect(created.n).toBe(25);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe('one host per data folder', () => {
  it('a second host is refused by name, a dead one is taken over', async () => {
    const first = await host(dir);
    const pid = first.child.pid!;

    const second = await teller(['host', dir, '--port', String(first.port + 1)]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain(`pid ${pid}`);
    expect(second.stderr).toContain(`localhost:${first.port}`);
    expect(second.stderr).toMatch(/kill/);
    expect(second.stdout).not.toMatch(/ctrl-c to stop/);
    // The refused host never touched the first one's table.
    expect(await health(first.base)).toBe(200);

    // `where`, `plugins`, `version` and `key` read beside a live host.
    expect((await teller(['where', dir])).code).toBe(0);
    expect((await teller(['plugins', dir])).code).toBe(0);
    expect((await teller(['version'])).code).toBe(0);
    const key = await teller(['key', dir]);
    expect(key.code).toBe(0);

    // A host that died without cleaning up leaves its claim behind…
    first.child.kill('SIGKILL');
    await exited(first.child);
    expect(existsSync(join(dir, 'host.lock'))).toBe(true);
    // …and the next one takes it over without a word.
    const next = await host(dir);
    expect(await health(next.base)).toBe(200);
    const claim = JSON.parse(readFileSync(join(dir, 'host.lock'), 'utf8'));
    expect(claim).toMatchObject({ pid: next.child.pid, port: next.port });
    next.child.kill('SIGTERM');
    expect(await exited(next.child)).toBe(0);
    expect(existsSync(join(dir, 'host.lock'))).toBe(false);
  }, 30_000);

  it('a port already taken is one sentence and no banner', async () => {
    const first = await host(dir);
    const elsewhere = join(dir, 'elsewhere');
    const second = await teller(['host', elsewhere, '--port', String(first.port)]);
    expect(second.code).toBe(1);
    expect(second.stderr).toMatch(new RegExp(`port ${first.port} is already in use`));
    expect(second.stderr).not.toMatch(/EADDRINUSE|at Server/);
    expect(second.stdout).not.toMatch(/teller ·|ctrl-c to stop|open on this machine/);
    // It gave back the folder it had claimed, and left its files whole.
    expect(existsSync(join(elsewhere, 'host.lock'))).toBe(false);
    expect(existsSync(join(elsewhere, 'shelf.db-wal'))).toBe(false);
    expect(await health(first.base)).toBe(200);
  }, 20_000);
});
