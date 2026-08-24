import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCampaign } from './boot.ts';
import { archiveJson, openArchive, writeArchive } from './archive.ts';
import {
  packArchive,
  packDir,
  packPanelDir,
  sweepPacks,
  refusalModule,
  systemExportModule,
  systemIndexModule,
} from './packs-shelf.ts';
import { createCampaign, openShelf, type Campaign, type Shelf } from './store.ts';

let dir: string;
let shelf: Shelf;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-packs-'));
  shelf = openShelf(dir);
});

afterEach(() => {
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A folder on the shelf: `pack.json` plus whatever slots the test wants. */
function writePack(name: string, files: Record<string, unknown>): string {
  const packDir = join(dir, 'packs', name);
  mkdirSync(packDir, { recursive: true });
  for (const [file, value] of Object.entries(files)) {
    writeFileSync(join(packDir, file), JSON.stringify(value, null, 2));
  }
  return packDir;
}

const GUIDEBOOK = {
  'pack.json': {
    id: 'pak_folder01',
    system: 'sys_test',
    name: 'Folder Guidebook',
    version: 3,
    rights: { status: 'personal' },
  },
  'system.json': {
    id: 'sys_test',
    name: 'Test System',
    version: 7,
    dials: { Grit: 'cylinder' },
    statuses: [{ name: 'Dazed' }],
  },
  'bestiary.json': [{ id: 'foe_1', name: 'Coyote', lists: {} }],
};

describe('sweepPacks — a folder yields both shelf entities', () => {
  it('no packs folder yet is just an empty shelf', () => {
    expect(sweepPacks(dir)).toEqual({ systems: [], packs: [], problems: [] });
  });

  it('reads pack.json as identity and every other *.json as a slot', () => {
    writePack('guidebook', GUIDEBOOK);
    const { systems, packs, problems } = sweepPacks(dir);
    expect(problems).toEqual([]);

    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe('pak_folder01');
    expect(packs[0].system).toBe('sys_test');
    expect(packs[0].name).toBe('Folder Guidebook');
    expect(packs[0].version).toBe(3);
    expect(packs[0].data.bestiary).toEqual([{ id: 'foe_1', name: 'Coyote', lists: {} }]);
    // `system.json` is the system's, never a pack slot.
    expect(packs[0].data.system).toBeUndefined();

    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ id: 'sys_test', name: 'Test System', version: 7 });
    expect(systems[0].data.dials).toEqual({ Grit: 'cylinder' });
    // Identity keys are reserved — they never become record slots.
    expect(systems[0].data.id).toBeUndefined();
    expect(systems[0].data.version).toBeUndefined();
  });

  it('a folder may carry a pack and no system at all', () => {
    writePack('bestiary-only', {
      'pack.json': { id: 'pak_only', system: 'sys_test', name: 'Just Foes', version: 1 },
      'bestiary.json': [],
    });
    const { systems, packs } = sweepPacks(dir);
    expect(systems).toEqual([]);
    expect(packs).toHaveLength(1);
  });

  it('a folder with no pack.json is not a pack — skipped in silence', () => {
    mkdirSync(join(dir, 'packs', 'not-a-pack'), { recursive: true });
    writeFileSync(join(dir, 'packs', 'not-a-pack', 'bestiary.json'), '[]');
    expect(sweepPacks(dir)).toEqual({ systems: [], packs: [], problems: [] });
  });
});

