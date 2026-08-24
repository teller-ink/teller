import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  rmSync,
  utimesSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShelf, type Shelf } from './store.ts';
import { writeArchive } from './archive.ts';
import {
  defaultPanelDir,
  defaultPanels,
  defaultsRoot,
  panelArchive,
  panelDir,
  sweepPanels,
} from './panels-shelf.ts';

let dir: string;

/** Teller's five, copied onto a scratch table's shelf — what a table
 * that wants to override every default would do by hand, and the
 * fixture the sweep tests below need. NOTHING in teller does this. */
function copyDefaultsOntoShelf(): void {
  cpSync(defaultsRoot(), join(dir, 'panels'), { recursive: true });
}

const DEFAULT_NAMES = ['boards', 'books', 'handouts', 'log', 'plugins', 'screens', 'shelf'];

/** The `?v=` a code url is expected to carry, worked out from the
 * artifact the same way the sweep does — so these tests pin the RULE
 * (the url names this build), not one machine's clock. */
function stampOf(outPath: string): string {
  return `?v=${Math.floor(statSync(outPath).mtimeMs).toString(36)}`;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-panels-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('defaultPanels — teller\'s own, shipped with the install', () => {
  it('reads the seven host tools from defaults/panels, with ids baked into the files', () => {
    const panels = defaultPanels();
    expect(panels.map((p) => p.name).sort()).toEqual(DEFAULT_NAMES);
    for (const panel of panels) {
      expect(panel.id).toMatch(/^pan_[0-9a-f]{12}$/);
      expect(panel.subject).toBe('none');
    }
  });

  it('needs no data dir at all — the install is where they live', () => {
    // Nothing under `dir` exists yet, and the defaults load anyway.
    expect(defaultPanels().length).toBe(DEFAULT_NAMES.length);
    expect(existsSync(join(dir, 'panels'))).toBe(false);
  });

  it('ids are stable across reads — nothing is minted at boot any more', () => {
    const first = defaultPanels().map((p) => p.id);
    const second = defaultPanels().map((p) => p.id);
    expect(second).toEqual(first);
  });

  it('writes nothing into the data dir — the table\'s panels/ is the table\'s', () => {
    defaultPanels();
    expect(existsSync(join(dir, 'panels'))).toBe(false);
  });

  it('defaultPanelDir resolves a shipped id back to its folder in the install', () => {
    const boards = defaultPanels().find((p) => p.name === 'boards')!;
    expect(defaultPanelDir(boards.id!)).toBe(join(defaultsRoot(), 'boards'));
    expect(defaultPanelDir('pan_nope')).toBeUndefined();
  });
});

describe('sweepPanels — reads and reports, writes nothing (like discoverPlugins)', () => {
  it('no panels folder yet is just an empty shelf', () => {
    expect(sweepPanels(dir)).toEqual({ panels: [], problems: [] });
  });

  it('reads every panel folder on the shelf, whole', () => {
    copyDefaultsOntoShelf();
    const { panels, problems } = sweepPanels(dir);
    expect(problems).toEqual([]);
    expect(panels.map((p) => p.name).sort()).toEqual(DEFAULT_NAMES);
  });

  it('a swept panel carries the edit — the file on disk wins', () => {
    copyDefaultsOntoShelf();
    const path = join(dir, 'panels', 'shelf', 'panel.json');
    const before = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...before, label: 'House Shelf' }));

    const { panels } = sweepPanels(dir);
    const shelfPanel = panels.find((p) => p.name === 'shelf');
    expect(shelfPanel?.label).toBe('House Shelf');
  });

  it('a duplicated folder just works — another file in the collection', () => {
    copyDefaultsOntoShelf();
    const boards = JSON.parse(
      readFileSync(join(dir, 'panels', 'boards', 'panel.json'), 'utf8'),
    );
    const dupDir = join(dir, 'panels', 'my-boards');
    mkdirSync(dupDir, { recursive: true });
    writeFileSync(
      join(dupDir, 'panel.json'),
      JSON.stringify({ ...boards, name: 'my-boards', label: 'My Boards' }),
    );

    const { panels } = sweepPanels(dir);
    expect(panels.some((p) => p.name === 'my-boards' && p.label === 'My Boards')).toBe(
      true,
    );
    // The original is untouched — duplicating didn't rename it away.
    expect(panels.some((p) => p.name === 'boards')).toBe(true);
  });

  it('a broken panel.json degrades — reported, never a crash, rest of the shelf loads', () => {
    copyDefaultsOntoShelf();
    const brokenDir = join(dir, 'panels', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'panel.json'), '{ not json');

    const emptyNameDir = join(dir, 'panels', 'empty-name');
    mkdirSync(emptyNameDir, { recursive: true });
    writeFileSync(join(emptyNameDir, 'panel.json'), JSON.stringify({ label: 'No name' }));

    const { panels, problems } = sweepPanels(dir);
    expect(panels.length).toBe(DEFAULT_NAMES.length);
    expect(problems).toHaveLength(2);
    expect(problems.map((p) => p.problem)).toEqual([
      'panel.json is not a panel (needs a name)',
      'panel.json is not a panel (needs a name)',
    ]);
    expect(problems.map((p) => p.dir).sort()).toEqual([brokenDir, emptyNameDir].sort());
  });
});

