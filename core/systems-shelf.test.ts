import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCampaign } from './boot.ts';
import {
  defaultSystems,
  defaultSystemsRoot,
  sweepSystems,
  systemDir,
  systemPanelDir,
} from './systems-shelf.ts';
import { createCampaign, openShelf, type Campaign, type Shelf } from './store.ts';

let dir: string;
let shelf: Shelf;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-systems-'));
  shelf = openShelf(dir);
});

afterEach(() => {
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A system folder on the shelf: `system.json` plus whatever else the test wants. */
function writeSystem(name: string, files: Record<string, unknown>): string {
  const sysDir = join(dir, 'systems', name);
  mkdirSync(sysDir, { recursive: true });
  for (const [file, value] of Object.entries(files)) {
    writeFileSync(join(sysDir, file), JSON.stringify(value, null, 2));
  }
  return sysDir;
}

function writeFile(path: string, body: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  return path;
}

const WIW = {
  'system.json': {
    id: 'sys_test',
    name: 'Test System',
    version: 7,
    dials: { Grit: 'dial' },
    statuses: [{ name: 'Dazed' }],
  },
};

const PRESENTATION = `export default function TestFace() { return null; }\n`;

describe('sweepSystems — the fourth shelf dir (§M)', () => {
  it('no systems folder yet is just an empty shelf', () => {
    expect(sweepSystems(dir)).toEqual({ systems: [], problems: [] });
  });

  it('reads system.json as identity plus record slots', () => {
    writeSystem('wiw', WIW);
    const { systems, problems } = sweepSystems(dir);
    expect(problems).toEqual([]);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ id: 'sys_test', name: 'Test System', version: 7 });
    expect(systems[0].data.dials).toEqual({ Grit: 'dial' });
    // The reserved three are identity, never slots — the packs rule, reused.
    expect(systems[0].data.id).toBeUndefined();
    expect(systems[0].data.name).toBeUndefined();
    expect(systems[0].data.version).toBeUndefined();
  });

  it('every other *.json beside it is a slot named by its file', () => {
    writeSystem('wiw', {
      ...WIW,
      'trades.json': [{ name: 'Digger', skills: { Nerve: '3B' } }],
      'creation.json': { tiers: [{ name: 'First' }] },
    });
    const { systems, problems } = sweepSystems(dir);
    expect(problems).toEqual([]);
    expect(systems[0].data.trades).toEqual([{ name: 'Digger', skills: { Nerve: '3B' } }]);
    expect(systems[0].data.creation).toEqual({ tiers: [{ name: 'First' }] });
    // …with the art rewrite a pack's slots get, keyed by the system's id.
  });

  it('a sibling slot rewrites its art to the installed key, like a pack slot', () => {
    writeSystem('wiw', { ...WIW, 'trades.json': [{ name: 'Digger', art: 'art/digger.png' }] });
    const { systems } = sweepSystems(dir);
    expect(systems[0].data.trades).toEqual([
      { name: 'Digger', art: 'art/sys_test/digger.png' },
    ]);
  });

  it('system.json wins a slot collision — the hand-edited file is the authority', () => {
    writeSystem('wiw', {
      'system.json': { ...WIW['system.json'], trades: [{ name: 'Inline' }] },
      'trades.json': [{ name: 'Sibling' }],
    });
    const { systems } = sweepSystems(dir);
    expect(systems[0].data.trades).toEqual([{ name: 'Inline' }]);
  });

  it('a sibling slot that does not parse is a problem, and the system still loads', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(join(sysDir, 'trades.json'), '{ nope');
    const { systems, problems } = sweepSystems(dir);
    expect(systems).toHaveLength(1);
    expect(systems[0].data.trades).toBeUndefined();
    expect(problems[0].problem).toMatch(/^trades\.json did not parse: /);
  });

  it('a folder with no system.json is not a system — skipped in silence', () => {
    mkdirSync(join(dir, 'systems', 'not-a-system'), { recursive: true });
    expect(sweepSystems(dir)).toEqual({ systems: [], problems: [] });
  });

  it('a malformed system.json is a problem, never a crash', () => {
    const sysDir = join(dir, 'systems', 'broken');
    mkdirSync(sysDir, { recursive: true });
    writeFileSync(join(sysDir, 'system.json'), '{ not json');
    writeSystem('wiw', WIW);

    const { systems, problems } = sweepSystems(dir);
    expect(systems.map((s) => s.id)).toEqual(['sys_test']);
    expect(problems).toHaveLength(1);
    expect(problems[0].dir).toBe(sysDir);
    expect(problems[0].problem).toMatch(/system\.json did not parse/);
  });

  it('a system.json with no id is reported — identity is the id', () => {
    writeSystem('nameless', { 'system.json': { name: 'No Id', version: 1 } });
    const { systems, problems } = sweepSystems(dir);
    expect(systems).toEqual([]);
    expect(problems[0].problem).toMatch(/no id/);
  });

  it('art installs under the system id and references rewrite to it', () => {
    const sysDir = writeSystem('wiw', {
      'system.json': { ...WIW['system.json'], icons: { die: 'art/die.png' } },
    });
    writeFile(join(sysDir, 'art', 'die.png'), 'PNGBYTES');

    const { systems } = sweepSystems(dir);
    const served = join(dir, 'art', 'sys_test', 'die.png');
    expect(existsSync(served)).toBe(true);
    expect(readFileSync(served, 'utf8')).toBe('PNGBYTES');
    expect(systems[0].data.icons).toEqual({ die: 'art/sys_test/die.png' });
  });

  it('systemDir finds the folder by id, for /pack-code/ to resolve', () => {
    const sysDir = writeSystem('wiw', WIW);
    expect(systemDir(dir, 'sys_test')).toBe(sysDir);
    expect(systemDir(dir, 'sys_nope')).toBeUndefined();
  });
});

