// Reading a printed statblock apart, ONCE, at the boundary.
//
// A book sets a creature's features as one paragraph per line —
//
//   Fast Swimmer. If taking the Move Action while in water, …
//   Harden Shell. During its Frenzy, the turtle's shell …
//
// — which reads fine in a book and terribly in a column, where three
// named abilities collapse into one grey wall. Worse, it's the
// recurring bug this codebase has a name for: a mechanic hiding in a
// text field. A Frenzy's THRESHOLD ("Guillotine (30 Health)") is the
// number that decides whether the Warden may press it, and it was
// living inside a sentence.
//
// So the split happens here, at conversion, and the statblock renderer
// never parses again. Everything is all-or-nothing per field: a field
// that doesn't fit the grammar comes back `undefined` and the caller
// keeps the old shape and says so out loud — half a structured
// statblock is worse than an honest prose one.
//
// The grammar was not invented: it's the old world's own reader
// (`src/lib/statblock.ts`), which had to parse at RENDER time because
// the data never held the parts.

import { newId } from '../core/id.ts';

// -------------------------------------------------------------- blocks

/** "Fast Swimmer. If taking the Move Action…" — a name, then its words. */
const NAMED = /^([A-Z][^.]{0,60})\.\s+(\S[\s\S]*)$/;
/** "Guillotine (30 Health)" — the number a name gates itself behind. */
const GATE = /^(.*?)\s*\((\d+)\s+([A-Za-z][A-Za-z ]*)\)\s*$/;

/**
 * A printed field that is really a LIST of named things, split back
 * into its parts. A line that announces no name keeps its text.
 */
export function namedBlocks(field) {
  const out = [];
  for (const line of String(field ?? '').split('\n')) {
    const text = line.trim();
    if (!text) continue;
    const m = NAMED.exec(text);
    out.push(m ? { name: m[1].trim(), text: m[2].trim() } : { text });
  }
  return out;
}

/**
 * A block's name split from the counter it watches — `{ name, gate }`,
 * the gate an ordinary entry (`{ name: 'Health', value: 30 }`) because
 * that is exactly what it is: a named counter at a number. Which
 * counter is DATA, read off the author's own notation; nothing here
 * knows what Health is (rule 2).
 */
export function parseGate(name) {
  const m = GATE.exec(String(name ?? '').trim());
  if (!m) return { name: String(name ?? '').trim() };
  return { name: m[1].trim(), gate: { name: m[3].trim(), value: Number(m[2]) } };
}

/**
 * A `Features` or `Trophies` field → one entry per named thing, the
 * prose as the entry's value. `undefined` if any line doesn't announce
 * a name — the caller keeps the blob and reports it.
 */
export function namedEntries(field) {
  const blocks = namedBlocks(field);
  if (!blocks.length) return [];
  if (blocks.some((b) => !b.name)) return undefined;
  return blocks.map((b) => ({ name: b.name, value: b.text }));
}

/**
 * A `Frenzy` field → child entities, one per named ability.
 *
 * A frenzy is a name, a threshold, the counter that threshold watches,
 * and a paragraph — four things, which is one more than a leaf
 * (`Entry` is a name, a value and a ceiling, and anything richer was an
 * entity all along). So it takes the shape an attack already takes: a
 * child with `type` and a `gate` list, its words in `notes`. The
 * alternative — prose in `value`, the number in `max` — had nowhere to
 * put "Health" but the renderer, which is a game concept in code.
 *
 * `undefined` if a line doesn't announce a name. A frenzy with no
 * printed threshold is kept, ungated: the words are still the ability.
 *
 * `context` — the creature's attacks, its stat and tolerance names, and
 * the system's statuses — turns on the second half of the read
 * (`frenzyStructure`): what the thing mechanically DOES. Without it a
 * frenzy is still a gate and a paragraph, which is what it was.
 */