describe('sweepPacks — degradation is out loud (the panels posture)', () => {
  it('a malformed slot file is reported and only that slot is lost', () => {
    const packDir = writePack('guidebook', GUIDEBOOK);
    writeFileSync(join(packDir, 'catalog.json'), '{ not json');

    const { packs, problems } = sweepPacks(dir);
    expect(packs).toHaveLength(1);
    expect(packs[0].data.bestiary).toBeDefined();
    expect(packs[0].data.catalog).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0].dir).toBe(packDir);
    expect(problems[0].problem).toMatch(/^catalog\.json did not parse/);
  });

  it('a malformed pack.json costs the folder, never the rest of the shelf', () => {
    writePack('guidebook', GUIDEBOOK);
    const brokenDir = join(dir, 'packs', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'pack.json'), '{ not json');

    const { packs, problems } = sweepPacks(dir);
    expect(packs.map((p) => p.id)).toEqual(['pak_folder01']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ dir: brokenDir });
    expect(problems[0].problem).toMatch(/pack\.json is not a pack/);
  });

  it('a pack.json with no id is reported — identity is the id, never the name', () => {
    writePack('nameless', { 'pack.json': { name: 'No Id', version: 1 } });
    const { packs, problems } = sweepPacks(dir);
    expect(packs).toEqual([]);
    expect(problems[0].problem).toMatch(/no id/);
  });

  it('a system.json that is not an object is reported and the pack still loads', () => {
    const packDir = writePack('guidebook', { ...GUIDEBOOK, 'system.json': ['nope'] });
    const { systems, packs, problems } = sweepPacks(dir);
    expect(systems).toEqual([]);
    expect(packs).toHaveLength(1);
    expect(problems).toEqual([
      { dir: packDir, problem: 'system.json is not a system (needs an object)' },
    ]);
  });
});

describe('sweepPacks — art reaches the serving path', () => {
  function writeArt(packDir: string, rel: string, bytes: string) {
    const path = join(packDir, 'art', rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, bytes);
    return path;
  }

  it('copies art under the pack id, where /files/art/… serves it', () => {
    const packDir = writePack('guidebook', {
      ...GUIDEBOOK,
      'brand.json': { logo: 'art/logo.png' },
    });
    writeArt(packDir, 'logo.png', 'PNGBYTES');

    const { packs } = sweepPacks(dir);
    const served = join(dir, 'art', 'pak_folder01', 'logo.png');
    expect(existsSync(served)).toBe(true);
    expect(readFileSync(served, 'utf8')).toBe('PNGBYTES');
    // …and the reference is rewritten to the key that route resolves.
    expect(packs[0].data.brand).toEqual({ logo: 'art/pak_folder01/logo.png' });
  });

  it('rewrites art references anywhere in a slot, however nested', () => {
    const packDir = writePack('guidebook', {
      ...GUIDEBOOK,
      'portraits.json': { Gunslinger: 'art/trades/gun.png' },
      'trades.json': [{ name: 'Gunslinger', art: 'art/trades/gun.png' }],
    });
    writeArt(packDir, 'trades/gun.png', 'JPEG');

    const { packs } = sweepPacks(dir);
    expect(packs[0].data.portraits).toEqual({
      Gunslinger: 'art/pak_folder01/trades/gun.png',
    });
    expect(packs[0].data.trades).toEqual([
      { name: 'Gunslinger', art: 'art/pak_folder01/trades/gun.png' },
    ]);
    expect(existsSync(join(dir, 'art', 'pak_folder01', 'trades', 'gun.png'))).toBe(true);
  });

  // §J's shape, and the reason it needs its own case: the pictures sit
  // TWO levels down, under a slot that the system also states. A pack
  // restating `dice` with nothing but `art` is how branded faces reach
  // unbranded mechanics (§M-3) — the merge does the joining, and this
  // only has to prove the keys arrive pointing at the served path.
  it('rewrites art two levels down — a pack restating `dice` with only `art`', () => {
    const packDir = writePack('guidebook', {
      ...GUIDEBOOK,
      'dice.json': { art: { hit: 'art/wiw/die_hit.png', ace: 'art/wiw/die_ace.png' } },
    });
    writeArt(packDir, 'wiw/die_hit.png', 'HIT');
    writeArt(packDir, 'wiw/die_ace.png', 'ACE');

    const { packs } = sweepPacks(dir);
    expect(packs[0].data.dice).toEqual({
      art: {
        hit: 'art/pak_folder01/wiw/die_hit.png',
        ace: 'art/pak_folder01/wiw/die_ace.png',
      },
    });
    expect(existsSync(join(dir, 'art', 'pak_folder01', 'wiw', 'die_hit.png'))).toBe(true);
  });

  it('the rewrite is idempotent — an already-installed key is left alone', () => {
    writePack('guidebook', {
      ...GUIDEBOOK,
      'brand.json': { logo: 'art/pak_folder01/logo.png' },
    });
    const { packs } = sweepPacks(dir);
    expect(packs[0].data.brand).toEqual({ logo: 'art/pak_folder01/logo.png' });
  });

  it('mtime skip — a second sweep does not re-copy an unchanged picture', () => {
    const packDir = writePack('guidebook', GUIDEBOOK);
    writeArt(packDir, 'logo.png', 'PNGBYTES');

    sweepPacks(dir);
    const served = join(dir, 'art', 'pak_folder01', 'logo.png');
    // Push the copy's mtime into the future — an unconditional re-copy
    // would stomp it back down to now.
    const future = new Date(Date.now() + 60_000);
    utimesSync(served, future, future);

    sweepPacks(dir);
    expect(statSync(served).mtimeMs).toBe(future.getTime());
  });
});

