import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCampaign } from './boot.ts';
import { resolve, stamp } from './stamp.ts';
import {
  createCampaign,
  openShelf,
  type Campaign,
  type Shelf,
} from './store.ts';

let dir: string;
let shelf: Shelf;
let campaign: Campaign;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-boot-'));
  shelf = openShelf(dir);
  shelf.putSystem({
    id: 'sys_wiw',
    name: 'Wild Imaginary West',
    version: 3,
    data: {
      statuses: [
        { name: 'Trapped', cap: 5 },
        { name: 'Afraid', cap: 5 },
      ],
    },
  });
  shelf.putPack({
    id: 'pak_guide',
    system: 'sys_wiw',
    name: 'Guidebook',
    data: {
      statuses: [{ name: 'trapped', cap: 5, note: 'the book prose' }],
      bestiary: [
        {
          id: 'npc_wiw_bark_watcher',
          name: 'Bark Watcher',
          type: 'foe',
          lists: { resources: [{ name: 'Health', value: 12, max: 12 }] },
        },
      ],
    },
  });
  campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  const root = campaign.root();
  campaign.save(
    {
      ...root,
      refs: {
        system: { id: 'sys_wiw', name: 'Wild Imaginary West' },
        packs: [{ id: 'pak_guide', name: 'Guidebook' }],
      },
    },
    'host',
  );
});