describe('sweepPanels — the code ladder (§E UN-DEFERRED, rungs 3-5)', () => {
  let shelf: Shelf;

  beforeEach(() => {
    shelf = openShelf(dir);
  });

  afterEach(() => {
    shelf.close();
  });

  function writeBlockPanel(name: string, id: string, source: string) {
    const panelDirPath = join(dir, 'panels', name);
    mkdirSync(join(panelDirPath, 'blocks'), { recursive: true });
    writeFileSync(
      join(panelDirPath, 'panel.json'),
      JSON.stringify({ name, id, subject: 'none', mounted: [], held: [] }),
    );
    writeFileSync(join(panelDirPath, 'blocks', 'Widget.tsx'), source);
    return panelDirPath;
  }

  const VALID_BLOCK = `export default function Widget() { return null; }\n`;

  it('compiles a block to .build and the loaded PanelDef carries code.blocks once trusted', () => {
    writeBlockPanel('my-widget', 'pan_widget1', VALID_BLOCK);
    shelf.setPluginEnabled('pan_widget1', true);

    const { panels, problems } = sweepPanels(dir, shelf);
    expect(problems).toEqual([]);
    const panel = panels.find((p) => p.name === 'my-widget');
    expect(panel?.codePending).toBeUndefined();
    expect(panel?.code?.blocks?.Widget).toBe(
      `/panel-code/pan_widget1/blocks/Widget.js${stampOf(join(dir, 'panels', 'my-widget', '.build', 'blocks', 'Widget.js'))}`,
    );

    const built = readFileSync(
      join(dir, 'panels', 'my-widget', '.build', 'blocks', 'Widget.js'),
      'utf8',
    );
    expect(built).toContain('Widget');
  });

  it('an untrusted code-carrying panel gets codePending instead of code', () => {
    writeBlockPanel('untrusted-widget', 'pan_widget2', VALID_BLOCK);
    // No trust row written — the sweep discovers, only a human enables.

    const { panels } = sweepPanels(dir, shelf);
    const panel = panels.find((p) => p.name === 'untrusted-widget');
    expect(panel?.code).toBeUndefined();
    expect(panel?.codePending).toBe(true);
  });

  it('a syntax-error block lands in problems, and the declaration still loads', () => {
    writeBlockPanel('broken-widget', 'pan_widget3', 'export default function( {{{ broken');
    shelf.setPluginEnabled('pan_widget3', true);

    const { panels, problems } = sweepPanels(dir, shelf);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].dir).toBe(join(dir, 'panels', 'broken-widget'));
    const panel = panels.find((p) => p.name === 'broken-widget');
    expect(panel).toBeDefined();
    expect(panel?.code).toBeUndefined();
  });

  it('mtime skip — a second sweep does not recompile an unchanged source', () => {
    writeBlockPanel('cached-widget', 'pan_widget4', VALID_BLOCK);
    shelf.setPluginEnabled('pan_widget4', true);

    sweepPanels(dir, shelf);
    const outPath = join(dir, 'panels', 'cached-widget', '.build', 'blocks', 'Widget.js');
    const firstBuild = statSync(outPath).mtimeMs;

    // Push the output's mtime into the future — if the sweep rebuilds
    // unconditionally, it will stomp this back down to "now".
    const future = new Date(Date.now() + 60_000);
    utimesSync(outPath, future, future);

    sweepPanels(dir, shelf);
    const secondBuild = statSync(outPath).mtimeMs;
    expect(secondBuild).toBe(future.getTime());
    expect(secondBuild).not.toBe(firstBuild);
  });

  it('a recompile changes the URL, and an unchanged one keeps it', () => {
    writeBlockPanel('stamped-widget', 'pan_widget6', VALID_BLOCK);
    shelf.setPluginEnabled('pan_widget6', true);
    const urlNow = () =>
      sweepPanels(dir, shelf).panels.find((p) => p.name === 'stamped-widget')?.code?.blocks
        ?.Widget;

    const first = urlNow();
    expect(first).toMatch(/\?v=[0-9a-z]+$/);
    // Two sweeps over an untouched folder: nothing recompiled, so
    // nothing may move — a url that churned on its own would throw
    // every cached module away for no reason.
    expect(urlNow()).toBe(first);

    // Now edit the source the way a person does, and push its mtime
    // past the build's so the sweep sees the change on a fast disk.
    const source = join(dir, 'panels', 'stamped-widget', 'blocks', 'Widget.tsx');
    writeFileSync(source, `export default function Widget() { return null; } // edited\n`);
    const later = new Date(Date.now() + 60_000);
    utimesSync(source, later, later);

    const second = urlNow();
    expect(second).toMatch(/\?v=[0-9a-z]+$/);
    expect(second).not.toBe(first);
  });

  it('style.css passes through untouched', () => {
    const name = 'styled-widget';
    const id = 'pan_widget5';
    const panelDirPath = join(dir, 'panels', name);
    mkdirSync(panelDirPath, { recursive: true });
    writeFileSync(
      join(panelDirPath, 'panel.json'),
      JSON.stringify({ name, id, subject: 'none', mounted: [], held: [] }),
    );
    writeFileSync(join(panelDirPath, 'style.css'), '.widget { color: red; }\n');
    shelf.setPluginEnabled(id, true);

    const { panels } = sweepPanels(dir, shelf);
    const panel = panels.find((p) => p.name === name);
    expect(panel?.code?.style).toBe(
      `/panel-code/${id}/style.css${stampOf(join(panelDirPath, '.build', 'style.css'))}`,
    );
    const copied = readFileSync(join(panelDirPath, '.build', 'style.css'), 'utf8');
    expect(copied).toBe('.widget { color: red; }\n');
  });

  it("a table's own copy of a default is an ordinary panel — its code waits for a human", () => {
    // Nothing is trusted by provenance any more: teller seeds nothing,
    // so there is no seed-time trust write, and a panel on the table's
    // shelf carrying code is gated exactly like any other (fail-closed).
    const tableDir = join(dir, 'panels', 'boards');
    copyDefaultsOntoShelf();
    mkdirSync(join(tableDir, 'blocks'), { recursive: true });
    writeFileSync(join(tableDir, 'blocks', 'Widget.tsx'), VALID_BLOCK);
    const id = JSON.parse(readFileSync(join(tableDir, 'panel.json'), 'utf8')).id;

    let boards = sweepPanels(dir, shelf).panels.find((p) => p.name === 'boards');
    expect(boards?.code).toBeUndefined();
    expect(boards?.codePending).toBe(true);

    shelf.setPluginEnabled(id, true);
    boards = sweepPanels(dir, shelf).panels.find((p) => p.name === 'boards');
    expect(boards?.code?.blocks?.Widget).toBe(
      `/panel-code/${id}/blocks/Widget.js${stampOf(join(tableDir, '.build', 'blocks', 'Widget.js'))}`,
    );
  });
});