describe('sweepSystems — a system carries code, on the pack terms', () => {
  it('compiles presentations and attaches them once the sys_ id is trusted', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(join(sysDir, 'presentations', 'TestFace.tsx'), PRESENTATION);
    shelf.setPluginEnabled('sys_test', true);

    const { systems, problems } = sweepSystems(dir, shelf);
    expect(problems).toEqual([]);
    expect(systems[0].codePending).toBeUndefined();
    expect(systems[0].code?.presentations.TestFace).toMatch(
      /^\/pack-code\/sys_test\/presentations\/TestFace\.js\?v=[a-z0-9]+$/,
    );
    expect(
      readFileSync(join(sysDir, '.build', 'presentations', 'TestFace.js'), 'utf8'),
    ).toContain('TestFace');
  });

  it('untrusted: the declarations load, the code waits', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(join(sysDir, 'presentations', 'TestFace.tsx'), PRESENTATION);

    const { systems } = sweepSystems(dir, shelf);
    expect(systems[0].code).toBeUndefined();
    expect(systems[0].codePending).toBe(true);
    expect(systems[0].data.dials).toEqual({ Grit: 'dial' });
  });

  it('a presentation importing `system` fails its compile, readably', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(
      join(sysDir, 'presentations', 'Cyclic.tsx'),
      `import { Other } from 'system';\nexport default function Cyclic() { return Other; }\n`,
    );
    shelf.setPluginEnabled('sys_test', true);

    const { systems, problems } = sweepSystems(dir, shelf);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain('presentations/Cyclic.tsx');
    expect(problems[0].problem).toContain('system');
    expect(systems[0].data.dials).toEqual({ Grit: 'dial' });
  });
});