describe('loadCampaign — a folder beats a row', () => {
  function campaignOn(system: string, packs: string[]): Campaign {
    const campaign = createCampaign(dir, 'table', 'The Table');
    const root = campaign.root();
    campaign.save(
      {
        ...root,
        refs: {
          system: { id: system, name: system },
          packs: packs.map((id) => ({ id, name: id })),
        },
      },
      'test',
    );
    return campaign;
  }

  it('the folder-sourced system and pack load into the stack', () => {
    writePack('guidebook', GUIDEBOOK);
    const campaign = campaignOn('sys_test', ['pak_folder01']);
    const loaded = loadCampaign(shelf, campaign, dir);

    expect(loaded.missing).toEqual([]);
    expect(loaded.system).toMatchObject({ id: 'sys_test', version: 7 });
    expect(loaded.packs.map((p) => p.id)).toEqual(['pak_folder01']);
    expect(loaded.record('dials')).toEqual({ Grit: 'cylinder' });
    expect(loaded.templates('bestiary').map((t) => t.name)).toEqual(['Coyote']);
    campaign.close();
  });

  it('an edit to system.json shows up on the next load — the edit recipe', () => {
    const packDir = writePack('guidebook', GUIDEBOOK);
    const campaign = campaignOn('sys_test', ['pak_folder01']);
    expect(loadCampaign(shelf, campaign, dir).record('dials')).toEqual({
      Grit: 'cylinder',
    });

    const system = JSON.parse(readFileSync(join(packDir, 'system.json'), 'utf8'));
    writeFileSync(
      join(packDir, 'system.json'),
      JSON.stringify({ ...system, dials: { ...system.dials, Aces: 'cards' } }),
    );

    expect(loadCampaign(shelf, campaign, dir).record('dials')).toEqual({
      Grit: 'cylinder',
      Aces: 'cards',
    });
    campaign.close();
  });

  it('the folder wins over a shelf.db row of the same id', () => {
    shelf.putSystem({
      id: 'sys_test',
      name: 'Row System',
      version: 1,
      data: { dials: { Grit: 'bar' } },
    });
    shelf.putPack({
      id: 'pak_folder01',
      system: 'sys_test',
      name: 'Row Pack',
      version: 1,
      data: { bestiary: [{ id: 'foe_row', name: 'Row Foe' }] },
    });
    writePack('guidebook', GUIDEBOOK);

    const campaign = campaignOn('sys_test', ['pak_folder01']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.system?.name).toBe('Test System');
    expect(loaded.packs[0].name).toBe('Folder Guidebook');
    expect(loaded.record('dials')).toEqual({ Grit: 'cylinder' });
    expect(loaded.templates('bestiary').map((t) => t.name)).toEqual(['Coyote']);
    campaign.close();
  });

  it('a row not yet folder-ized still loads — nothing breaks mid-migration', () => {
    shelf.putSystem({ id: 'sys_test', name: 'Row System', version: 1, data: {} });
    shelf.putPack({
      id: 'pak_row',
      system: 'sys_test',
      name: 'Row Pack',
      version: 1,
      data: { bestiary: [{ id: 'foe_row', name: 'Row Foe' }] },
    });
    writePack('guidebook', GUIDEBOOK);

    // No declared list: every pack for the system applies, rows and
    // folders alike.
    const campaign = createCampaign(dir, 'table', 'The Table');
    const root = campaign.root();
    campaign.save(
      { ...root, refs: { system: { id: 'sys_test', name: 'sys_test' } } },
      'test',
    );
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.packs.map((p) => p.id).sort()).toEqual(['pak_folder01', 'pak_row']);
    expect(loaded.templates('bestiary').map((t) => t.name).sort()).toEqual([
      'Coyote',
      'Row Foe',
    ]);
    campaign.close();
  });

  it('a broken folder is a load-report problem, not a crash', () => {
    writePack('guidebook', GUIDEBOOK);
    const brokenDir = join(dir, 'packs', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'pack.json'), '{ not json');

    const campaign = campaignOn('sys_test', ['pak_folder01']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.packProblems).toHaveLength(1);
    expect(loaded.packProblems[0].dir).toBe(brokenDir);
    expect(loaded.templates('bestiary')).toHaveLength(1);
    campaign.close();
  });
});