describe('panelDir — resolving a pan_ id back to its folder', () => {
  it('finds the folder whose panel.json carries this id', () => {
    copyDefaultsOntoShelf();
    const path = join(dir, 'panels', 'boards', 'panel.json');
    const id = JSON.parse(readFileSync(path, 'utf8')).id;
    expect(panelDir(dir, id)).toBe(join(dir, 'panels', 'boards'));
  });

  it('an unknown id resolves to nothing', () => {
    copyDefaultsOntoShelf();
    expect(panelDir(dir, 'pan_nope')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Rule 4a's law, applied to the other kind of folder: a `.panel` is the
// same thing, zipped.

describe('panels on the shelf as ARCHIVES', () => {
  /** A `.panel` dropped in the table's own panels folder. */
  function dropArchive(name: string, files: Record<string, string>): string {
    mkdirSync(join(dir, 'panels'), { recursive: true });
    const path = join(dir, 'panels', `${name}.panel`);
    writeFileSync(
      path,
      writeArchive(
        Object.entries(files).map(([file, body]) => ({
          name: file,
          data: Buffer.from(body, 'utf8'),
        })),
      ),
    );
    return path;
  }

  const LOG = JSON.stringify(
    { id: 'pan_dropped01', name: 'house-log', label: 'House Log', mounted: [] },
    null,
    2,
  );

  it('an archive unpacks to a folder the sweep then reads', () => {
    dropArchive('house-log', { 'panel.json': LOG, 'style.css': '.x{}' });
    const { panels, problems } = sweepPanels(dir);
    expect(problems).toEqual([]);
    expect(panels.map((p) => p.name)).toEqual(['house-log']);
    expect(existsSync(join(dir, 'panels', 'house-log', 'panel.json'))).toBe(true);
    expect(existsSync(join(dir, 'panels', 'house-log', 'style.css'))).toBe(true);
  });

  it('the minted pan_ id travels — this is the same panel, arriving', () => {
    dropArchive('house-log', { 'panel.json': LOG });
    expect(sweepPanels(dir).panels[0].id).toBe('pan_dropped01');
  });

  it('the archive file is kept, and a second sweep installs nothing again', () => {
    const path = dropArchive('house-log', { 'panel.json': LOG });
    sweepPanels(dir);
    const manifest = join(dir, 'panels', 'house-log', 'panel.json');
    const before = statSync(manifest).mtimeMs;
    sweepPanels(dir);
    expect(existsSync(path)).toBe(true);
    expect(statSync(manifest).mtimeMs).toBe(before);
  });

  it('an existing folder is never written over — and the collision is SAID', () => {
    mkdirSync(join(dir, 'panels', 'house-log'), { recursive: true });
    writeFileSync(
      join(dir, 'panels', 'house-log', 'panel.json'),
      JSON.stringify({ id: 'pan_mine', name: 'house-log', label: 'Mine' }),
    );
    // Newly dropped over an existing panel: that is the news.
    const path = dropArchive('house-log', { 'panel.json': LOG });
    utimesSync(path, new Date(), new Date(Date.now() + 60_000));

    const { panels, problems } = sweepPanels(dir);
    expect(panels[0].label).toBe('Mine');
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toMatch(/already exists — the folder wins/);
  });

  it('but the archive that MADE the folder stops complaining about it', () => {
    dropArchive('house-log', { 'panel.json': LOG });
    expect(sweepPanels(dir).problems).toEqual([]);
    // Second sweep, third, forever: the steady state is silent.
    expect(sweepPanels(dir).problems).toEqual([]);
    expect(sweepPanels(dir).problems).toEqual([]);
  });

  it('a file that is not a zip is a problem, never a crash', () => {
    mkdirSync(join(dir, 'panels'), { recursive: true });
    writeFileSync(join(dir, 'panels', 'broken.panel'), 'not a zip');
    const { panels, problems } = sweepPanels(dir);
    expect(panels).toEqual([]);
    expect(problems[0].problem).toMatch(/did not open/);
  });

  it('an archive carrying no panel.json installs nothing and says why', () => {
    dropArchive('nameless', { 'style.css': '.x{}' });
    const { problems } = sweepPanels(dir);
    expect(problems[0].problem).toMatch(/no panel.json with a name/);
    expect(existsSync(join(dir, 'panels', 'nameless'))).toBe(false);
  });

  it('the round trip — export a panel here, drop it on another shelf', () => {
    copyDefaultsOntoShelf();
    const from = join(dir, 'panels', 'log');
    // Compile output exists on the source shelf and must NOT travel.
    mkdirSync(join(from, '.build'), { recursive: true });
    writeFileSync(join(from, '.build', 'panel.js'), 'compiled');
    const here = sweepPanels(dir).panels.find((p) => p.name === 'log');

    const bytes = panelArchive(from);
    const other = mkdtempSync(join(tmpdir(), 'teller-panels-there-'));
    try {
      mkdirSync(join(other, 'panels'), { recursive: true });
      writeFileSync(join(other, 'panels', 'log.panel'), bytes);
      const { panels, problems } = sweepPanels(other);
      expect(problems).toEqual([]);
      expect(panels).toEqual([here]);
      expect(existsSync(join(other, 'panels', 'log', '.build'))).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