describe('sweepSystems — the export surface (§M-4a)', () => {
  const ENGINE = `export const rung = 4;\nexport default function make() { return rung; }\n`;

  it('compiles exports/*.ts, names them by their file, and stamps the url', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(join(sysDir, 'exports', 'creation.ts'), ENGINE);
    shelf.setPluginEnabled('sys_test', true);

    const { systems, problems } = sweepSystems(dir, shelf);
    expect(problems).toEqual([]);
    const creation = systems[0].code?.exports?.creation;
    expect(creation?.url).toMatch(
      /^\/pack-code\/sys_test\/exports\/creation\.js\?v=[a-z0-9]+$/,
    );
    // What it exports is read off the build, not guessed — the shim
    // re-exports exactly these names.
    expect(creation?.names.sort()).toEqual(['default', 'rung']);
    expect(existsSync(join(sysDir, '.build', 'exports', 'creation.js'))).toBe(true);
  });

  it('a .tsx export compiles too — an export is function, not necessarily a component', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(join(sysDir, 'exports', 'dialog.tsx'), `export const Face = () => null;\n`);
    shelf.setPluginEnabled('sys_test', true);
    expect(sweepSystems(dir, shelf).systems[0].code?.exports?.dialog?.names).toEqual(['Face']);
  });

  it('untrusted: the exports compile and the urls wait, exactly as presentations do', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(join(sysDir, 'exports', 'creation.ts'), ENGINE);

    const { systems } = sweepSystems(dir, shelf);
    expect(systems[0].code).toBeUndefined();
    expect(systems[0].codePending).toBe(true);
  });

  it('an export may not import the merged index it sits under — that is the cycle', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(join(sysDir, 'exports', 'cyclic.ts'), `export { Dial } from 'system';\n`);
    shelf.setPluginEnabled('sys_test', true);

    const { systems, problems } = sweepSystems(dir, shelf);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain('exports/cyclic.ts');
    expect(problems[0].problem).toContain('system');
    // …and the DATA loaded regardless, as ever.
    expect(systems[0].data.dials).toEqual({ Grit: 'dial' });
  });
});

describe('sweepSystems — a system may ship panels', () => {
  it('panel declarations ride the system layer, and their code takes the same trust', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(
      join(sysDir, 'panels', 'encounters', 'panel.json'),
      JSON.stringify({ id: 'pan_sys01', name: 'encounters', label: 'Encounters', blocks: [] }),
    );
    writeFile(
      join(sysDir, 'panels', 'encounters', 'blocks', 'Row.tsx'),
      PRESENTATION.replace('TestFace', 'Row'),
    );

    const { systems, problems } = sweepSystems(dir, shelf);
    expect(problems).toEqual([]);
    const panels = systems[0].data.panels as { name: string; codePending?: boolean }[];
    expect(panels.map((p) => p.name)).toEqual(['encounters']);
    // Data always loads; the code waits for a human, exactly as the
    // table's own panels do.
    expect(panels[0].codePending).toBe(true);
    expect(systemPanelDir(dir, 'pan_sys01')).toBe(join(sysDir, 'panels', 'encounters'));
    expect(systemPanelDir(dir, 'pan_nope')).toBeUndefined();
  });
});

