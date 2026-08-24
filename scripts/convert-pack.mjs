// The first exercise of the new pack format: convert an old-world pack
// folder (fields/counters/tags) and its system row into the new shape
// (lists + declarations) and write both as new-world FOLDERS — one per
// half, since §M split them.
//
//   node scripts/convert-pack.mjs --pack ~/.teller/packs/wiw-guidebook \
//     --old-db ~/.teller/teller.db --data ~/.teller-next
//
// Two folders come out: `<data>/systems/<slug>/system.json` (the
// FUNCTION half — declarations, kinds, dice; `--system <slug>` or
// `--system-out <path>` to place it) and `<data>/packs/<name>/` (the
// CONTENT half — bestiary, catalogue, sections, art). They were one
// folder in §L phase 1, which merged function and content and made
// "who may hand this on?" unanswerable per half; a re-export must not
// resurrect that shape.
//
// §L phase 1 turned this from an install into an EXPORT. It used to
// write `shelf.db` rows and nothing else, which made the old world's
// pack the authoring copy forever — every WiW vocabulary edit was a
// round trip through here. Now it writes the folders above, and THOSE
// are the authoring copies from the run after this one. Run it once per pack, then edit the
// folder and `POST /api/shelf/sweep`.
//
// It still installs the db rows too (`--skip-db` to not). They're
// harmless: `loadCampaign` prefers a folder over a row of the same id,
// so the rows sit shadowed as a fallback for a host that hasn't got the
// folder yet. Nothing reads them once the folder exists.
//
// The script carries ZERO content (rule 4): everything it writes comes
// from files already on this host. Conversion is a port, not a
// redesign — a field that was one text blob stays one text entry; what
// has no consumer yet rides along unchanged under its old key.
//
// The mechanical mappings, and why:
//   * counters {current, max}       → entries {value, max}   (resources)
//   * skill fields (system groups)  → entries in `skills`
//   * short stat fields             → entries in `stats`
//   * features/trophies             → one entry per NAMED thing, in
//     `features` / `trophies` — the book prints "Fast Swimmer. …" and
//     the name is a name, not the first four words of a paragraph
//   * frenzy                        → child entities, `type: 'frenzy'`,
//     the printed threshold structured as a `gate` entry (the mechanic
//     that was hiding in "Guillotine (30 Health)")
//   * description/behavior          → entries in `about` (prose is
//     prose, but a heading is not prose: they used to be glued into
//     `notes` behind a "Description: " prefix)
//   * statuses meta (stack/cap/uncapped) → a KIND declaration for
//     `conditions` — the discriminator the rebuild was for: zero
//     clears, the cap presented never enforced; a per-status exception
//     (uncapped) rides on that status's own declaration.

import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { openShelf } from '../core/store.ts';
import { newId } from '../core/id.ts';
import { withInstalledArt } from '../core/packs-shelf.ts';
import {
  frenzyChildren,
  namedEntries,
  parseAttacks,
  parseTolerances,
} from './statblock-text.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] ?? '';
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const untilde = (p) => resolve((p ?? '').replace(/^~/, homedir()));
const packDir = untilde(args.pack ?? join(homedir(), '.teller/packs/wiw-guidebook'));
const oldDb = untilde(args['old-db'] ?? join(homedir(), '.teller/teller.db'));
const dataDir = untilde(args.data ?? join(homedir(), '.teller-next'));
// Where the folders land — TWO of them since §M's split: the content
// half under `packs/<name>/`, the function half under
// `systems/<slug>/`. Both are named for a person to type; identity is
// still the id inside (rule 4a).
const outDir = untilde(args.out ?? join(dataDir, 'packs', basename(packDir)));
const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'system';
const skipDb = args['skip-db'] !== undefined;