describe('sweepPacks — the system carries code (§L phase 2)', () => {
  const PRESENTATION = `export default function TestFace() { return null; }\n`;

  /** A pack folder with `presentations/<name>.tsx` inside it. */
  function writePresentation(pack: string, name: string, source: string): string {
    const packDir = join(dir, 'packs', pack, 'presentations');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, `${name}.tsx`), source);
    return packDir;
  }

  it('compiles to .build and the pack carries code.presentations once trusted', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation('guidebook', 'TestFace', PRESENTATION);
    shelf.setPluginEnabled('pak_folder01', true);

    const { packs, problems } = sweepPacks(dir, shelf);
    expect(problems).toEqual([]);
    expect(packs[0].codePending).toBeUndefined();
    expect(packs[0].code?.presentations.TestFace).toMatch(
      /^\/pack-code\/pak_folder01\/presentations\/TestFace\.js\?v=[a-z0-9]+$/,
    );

    const built = readFileSync(
      join(dir, 'packs', 'guidebook', '.build', 'presentations', 'TestFace.js'),
      'utf8',
    );
    expect(built).toContain('TestFace');
  });

  it('untrusted: the data loads, the code does not', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation('guidebook', 'TestFace', PRESENTATION);
    // No trust row — the sweep discovers, only a human enables.

    const { packs, systems } = sweepPacks(dir, shelf);
    expect(packs[0].code).toBeUndefined();
    expect(packs[0].codePending).toBe(true);
    // …and every fact in the folder arrived anyway.
    expect(packs[0].data.bestiary).toHaveLength(1);
    expect(systems[0].data.dials).toEqual({ Grit: 'cylinder' });
  });

  it('a presentation importing `system` fails its compile, readably', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation(
      'guidebook',
      'Cyclic',
      `import { Other } from 'system';\nexport default function Cyclic() { return Other; }\n`,
    );
    shelf.setPluginEnabled('pak_folder01', true);

    const { packs, problems } = sweepPacks(dir, shelf);
    expect(problems).toHaveLength(1);
    expect(problems[0].dir).toBe(join(dir, 'packs', 'guidebook'));
    expect(problems[0].problem).toContain('presentations/Cyclic.tsx');
    expect(problems[0].problem).toContain('system');
    // The pack itself still loaded — a compile error costs the code, never the facts.
    expect(packs[0].data.bestiary).toHaveLength(1);
  });

  it('mtime skip — a second sweep does not recompile an unchanged presentation', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation('guidebook', 'TestFace', PRESENTATION);
    shelf.setPluginEnabled('pak_folder01', true);

    sweepPacks(dir, shelf);
    const out = join(dir, 'packs', 'guidebook', '.build', 'presentations', 'TestFace.js');
    const future = new Date(Date.now() + 60_000);
    utimesSync(out, future, future);

    sweepPacks(dir, shelf);
    expect(statSync(out).mtimeMs).toBe(future.getTime());
  });

  it('packDir resolves a pak_ id back to its folder, and an unknown one to nothing', () => {
    writePack('guidebook', GUIDEBOOK);
    expect(packDir(dir, 'pak_folder01')).toBe(join(dir, 'packs', 'guidebook'));
    expect(packDir(dir, 'pak_nope')).toBeUndefined();
  });
});