describe('loadCampaign — systems-dir beats pack-embedded beats row (§M)', () => {
  function campaignOn(system: string, packs: string[] = []): Campaign {
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

  /** A pack folder, optionally still carrying its own `system.json` (phase 1's shape). */
  function writePack(name: string, files: Record<string, unknown>): string {
    const packDir = join(dir, 'packs', name);
    mkdirSync(packDir, { recursive: true });
    for (const [file, value] of Object.entries(files)) {
      writeFileSync(join(packDir, file), JSON.stringify(value, null, 2));
    }
    return packDir;
  }

  const MERGED_PACK = {
    'pack.json': { id: 'pak_old', system: 'sys_test', name: 'Old Export', version: 2 },
    'system.json': { id: 'sys_test', name: 'Embedded System', version: 3, dials: { Grit: 'bar' } },
    'bestiary.json': [{ id: 'foe_1', name: 'Coyote', lists: {} }],
  };

  it('a pack carrying system.json still loads with no systems/ folder at all — old exports keep working', () => {
    writePack('wiw-guidebook', MERGED_PACK);
    const campaign = campaignOn('sys_test', ['pak_old']);
    const loaded = loadCampaign(shelf, campaign, dir);

    expect(loaded.missing).toEqual([]);
    expect(loaded.system).toMatchObject({ id: 'sys_test', name: 'Embedded System', version: 3 });
    expect(loaded.record('dials')).toEqual({ Grit: 'bar' });
    expect(loaded.templates('bestiary').map((t) => t.name)).toEqual(['Coyote']);
    campaign.close();
  });

  it('the systems folder wins over the same id embedded in a pack', () => {
    writePack('wiw-guidebook', MERGED_PACK);
    writeSystem('wiw', WIW);
    const campaign = campaignOn('sys_test', ['pak_old']);
    const loaded = loadCampaign(shelf, campaign, dir);

    expect(loaded.system).toMatchObject({ name: 'Test System', version: 7 });
    expect(loaded.record('dials')).toEqual({ Grit: 'dial' });
    // …and the pack's own content is untouched by the split.
    expect(loaded.templates('bestiary').map((t) => t.name)).toEqual(['Coyote']);
    campaign.close();
  });

  it('the systems folder wins over a shelf.db row', () => {
    shelf.putSystem({ id: 'sys_test', name: 'Row System', version: 1, data: { dials: { Grit: 'row' } } });
    writeSystem('wiw', WIW);
    const campaign = campaignOn('sys_test');
    const loaded = loadCampaign(shelf, campaign, dir);

    expect(loaded.system?.name).toBe('Test System');
    expect(loaded.record('dials')).toEqual({ Grit: 'dial' });
    campaign.close();
  });

  it('the system layer still sits BELOW the packs — a pack slot overrides a system slot', () => {
    writeSystem('wiw', WIW);
    writePack('book', {
      'pack.json': { id: 'pak_book', system: 'sys_test', name: 'Book', version: 1 },
      'dials.json': { Grit: 'cylinder' },
    });
    const campaign = campaignOn('sys_test', ['pak_book']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.record('dials')).toEqual({ Grit: 'cylinder' });
    campaign.close();
  });

  it('presentations merge system-first, later wins — the pack skins the system dial', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(join(sysDir, 'presentations', 'Dial.tsx'), PRESENTATION);
    writeFile(join(sysDir, 'presentations', 'HealthPanel.tsx'), PRESENTATION);
    const packDir = writePack('book', {
      'pack.json': { id: 'pak_book', system: 'sys_test', name: 'Book', version: 1 },
    });
    writeFile(join(packDir, 'presentations', 'Dial.tsx'), PRESENTATION);
    shelf.setPluginEnabled('sys_test', true);
    shelf.setPluginEnabled('pak_book', true);

    const campaign = campaignOn('sys_test', ['pak_book']);
    const loaded = loadCampaign(shelf, campaign, dir);
    const presentations = loaded.presentations();
    expect(presentations.HealthPanel).toMatch(
      /^\/pack-code\/sys_test\/presentations\/HealthPanel\.js\?v=[a-z0-9]+$/,
    );
    expect(presentations.Dial).toMatch(
      /^\/pack-code\/pak_book\/presentations\/Dial\.js\?v=[a-z0-9]+$/,
    );
    campaign.close();
  });

  it('a pack may import `system/<name>`, and the requirement is checked at LOAD', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(join(sysDir, 'exports', 'creation.ts'), `export const rung = 4;\n`);
    const packDir = writePack('book', {
      'pack.json': { id: 'pak_book', system: 'sys_test', name: 'The Book', version: 1 },
    });
    writeFile(
      join(packDir, 'presentations', 'Builder.tsx'),
      `import { rung } from 'system/creation';\nexport default function Builder() { return rung; }\n`,
    );
    shelf.setPluginEnabled('sys_test', true);
    shelf.setPluginEnabled('pak_book', true);

    const campaign = campaignOn('sys_test', ['pak_book']);
    const loaded = loadCampaign(shelf, campaign, dir);
    // It COMPILED — `system/*` is external for every tier, packs included.
    expect(loaded.packProblems).toEqual([]);
    expect(loaded.presentations().Builder).toMatch(/^\/pack-code\/pak_book\/presentations\//);
    campaign.close();
  });

  it('a name the system does not export refuses out loud, naming all three parties', () => {
    writeSystem('wiw', WIW);
    const packDir = writePack('book', {
      'pack.json': { id: 'pak_book', system: 'sys_test', name: 'The Book', version: 1 },
    });
    writeFile(
      join(packDir, 'presentations', 'Builder.tsx'),
      `import { rung } from 'system/creation';\nexport default function Builder() { return rung; }\n`,
    );
    shelf.setPluginEnabled('pak_book', true);

    const campaign = campaignOn('sys_test', ['pak_book']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.packProblems.map((p) => p.problem)).toEqual([
      'The Book needs `creation` from Test System, which this version doesn\'t export',
    ]);
    campaign.close();
  });

  it('a PANEL of the merged collection asks the same question', () => {
    const sysDir = writeSystem('wiw', WIW);
    writeFile(
      join(sysDir, 'panels', 'builder', 'panel.json'),
      JSON.stringify({ id: 'pan_build0001', name: 'builder', surface: false }),
    );
    writeFile(
      join(sysDir, 'panels', 'builder', 'blocks', 'Step.tsx'),
      `import { rung } from 'system/creation';\nexport default function Step() { return rung; }\n`,
    );
    shelf.setPluginEnabled('sys_test', true);
    shelf.setPluginEnabled('pan_build0001', true);

    const campaign = campaignOn('sys_test');
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.panelProblems.map((p) => p.problem)).toEqual([
      "panel 'builder' needs `creation` from Test System, which this version doesn't export",
    ]);

    // Ship the export and the refusal goes away — the requirement is on
    // the SURFACE, not on any version number.
    writeFile(join(sysDir, 'exports', 'creation.ts'), `export const rung = 4;\n`);
    expect(loadCampaign(shelf, campaign, dir).panelProblems).toEqual([]);
    campaign.close();
  });

  it('a broken system folder is a load-report problem, not a crash', () => {
    const brokenDir = join(dir, 'systems', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'system.json'), '{ not json');
    writeSystem('wiw', WIW);

    const campaign = campaignOn('sys_test');
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.system?.name).toBe('Test System');
    expect(loaded.packProblems.map((p) => p.dir)).toContain(brokenDir);
    campaign.close();
  });
});