const readJson = (name) => {
  const path = join(packDir, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
};

const num = (v) => (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v);

// ---------------------------------------------------------------- system

const pack = readJson('pack.json');
if (!pack) {
  console.error(`${packDir} has no pack.json`);
  process.exit(1);
}

const db = new DatabaseSync(oldDb, { readOnly: true });
const sysRow = db
  .prepare('SELECT name, version, data FROM systems WHERE system = ?')
  .get(String(pack.system));
if (!sysRow) {
  console.error(`old db has no system '${pack.system}'`);
  process.exit(1);
}
const oldSys = JSON.parse(String(sysRow.data));
const systemId = `sys_${pack.system}`;

const skillKeys = new Set(oldSys.groups?.skills ?? []);
const conditionsWord = oldSys.vocabulary?.conditions;

// Statuses: named declarations, extras (relief, effect) riding along.
const statuses = (oldSys.statuses?.list ?? []).map((s) => ({
  ...s,
  ...(oldSys.statuses?.uncapped?.includes(s.name) ? { uncapped: true } : {}),
}));

// The statuses META becomes the kind declaration for `conditions`.
const kinds = [
  {
    name: 'conditions',
    ...(conditionsWord ? { label: conditionsWord } : {}),
    domain: {
      kind: 'count',
      zero: 'clears',
      ...(typeof oldSys.statuses?.cap === 'number' ? { cap: oldSys.statuses.cap } : {}),
    },
  },
  { name: 'skills', domain: { kind: 'text' } },
];

// Old sheet defaults (character/npc starting kits) → lists shape.
function sheetOf(old) {
  if (!old) return undefined;
  const lists = {};
  const skills = (old.fields ?? []).filter((f) => skillKeys.has(f.key));
  const stats = (old.fields ?? []).filter((f) => !skillKeys.has(f.key));
  if (skills.length) lists.skills = skills.map((f) => ({ name: f.label }));
  if (stats.length) lists.stats = stats.map((f) => ({ name: f.label }));
  const resources = (old.counters ?? []).map((c) => {
    const entry = { name: c.name };
    if (typeof c.current === 'number') entry.value = c.current;
    else if (typeof c.max === 'number') entry.value = c.max;
    if (typeof c.max === 'number') entry.max = c.max;
    return entry;
  });
  if (resources.length) lists.resources = resources;
  return { lists };
}

const systemData = {
  statuses,
  kinds,
  sheets: {
    ...(sheetOf(oldSys.character) ? { character: sheetOf(oldSys.character) } : {}),
    ...(sheetOf(oldSys.npc) ? { npc: sheetOf(oldSys.npc) } : {}),
  },
};
// Everything with no consumer yet rides along unchanged.
for (const key of [
  'space', 'bands', 'reload', 'vocabulary', 'dice', 'groups', 'accents',
  'pins', 'dials', 'screens', 'currency', 'icons', 'marks', 'use', 'store',
  'growth', 'ladders', 'spends', 'initiative',
]) {
  if (oldSys[key] !== undefined) systemData[key] = oldSys[key];
}

// ---------------------------------------------------------------- pack
//
// Nothing a creature prints stays a blob. `attacks` and `frenzy` become
// child entities, `tolerances`/`features`/`trophies` become lists of
// named entries, and `description`/`behavior` become `about` — each one
// read apart ONCE, here, at the boundary, by `statblock-text.mjs`, so
// the statblock renderer never parses again.
//
// All or nothing per field: if any line doesn't fit the grammar the
// WHOLE field falls back to a `traits` blob (never a half-structured,
// half-text statblock) and is logged — degradation out loud, never a
// silent drop.

/** Printed field key → the list its named entries land in. */
const NAMED_FIELDS = new Map([
  ['features', 'features'],
  ['trophies', 'trophies'],
]);
const PROSE_FIELDS = new Set(['description', 'behavior']);

const parseStats = {
  attacks: { parsed: 0, fellBack: 0 },
  tolerances: { parsed: 0, fellBack: 0 },
  named: { parsed: 0, fellBack: 0 },
  frenzy: { parsed: 0, fellBack: 0 },
  /** Frenzies whose paragraph said nothing this can structure — prose, out loud. */
  frenzyBare: 0,
  marks: 0,
};

// A Talent used to hide behind a prefix on a tag string ("Talent:
// Rifles") — the recurring bug rule 4 names. The prefix itself is
// system data (`oldSys.marks.prefix`), never hardcoded here; a tag
// wearing it becomes a bare `marks` entry (name = category, no value)
// and the prefixed tag is dropped, not carried forward alongside it.
const marksPrefix = oldSys.marks?.prefix;

function creatureOf(old) {
  const lists = {};
  const about = [];
  const skills = [];
  const stats = [];
  const traits = [];
  const children = [];
  const marks = [];
  /** Held back until the rest of the creature is read — see below. */
  let frenzyField;
  for (const t of old.tags ?? []) {
    const name = typeof t.name === 'string' ? t.name : undefined;
    if (marksPrefix && name?.startsWith(marksPrefix)) {
      marks.push({ name: name.slice(marksPrefix.length).trim() });
      parseStats.marks++;
    }
    // Non-Talent tags have no consumer yet and stay unconverted, same
    // as before this change — only the Talent-prefixed shape hid a
    // mechanic (rule 4) and needed a structured home.
  }
  if (marks.length) lists.marks = marks;
  for (const f of old.fields ?? []) {
    const value = typeof f.value === 'string' ? f.value.trim() : f.value;
    if (value === '' || value === undefined) continue;
    if (f.key === 'attacks') {
      const attacks = parseAttacks(value, () => newId('atk'));
      if (attacks) {
        parseStats.attacks.parsed++;
        children.push(...attacks);
      } else {
        parseStats.attacks.fellBack++;
        console.log(`  attacks didn't parse cleanly for ${old.name} — kept as prose`);
        traits.push({ name: f.label, value });
      }
    } else if (f.key === 'tolerances') {
      const tolerances = parseTolerances(value);
      if (tolerances) {
        parseStats.tolerances.parsed++;
        if (tolerances.length) lists.tolerances = tolerances;
      } else {
        parseStats.tolerances.fellBack++;
        console.log(`  tolerances didn't parse cleanly for ${old.name} — kept as prose`);
        traits.push({ name: f.label, value });
      }
    } else if (f.key === 'frenzy') {
      // Read LAST, whatever order the fields arrive in: what a frenzy
      // does is written against the creature's own attacks, stats and
      // tolerances, and it can't point at a list that hasn't been read
      // yet. See the deferred parse below.
      frenzyField = { label: f.label, value };
    } else if (NAMED_FIELDS.has(f.key)) {
      const entries = namedEntries(value);
      if (entries) {
        parseStats.named.parsed++;
        if (entries.length) lists[NAMED_FIELDS.get(f.key)] = entries;
      } else {
        parseStats.named.fellBack++;
        console.log(`  ${f.key} didn't parse cleanly for ${old.name} — kept as prose`);
        traits.push({ name: f.label, value });
      }
    } else if (PROSE_FIELDS.has(f.key)) about.push({ name: f.label, value });
    else if (skillKeys.has(f.key)) skills.push({ name: f.label, value });
    else stats.push({ name: f.label, value: num(value) });
  }
  if (about.length) lists.about = about;
  if (skills.length) lists.skills = skills;
  if (stats.length) lists.stats = stats;

  // The frenzy, now that there's a creature to read it against: its own
  // attacks (so a rewrite points at one with a REF rather than copying
  // a name the book spells differently), its stat and tolerance names
  // (so an override can only ever name something real), and the
  // system's statuses (so a bracketed name is known to be one, or known
  // not to be). Nothing in that list is a word this file spells.
  if (frenzyField) {
    const frenzies = frenzyChildren(frenzyField.value, () => newId('frz'), {
      attacks: children.filter((c) => c.type === 'attack').map((c) => ({ id: c.id, name: c.name })),
      stats: stats.map((s) => s.name),
      tolerances: (lists.tolerances ?? []).map((t) => t.name),
      statuses: statuses.map((s) => s.name),
    });
    if (frenzies) {
      parseStats.frenzy.parsed++;
      parseStats.frenzyBare += frenzies.filter(
        (f) => !f.children && Object.keys(f.lists).every((k) => k === 'gate'),
      ).length;
      children.push(...frenzies);
    } else {
      parseStats.frenzy.fellBack++;
      console.log(`  frenzy didn't parse cleanly for ${old.name} — kept as prose`);
      traits.push({ name: frenzyField.label, value: frenzyField.value });
    }
  }
  if (traits.length) lists.traits = traits;
  const resources = (old.counters ?? []).map((c) => {
    const entry = { name: c.name };
    const value = typeof c.current === 'number' ? c.current : c.max;
    if (typeof value === 'number') entry.value = value;
    if (typeof c.max === 'number') entry.max = c.max;
    return entry;
  });
  if (resources.length) lists.resources = resources;
  const out = { id: old.id, name: old.name, type: 'foe', lists };
  if (children.length) out.children = children;
  if (typeof old.page === 'number') out.page = old.page;
  return out;
}

function itemOf(old) {
  const { id, name, kind, fields, ...rest } = old;
  const lists = {};
  const stats = (fields ?? [])
    .map((f) => ({ name: f.label ?? f.key, value: num(f.value) }))
    .filter((e) => e.value !== '' && e.value !== undefined);
  if (stats.length) lists.stats = stats;
  return { id, name, ...(kind ? { type: kind } : {}), lists, ...rest };
}

const bestiary = (readJson('bestiary.json') ?? []).map(creatureOf);
const oldCatalog = readJson('catalog.json') ?? {};
const catalog = (oldCatalog.items ?? []).map(itemOf);

// -- art: a pack carries its pictures (rule 4a). The blob assembled
// here keeps art RELATIVE (`art/logo.png`), because that is what a
// pack folder holds; the sweep rewrites it to `art/<pak_id>/…` at
// install, and the db path below does the same rewrite by hand.
const artDir = join(packDir, 'art');
const hasArt = existsSync(artDir);
const installedArt = (rel) => `art/${String(rel).replace(/^art\//, '')}`;

const brand = {};
const portraits = {};
if (hasArt) {
  // A file named logo.* anywhere in the pack's art is the brand mark.
  const findLogo = (dir, rel = '') => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(path).isDirectory()) {
        const hit = findLogo(path, relPath);
        if (hit) return hit;
      } else if (/^logo\./i.test(name)) {
        return relPath;
      }
    }
    return undefined;
  };
  const logo = findLogo(artDir);
  if (logo) brand.logo = `art/${logo}`;
  for (const trade of readJson('trades.json') ?? []) {
    if (trade.name && trade.art) portraits[trade.name] = installedArt(trade.art);
  }
}