describe('sweepPacks — a pack may ship panels', () => {
  it('panel declarations ride the pack layer, and their code takes the same trust', () => {
    const dirPath = writePack('guidebook', GUIDEBOOK);
    mkdirSync(join(dirPath, 'panels', 'sheet', 'blocks'), { recursive: true });
    writeFileSync(
      join(dirPath, 'panels', 'sheet', 'panel.json'),
      JSON.stringify({ id: 'pan_pak01', name: 'sheet', label: 'Sheet', blocks: [] }),
    );
    writeFileSync(
      join(dirPath, 'panels', 'sheet', 'blocks', 'Row.tsx'),
      'export default function Row() { return null; }\n',
    );

    const { packs, problems } = sweepPacks(dir, shelf);
    expect(problems).toEqual([]);
    const panels = packs[0].data.panels as { name: string; codePending?: boolean }[];
    expect(panels.map((p) => p.name)).toEqual(['sheet']);
    // Data always loads; the code waits for a human, exactly as the
    // table's own and the system's panels do.
    expect(panels[0].codePending).toBe(true);
    expect(packPanelDir(dir, 'pan_pak01')).toBe(join(dirPath, 'panels', 'sheet'));
    expect(packPanelDir(dir, 'pan_nope')).toBeUndefined();
  });

  it('trusted: the pan_ id is its own trust row, not the pack’s', () => {
    const dirPath = writePack('guidebook', GUIDEBOOK);
    mkdirSync(join(dirPath, 'panels', 'sheet', 'blocks'), { recursive: true });
    writeFileSync(
      join(dirPath, 'panels', 'sheet', 'panel.json'),
      JSON.stringify({ id: 'pan_pak01', name: 'sheet', label: 'Sheet', blocks: [] }),
    );
    writeFileSync(
      join(dirPath, 'panels', 'sheet', 'blocks', 'Row.tsx'),
      'export default function Row() { return null; }\n',
    );
    shelf.setPluginEnabled('pan_pak01', true);

    const { packs } = sweepPacks(dir, shelf);
    const panels = packs[0].data.panels as {
      codePending?: boolean;
      code?: { blocks?: Record<string, string> };
    }[];
    expect(panels[0].codePending).toBeUndefined();
    // Stamped with the artifact's mtime (`stamp` in `panels-shelf.ts`)
    // so a recompile changes the url — a pack's panel takes the same
    // route a table's does, because it is the same compile.
    expect(panels[0].code?.blocks?.Row).toMatch(
      /^\/panel-code\/pan_pak01\/blocks\/Row\.js\?v=[0-9a-z]+$/,
    );
  });
});