// The systems teller SHIPS — `defaults/systems/`, read from the install
// (§M-6, 2026-08-21). The virgin-host case: nothing installs them, so
// nothing can go stale or resurrect, and the shelf always outranks them.
describe('the install floor — a virgin host still has a system to offer', () => {
  function campaignOn(system: string): Campaign {
    const campaign = createCampaign(dir, 'table', 'The Table');
    const root = campaign.root();
    campaign.save(
      { ...root, refs: { system: { id: system, name: system } } },
      'test',
    );
    return campaign;
  }

  it('ships the starter, and reads it where it lies', () => {
    const shipped = defaultSystems();
    const starter = shipped.find((s) => s.id === 'sys_starter');
    expect(starter).toBeDefined();
    expect(defaultSystemsRoot().endsWith(join('defaults', 'systems'))).toBe(true);
    // Data only: teller's install may be read-only, so the floor never
    // compiles and never copies art (`sweepSystemsIn`).
    expect(starter?.code).toBeUndefined();
    expect(starter?.codePending).toBeUndefined();
    // It declares the play screens, which is the whole point of it.
    expect((starter?.data.panels as { name: string }[]).map((p) => p.name).sort()).toContain(
      'encounters',
    );
  });

  it('resolves for a campaign on a shelf that has no systems folder at all', () => {
    const campaign = campaignOn('sys_starter');
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.missing).toEqual([]);
    expect(loaded.system).toMatchObject({ id: 'sys_starter', name: 'Starter' });
    expect(existsSync(join(dir, 'systems'))).toBe(false);
    campaign.close();
  });

  it('a shelf folder restating a shipped id wins outright', () => {
    writeSystem('starter', {
      'system.json': { id: 'sys_starter', name: 'My Starter', version: 9 },
    });
    const campaign = campaignOn('sys_starter');
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.system).toMatchObject({ name: 'My Starter', version: 9 });
    // …and the shipped copy contributes nothing behind it: the floor is
    // a FALLBACK per id, not a layer that merges underneath.
    expect(loaded.declarations('panels')).toEqual(
      loadCampaign(shelf, campaign, dir).declarations('panels'),
    );
    expect((loaded.declarations('kinds') as { name: string }[]).length).toBe(0);
    campaign.close();
  });
});