afterEach(() => {
  campaign.close();
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('loadCampaign — the resolution law at boot', () => {
  it('resolves the manifest against the shelf, once', () => {
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.system).toEqual({
      id: 'sys_wiw',
      name: 'Wild Imaginary West',
      version: 3,
    });
    expect(loaded.packs.map((p) => p.id)).toEqual(['pak_guide']);
    expect(loaded.missing).toEqual([]);
  });

  it('reports a missing pack — never silently dropped', () => {
    const root = campaign.root();
    campaign.save(
      {
        ...root,
        refs: {
          ...root.refs,
          packs: [
            { id: 'pak_guide', name: 'Guidebook' },
            { id: 'pak_gone', name: 'The Lost Supplement' },
          ],
        },
      },
      'host',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.packs.map((p) => p.id)).toEqual(['pak_guide']);
    expect(loaded.missing).toEqual([
      { slot: 'pack', ref: { id: 'pak_gone', name: 'The Lost Supplement' } },
    ]);
  });

  it('a missing system degrades, not errors — the table plays on', () => {
    const root = campaign.root();
    campaign.save(
      { ...root, refs: { system: { id: 'sys_gone', name: 'Vanished' } } },
      'host',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.system).toBeUndefined();
    expect(loaded.missing[0]).toEqual({
      slot: 'system',
      ref: { id: 'sys_gone', name: 'Vanished' },
    });
    expect(loaded.declarations('statuses')).toEqual([]);
  });

  it('no declared pack list means every pack for the system, in arrival order', () => {
    shelf.putPack({
      id: 'pak_home',
      system: 'sys_wiw',
      name: 'House Rules',
      data: {},
    });
    const root = campaign.root();
    campaign.save(
      { ...root, refs: { system: { id: 'sys_wiw', name: 'WiW' } } },
      'host',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.packs.map((p) => p.id)).toEqual(['pak_guide', 'pak_home']);
  });
});

describe('the merged readings', () => {
  it('declarations merge by name — the pack restates the system, the campaign restates them both', () => {
    campaign.putTemplate(
      'statuses',
      { name: 'Trapped', cap: 7, note: 'house rule' },
      'dm',
    );
    campaign.putTemplate('statuses', { name: 'Spooked', cap: 3 }, 'dm');
    const loaded = loadCampaign(shelf, campaign);
    const statuses = loaded.declarations('statuses') as {
      name: string;
      cap: number;
    }[];
    expect(statuses.map((s) => [s.name, s.cap])).toEqual([
      ['Trapped', 7],
      ['Afraid', 5],
      ['Spooked', 3],
    ]);
    expect(loaded.sourceOf('statuses', 'trapped')).toBe('campaign');
    expect(loaded.sourceOf('statuses', 'Afraid')).toBe('system:sys_wiw');
    expect(loaded.sourceOf('statuses', 'Nothing')).toBeUndefined();
  });

  it('a declaration LAYERS by field — the system carries the mechanic, the pack the words', () => {
    const loaded = loadCampaign(shelf, campaign);
    const trapped = (loaded.declarations('statuses') as Record<string, unknown>[]).find(
      (s) => s.name === 'trapped',
    );
    // The pack restated neither cap nor severity to add its prose, and
    // the system never learned the book's words. Both survive.
    expect(trapped).toEqual({ name: 'trapped', cap: 5, note: 'the book prose' });
  });

  it('panels are the exception — a later layer replaces one whole, code and all', () => {
    shelf.putSystem({
      id: 'sys_wiw',
      name: 'Wild Imaginary West',
      version: 4,
      data: {
        panels: [
          { name: 'sheet', label: 'Sheet', icon: 'sheet', code: { blocks: { vitals: '/x.js' } } },
        ],
      },
    });
    shelf.putPack({
      id: 'pak_guide',
      system: 'sys_wiw',
      name: 'Guidebook',
      data: { panels: [{ name: 'sheet', label: "The Book's Sheet" }] },
    });
    const loaded = loadCampaign(shelf, campaign);
    const sheet = (loaded.declarations('panels') as Record<string, unknown>[]).find(
      (p) => p.name === 'sheet',
    );
    expect(sheet).toEqual({ name: 'sheet', label: "The Book's Sheet" });
  });

  it('a record slot merges per key, and a nested record refines', () => {
    shelf.putSystem({
      id: 'sys_wiw',
      name: 'Wild Imaginary West',
      version: 4,
      data: { creation: { wallet: { roll: '6B' }, tiers: [{ name: 'Tenderfoot' }] } },
    });
    shelf.putPack({
      id: 'pak_guide',
      system: 'sys_wiw',
      name: 'Guidebook',
      data: { creation: { wallet: { page: 8 }, welcome: { title: 'Welcome to the' } } },
    });
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.record('creation')).toEqual({
      wallet: { roll: '6B', page: 8 },
      tiers: [{ name: 'Tenderfoot' }],
      welcome: { title: 'Welcome to the' },
    });
  });

  it('templates merge by id — the campaign overrides a pack monster by restating its id', () => {
    campaign.putTemplate(
      'bestiary',
      {
        id: 'npc_wiw_bark_watcher',
        name: 'Bark Watcher (house)',
        lists: { resources: [{ name: 'Health', value: 20, max: 20 }] },
      },
      'dm',
    );
    const loaded = loadCampaign(shelf, campaign);
    const bestiary = loaded.templates('bestiary');
    expect(bestiary).toHaveLength(1);
    expect(bestiary[0].name).toBe('Bark Watcher (house)');
  });

  it('templateOf feeds resolve end to end — stamp thin at the table, read through the merge', () => {
    const loaded = loadCampaign(shelf, campaign);
    const blueprint = loaded.templateOf('bestiary')('npc_wiw_bark_watcher');
    expect(blueprint).toBeDefined();
    const foe = campaign.create(
      stamp(blueprint!, { name: 'Bark Watcher 1' }),
      'dm',
    );
    const read = resolve(
      campaign.get(foe.id)!,
      loaded.templateOf('bestiary', 'catalog'),
    );
    expect(read.lists.resources).toEqual([
      { name: 'Health', value: 12, max: 12 },
    ]);
  });

  it('the campaign template half logs like everything else', () => {
    const { id } = campaign.putTemplate('statuses', { name: 'Spooked' }, 'dm');
    campaign.putTemplate('statuses', { id, name: 'Spooked', cap: 2 }, 'dm');
    campaign.removeTemplate(id, 'dm');
    expect(
      campaign.events({ entityId: id }).map((e) => e.kind),
    ).toEqual(['template.deleted', 'template.updated', 'template.updated']);
    expect(campaign.templatesIn('statuses')).toEqual([]);
  });
});