export function frenzyChildren(field, idFor = () => newId('frz'), context) {
  const blocks = namedBlocks(field);
  if (!blocks.length) return [];
  if (blocks.some((b) => !b.name)) return undefined;
  return blocks.map((b) => {
    const { name, gate } = parseGate(b.name);
    const { lists, children } = context
      ? frenzyStructure(b.text, context)
      : { lists: {}, children: [] };
    return {
      id: idFor(name),
      name,
      type: 'frenzy',
      lists: { ...(gate ? { gate: [gate] } : {}), ...lists },
      ...(children.length ? { children } : {}),
      notes: b.text,
    };
  });
}

/**
 * Old-shape notes ("Description: …\n\nBehavior: …") → an `about` list
 * plus whatever else was in there.
 *
 * The prefixes were a heading pretending to be prose: two labelled
 * sections the book prints separately, glued into one field with a
 * colon holding them apart. Anything that ISN'T one of the named
 * labels is a table's own note and survives untouched — notes are the
 * one place a human writes freely and nothing may eat that.
 */
export function aboutFromNotes(notes, labels = ['Description', 'Behavior']) {
  const about = [];
  const kept = [];
  for (const part of String(notes ?? '').split(/\n{2,}/)) {
    const text = part.trim();
    if (!text) continue;
    const label = labels.find((l) =>
      text.toLowerCase().startsWith(`${l.toLowerCase()}:`),
    );
    if (label) about.push({ name: label, value: text.slice(label.length + 1).trim() });
    else kept.push(text);
  }
  return { about, notes: kept.join('\n\n') };
}

// ------------------------------------------------------------- attacks
//
// An attack is an entity, not a line of prose (§I). The book prints one
// field —
//   Melee — Big Foot (3 Grit): 2B2G damage + Dazed [2] · Brutal Fists (2 Grit): 2G damage
// — and this reads it apart. Started from the old world's regex
// grammar, extended for AOE and Piercing, which that reader never had
// to structure because it stayed prose there.

