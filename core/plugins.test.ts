import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverPlugins, enablePlugin, loadPlugins, providersOf } from './plugins.ts';
import { openShelf, type Shelf } from './store.ts';

let dir: string;
let shelf: Shelf;

/** A plugin folder on the shelf, written the way an author would. */
function author(
  name: string,
  manifest: unknown,
  host?: string,
): string {
  const at = join(dir, 'plugins', name);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, 'plugin.json'), JSON.stringify(manifest));
  if (host !== undefined) writeFileSync(join(at, 'host.mjs'), host);
  return at;
}

const echo = {
  id: 'plg_echo',
  name: 'Echo',
  version: 1,
  provides: ['propose.turn'],
  needs: [],
};

const ECHO_HOST = `
export const provides = {
  'propose.turn': (snapshot) => ({ suggestion: snapshot.round + 1 }),
};
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-plugins-'));
  shelf = openShelf(dir);
});

afterEach(() => {
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('discovery — the sweep reads and reports, writes nothing', () => {
  it('lists what is on the shelf, disabled until a human says otherwise', () => {
    author('echo', echo, ECHO_HOST);
    const { found, problems } = discoverPlugins(dir, shelf);
    expect(problems).toEqual([]);
    expect(found).toHaveLength(1);
    expect(found[0].manifest.id).toBe('plg_echo');
    expect(found[0].enabled).toBe(false);
    expect(shelf.pluginTrust('plg_echo')).toBeUndefined();
  });

  it('a malformed manifest is a problem, not a crash', () => {
    author('broken', { name: 'No Id' });
    const { found, problems } = discoverPlugins(dir, shelf);
    expect(found).toEqual([]);
    expect(problems[0].problem).toMatch(/plg_ id/);
  });

  it('no plugins folder is just an empty shelf', () => {
    expect(discoverPlugins(dir, shelf)).toEqual({ found: [], problems: [] });
  });
});

describe('the enable gate', () => {
  it('an unenabled plugin is discovered but never imported', async () => {
    author('echo', echo, ECHO_HOST);
    const { loaded, problems } = await loadPlugins(dir, shelf);
    expect(loaded).toEqual([]);
    expect(problems).toEqual([]);
  });

  it('enablement lives on the shelf and survives reopening', () => {
    shelf.setPluginEnabled('plg_echo', true);
    expect(shelf.pluginTrust('plg_echo')?.enabled).toBe(true);
    shelf.setPluginEnabled('plg_echo', false);
    expect(shelf.pluginTrust('plg_echo')?.enabled).toBe(false);
  });

  it('config is one blob per plugin id, enablement untouched', () => {
    shelf.setPluginConfig('plg_echo', { model: 'claude-sonnet-5' });
    expect(shelf.pluginTrust('plg_echo')).toEqual({
      enabled: false,
      config: { model: 'claude-sonnet-5' },
    });
    shelf.setPluginEnabled('plg_echo', true);
    expect(shelf.pluginTrust('plg_echo')?.config).toEqual({
      model: 'claude-sonnet-5',
    });
  });
});

describe('loading — only what a human enabled, only points the registry knows', () => {
  it('imports, wires provides, and a call round-trips message-shaped', async () => {
    author('echo', echo, ECHO_HOST);
    shelf.setPluginEnabled('plg_echo', true);
    const { loaded, problems } = await loadPlugins(dir, shelf);
    expect(problems).toEqual([]);
    expect(loaded).toHaveLength(1);
    const providers = providersOf(loaded, 'propose.turn');
    expect(providers.map((p) => p.id)).toEqual(['plg_echo']);
    expect(await providers[0].call({ round: 2 })).toEqual({ suggestion: 3 });
  });

  it('a provide against a point the registry never heard of is refused out loud', async () => {
    author(
      'rogue',
      { ...echo, id: 'plg_rogue', provides: ['decide.turn'] },
      `export const provides = { 'decide.turn': () => 'I decide now' };`,
    );
    shelf.setPluginEnabled('plg_rogue', true);
    const { loaded, problems } = await loadPlugins(dir, shelf);
    expect(problems[0].problem).toMatch(/not a point in the registry/);
    expect(loaded[0].provides).toEqual({});
  });

  it('an unclonable proposal fails today, in process — not the day the transport changes', async () => {
    author(
      'leaky',
      { ...echo, id: 'plg_leaky' },
      `export const provides = { 'propose.turn': () => ({ handle: () => {} }) };`,
    );
    shelf.setPluginEnabled('plg_leaky', true);
    const { loaded } = await loadPlugins(dir, shelf);
    await expect(
      providersOf(loaded, 'propose.turn')[0].call({}),
    ).rejects.toThrow();
  });

  it('a broken plugin degrades like a missing pack — reported, table plays on', async () => {
    author('echo', echo, ECHO_HOST);
    author('broken', { ...echo, id: 'plg_broken' }, `throw new Error('boom');`);
    author('empty', { ...echo, id: 'plg_empty' });
    shelf.setPluginEnabled('plg_echo', true);
    shelf.setPluginEnabled('plg_broken', true);
    shelf.setPluginEnabled('plg_empty', true);
    const { loaded, problems } = await loadPlugins(dir, shelf);
    expect(loaded.map((p) => p.manifest.id)).toEqual(['plg_echo']);
    expect(problems.map((p) => p.problem).join(' | ')).toMatch(
      /failed to import.*boom/,
    );
    expect(problems.map((p) => p.problem).join(' | ')).toMatch(/no host\.mjs/);
  });
});

// ENABLEMENT IS CONSENT TO A LIST (§15).
//
// A plugin on the shelf is a file its author edits, so the needs it
// declares can widen after a human agreed to the old ones. That is the
// one way the enable gate can fail — quietly, by honouring a wider
// claim under an older yes — so it fails loudly instead.
describe('the enable gate remembers WHAT was agreed to', () => {
  const wants = ['read:entities — the sheets'];

  it('records the needs as written, and clears them when trust is taken back', () => {
    author('echo', { ...echo, needs: wants }, ECHO_HOST);
    enablePlugin(dir, shelf, 'plg_echo', true);
    expect(shelf.pluginTrust('plg_echo')?.wants).toEqual(wants);
    enablePlugin(dir, shelf, 'plg_echo', false);
    expect(shelf.pluginTrust('plg_echo')?.wants).toBeUndefined();
  });

  it('refuses to run a plugin that now wants more than it was enabled for', async () => {
    author('echo', { ...echo, needs: wants }, ECHO_HOST);
    enablePlugin(dir, shelf, 'plg_echo', true);
    expect((await loadPlugins(dir, shelf)).loaded).toHaveLength(1);

    // The author adds a line. Nobody agreed to this one.
    author('echo', { ...echo, needs: [...wants, 'write:log — quietly'] }, ECHO_HOST);
    const { loaded, problems } = await loadPlugins(dir, shelf);
    expect(loaded).toEqual([]);
    expect(problems[0].problem).toMatch(/wants more than it was enabled for/);
    expect(problems[0].problem).toContain('write:log — quietly');

    // Saying yes again is what fixes it — and only a human does that.
    enablePlugin(dir, shelf, 'plg_echo', true);
    expect((await loadPlugins(dir, shelf)).loaded).toHaveLength(1);
  });

  it('lets a plugin drop a need without asking again', async () => {
    author('echo', { ...echo, needs: [...wants, 'write:log — quietly'] }, ECHO_HOST);
    enablePlugin(dir, shelf, 'plg_echo', true);
    author('echo', { ...echo, needs: wants }, ECHO_HOST);
    const { loaded, problems } = await loadPlugins(dir, shelf);
    expect(problems).toEqual([]);
    expect(loaded).toHaveLength(1);
  });

  it('grandfathers a row enabled before this was recorded — and says so every boot', async () => {
    author('echo', { ...echo, needs: wants }, ECHO_HOST);
    // The old spelling: enabled, with nothing written down about what for.
    shelf.setPluginEnabled('plg_echo', true);
    const { loaded, problems } = await loadPlugins(dir, shelf);
    // It runs — taking a table's plugins away over a bookkeeping change
    // would be the wrong failure — but it is never silent about it.
    expect(loaded).toHaveLength(1);
    expect(problems[0].problem).toMatch(/enabled before teller recorded what it wants/);
    expect(problems[0].problem).toContain('read:entities — the sheets');

    enablePlugin(dir, shelf, 'plg_echo', true);
    expect((await loadPlugins(dir, shelf)).problems).toEqual([]);
  });

  it('says nothing about a plugin that wants nothing', async () => {
    author('echo', echo, ECHO_HOST);
    shelf.setPluginEnabled('plg_echo', true);
    expect((await loadPlugins(dir, shelf)).problems).toEqual([]);
  });
});