describe("teller's own furniture (§E)", () => {
  it('ships the HOST\'s own tools below everything; a system brings the play screens', () => {
    const shelf = openShelf(dir);
    // teller seeds only the host tools now (2026-08-19) — a play screen
    // like 'sheet' arrives on the SYSTEM layer, from its `panels/` dir.
    shelf.putSystem({
      id: 'sys_x',
      name: 'X',
      data: {
        panels: [{ name: 'sheet', label: 'Sheet', subject: 'entity', held: [{ block: 'floor' }] }],
      },
    });
    const campaign = createCampaign(dir, 'furn', 'Furniture');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_x', name: 'X' } } },
      't',
    );
    let loaded = loadCampaign(shelf, campaign);
    const names = loaded.declarations('panels').map((p: any) => p.name);
    expect(names).toContain('sheet');
    expect(names).toContain('screens');
    expect(loaded.sourceOf('panels', 'screens')).toBe('teller');
    expect(loaded.sourceOf('panels', 'sheet')).toBe('system:sys_x');

    // The campaign restates the word and wins — furniture, not law.
    campaign.putTemplate(
      'panels',
      { name: 'sheet', label: 'House Sheet', subject: 'entity', held: [{ block: 'floor' }] },
      't',
    );
    loaded = loadCampaign(shelf, campaign);
    const sheet: any = loaded
      .declarations('panels')
      .find((p: any) => p.name === 'sheet');
    expect(sheet.label).toBe('House Sheet');
    expect(loaded.sourceOf('panels', 'sheet')).toBe('campaign');
    campaign.close();
  });

  it("the table's own panels/ folder is the TOP layer — it beats a default by name", () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_y', name: 'Y', data: {} });
    const campaign = createCampaign(dir, 'furn2', 'Furniture Two');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_y', name: 'Y' } } },
      't',
    );

    // Nothing seeded this — a human wrote it, which is the only way
    // anything gets into `<dataDir>/panels/` now.
    const tablePanel = join(dir, 'panels', 'shelf');
    mkdirSync(tablePanel, { recursive: true });
    writeFileSync(
      join(tablePanel, 'panel.json'),
      JSON.stringify({ id: 'pan_table1', name: 'shelf', label: 'House Shelf', subject: 'none' }),
    );

    const loaded = loadCampaign(shelf, campaign, dir);
    const names = loaded.declarations('panels').map((p: any) => p.name);
    // The other four defaults still come from the install, unshadowed.
    expect(names).toContain('boards');
    expect(loaded.sourceOf('panels', 'boards')).toBe('teller');
    const shelfPanel: any = loaded.declarations('panels').find((p: any) => p.name === 'shelf');
    expect(shelfPanel.label).toBe('House Shelf');
    expect(loaded.sourceOf('panels', 'shelf')).toBe('table');
    campaign.close();
  });

  it("the table beats the SYSTEM too — §M-6's wrinkle, the merge pointing the right way", () => {
    const shelf = openShelf(dir);
    shelf.putSystem({
      id: 'sys_t',
      name: 'T',
      data: { panels: [{ name: 'roster', label: "The System's Roster", subject: 'none' }] },
    });
    const campaign = createCampaign(dir, 'furn5', 'Furniture Five');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_t', name: 'T' } } },
      't',
    );

    const tablePanel = join(dir, 'panels', 'roster');
    mkdirSync(tablePanel, { recursive: true });
    writeFileSync(
      join(tablePanel, 'panel.json'),
      JSON.stringify({ id: 'pan_table2', name: 'roster', label: 'Our Roster', subject: 'none' }),
    );

    const loaded = loadCampaign(shelf, campaign, dir);
    const roster: any = loaded.declarations('panels').find((p: any) => p.name === 'roster');
    expect(roster.label).toBe('Our Roster');
    expect(roster.id).toBe('pan_table2');
    expect(loaded.sourceOf('panels', 'roster')).toBe('table');
    campaign.close();
  });

  it('the defaults load with no data dir at all — they ship with teller', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_n', name: 'N', data: {} });
    const campaign = createCampaign(dir, 'furn6', 'Furniture Six');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_n', name: 'N' } } },
      't',
    );

    const loaded = loadCampaign(shelf, campaign); // no dataDir
    const names = loaded.declarations('panels').map((p: any) => p.name).sort();
    expect(names).toEqual(['boards', 'books', 'handouts', 'log', 'plugins', 'screens', 'shelf']);
    for (const name of names) expect(loaded.sourceOf('panels', name)).toBe('teller');
    campaign.close();
  });

  it('a broken panel.json is reported, never a crash — the rest of the shelf loads', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_z', name: 'Z', data: {} });
    const campaign = createCampaign(dir, 'furn3', 'Furniture Three');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_z', name: 'Z' } } },
      't',
    );

    const brokenDir = join(dir, 'panels', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'panel.json'), '{ not json');

    const loaded = loadCampaign(shelf, campaign, dir);
    const names = loaded.declarations('panels').map((p: any) => p.name);
    expect(names).toContain('screens');
    expect(names).toContain('boards');
    expect(loaded.panelProblems).toHaveLength(1);
    expect(loaded.panelProblems[0].dir).toBe(brokenDir);
    campaign.close();
  });

  it('reports a dangling include, and stops reporting it once a layer supplies the name', () => {
    // §M-5a′: a cycle or a dangling include is a fact about the MERGED
    // collection — which is why the load report is where it belongs, and
    // why a pack shipping the missing fragment silences it without the
    // arrangement that includes it being touched.
    const shelf = openShelf(dir);
    shelf.putSystem({
      id: 'sys_i',
      name: 'I',
      data: {
        panels: [
          { name: 'sheet', subject: 'entity', held: [{ block: 'panel', name: 'vitals-strip' }] },
        ],
      },
    });
    const campaign = createCampaign(dir, 'incl', 'Includes');
    campaign.save({ ...campaign.root(), refs: { system: { id: 'sys_i', name: 'I' } } }, 't');

    let loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.panelProblems.map((p) => p.problem).join(' ')).toContain("includes 'vitals-strip'");

    campaign.putTemplate(
      'panels',
      { name: 'vitals-strip', surface: false, held: [{ block: 'list', list: 'resources' }] },
      't',
    );
    loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.panelProblems).toEqual([]);
    // …and the fragment merged like any other declaration, while never
    // being something a screen could be pointed at.
    const strip: any = loaded
      .declarations('panels')
      .find((p: any) => p.name === 'vitals-strip');
    expect(strip.surface).toBe(false);
    campaign.close();
  });

  it("a pack's panel beats the system's by restating the name (branded over unbranded)", () => {
    const shelf = openShelf(dir);
    const campaign = createCampaign(dir, 'furn4', 'Furniture Four');
    campaign.save(
      {
        ...campaign.root(),
        refs: {
          system: { id: 'sys_p', name: 'P' },
          packs: [{ id: 'pak_p', name: 'Book' }],
        },
      },
      't',
    );

    // The system's folder ships the unbranded sheet…
    const sysPanel = join(dir, 'systems', 'p', 'panels', 'sheet');
    mkdirSync(sysPanel, { recursive: true });
    writeFileSync(
      join(dir, 'systems', 'p', 'system.json'),
      JSON.stringify({ id: 'sys_p', name: 'P', version: 1 }),
    );
    writeFileSync(
      join(sysPanel, 'panel.json'),
      JSON.stringify({ id: 'pan_sys', name: 'sheet', label: 'Sheet', blocks: [] }),
    );

    // …and the book's pack ships its own, under the same name.
    const packPanel = join(dir, 'packs', 'book', 'panels', 'sheet');
    mkdirSync(packPanel, { recursive: true });
    writeFileSync(
      join(dir, 'packs', 'book', 'pack.json'),
      JSON.stringify({ id: 'pak_p', system: 'sys_p', name: 'Book', version: 1 }),
    );
    writeFileSync(
      join(packPanel, 'panel.json'),
      JSON.stringify({ id: 'pan_pak', name: 'sheet', label: 'The Book’s Sheet', blocks: [] }),
    );

    const loaded = loadCampaign(shelf, campaign, dir);
    const sheet: any = loaded.declarations('panels').find((p: any) => p.name === 'sheet');
    expect(sheet.label).toBe('The Book’s Sheet');
    expect(sheet.id).toBe('pan_pak');
    expect(loaded.sourceOf('panels', 'sheet')).toBe('pack:pak_p');
    campaign.close();
  });
});