const BAND_LINE = /^(.+?)\s+—\s+(.+)$/;
const ATTACK_ENTRY = /^(.+?)(\s+\(AOE\))?\s+\((\d+)\s+([A-Za-z]+)\):\s*(.+)$/;
const POOL_DAMAGE = /^((?:\d+[BG])+)\s+damage\b/i;
// A chain item is "Name [severity]" — severity a plain number ("[2]")
// or a full pool, one or more die groups ("[4B]", "[1B1G]") — or a bare
// "Name" with no severity at all (a held tag, "+ Knockback").
const CHAIN_TOKEN = /^([A-Z][A-Za-z'’ -]*?)(?:\s*\[([^\]]+)\])?$/;
const BANDS = ['Melee', 'Short', 'Long'];

const numeric = (raw) => (/^\d+$/.test(raw) ? Number(raw) : raw);

/** The "+ Status [n]" / "+ Status" tail after the damage pool (or the whole effect, for a status-only line). */
function parseChain(rest) {
  const trimmed = rest.trim();
  if (!trimmed) return { items: [], ok: true };
  const tokens = trimmed.split(/\s*\+\s*/).filter(Boolean);
  const items = [];
  for (const token of tokens) {
    const m = CHAIN_TOKEN.exec(token.trim());
    if (!m) return { items: [], ok: false };
    const [, name, raw] = m;
    if (raw === undefined) items.push({ name: name.trim() });
    else items.push({ name: name.trim(), value: numeric(raw.trim()) });
  }
  return { items, ok: true };
}

/** One creature's printed `attacks` field → attack child entities, or `undefined` on any line it can't fit. */
export function parseAttacks(field, idFor = () => newId('atk')) {
  const out = [];
  for (const line of String(field ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bandMatch = BAND_LINE.exec(trimmed);
    if (!bandMatch) return undefined;
    const band = bandMatch[1].trim();
    if (!BANDS.includes(band)) return undefined;
    for (const part of bandMatch[2].split(' · ')) {
      const entry = ATTACK_ENTRY.exec(part.trim());
      if (!entry) return undefined;
      const [, rawName, aoe, cost, unit, effectRaw] = entry;
      if (unit.trim().toLowerCase() !== 'grit') return undefined;
      const effect = effectRaw.trim();
      const poolMatch = POOL_DAMAGE.exec(effect);
      const damage = poolMatch ? poolMatch[1] : undefined;
      const rest = poolMatch ? effect.slice(poolMatch[0].length) : effect;
      const { items, ok } = parseChain(rest);
      if (!ok) return undefined;
      const piercing = items.find((i) => i.name.toLowerCase() === 'piercing');
      const inflicts = items.filter((i) => i !== piercing);
      const profile = [
        { name: 'Band', value: band },
        { name: 'Cost', value: Number(cost) },
      ];
      if (damage) profile.push({ name: 'Damage', value: damage });
      if (aoe) profile.push({ name: 'AOE' });
      if (piercing) {
        profile.push(
          piercing.value === undefined
            ? { name: 'Piercing' }
            : { name: 'Piercing', value: piercing.value },
        );
      }
      out.push({
        id: idFor(rawName.trim()),
        name: rawName.trim(),
        type: 'attack',
        lists: { profile, inflicts },
      });
    }
  }
  return out;
}

// ------------------------------------------------------- frenzy structure
//
// What a frenzy DOES, read out of its paragraph — the mechanical common
// core and NOTHING ELSE. The shape it writes is `core/frenzy.ts`, which
// is where the semantics are documented; this is only the boundary that
// finds them in prose.
//
// It was built against a survey of a whole book's worth of frenzies, and
// the survey is the design: a large majority of them do some mix of five
// things (pay a price, rewrite one of the creature's own attacks, move a
// stat or a tolerance, hang a status on everyone in range, act as an
// attack of their own), and a long tail does something ONCE — a summon,
// a zone, an escape roll, a dice table. The tail is left alone. A
// frenzy nothing here recognises keeps its prose and gets no lists, and
// the Warden runs it, which is what the Warden was going to do anyway.
//
// Two rules govern every line below:
//
//   * THE PROSE IS NEVER EDITED. Not to fix a name the book prints
//     differently from the attack it means ("its Iron Jaw attack" beside
//     an attack printed "Iron Jaws"), not for anything. A rewrite points
//     at the attack with a REF, resolved once here, and the words stay
//     exactly as the book set them (§K).
//   * A MISS BEATS A GUESS. Every pattern is narrow, and anything that
//     doesn't fit falls through to prose rather than being approximated.
//     Structure that says the wrong number is worse than no structure:
//     the paragraph is right there either way.

/** Which counter a price is paid in — "Spending 4 Grit", "(4 Grit)". */
const COSTS = [
  /\bSpend(?:ing)?\s+(\d+)\s+([A-Z][a-z]+)\b/,
  /\bcosting\s+(\d+)\s+([A-Z][a-z]+)\b/,
  /\((\d+)\s+([A-Z][a-z]+)\)/,
];

/** "Trapped [4B]", "Piercing [3]" — a name and what it's printed at. */
const BRACKETED = /\b([A-Z][A-Za-z]+)\s*\[([^\]]+)\]/g;
/** A pool spent as damage, wherever the sentence puts it. */
const DAMAGE = /\b((?:\d+[A-Za-z])+)\s+damage\b/i;
/** A pool that ADDS to whatever was printed. */
const EXTRA = /\b(?:an?\s+)?(?:additional|extra)\s+\+?((?:\d+[A-Za-z])+)/i;
/** Which reach it happens at, in the system's own printed word. */
const REACH = /\b(?:within|up to|in a)\s+(?:a\s+)?([A-Z][a-z]+(?:'s [A-Z][a-z]+)?)\s+Range\b/;
/** Everyone at that reach, rather than one target. */
const EVERYONE = /\b(any|all|each|every|anyone|everyone)\b/i;

/**
 * A phrase that means "every attack it has", optionally narrowed to a
 * band. Plural is safe; the SINGULAR needs the gap policed, because
 * "every Hit from that attack" is one named attack being talked about
 * and not a rule over all of them — an article or a demonstrative in
 * there means the book is pointing at something.
 */
const ALL_ATTACKS =
  /\b(?:all|each|any|every|successful)\b(?:\s+(?:of\s+)?[\w-]+){0,3}?\s+attacks\b|\b(?:each|every|any)\s+(?:[\w-]+\s+){0,2}attack\b/i;
const POINTING = /\b(?:a|an|the|that|this|its|their|same|second|first)\b/i;
/** "…and all attacks by 1G" — a bump to every printed pool. */
const ATTACKS_BY = /\battacks?\s+by\s+\+?((?:\d+[A-Za-z])+)/i;
/** A rider handed to an attack by name — "has the Bang! property". */
const PROPERTY = /\bhas\s+the\s+([A-Za-z][\w!'-]*)\s+property\b/i;
/**
 * A paragraph that is a DICE TABLE, not a rule — one roll with a
 * different outcome per face. Every outcome in it reads like an effect
 * and only one of them ever happens, so the whole thing stays prose.
 */
const TABLE = /\broll\s+\d+[A-Za-z]\b[^.]{0,60}?\bto\s+(?:determine|see)\b/i;
/** A CHOICE the other side makes — "must … or take …". Not an effect. */
const CHOICE = /\bmust\b[^.]*\bor\b/i;

/** Cost, inside a rewrite — what one of its attacks now costs. */
const MOD_COSTS = [
  /\bcosts?\s+(?:only\s+)?(\d+)\s+[A-Z][a-z]+/i,
  /\bcost\s+of[^.]*?(?:reduced to|drops to|is now)\s+(\d+)/i,
  /\bcost\s+remains\s+at\s+(\d+)/i,
];
const MOD_COST_LESS = /\bcosts?\s+one\s+less\b/i;
/** "now targets anyone within Long Range" — a rewrite of its reach. */
const MOD_REACH = /\bnow\s+targets?\s+[^.]*?\b([A-Z][a-z]+)\s+Range\b/;

/** The overrides, each as [pattern, how to read it]. */
const SET_STAT = [
  /([A-Za-z][\w' ]*?)\s+(?:now\s+)?becomes\s+((?:\d+[A-Za-z])+|\d+)\b/,
  /([A-Za-z][\w' ]*?)\s+increases?\s+to\s+((?:\d+[A-Za-z])+|\d+)\b/,
];
/** "increasing its Speed from Normal to Fast" — a named rung, not a number. */
const SET_RUNG = /\bincreas(?:es|ing)\s+its\s+([A-Za-z]+)\s+from\s+[\w ]+?\s+to\s+([A-Z][a-z]+)\b/;
const ADD_STAT = [
  /\b(?:gain|grant)(?:s|ing)?\s+(?:it\s+)?\+?((?:\d+[A-Za-z])+)\s+to\s+its\s+([A-Za-z][\w' ]*?)(?:[,.]|\s+and\b|$)/,
  /([A-Za-z][\w' ]*?)\s+increases?\s+by\s+\+?((?:\d+[A-Za-z])+|\d+)\b/,
  /\bincreases?\s+its\s+([A-Za-z][\w' ]*?)\s+by\s+\+?((?:\d+[A-Za-z])+|\d+)\b/,
];
const SUBTRACT_STAT = /\bsubtract(?:s|ing)?\s+((?:\d+[A-Za-z])+)\s+from\s+its\s+([A-Za-z]+)/;
/** The tail of a list — "…, Sweep Tolerance by 1, and all attacks by 1G". */
const ALSO_TOLERANCE = /,\s*([A-Za-z]+)\s+Tolerance\s+by\s+\+?((?:\d+[A-Za-z])+|\d+)/g;
const IMMUNE = /\bimmune\s+to\s+(?:the\s+)?([^.]+?)\s+Status(?:es)?\b/i;

const DURATIONS = [
  /\bfor\s+(?:the\s+next\s+)?[\w-]+\s+rounds?(?:\s+of\s+combat)?\b/i,
  /\buntil\s+[^.]+?\s+reaches\s+0\s+[A-Za-z]+\b/i,
];

/** Sentences, near enough — the unit a finding is attributed within. */
function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.?])\s+(?=[A-Z“"(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const lower = (s) => String(s ?? '').trim().toLowerCase();
/** Singular and plural are the same name — the book pluralises loosely. */
const loose = (s) => lower(s).replace(/s$/, '');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Which of this creature's own attacks a sentence is talking about.
 *
 * Matched loosely on the last word so "Iron Jaw" finds "Iron Jaws" —
 * the ONLY place that drift is ever handled, and it is handled by
 * resolving to the attack's id. Longest name first, so "Long Web Bolt"
 * doesn't answer to "Web Bolt".
 */
export function findAttack(sentence, attacks) {
  const ordered = [...(attacks ?? [])].sort((a, b) => b.name.length - a.name.length);
  for (const attack of ordered) {
    const words = attack.name.trim().split(/\s+/);
    const last = words[words.length - 1];
    const stem = escape(last.replace(/s$/, ''));
    const pattern = [...words.slice(0, -1).map(escape), `${stem}s?`].join('\\s+');
    if (new RegExp(`(?<![A-Za-z])${pattern}(?![A-Za-z])`, 'i').test(sentence)) {
      return { id: attack.id, name: attack.name };
    }
  }
  return undefined;
}

/** A printed number or a printed pool, as the value it is. */
const value = (raw) => numeric(String(raw).trim());

/** Everything a sentence says about damage, price and statuses, unsorted. */
function findings(sentence, statuses) {
  const known = new Set((statuses ?? []).map(lower));
  const inflicts = [];
  const properties = [];
  if (!CHOICE.test(sentence)) {
    for (const [, name, printed] of sentence.matchAll(BRACKETED)) {
      const entry = { name, value: value(printed) };
      if (!statuses?.length || known.has(lower(name))) inflicts.push(entry);
      else properties.push(entry);
    }
  }
  const named = PROPERTY.exec(sentence);
  if (named) properties.push({ name: named[1] });
  const bump = EXTRA.exec(sentence) ?? ATTACKS_BY.exec(sentence);
  const damage = bump ? undefined : DAMAGE.exec(sentence)?.[1];
  const costs = MOD_COSTS.some((p) => p.test(sentence)) || MOD_COST_LESS.test(sentence);
  return {
    inflicts,
    properties,
    costs,
    reaches: MOD_REACH.test(sentence),
    ...(damage ? { damage } : {}),
    ...(bump ? { addDamage: bump[1] } : {}),
  };
}

const anyFinding = (f) =>
  f.inflicts.length > 0 ||
  f.properties.length > 0 ||
  f.costs ||
  f.reaches ||
  f.damage !== undefined ||
  f.addDamage !== undefined;

/** The reach a sentence happens at, and whether it catches everyone there. */
function reachOf(sentence) {
  const reach = REACH.exec(sentence)?.[1];
  if (!reach) return {};
  const aoe = EVERYONE.test(sentence) || /\bradius\b|\ball directions\b/i.test(sentence);
  return { band: reach, aoe };
}

/** Overrides a sentence declares, validated against what the sheet prints. */
function overrides(sentence, stats, tolerances) {
  const set = [];
  const add = [];
  const immune = [];
  const knownStat = new Map((stats ?? []).map((s) => [lower(s), s]));
  const knownTolerance = new Map((tolerances ?? []).map((s) => [lower(s), s]));

  /**
   * The stat a captured phrase names — its LAST word, because the book
   * writes "The Peril's Defense" and the possessive is not the stat.
   * A name nothing on the sheet knows is refused unless the sentence
   * spelled out that it's a tolerance: a delta with no printed base is
   * legitimate (absent is zero), a delta on a word we misread is not.
   */
  const named = (raw) => {
    const phrase = String(raw).trim();
    const tolerance = /\btolerance\b/i.test(phrase);
    const word = phrase.replace(/\s*tolerance\s*$/i, '').trim().split(/\s+/).pop() ?? '';
    if (knownStat.has(lower(word))) return knownStat.get(lower(word));
    if (knownTolerance.has(lower(word))) return knownTolerance.get(lower(word));
    if (tolerance && /^[A-Z][a-z]+$/.test(word)) return word;
    return undefined;
  };

  for (const pattern of SET_STAT) {
    const m = pattern.exec(sentence);
    const name = m && named(m[1]);
    if (name) set.push({ name, value: value(m[2]) });
  }
  const rung = SET_RUNG.exec(sentence);
  if (rung && named(rung[1])) set.push({ name: named(rung[1]), value: rung[2] });

  for (const pattern of ADD_STAT) {
    const m = pattern.exec(sentence);
    if (!m) continue;
    // The first spelling reads "+1B to its Defense"; the others read
    // "Defense by +1B". Whichever way round, the name is the one the
    // sheet knows and the value is the one that parses as printed.
    const [a, b] = [m[1], m[2]];
    const name = named(a) ?? named(b);
    const printed = named(a) ? b : a;
    if (name && !add.some((e) => e.name === name)) add.push({ name, value: value(printed) });
  }
  const down = SUBTRACT_STAT.exec(sentence);
  if (down && named(down[2])) add.push({ name: named(down[2]), value: `-${down[1]}` });

  for (const [, word, printed] of sentence.matchAll(ALSO_TOLERANCE)) {
    if (add.some((e) => lower(e.name) === lower(word))) continue;
    add.push({ name: word, value: value(printed) });
  }

  const stopped = IMMUNE.exec(sentence);
  if (stopped) {
    for (const part of stopped[1].split(/,|\band\b/)) {
      const word = part.trim();
      if (word && /^[A-Z][a-z]+$/.test(word)) immune.push({ name: word });
    }
  }
  return { set, add, immune };
}

/** A rewrite's own lists, from what a sentence found. */
function rewrite(sentence, found) {
  const set = [];
  const add = [];
  if (found.damage) set.push({ name: 'Damage', value: found.damage });
  if (found.addDamage) add.push({ name: 'Damage', value: found.addDamage });
  for (const pattern of MOD_COSTS) {
    const m = pattern.exec(sentence);
    if (m) {
      set.push({ name: 'Cost', value: Number(m[1]) });
      break;
    }
  }
  if (!set.some((e) => e.name === 'Cost') && MOD_COST_LESS.test(sentence)) {
    add.push({ name: 'Cost', value: -1 });
  }
  const reach = MOD_REACH.exec(sentence);
  if (reach) {
    set.push({ name: 'Band', value: reach[1] });
    if (EVERYONE.test(sentence)) set.push({ name: 'AOE' });
  }
  return { set, add, inflicts: found.inflicts, properties: found.properties };
}

const usedRewrite = (r) =>
  r.set.length > 0 || r.add.length > 0 || r.inflicts.length > 0 || r.properties.length > 0;

/**
 * One frenzy's paragraph → the lists and children `core/frenzy.ts` reads.
 *
 * `context` is what the CREATURE prints — its attacks (for the refs),
 * its stat and tolerance names (so an override can only ever name
 * something real), and the SYSTEM's declared statuses (so "Trapped [4B]"
 * is known to be a status and "Piercing [3]" is known not to be). None
 * of those words are spelled in this file; a different book brings
 * different ones and this reads the same.
 */
export function frenzyStructure(notes, context = {}, idFor = () => newId('mod')) {
  const { attacks = [], stats = [], tolerances = [], statuses = [] } = context;
  const text = String(notes ?? '').trim();
  const lists = {};
  const children = [];
  // A dice table is a paragraph where every effect in it is one FACE of
  // one roll. Read flat it says the frenzy does all of them at once,
  // which is the loudest possible way to be wrong.
  if (!text || TABLE.test(text)) return { lists, children };

  for (const pattern of COSTS) {
    const m = pattern.exec(text);
    if (m) {
      lists.cost = [{ name: m[2], value: Number(m[1]) }];
      break;
    }
  }

  for (const pattern of DURATIONS) {
    const m = pattern.exec(text);
    if (m) {
      lists.duration = [{ name: 'Duration', value: m[0] }];
      break;
    }
  }

  const set = [];
  const add = [];
  const immune = [];
  const inflicts = [];
  const profile = [];
  /** The attack the paragraph is still talking about, sentence to sentence. */
  let sticky;

  for (const sentence of sentences(text)) {
    const over = overrides(sentence, stats, tolerances);
    set.push(...over.set);
    add.push(...over.add);
    immune.push(...over.immune);

    const found = findings(sentence, statuses);
    const named = findAttack(sentence, attacks);
    if (named) sticky = named;

    // Every attack it has — the book says so out loud, so nothing is
    // inferred from a missing name.
    const all = ALL_ATTACKS.exec(sentence);
    // Plural says "every one of them" on its own. Singular has to prove
    // it isn't pointing at one attack the sentence already named.
    const gap = all ? all[0].replace(/^\S+\s*/, '').replace(/\s*attacks?\b.*$/i, '') : '';
    const everyOne = all && (/attacks\b/i.test(all[0]) || !POINTING.test(gap));
    if (everyOne && anyFinding(found)) {
      const parts = rewrite(sentence, found);
      // "each of its melee attacks" — the same band word an attack line
      // prints, however the sentence happens to case it.
      const band =
        REACH.exec(all[0])?.[1] ??
        new RegExp(`\\b(${BANDS.join('|')})\\b`, 'i').exec(all[0])?.[1];
      children.push({
        id: idFor('all'),
        name: all[0].trim(),
        type: 'modifies',
        lists: {
          ...(band ? { profile: [{ name: 'Band', value: band }] } : {}),
          ...(parts.set.length ? { set: parts.set } : {}),
          ...(parts.add.length ? { add: parts.add } : {}),
          ...(parts.inflicts.length ? { inflicts: parts.inflicts } : {}),
          ...(parts.properties.length ? { properties: parts.properties } : {}),
        },
      });
      continue;
    }

    // One of its own attacks, rewritten. `sticky` carries the name over
    // a sentence break — a book writes "The lobster's Crusher Claw grows
    // bigger. It now deals…" and the second sentence means the first.
    const aimed = named ?? sticky;
    if (aimed && anyFinding(found)) {
      const parts = rewrite(sentence, found);
      if (usedRewrite(parts)) {
        children.push({
          id: idFor(aimed.name),
          name: aimed.name,
          type: 'modifies',
          lists: {
            ...(parts.set.length ? { set: parts.set } : {}),
            ...(parts.add.length ? { add: parts.add } : {}),
            ...(parts.inflicts.length ? { inflicts: parts.inflicts } : {}),
            ...(parts.properties.length ? { properties: parts.properties } : {}),
          },
          refs: { attack: aimed },
        });
        continue;
      }
    }

    // Otherwise the frenzy is the thing acting, and what it found is its
    // own — a status on everyone in range, a pool it throws itself.
    if (found.inflicts.length || found.damage) {
      inflicts.push(...found.inflicts);
      const { band, aoe } = reachOf(sentence);
      if (band && !profile.some((e) => e.name === 'Band')) profile.push({ name: 'Band', value: band });
      if (aoe && !profile.some((e) => e.name === 'AOE')) profile.push({ name: 'AOE' });
      if (found.damage && !profile.some((e) => e.name === 'Damage')) {
        profile.push({ name: 'Damage', value: found.damage });
      }
    }
  }

  if (set.length) lists.set = set;
  if (add.length) lists.add = add;
  if (immune.length) lists.immune = immune;
  if (inflicts.length) lists.inflicts = inflicts;
  // A reach on its own says nothing worth storing — it's the price of
  // the sentence that carried the status, not an action of its own.
  if (profile.length && (inflicts.length || profile.some((e) => e.name === 'Damage'))) {
    lists.profile = profile;
  }
  // How long a thing lasts, with no thing to time, is noise: it means
  // the paragraph said something this can't read, and the honest answer
  // to that is the paragraph.
  const only = Object.keys(lists);
  if (!children.length && only.every((k) => k === 'duration')) return { lists: {}, children };
  return { lists, children };
}

/** The printed `Tolerances` field → a plain list of entries (§I) — "None" prints as none at all. */
export function parseTolerances(field) {
  const text = String(field ?? '').trim();
  if (!text || /^none$/i.test(text)) return [];
  const out = [];
  for (const part of text.split(',')) {
    const m = /^(.+?)\s*\[([^\]]+)\]\s*$/.exec(part.trim());
    if (!m) return undefined;
    out.push({ name: m[1].trim(), value: numeric(m[2].trim()) });
  }
  return out;
}
