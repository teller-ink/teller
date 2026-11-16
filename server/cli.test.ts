// The `teller` command as a stranger meets it — the 2026-11-16 audit's
// lane F, pinned. Spawns the real `bin/teller` (and the real host) the
// way `host.test.ts` does, because what these guard is what lands on a
// terminal and on disk, not what a function returns.

import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(ROOT, 'bin', 'teller');
const ENTRY = join(ROOT, 'server', 'index.ts');

let dir: string;
const running: ChildProcess[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-cli-'));
});

afterEach(() => {
  for (const child of running.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

function teller(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  running.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (c: Buffer) => (stdout += c.toString()));
  child.stderr!.on('data', (c: Buffer) => (stderr += c.toString()));
  return new Promise((resolve) => child.on('exit', (code) => resolve({ code, stdout, stderr })));
}

/** A real host on port 0, resolved once it has printed where it is. */
function host(data: string): Promise<{ child: ChildProcess; out: () => string }> {
  const child = spawn(process.execPath, [ENTRY, '--data', data, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);
  let out = '';
  return new Promise((resolve, reject) => {
    const seen = (chunk: Buffer) => {
      out += chunk.toString();
      if (/DM key:/.test(out)) {
        child.stdout!.off('data', seen);
        child.stdout!.on('data', (c: Buffer) => (out += c.toString()));
        resolve({ child, out: () => out });
      }
    };
    child.stdout!.on('data', seen);
    child.stderr!.on('data', (c: Buffer) => (out += c.toString()));
    child.on('exit', (code) => reject(new Error(`host exited ${code} before listening:\n${out}`)));
  });
}

/** An authentic-enough 0.1.0 folder: the old database, and no shelf. */
function oldShape(): string {
  const old = join(dir, 'old');
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'teller.db'), 'SQLite format 3\0');
  return old;
}

describe('a pre-fold (0.1.0) data folder is refused by every command that touches it', () => {
  it.each([
    ['plugins', ['plugins']],
    ['plugins --enable', ['plugins', '--enable', 'whatever']],
    ['key', ['key']],
    ['key --reset', ['key', '--reset']],
    ['where', ['where']],
  ])('%s refuses and writes nothing', async (_label, args) => {
    const old = oldShape();
    const before = readdirSync(old).sort();
    const said = await teller([...args, '--data', old]);
    expect(said.code).toBe(1);
    expect(said.stderr).toMatch(/pre-fold teller database \(teller\.db\)/);
    expect(said.stderr).toMatch(/Move the old folder aside/);
    // Nothing written — above all no shelf.db, which is what used to
    // disarm `host`'s refusal for good.
    expect(readdirSync(old).sort()).toEqual(before);
    expect(existsSync(join(old, 'shelf.db'))).toBe(false);
  }, 20_000);

  it('and host still refuses afterwards — the guard was never disarmed', async () => {
    const old = oldShape();
    await teller(['plugins', '--data', old]);
    const said = await teller(['host', old, '--port', '4841']);
    expect(said.code).toBe(1);
    expect(said.stderr).toMatch(/pre-fold teller database/);
  }, 20_000);
});

describe('the shelf exists from the first boot', () => {
  it('a host on an empty folder makes systems/, packs/, plugins/, panels/, books/', async () => {
    const data = join(dir, 'fresh');
    const h = await host(data);
    for (const name of ['systems', 'packs', 'plugins', 'panels', 'books']) {
      expect(statSync(join(data, name)).isDirectory()).toBe(true);
      // Folders only — nothing is ever seeded into the data dir.
      expect(readdirSync(join(data, name))).toEqual([]);
    }
    h.child.kill('SIGTERM');
  }, 20_000);

  it("prints what the sweep said about a pack naming a system nobody has", async () => {
    const data = join(dir, 'said');
    const pack = join(data, 'packs', 'critters');
    mkdirSync(pack, { recursive: true });
    writeFileSync(
      join(pack, 'pack.json'),
      JSON.stringify({ id: 'pak_critters01', system: 'starter', name: 'Critters', version: 1 }),
    );
    const h = await host(data);
    const out = h.out();
    expect(out).toMatch(/SHELF PROBLEM .*critters: pack\.json names the system "starter"/);
    expect(out).toMatch(/sys_starter \(Starter\)/);
    h.child.kill('SIGTERM');
  }, 20_000);
});

describe('teller where', () => {
  it('names the data folder AND the install’s own defaults, which exist', async () => {
    const said = await teller(['where', '--data', dir]);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain(`data      ${dir}`);
    const defaults = /defaults {2}(.+)/.exec(said.stdout)?.[1]?.trim();
    expect(defaults).toBeDefined();
    expect(existsSync(join(defaults!, 'systems', 'starter', 'system.json'))).toBe(true);

    const only = await teller(['where', '--defaults', '--data', dir]);
    expect(only.stdout.trim()).toBe(defaults);
  }, 20_000);
});

describe('teller key --reset beside a running host', () => {
  it('says in one sentence that the running host keeps the old key — then resets anyway', async () => {
    const data = join(dir, 'live');
    const h = await host(data);
    const said = await teller(['key', '--reset', '--data', data]);
    expect(said.code).toBe(0);
    expect(said.stderr).toMatch(/keeps the old key until it is restarted/);
    expect(said.stderr).toContain(`pid ${h.child.pid}`);
    // stdout is the new key and nothing else — scripts read it.
    expect(said.stdout.trim().split('\n')).toHaveLength(1);
    h.child.kill('SIGTERM');

    // With no host running, a reset says nothing extra.
    const quiet = await teller(['key', '--reset', '--data', join(dir, 'idle')]);
    expect(quiet.stderr).toBe('');
  }, 20_000);
});