describe('the order a bar of panels is drawn in', () => {
  // One sorted list at one seam, so the console's tabs, the Screens
  // picker and the seat's bar can't disagree about where a panel sits.

  function tableWith(panels: Record<string, unknown>[]): Campaign {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_o', name: 'O', data: { panels } });
    const campaign = createCampaign(dir, 'ord', 'Order');
    campaign.save({ ...campaign.root(), refs: { system: { id: 'sys_o', name: 'O' } } }, 't');
    return campaign;
  }

  it("play screens first, teller's host tools last — undeclared sits between", () => {
    const campaign = tableWith([
      { name: 'roster', label: 'Roster', subject: 'none' },
      { name: 'runner', label: 'Runner', subject: 'none', order: 10 },
    ]);
    const names = loadCampaign(openShelf(dir), campaign).declarations('panels').map(
      (p: any) => p.name,
    );
    // Runner declared 10, roster declared nothing (50), the seven
    // defaults 90-98. Alphabetical within a tie is the tiebreak, which
    // is why the tools read screens · handouts · boards · books · shelf
    // · plugins · log.
    expect(names).toEqual([
      'runner',
      'roster',
      'screens',
      'handouts',
      'boards',
      'books',
      'shelf',
      'plugins',
      'log',
    ]);
    campaign.close();
  });

  it('a restatement moves a tab — reordering is the same override as everything else', () => {
    const campaign = tableWith([{ name: 'roster', label: 'Roster', subject: 'none' }]);
    // The table says the log belongs first. No new machinery: it
    // restates the word with a number, and the merge does the rest.
    const tablePanel = join(dir, 'panels', 'log');
    mkdirSync(tablePanel, { recursive: true });
    writeFileSync(
      join(tablePanel, 'panel.json'),
      JSON.stringify({ id: 'pan_tlog', name: 'log', label: 'Log', subject: 'none', order: 1 }),
    );

    const names = loadCampaign(openShelf(dir), campaign, dir)
      .declarations('panels')
      .map((p: any) => p.name);
    expect(names[0]).toBe('log');
    campaign.close();
  });
});