const packData = { bestiary, catalog };
if (Object.keys(brand).length) packData.brand = brand;
if (Object.keys(portraits).length) packData.portraits = portraits;
if (oldCatalog.upgrades) packData.upgrades = oldCatalog.upgrades;

// `sections` is the mid-game lookup text — a declarations-style slot
// (merged by NAME, later wins, same as `statuses`), so a campaign can
// override one section wholesale by restating its title. The old file
// keys each section by `title`; the new shape wants `name`, the field
// every declaration merges on (`Loaded#declarations`).
const oldSections = readJson('sections.json');
if (Array.isArray(oldSections)) {
  packData.sections = oldSections.map(({ title, ...rest }) => ({ name: title, ...rest }));
}

for (const [file, slot] of [
  ['trades.json', 'trades'],
  ['creation.json', 'creation'],
  ['notes.json', 'notes'],
]) {
  const held = readJson(file);
  if (held !== undefined) packData[slot] = held;
}

// ----------------------------------------------------------- export folder
//
// The serialization rule, and the whole of it: `pack.json` and
// `system.json` carry identity, and every other key of the blob becomes
// `<slot>.json`. The system's records stay INLINE in `system.json`
// because they're read and edited together (see `core/packs-shelf.ts`).

const written = [];
const writeJson = (name, value) => {
  writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
  written.push(name);
};

