// Re-create an old-world campaign in the new world — characters,
// encounters, boards, board state — against packs already converted by
// scripts/convert-pack.mjs. One-time migration, run on the host; the
// script carries zero content (rule 4).
//
//   node scripts/port-campaign.mjs --old-db ~/.teller/teller.db \
//     --campaign cmp_3e383af30ace --slug the-unlikely-duo \
//     --data ~/.teller-next [--retire pak_demo] [--fresh]
//
// Mappings (same law as the pack converter):
//   * fields → lists.skills / lists.stats / lists.traits by the
//     system's own groups; trade → entity.type; player → lists.meta
//   * counters → lists.resources {value, max}
//   * tags → lists.conditions (a trailing number becomes the value —
//     the severity-hiding-in-a-string bug, unwound at the border)
//   * items → flat children (§K): thin stamp, refs.from → the catalog
//     (id match, name-match fallback logged), refs.chambered/refs.upgrades
//     for ammo and fittings, fitted upgrades their own flat sibling child,
//     history (Deeds) → the event log against the item's minted id
//   * npc statblocks convert like pack creatures (prose → notes)
//   * encounters → campaign templates, slot 'encounters'
//   * maps → shelf boards (ids kept) + board_state placements linked
//     to the ported entities; image files copied under the new root
//   * vendors → campaign templates, slot 'vendors' (ride until built)

import { copyFileSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { createCampaign, openShelf } from '../core/store.ts';
import { newId } from '../core/id.ts';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const next = argv[i + 1];
      out[argv[i].slice(2)] = next && !next.startsWith('--') ? next : true;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const untilde = (p) => resolve(String(p ?? '').replace(/^~/, homedir()));
const oldRoot = dirname(untilde(args['old-db'] ?? join(homedir(), '.teller/teller.db')));
const oldDbPath = untilde(args['old-db'] ?? join(homedir(), '.teller/teller.db'));
const dataDir = untilde(args.data ?? join(homedir(), '.teller-next'));
const campaignId = String(args.campaign ?? '');
const slug = String(args.slug ?? '');
if (!campaignId || !slug) {
  console.error('need --campaign <cmp_id> and --slug <new-slug>');
  process.exit(1);
}

const db = new DatabaseSync(oldDbPath, { readOnly: true });
const campRow = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
if (!campRow) {
  console.error(`old db has no campaign ${campaignId}`);
  process.exit(1);
}
const campData = JSON.parse(String(campRow.data ?? '{}'));
const sysSlug = String(campRow.system);
const sysRow = db.prepare('SELECT name, data FROM systems WHERE system = ?').get(sysSlug);
const oldSys = sysRow ? JSON.parse(String(sysRow.data)) : {};
const groups = oldSys.groups ?? {};
const skillKeys = new Set(groups.skills ?? []);
const titleKeys = new Set(groups.title ?? []);
const playerKeys = new Set(groups.player ?? []);
const systemId = `sys_${sysSlug}`;

const shelf = openShelf(dataDir);
if (args.retire) {
  shelf.removePack(String(args.retire));
  console.log(`retired ${args.retire} from the shelf`);
}
if (args.fresh) {
  rmSync(join(dataDir, 'campaigns', `${slug}.db`), { force: true });
  rmSync(join(dataDir, 'campaigns', `${slug}.db-wal`), { force: true });
  rmSync(join(dataDir, 'campaigns', `${slug}.db-shm`), { force: true });
}

const campaign = createCampaign(dataDir, slug, String(campRow.name));
const ACTOR = 'port';

// -- manifest: system + declared pack order + book refs ----------------
const packIds = shelf.packsFor(systemId);
const packRefs = packIds.map((id) => ({ id, name: shelf.pack(id)?.name ?? id }));
const bookNames = new Map(
  db.prepare('SELECT id, name FROM books').all().map((r) => [String(r.id), String(r.name)]),
);
const refs = {
  system: { id: systemId, name: String(sysRow?.name ?? sysSlug) },
  ...(packRefs.length ? { packs: packRefs } : {}),
};
const books = (campData.books ?? []).map((id) => ({ id, name: bookNames.get(id) ?? id }));
if (books.length) refs.books = books;
campaign.save({ ...campaign.root(), refs }, ACTOR);

// -- catalog lookup, for carried-item refs.from (§K) --------------------
//
// The same set an installed item resolves against at the table: every
// declared pack's catalog/upgrades, in precedence order, with the
// campaign's own (old-world) homebrew catalogue winning last — the
// identical merge rule 4a already uses. `upgrades` gets its own map:
// a `FittedUpgrade.from` and an `Item.from` are never the same id space,
// and a fitted upgrade carries no name to fall back on — id only.
const catalogById = new Map();
const catalogByName = new Map();
const upgradesById = new Map();
for (const id of packIds) {
  const held = shelf.pack(id)?.data ?? {};
  for (const entry of held.catalog ?? []) {
    catalogById.set(entry.id, entry);
    catalogByName.set(String(entry.name).trim().toLowerCase(), entry);
  }
  for (const entry of held.upgrades ?? []) {
    upgradesById.set(entry.id, entry);
  }
}
for (const entry of campData.catalog?.items ?? []) {
  catalogById.set(entry.id, entry);
  catalogByName.set(String(entry.name).trim().toLowerCase(), entry);
}
for (const entry of campData.catalog?.upgrades ?? []) {
  upgradesById.set(entry.id, entry);
}

const itemStats = { children: 0, chambered: 0, upgrades: 0, nameFallback: 0, dangling: 0, deeds: 0 };

/**
 * An upgrade a character actually fitted, as its OWN flat child of the
 * character (§K: "the upgrade itself a FLAT child of the character,
 * never nested in the weapon"). `range`, the choice the player made
 * (Damage/Accuracy pick Short or Long), is the instance's own — it rides
 * in `stats`, the same bucket every other instance override uses.
 *
 * A `FittedUpgrade` carries no name of its own, only `from` — so there
 * is no name-match fallback here (that's the item converter's trick,
 * below); an id miss goes straight to a dangling ref.
 */
function upgradeChildOf(fitted, charName) {
  const hit = upgradesById.get(fitted.from);
  const name = hit?.name ?? fitted.from;
  const child = { id: newId('itm'), name, type: 'upgrade', lists: {} };
  if (fitted.range) child.lists.stats = [{ name: 'Range', value: fitted.range }];
  if (hit) {
    child.refs = { from: { id: hit.id, name: hit.name } };
  } else {
    console.log(`  ${charName}: upgrade ${fitted.from} matched no catalog entry — kept as a dangling ref`);
    child.refs = { from: { id: fitted.from, name } };
    itemStats.dangling++;
  }
  itemStats.upgrades++;
  return child;
}

/** One carried item → a flat child entity — §K's whole shape: thin stamp, instance-own lists, refs for chambering/fittings. */
function itemChildOf(old, charName) {
  const lists = {};
  const stats = (old.fields ?? [])
    .map((f) => ({ name: f.label ?? f.key, value: num(f.value) }))
    .filter((e) => e.value !== '' && e.value !== undefined);
  if (stats.length) lists.stats = stats;
  const resources = (old.counters ?? []).map((c) => {
    const entry = { name: c.name };
    if (typeof c.current === 'number') entry.value = c.current;
    else if (typeof c.max === 'number') entry.value = c.max;
    if (typeof c.max === 'number') entry.max = c.max;
    return entry;
  });
  if (resources.length) lists.resources = resources;
  if (old.tags?.length) {
    lists.tags = old.tags.map((t) => {
      const raw = String(t.name ?? t).trim();
      const m = raw.match(/^(.*?)\s+(\d+)$/);
      return m ? { name: m[1], value: Number(m[2]) } : { name: raw };
    });
  }
  const child = { id: newId('itm'), name: old.name, lists };
  if (old.kind) child.type = old.kind;
  if (old.notes) child.notes = old.notes;
  if (old.from) {
    const hit = catalogById.get(old.from) ?? undefined;
    const named = hit ? undefined : catalogByName.get(String(old.name).trim().toLowerCase());
    const found = hit ?? named;
    if (named && !hit) {
      console.log(`  ${charName}: ${old.name}'s catalog id ${old.from} wasn't found — matched by name to ${named.id}`);
      itemStats.nameFallback++;
    }
    if (found) {
      child.refs = { from: { id: found.id, name: found.name } };
    } else {
      console.log(`  ${charName}: ${old.name} references catalog id ${old.from}, which isn't installed — kept as a dangling ref`);
      child.refs = { from: { id: old.from, name: old.name } };
      itemStats.dangling++;
    }
  }
  itemStats.children++;
  return child;
}

/** A character's `items` → flat children + the deed events they carry (history → events, §9's own evidence). */
function convertItems(oldItems, charName, campaign) {
  const children = [];
  const byOldId = new Map();
  const deedsFor = [];
  for (const old of oldItems ?? []) {
    if (!old?.id || !old?.name) continue;
    const child = itemChildOf(old, charName);
    children.push(child);
    byOldId.set(old.id, child);
    if (old.history?.length) deedsFor.push([child.id, old.history]);
  }
  for (const old of oldItems ?? []) {
    const child = byOldId.get(old.id);
    if (!child) continue;
    if (old.loaded) {
      const ammoChild = byOldId.get(old.loaded);
      if (ammoChild) {
        child.refs = { ...(child.refs ?? {}), chambered: { id: ammoChild.id, name: ammoChild.name } };
        itemStats.chambered++;
      } else {
        console.log(`  ${charName}: ${old.name}'s chambered ammo (${old.loaded}) wasn't among its carried items — dropped`);
      }
    }
    if (old.upgrades?.length) {
      const upgradeRefs = old.upgrades.map((fitted) => {
        const upChild = upgradeChildOf(fitted, charName);
        children.push(upChild);
        return { id: upChild.id, name: upChild.name };
      });
      child.refs = { ...(child.refs ?? {}), upgrades: upgradeRefs };
    }
  }
  // Deeds go straight to the event log, keyed by the minted child id —
  // `events.entity_id` isn't foreign-keyed (nested children never get
  // their own row), so this needs no ordering against `campaign.create`.
  for (const [childId, history] of deedsFor) {
    for (const deed of history) {
      campaign.append(childId, ACTOR, 'item.deed', deed);
      itemStats.deeds++;
    }
  }
  return children;
}

// -- characters --------------------------------------------------------
const num = (v) => (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v);
const LONG_FIELDS = new Set(['attacks', 'features', 'trophies', 'tolerances', 'frenzy']);
const PROSE_FIELDS = new Set(['description', 'behavior']);

function convertCharacter(row) {
  const d = JSON.parse(String(row.data ?? '{}'));
  const lists = {};
  const notes = [];
  const skills = [];
  const stats = [];
  const traits = [];
  const meta = [];
  let type = row.kind === 'npc' ? 'foe' : undefined;
  for (const f of d.fields ?? []) {
    const value = typeof f.value === 'string' ? f.value.trim() : f.value;
    // An EMPTY field survives as a bare held entry — the printed sheet
    // has a Defense box whether or not anything is written in it, and
    // dropping the empty one un-pins Health's whole panel (the sheet
    // renders MAX/stepper/DEFENSE only for an entry that exists).
    // core/entity.ts's own contract: absent value = a plain held thing.
    if (value === '' && !titleKeys.has(f.key) && !playerKeys.has(f.key) && !PROSE_FIELDS.has(f.key) && !LONG_FIELDS.has(f.key)) {
      stats.push({ name: f.label });
      continue;
    }
    if (value === '' || value === undefined) continue;
    if (titleKeys.has(f.key)) type = String(value);
    else if (playerKeys.has(f.key)) meta.push({ name: f.label, value });
    else if (PROSE_FIELDS.has(f.key)) notes.push(`${f.label}: ${value}`);
    else if (skillKeys.has(f.key)) skills.push({ name: f.label, value });
    else if (LONG_FIELDS.has(f.key)) traits.push({ name: f.label, value });
    else stats.push({ name: f.label, value: num(value) });
  }
  const resources = (d.counters ?? []).map((c) => {
    const entry = { name: c.name };
    if (typeof c.current === 'number') entry.value = c.current;
    if (typeof c.max === 'number') entry.max = c.max;
    return entry;
  });
  const conditions = (d.tags ?? []).map((t) => {
    const raw = String(t.name ?? t).trim();
    const m = raw.match(/^(.*?)\s+(\d+)$/); // severity unhidden from the string
    return m ? { name: m[1], value: Number(m[2]) } : { name: raw };
  });
  if (skills.length) lists.skills = skills;
  if (stats.length) lists.stats = stats;
  if (traits.length) lists.traits = traits;
  if (meta.length) lists.meta = meta;
  if (resources.length) lists.resources = resources;
  if (conditions.length) lists.conditions = conditions;
  if (typeof d.notes === 'string' && d.notes.trim()) notes.push(d.notes.trim());
  const draft = { name: String(row.name), lists };
  if (type) draft.type = type;
  if (notes.length) draft.notes = notes.join('\n\n');
  const children = convertItems(d.items, String(row.name), campaign);
  if (children.length) draft.children = children;
  return draft;
}

const idMap = new Map(); // old chr_ id → new ent_ id
const chars = db
  .prepare('SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at')
  .all(campaignId);
for (const row of chars) {
  const entity = campaign.create(convertCharacter(row), ACTOR);
  idMap.set(String(row.id), entity.id);
}

// -- boards + live state ----------------------------------------------
let boardCount = 0;
let copiedImages = 0;
for (const map of campData.maps ?? []) {
  shelf.putBoard({
    id: map.id, // kept, so encounter sceneIds keep pointing at it
    key: map.key,
    name: map.name,
    ...(typeof map.widthInches === 'number' ? { widthInches: map.widthInches } : {}),
    ...(map.grid !== undefined ? { grid: map.grid } : {}),
  });
  boardCount++;
  const src = join(oldRoot, map.key);
  const dst = join(dataDir, map.key);
  if (existsSync(src)) {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    copiedImages++;
  }
  const placements = (map.tokens ?? []).map((t) => ({
    ...(t.characterId && idMap.has(t.characterId)
      ? { entityId: idMap.get(t.characterId) }
      : { label: t.label }),
    u: t.u,
    v: t.v,
    sizeInches: t.sizeInches ?? 1,
    ...(t.color ? { color: t.color } : {}),
    ...(t.hidden ? { hidden: true } : {}),
  }));
  if (placements.length) {
    campaign.putBoardState(map.id, { placements }, ACTOR);
  }
}

// -- encounters + vendors → the campaign's template half ---------------
for (const enc of campData.encounters ?? []) {
  campaign.putTemplate(
    'encounters',
    {
      id: enc.id,
      name: enc.name,
      ...(enc.sceneId ? { boardId: enc.sceneId } : {}),
      ...(enc.notes ? { notes: enc.notes } : {}),
      foes: (enc.foes ?? []).map((f) => ({
        templateId: f.blueprintId,
        ...(f.name ? { name: f.name } : {}),
        count: 1,
        ...(typeof f.u === 'number' ? { u: f.u, v: f.v } : {}),
        ...(f.hidden ? { hidden: true } : {}),
      })),
    },
    ACTOR,
  );
}
for (const vendor of campData.vendors ?? []) {
  campaign.putTemplate('vendors', vendor, ACTOR);
}
// The campaign's OWN catalogue half — homebrew items and upgrades the
// table wrote, layered over the packs' (later wins, as everywhere).
let ownCatalog = 0;
for (const item of campData.catalog?.items ?? []) {
  campaign.putTemplate('catalog', item, ACTOR);
  ownCatalog++;
}
for (const upgrade of campData.catalog?.upgrades ?? []) {
  campaign.putTemplate('upgrades', upgrade, ACTOR);
  ownCatalog++;
}

const skipped = ['vocabulary', 'foePicks', 'activeMapId', 'npcs', 'counters']
  .filter((k) => {
    const v = campData[k];
    return v && (Array.isArray(v) ? v.length : Object.keys(v).length);
  });

console.log(`campaign ${slug} · ${campRow.name}`);
console.log(`  system: ${systemId} · packs declared: ${packRefs.map((p) => p.name).join(' → ') || '(none)'}`);
console.log(`  entities: ${idMap.size} (${chars.filter((c) => c.kind === 'npc').length} statblock foes)`);
console.log(`  boards: ${boardCount} (${copiedImages} images copied) · encounters: ${(campData.encounters ?? []).length} · vendors: ${(campData.vendors ?? []).length}`);
console.log(`  book refs: ${books.length} · own catalogue entries: ${ownCatalog}`);
console.log(
  `  carried items: ${itemStats.children} (${itemStats.nameFallback} name-matched, ${itemStats.dangling} dangling refs)` +
    ` · chambered: ${itemStats.chambered} · fitted upgrades: ${itemStats.upgrades} · deeds ported: ${itemStats.deeds}`,
);
if (skipped.length) console.log(`  skipped (no consumer / redundant): ${skipped.join(', ')}`);
campaign.close();
shelf.close();