describe('sections — declarations, merged by name (§J)', () => {
  it('a pack section loads, and the campaign overrides one by restating its name', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_s', name: 'S', data: {} });
    shelf.putPack({
      id: 'pak_s',
      system: 'sys_s',
      name: 'Guidebook',
      data: {
        sections: [
          {
            name: 'Skills',
            entries: [{ name: 'Charm', meta: 'convince, barter', text: 'Roll with Charm…', page: 26 }],
          },
          { name: 'Task Difficulty', entries: [{ name: 'Very Easy', text: '1 Hit', page: 26 }] },
        ],
      },
    });
    const campaign = createCampaign(dir, 'sec', 'Sections');
    campaign.save(
      {
        ...campaign.root(),
        refs: { system: { id: 'sys_s', name: 'S' }, packs: [{ id: 'pak_s', name: 'Guidebook' }] },
      },
      't',
    );
    let loaded = loadCampaign(shelf, campaign);
    const names = loaded.declarations('sections').map((s: any) => s.name);
    expect(names).toEqual(['Skills', 'Task Difficulty']);
    expect(loaded.sourceOf('sections', 'Skills')).toBe('pack:pak_s');

    // The campaign restates a section's name wholesale and wins — the
    // table's own note beats the book's (rule 1).
    campaign.putTemplate(
      'sections',
      { name: 'Skills', entries: [{ name: 'Charm', text: 'House ruling: also covers haggling.' }] },
      't',
    );
    loaded = loadCampaign(shelf, campaign);
    const skills: any = loaded.declarations('sections').find((s: any) => s.name === 'Skills');
    expect(skills.entries).toEqual([{ name: 'Charm', text: 'House ruling: also covers haggling.' }]);
    expect(loaded.sourceOf('sections', 'Skills')).toBe('campaign');
    campaign.close();
  });
});

describe('the record stack (visual vocabulary)', () => {
  it('shallow-merges records, later layer winning per key', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({
      id: 'sys_r',
      name: 'R',
      data: { accents: { Doctor: '#ff8a28', Marshal: '#50a9dc' } },
    });
    shelf.putPack({
      id: 'pak_r',
      system: 'sys_r',
      name: 'P',
      data: { accents: { Marshal: '#123456' } },
    });
    const campaign = createCampaign(dir, 'rec', 'Rec');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_r', name: 'R' } } },
      't',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.record('accents')).toEqual({
      Doctor: '#ff8a28',
      Marshal: '#123456', // the pack restated the key and won
    });
    expect(loaded.record('nothing')).toEqual({});
    campaign.close();
  });

  it('carries dice and marks straight through — a system-layer record, same as accents (§J)', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({
      id: 'sys_d',
      name: 'D',
      data: {
        dice: {
          faces: { B: ['hit', 'hit', 'ace', 'blank', 'blank', 'spur'] },
          values: { hit: 1, ace: 2, blank: 0, spur: 0 },
          unit: 'Hits',
          track: 6,
          trackBonus: 1,
          banks: [{ face: 'ace', counter: 'Aces' }],
        },
        marks: { kind: 'mark', text: 'rerolls Spurs', label: 'Talents', categories: ['Charm'] },
      },
    });
    const campaign = createCampaign(dir, 'dice', 'Dice');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_d', name: 'D' } } },
      't',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.record('dice')).toEqual({
      faces: { B: ['hit', 'hit', 'ace', 'blank', 'blank', 'spur'] },
      values: { hit: 1, ace: 2, blank: 0, spur: 0 },
      unit: 'Hits',
      track: 6,
      trackBonus: 1,
      banks: [{ face: 'ace', counter: 'Aces' }],
    });
    expect(loaded.record('marks')).toEqual({
      kind: 'mark',
      text: 'rerolls Spurs',
      label: 'Talents',
      categories: ['Charm'],
    });
    campaign.close();
  });
});