mkdirSync(outDir, { recursive: true });

// The SYSTEM half, in its own folder (§M · 4). It used to be written
// beside `pack.json`, which merged function and content in one place and
// made "who may hand this on?" unanswerable per half. A re-export must
// never resurrect that shape, so the two writes are separate here — and
// a system folder someone has since grown `presentations/` or `panels/`
// in is left alone apart from its `system.json`.
const systemDir = untilde(
  args['system-out'] ?? join(dataDir, 'systems', slug(args.system ?? sysRow.name)),
);
mkdirSync(systemDir, { recursive: true });
writeFileSync(
  join(systemDir, 'system.json'),
  `${JSON.stringify(
    {
      id: systemId,
      name: String(sysRow.name),
      version: Number(sysRow.version) || 1,
      ...systemData,
    },
    null,
    2,
  )}\n`,
);
writeJson('pack.json', {
  id: String(pack.id),
  system: systemId,
  name: String(pack.name),
  version: Number(pack.version) || 1,
  ...(pack.rights ? { rights: pack.rights } : {}),
  ...(pack.books ? { books: pack.books } : {}),
});
for (const [slot, held] of Object.entries(packData)) writeJson(`${slot}.json`, held);
if (hasArt) cpSync(artDir, join(outDir, 'art'), { recursive: true });