describe('the `system` specifier — one index module over the whole stack', () => {
  function writePresentation(pack: string, name: string, source: string) {
    const packDir = join(dir, 'packs', pack, 'presentations');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, `${name}.tsx`), source);
  }

  function campaignOn(system: string, packs: string[]): Campaign {
    const campaign = createCampaign(dir, 'table', 'The Table');
    const root = campaign.root();
    campaign.save(
      {
        ...root,
        refs: {
          system: { id: system, name: system },
          packs: packs.map((id) => ({ id, name: id })),
        },
      },
      'test',
    );
    return campaign;
  }

  it('no code anywhere is a VALID EMPTY MODULE, never a 404', () => {
    expect(systemIndexModule({})).toBe('export {};\n');
  });

  it('re-exports each presentation by its file name', () => {
    expect(systemIndexModule({ TestFace: '/pack-code/pak_a/presentations/TestFace.js' })).toBe(
      "export { default as TestFace } from '/pack-code/pak_a/presentations/TestFace.js';\n",
    );
  });

  it('later pack in precedence order wins a name collision', () => {
    writePack('base', {
      'pack.json': { id: 'pak_base', system: 'sys_test', name: 'Base', version: 1 },
      'system.json': { id: 'sys_test', name: 'Test System', version: 1 },
    });
    writePack('extra', {
      'pack.json': { id: 'pak_extra', system: 'sys_test', name: 'Extra', version: 1 },
    });
    writePresentation('base', 'TestFace', 'export default function TestFace() { return null; }\n');
    writePresentation('extra', 'TestFace', 'export default function TestFace() { return null; }\n');
    shelf.setPluginEnabled('pak_base', true);
    shelf.setPluginEnabled('pak_extra', true);

    // Declared order IS precedence order; the later one wins.
    const campaign = campaignOn('sys_test', ['pak_base', 'pak_extra']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(Object.keys(loaded.presentations())).toEqual(['TestFace']);
    expect(loaded.presentations().TestFace).toMatch(
      /^\/pack-code\/pak_extra\/presentations\/TestFace\.js\?v=[a-z0-9]+$/,
    );
    expect(systemIndexModule(loaded.presentations())).toContain('pak_extra');
    campaign.close();
  });

  it('a pack presentation may import `system/<name>` — that one is not a cycle', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation(
      'guidebook',
      'Builder',
      "import { rung } from 'system/creation';\nexport default function Builder() { return rung; }\n",
    );
    shelf.setPluginEnabled('pak_folder01', true);

    const swept = sweepPacks(dir, shelf);
    expect(swept.problems).toEqual([]);
    // …and the sweep wrote down what it asked for, so boot can check it
    // without re-reading anyone's source.
    expect(swept.packs[0].code?.needs).toEqual(['creation']);
  });

  it('bare `system` stays closed to a pack — importing the merge it rides is the cycle', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation('guidebook', 'Cyclic', "export { Dial } from 'system';\n");
    shelf.setPluginEnabled('pak_folder01', true);

    const swept = sweepPacks(dir, shelf);
    expect(swept.problems).toHaveLength(1);
    expect(swept.problems[0].problem).toContain('presentations/Cyclic.tsx');
    expect(swept.problems[0].problem).toContain('system');
    // The pack's DATA loaded regardless, as ever.
    expect(swept.packs[0].id).toBe('pak_folder01');
  });

  it('an untrusted pack contributes nothing to the index', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation(
      'guidebook',
      'TestFace',
      'export default function TestFace() { return null; }\n',
    );
    const campaign = campaignOn('sys_test', ['pak_folder01']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.packs[0].codePending).toBe(true);
    expect(systemIndexModule(loaded.presentations())).toBe('export {};\n');
    campaign.close();
  });
});