describe('a panel switched off (§15 — a trust row is a switch)', () => {
  // The row means "is this thing on?", not "may its code run". These
  // pin the truth table, because the bug that produced it was a
  // disabled panel whose tab never went anywhere.

  function tablePanel(name: string, id: string): void {
    const folder = join(dir, 'panels', name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'panel.json'), JSON.stringify({ id, name, subject: 'none' }));
  }

  it('leaves the merge entirely — and no row at all leaves it in', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_off', name: 'Off', data: {} });
    const campaign = createCampaign(dir, 'off1', 'Off One');
    campaign.save({ ...campaign.root(), refs: { system: { id: 'sys_off', name: 'Off' } } }, 't');
    tablePanel('ledger', 'pan_off1');

    expect(
      loadCampaign(shelf, campaign, dir).declarations('panels').map((p: any) => p.name),
    ).toContain('ledger');

    shelf.setPluginEnabled('pan_off1', false);
    expect(
      loadCampaign(shelf, campaign, dir).declarations('panels').map((p: any) => p.name),
    ).not.toContain('ledger');

    // …and back on, because the console has to be able to undo it.
    shelf.setPluginEnabled('pan_off1', true);
    expect(
      loadCampaign(shelf, campaign, dir).declarations('panels').map((p: any) => p.name),
    ).toContain('ledger');
    campaign.close();
  });

  it('still LISTS in the stack reading — the registry keeps what the merge drops', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_off2', name: 'Off2', data: {} });
    const campaign = createCampaign(dir, 'off2', 'Off Two');
    campaign.save({ ...campaign.root(), refs: { system: { id: 'sys_off2', name: 'Off2' } } }, 't');
    tablePanel('ledger', 'pan_off2');
    shelf.setPluginEnabled('pan_off2', false);

    const loaded = loadCampaign(shelf, campaign, dir);
    const fromTable = loaded.sourced('panels').find((s) => s.source === 'table')!;
    expect(fromTable.items.map((p: any) => p.name)).toEqual(['ledger']);
    expect(loaded.declarations('panels').map((p: any) => p.name)).not.toContain('ledger');
    campaign.close();
  });

  it("a switched-off SYSTEM panel doesn't shadow-kill a table's own of the same name", () => {
    const shelf = openShelf(dir);
    shelf.putSystem({
      id: 'sys_off3',
      name: 'Off3',
      data: { panels: [{ id: 'pan_sysbest', name: 'bestiary', label: "The System's" }] },
    });
    const campaign = createCampaign(dir, 'off3', 'Off Three');
    campaign.save({ ...campaign.root(), refs: { system: { id: 'sys_off3', name: 'Off3' } } }, 't');

    const folder = join(dir, 'panels', 'bestiary');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'panel.json'),
      JSON.stringify({ id: 'pan_tblbest', name: 'bestiary', label: 'Ours', subject: 'none' }),
    );
    shelf.setPluginEnabled('pan_sysbest', false);

    const loaded = loadCampaign(shelf, campaign, dir);
    const best: any = loaded.declarations('panels').find((p: any) => p.name === 'bestiary');
    expect(best.id).toBe('pan_tblbest');
    expect(best.label).toBe('Ours');
    expect(loaded.sourceOf('panels', 'bestiary')).toBe('table');
    campaign.close();
  });

  it("rejects one of teller's own seven — the console tombstone, across a fresh load", () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_off4', name: 'Off4', data: {} });
    const campaign = createCampaign(dir, 'off4', 'Off Four');
    campaign.save({ ...campaign.root(), refs: { system: { id: 'sys_off4', name: 'Off4' } } }, 't');

    const before = loadCampaign(shelf, campaign, dir).declarations('panels');
    const log: any = before.find((p: any) => p.name === 'log');
    expect(log.id).toBeTruthy();

    shelf.setPluginEnabled(log.id, false);
    const names = loadCampaign(shelf, campaign, dir)
      .declarations('panels')
      .map((p: any) => p.name)
      .sort();
    expect(names).toEqual(['boards', 'books', 'handouts', 'plugins', 'screens', 'shelf']);
    campaign.close();
  });
});