// ------------------------------------------------------- install (shadowed)

if (!skipDb) {
  // The rows the folder now supersedes. Art references have to be the
  // INSTALLED keys here, because a row has no folder to be relative to.
  if (hasArt) cpSync(artDir, join(dataDir, 'art', String(pack.id)), { recursive: true });
  const shelf = openShelf(dataDir);
  shelf.putSystem({
    id: systemId,
    name: String(sysRow.name),
    version: Number(sysRow.version) || 1,
    data: withInstalledArt(systemData, String(pack.id)),
  });
  shelf.putPack({
    id: String(pack.id),
    system: systemId,
    name: String(pack.name),
    version: Number(pack.version) || 1,
    data: withInstalledArt(packData, String(pack.id)),
  });
  shelf.close();
}

console.log(`system ${systemId} · ${sysRow.name} v${sysRow.version}`);
console.log(`  statuses: ${statuses.length} · kinds: ${kinds.map((k) => k.name).join(', ')}`);
console.log(`pack ${pack.id} · ${pack.name} v${pack.version}`);
console.log(`  bestiary: ${bestiary.length} · catalog: ${catalog.length}`);
for (const field of ['attacks', 'tolerances', 'named', 'frenzy']) {
  const { parsed, fellBack } = parseStats[field];
  console.log(
    `  ${field} parsed: ${parsed}/${parsed + fellBack}` +
      (fellBack ? ` (${fellBack} fell back to prose, see above)` : ''),
  );
}
console.log(
  `  frenzies left as prose (nothing structurable in the paragraph): ${parseStats.frenzyBare}`,
);
console.log(`  Talent tags converted to marks: ${parseStats.marks}`);
for (const [slot, held] of Object.entries(packData)) {
  if (['bestiary', 'catalog'].includes(slot)) continue;
  console.log(`  rides along: ${slot} (${Array.isArray(held) ? held.length + ' items' : 'object'})`);
}
if (hasArt) {
  console.log(
    `  art copied into the folder, relative` +
      `${brand.logo ? ' · brand logo found' : ''}` +
      `${Object.keys(portraits).length ? ` · ${Object.keys(portraits).length} portraits` : ''}`,
  );
}
console.log(`system folder written to ${systemDir}`);
console.log('  system.json');
console.log(`pack folder written to ${outDir}`);
console.log(`  ${written.join(' · ')}${hasArt ? ' · art/' : ''}`);
console.log(
  skipDb
    ? '  (db rows not written — the folder is the only copy)'
    : `  shadow rows also written to ${join(dataDir, 'shelf.db')} — the folder wins`,
);
console.log('edit the folder, then POST /api/shelf/sweep');