describe('the `system/<name>` shim — exact re-exports, or a labeled throw (§M-4a)', () => {
  const url = '/pack-code/sys_a/exports/creation.js?v=abc';

  it('re-exports the named exports it actually has', () => {
    expect(systemExportModule('creation', { url, names: ['compose', 'rung'] })).toBe(
      `export { compose, rung } from '${url}';\n`,
    );
  });

  it('a default export is re-exported EXPLICITLY — `export *` would drop it', () => {
    const body = systemExportModule('creation', { url, names: ['default', 'compose'] });
    expect(body).toContain(`export { compose } from '${url}';`);
    expect(body).toContain(`export { default } from '${url}';`);
  });

  it('default ALONE never emits an empty named clause', () => {
    expect(systemExportModule('creation', { url, names: ['default'] })).toBe(
      `export { default } from '${url}';\n`,
    );
  });

  it('a file that exports nothing refuses rather than pretending', () => {
    const body = systemExportModule('creation', { url, names: [] });
    expect(body).toMatch(/^throw new Error\(/);
    expect(body).toContain('exports nothing');
  });

  it('a refusal is a module that THROWS, labeled — a 404 would name nothing', () => {
    expect(refusalModule('Test System doesn\'t export `creation`')).toBe(
      'throw new Error("teller: Test System doesn\'t export `creation`");\n',
    );
  });
});

// ---------------------------------------------------------------------
// Rule 4a's other half: a pack is an ARCHIVE, and equally a FOLDER.

describe('packs on the shelf as ARCHIVES', () => {
  /** Write a `.pack` beside the folders, the way someone dropping one in would. */
  function dropArchive(name: string, files: Record<string, unknown>): string {
    mkdirSync(join(dir, 'packs'), { recursive: true });
    const path = join(dir, 'packs', `${name}.pack`);
    writeFileSync(
      path,
      writeArchive(
        Object.entries(files).map(([file, value]) => ({
          name: file,
          data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
        })),
      ),
    );
    return path;
  }

  it('an archive unpacks to a folder, and the sweep reads the folder', () => {
    dropArchive('guidebook', GUIDEBOOK);
    const swept = sweepPacks(dir, shelf);
    expect(swept.problems).toEqual([]);
    expect(swept.packs.map((p) => p.id)).toEqual(['pak_folder01']);
    expect(swept.systems.map((s) => s.id)).toEqual(['sys_test']);
    // The FOLDER is the installed form — that's what you edit next.
    expect(existsSync(join(dir, 'packs', 'guidebook', 'pack.json'))).toBe(true);
    expect(existsSync(join(dir, 'packs', 'guidebook', 'bestiary.json'))).toBe(true);
  });

  it('the archive file is KEPT — installing is not a licence to delete', () => {
    const path = dropArchive('guidebook', GUIDEBOOK);
    sweepPacks(dir, shelf);
    expect(existsSync(path)).toBe(true);
  });

  it('a second sweep re-installs nothing — the mtime gate holds', () => {
    dropArchive('guidebook', GUIDEBOOK);
    sweepPacks(dir, shelf);
    const manifest = join(dir, 'packs', 'guidebook', 'pack.json');
    const before = statSync(manifest).mtimeMs;
    sweepPacks(dir, shelf);
    expect(statSync(manifest).mtimeMs).toBe(before);
  });

  it('never clobbers a newer folder — an arriving file is a proposal', () => {
    writePack('guidebook', {
      ...GUIDEBOOK,
      'pack.json': { ...GUIDEBOOK['pack.json'], version: 9, name: 'Edited Here' },
    });
    // An OLDER archive, and newer on disk than the folder it names.
    const path = dropArchive('guidebook', GUIDEBOOK);
    utimesSync(path, new Date(), new Date(Date.now() + 60_000));

    const swept = sweepPacks(dir, shelf);
    expect(swept.packs[0].name).toBe('Edited Here');
    expect(swept.packs[0].version).toBe(9);
  });

  it('a higher version upgrades the folder', () => {
    writePack('guidebook', GUIDEBOOK);
    const path = dropArchive('guidebook', {
      ...GUIDEBOOK,
      'pack.json': { ...GUIDEBOOK['pack.json'], version: 11, name: 'Newer Edition' },
    });
    utimesSync(path, new Date(), new Date(Date.now() + 60_000));

    const swept = sweepPacks(dir, shelf);
    expect(swept.packs[0].version).toBe(11);
    expect(swept.packs[0].name).toBe('Newer Edition');
  });

  it('a file that is not a zip is a problem in the report, never a crash', () => {
    mkdirSync(join(dir, 'packs'), { recursive: true });
    writeFileSync(join(dir, 'packs', 'broken.pack'), 'this is not a zip');
    const swept = sweepPacks(dir, shelf);
    expect(swept.packs).toEqual([]);
    expect(swept.problems[0].problem).toMatch(/did not open/);
  });

  it('an archive with no pack.json is reported and installs nothing', () => {
    dropArchive('nameless', { 'bestiary.json': [] });
    const swept = sweepPacks(dir, shelf);
    expect(swept.problems[0].problem).toMatch(/no pack.json with an id/);
    expect(existsSync(join(dir, 'packs', 'nameless'))).toBe(false);
  });
});

describe('packArchive — the way back out', () => {
  it('leaves .build behind and carries art', () => {
    const packFolder = writePack('guidebook', GUIDEBOOK);
    mkdirSync(join(packFolder, 'art'), { recursive: true });
    writeFileSync(join(packFolder, 'art', 'logo.png'), 'pixels');
    mkdirSync(join(packFolder, '.build', 'presentations'), { recursive: true });
    writeFileSync(join(packFolder, '.build', 'presentations', 'X.js'), 'compiled');

    const files = openArchive(packArchive(packFolder, 'pak_folder01'));
    expect([...files.keys()].sort()).toEqual([
      'art/logo.png',
      'bestiary.json',
      'pack.json',
      'system.json',
    ]);
  });

  it('reverses the art rewrite — an installed key goes back to relative', () => {
    const packFolder = writePack('guidebook', {
      ...GUIDEBOOK,
      'bestiary.json': [{ id: 'foe_1', name: 'Coyote', art: 'art/pak_folder01/coyote.png' }],
    });
    const files = openArchive(packArchive(packFolder, 'pak_folder01'));
    expect(archiveJson(files, 'bestiary.json')).toEqual([
      { id: 'foe_1', name: 'Coyote', art: 'art/coyote.png' },
    ]);
  });

  it('a slot with nothing to reverse travels byte-for-byte', () => {
    const packFolder = writePack('guidebook', GUIDEBOOK);
    // Deliberately odd formatting: it must survive untouched.
    writeFileSync(join(packFolder, 'notes.json'), '{"a":1,   "b":2}');
    const files = openArchive(packArchive(packFolder, 'pak_folder01'));
    expect(files.get('notes.json')?.toString('utf8')).toBe('{"a":1,   "b":2}');
  });

  it('rights ride along untouched — the pack\'s own claim about itself', () => {
    const packFolder = writePack('guidebook', GUIDEBOOK);
    const files = openArchive(packArchive(packFolder, 'pak_folder01'));
    expect((archiveJson(files, 'pack.json') as { rights: unknown }).rights).toEqual({
      status: 'personal',
    });
  });
});

describe('the round trip — export here, install there', () => {
  it('a pack exported from one shelf lands identically on another', () => {
    const packFolder = writePack('guidebook', {
      ...GUIDEBOOK,
      'bestiary.json': [
        { id: 'foe_1', name: 'Coyote', art: 'art/coyote.png' },
        { id: 'foe_2', name: 'Rattler', lists: {} },
      ],
    });
    mkdirSync(join(packFolder, 'art'), { recursive: true });
    writeFileSync(join(packFolder, 'art', 'coyote.png'), 'pixels');
    const here = sweepPacks(dir, shelf);

    const bytes = packArchive(packFolder, 'pak_folder01');

    // A SECOND shelf, which has never seen this pack.
    const other = mkdtempSync(join(tmpdir(), 'teller-packs-there-'));
    const otherShelf = openShelf(other);
    try {
      mkdirSync(join(other, 'packs'), { recursive: true });
      writeFileSync(join(other, 'packs', 'guidebook.pack'), bytes);
      const there = sweepPacks(other, otherShelf);

      expect(there.problems).toEqual([]);
      expect(there.packs).toEqual(here.packs);
      expect(there.systems).toEqual(here.systems);
      expect((there.packs[0].data.bestiary as { art?: string }[])[0].art).toBe(
        'art/pak_folder01/coyote.png',
      );
      // …and the rewritten key resolves to bytes on the new host.
      expect(
        readFileSync(join(other, 'art', 'pak_folder01', 'coyote.png'), 'utf8'),
      ).toBe('pixels');
      expect(there.packs[0].version).toBe(3);
    } finally {
      otherShelf.close();
      rmSync(other, { recursive: true, force: true });
    }
  });
});
