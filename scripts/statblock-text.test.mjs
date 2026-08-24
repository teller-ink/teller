// The boundary parse, held to the shapes a real book prints.
//
// Every fixture here is invented — a repo test carries nobody's book
// (rule 4) — but the GRAMMAR is the one the WiW pack writes, which is
// the thing that has to keep working when the converter runs again.

import { describe, expect, it } from 'vitest';
import {
  aboutFromNotes,
  findAttack,
  frenzyChildren,
  frenzyStructure,
  namedBlocks,
  namedEntries,
  parseAttacks,
  parseGate,
  parseTolerances,
} from './statblock-text.mjs';

describe('namedBlocks', () => {
  it('splits a line into its announced name and its words', () => {
    expect(namedBlocks('Quick Step. It moves first.')).toEqual([
      { name: 'Quick Step', text: 'It moves first.' },
    ]);
  });

  it('keeps a line that announces no name', () => {
    expect(namedBlocks('it simply lumbers about')).toEqual([
      { text: 'it simply lumbers about' },
    ]);
  });

  it('reads one block per line, blanks dropped', () => {
    const blocks = namedBlocks('One. First words.\n\nTwo. Second words.');
    expect(blocks.map((b) => b.name)).toEqual(['One', 'Two']);
  });
});

describe('parseGate', () => {
  it('pulls the threshold and the counter it watches out of the name', () => {
    expect(parseGate('Guillotine (30 Health)')).toEqual({
      name: 'Guillotine',
      gate: { name: 'Health', value: 30 },
    });
  });

  it('leaves an ungated name alone', () => {
    expect(parseGate('Guillotine')).toEqual({ name: 'Guillotine' });
  });

  it('does not mistake prose parentheses for a gate', () => {
    expect(parseGate('Second Wind (once a day)')).toEqual({
      name: 'Second Wind (once a day)',
    });
  });
});

describe('namedEntries', () => {
  it('gives every named thing its own entry, prose as the value', () => {
    expect(namedEntries('Alpha. First.\nBeta. Second.')).toEqual([
      { name: 'Alpha', value: 'First.' },
      { name: 'Beta', value: 'Second.' },
    ]);
  });

  it('refuses the whole field when a line announces no name', () => {
    expect(namedEntries('Alpha. First.\nno name here')).toBeUndefined();
  });

  it('an empty field is no entries, not a failure', () => {
    expect(namedEntries('')).toEqual([]);
  });
});

describe('frenzyChildren', () => {
  const ids = () => 'frz_test';

  it('structures the threshold and keeps the words in notes', () => {
    expect(frenzyChildren('Guillotine (30 Health). It bites clean through.', ids)).toEqual([
      {
        id: 'frz_test',
        name: 'Guillotine',
        type: 'frenzy',
        lists: { gate: [{ name: 'Health', value: 30 }] },
        notes: 'It bites clean through.',
      },
    ]);
  });

  it('keeps an ungated frenzy — the words are still the ability', () => {
    const [only] = frenzyChildren('Last Stand. It stops running.', ids);
    expect(only.lists).toEqual({});
    expect(only.notes).toBe('It stops running.');
  });

  it('refuses the whole field when a line announces no name', () => {
    expect(frenzyChildren('it thrashes wildly', ids)).toBeUndefined();
  });
});

describe('aboutFromNotes', () => {
  it('lifts the labelled sections out of the prefixed blob', () => {
    const { about, notes } = aboutFromNotes(
      'Description: a big one.\n\nBehavior: it waits.',
    );
    expect(about).toEqual([
      { name: 'Description', value: 'a big one.' },
      { name: 'Behavior', value: 'it waits.' },
    ]);
    expect(notes).toBe('');
  });

  it("leaves a table's own note alone", () => {
    const { about, notes } = aboutFromNotes(
      'Description: a big one.\n\nBrian rules it swims at Fast.',
    );
    expect(about).toHaveLength(1);
    expect(notes).toBe('Brian rules it swims at Fast.');
  });

  it('nothing labelled is nothing lifted', () => {
    expect(aboutFromNotes('just a note')).toEqual({
      about: [],
      notes: 'just a note',
    });
  });
});

describe('parseAttacks', () => {
  const ids = (name) => `atk_${name.toLowerCase().replace(/\W+/g, '_')}`;

  it('reads a band line into its attacks', () => {
    expect(
      parseAttacks('Melee — Bite (3 Grit): 2B2G damage + Dazed [2]', ids),
    ).toEqual([
      {
        id: 'atk_bite',
        name: 'Bite',
        type: 'attack',
        lists: {
          profile: [
            { name: 'Band', value: 'Melee' },
            { name: 'Cost', value: 3 },
            { name: 'Damage', value: '2B2G' },
          ],
          inflicts: [{ name: 'Dazed', value: 2 }],
        },
      },
    ]);
  });

  it('marks AOE and lifts Piercing out of the chain', () => {
    const [attack] = parseAttacks('Long — Wail (4 Grit): 1B damage + Piercing + Afraid [2B]', ids);
    expect(attack.lists.profile).toContainEqual({ name: 'Piercing' });
    expect(attack.lists.inflicts).toEqual([{ name: 'Afraid', value: '2B' }]);
  });

  it('refuses a line that names no band', () => {
    expect(parseAttacks('Bite (3 Grit): 2B damage', ids)).toBeUndefined();
  });
});

describe('parseTolerances', () => {
  it('reads each printed severity, number or pool', () => {
    expect(parseTolerances('Sweep [4], Afraid [3G]')).toEqual([
      { name: 'Sweep', value: 4 },
      { name: 'Afraid', value: '3G' },
    ]);
  });

  it('"None" prints as none at all', () => {
    expect(parseTolerances('None')).toEqual([]);
  });

  it('refuses a part with no printed severity', () => {
    expect(parseTolerances('Sweep [4], Afraid')).toBeUndefined();
  });
});

// --------------------------------------------------------------- frenzies
//
// What a frenzy DOES. Every creature and every sentence below is
// invented — the repo carries nobody's book (rule 4) — but each one is
// written in the grammar a real book uses for that category, because
// the categories came from surveying one.

const context = {
  attacks: [
    { id: 'atk_jaws', name: 'Iron Jaws' },
    { id: 'atk_claws', name: 'Opposable Claws' },
    { id: 'atk_wail', name: 'Wail' },
  ],
  stats: ['Defense', 'Speed', 'Size'],
  tolerances: ['Shock', 'Afraid'],
  statuses: ['Afraid', 'Burned', 'Dazed', 'Shocked', 'Trapped'],
};
const ids = (name) => `mod_${name}`;
const read = (text) => frenzyStructure(text, context, ids);

describe('frenzyStructure — the price', () => {
  it('reads what spending it costs, in the counter the book names', () => {
    expect(read('Spending 4 Grit, it thrashes.').lists.cost).toEqual([
      { name: 'Grit', value: 4 },
    ]);
    expect(read('It lunges, dealing 8G damage (3 Grit).').lists.cost).toEqual([
      { name: 'Grit', value: 3 },
    ]);
  });
});

describe('frenzyStructure — rewriting one of its own attacks', () => {
  it('points at the sibling with a ref and sets the new pool', () => {
    const { children } = read('Its Iron Jaws attack now does 6B6G damage.');
    expect(children).toEqual([
      {
        id: 'mod_Iron Jaws',
        name: 'Iron Jaws',
        type: 'modifies',
        lists: { set: [{ name: 'Damage', value: '6B6G' }] },
        refs: { attack: { id: 'atk_jaws', name: 'Iron Jaws' } },
      },
    ]);
  });

  it('resolves a name the book prints singular, and never edits the words', () => {
    const text = 'Its Iron Jaw attack now does 6B6G damage.';
    const { children } = read(text);
    expect(children[0].refs.attack.id).toBe('atk_jaws');
    // The ref carries the link; the prose is left exactly as printed.
    expect(text).toContain('Iron Jaw attack');
  });

  it('carries the named attack across a sentence break', () => {
    const { children } = read(
      "The beast's Opposable Claws grow bigger. It now deals 4B6G damage + Dazed [4] while the Grit cost remains at 4.",
    );
    expect(children[0].refs.attack.id).toBe('atk_claws');
    expect(children[0].lists.set).toEqual([
      { name: 'Damage', value: '4B6G' },
      { name: 'Cost', value: 4 },
    ]);
    expect(children[0].lists.inflicts).toEqual([{ name: 'Dazed', value: 4 }]);
  });

  it('reads a cheaper price, a bumped pool, and a rider by name', () => {
    expect(read('Its Wail attack now costs only 2 Grit.').children[0].lists.set).toEqual([
      { name: 'Cost', value: 2 },
    ]);
    expect(
      read('When it uses its Wail attack, roll with an additional +2G.').children[0].lists.add,
    ).toEqual([{ name: 'Damage', value: '2G' }]);
    expect(
      read('Its Wail attack now has the Loud! property applied.').children[0].lists.properties,
    ).toEqual([{ name: 'Loud!' }]);
  });

  it('files a bracketed name the system never declared as a rider, not a status', () => {
    const { children } = read('Its Wail attack now does Piercing [3].');
    expect(children[0].lists.properties).toEqual([{ name: 'Piercing', value: 3 }]);
    expect(children[0].lists.inflicts).toBeUndefined();
  });

  it('leaves an attack it merely mentions alone', () => {
    expect(read('It can no longer use its Wail attack.')).toEqual({ lists: {}, children: [] });
  });
});

describe('frenzyStructure — rewriting every attack', () => {
  it('says all of them by carrying no ref at all', () => {
    const [mod] = read('Now all of its attacks cost one less Grit.').children;
    expect(mod.refs).toBeUndefined();
    expect(mod.lists.add).toEqual([{ name: 'Cost', value: -1 }]);
  });

  it('narrows to a band when the book names one', () => {
    const [mod] = read('Each of its melee attacks also inflict Burned [1].').children;
    expect(mod.refs).toBeUndefined();
    expect(mod.lists.profile).toEqual([{ name: 'Band', value: 'melee' }]);
    expect(mod.lists.inflicts).toEqual([{ name: 'Burned', value: 1 }]);
  });

  it('bumps every printed pool', () => {
    const [mod] = read('It increases all attacks by 1G.').children;
    expect(mod.lists.add).toEqual([{ name: 'Damage', value: '1G' }]);
  });

  it('is not fooled by a singular pointing back at one named attack', () => {
    const { children } = read(
      'The next Iron Jaws attack does 6B damage and it heals one point for every Hit from that attack.',
    );
    expect(children).toHaveLength(1);
    expect(children[0].refs.attack.id).toBe('atk_jaws');
  });
});

describe('frenzyStructure — moving a stat or a tolerance', () => {
  it('tells an absolute from a delta, because the book prints both', () => {
    expect(read("The beast's Defense becomes 2G.").lists.set).toEqual([
      { name: 'Defense', value: '2G' },
    ]);
    expect(read("The beast's Defense increases to 2G.").lists.set).toEqual([
      { name: 'Defense', value: '2G' },
    ]);
    expect(read('It gains +2B to its Defense.').lists.add).toEqual([
      { name: 'Defense', value: '2B' },
    ]);
    expect(read("The beast's Defense increases by +1B.").lists.add).toEqual([
      { name: 'Defense', value: '1B' },
    ]);
  });

  it('reads a subtraction as the negative delta it is', () => {
    const { lists } = read('It sheds its shell, subtracting 2B from its Defense.');
    expect(lists.add).toEqual([{ name: 'Defense', value: '-2B' }]);
  });

  it('takes a named rung as an absolute', () => {
    expect(read('It grows, increasing its Speed from Normal to Fast.').lists.set).toEqual([
      { name: 'Speed', value: 'Fast' },
    ]);
  });

  it('takes a tolerance the sheet never printed — an absent base is zero', () => {
    expect(read('Its Sweep Tolerance increases by 2.').lists.add).toEqual([
      { name: 'Sweep', value: 2 },
    ]);
  });

  it('refuses a word the sheet has no stat or tolerance for', () => {
    expect(read('Its reputation increases by 2.').lists.add).toBeUndefined();
  });

  it('collects what it stops taking', () => {
    expect(read('It becomes Immune to the Afraid, Dazed, and Burned Statuses.').lists.immune).toEqual([
      { name: 'Afraid' },
      { name: 'Dazed' },
      { name: 'Burned' },
    ]);
  });

  it('reads a whole list of them out of one sentence', () => {
    const { lists, children } = read(
      'It increases its Defense by +1G, Sweep Tolerance by 1, and all attacks by 1G.',
    );
    expect(lists.add).toEqual([
      { name: 'Defense', value: '1G' },
      { name: 'Sweep', value: 1 },
    ]);
    expect(children[0].lists.add).toEqual([{ name: 'Damage', value: '1G' }]);
  });
});

describe('frenzyStructure — the frenzy acting on its own', () => {
  it('hangs a status on everyone at the reach the book names', () => {
    const { lists } = read('Any target within Short Range becomes Trapped [4B] in thick mud.');
    expect(lists.inflicts).toEqual([{ name: 'Trapped', value: '4B' }]);
    expect(lists.profile).toEqual([{ name: 'Band', value: 'Short' }, { name: 'AOE' }]);
  });

  it('is an attack of its own when it throws a pool', () => {
    const { lists } = read(
      'Spending 4 Grit, it bolts. Any target within Long Range takes 2G damage + Shocked [3].',
    );
    expect(lists.cost).toEqual([{ name: 'Grit', value: 4 }]);
    expect(lists.inflicts).toEqual([{ name: 'Shocked', value: 3 }]);
    expect(lists.profile).toEqual([
      { name: 'Band', value: 'Long' },
      { name: 'AOE' },
      { name: 'Damage', value: '2G' },
    ]);
  });

  it('keeps how long it lasts in the book’s own words', () => {
    const { lists } = read(
      'Any target within Short Range is Burned [2B]. The ground burns for the next two rounds.',
    );
    expect(lists.duration).toEqual([{ name: 'Duration', value: 'for the next two rounds' }]);
  });

  it('will not store a reach with nothing happening at it', () => {
    expect(read('It leaps at a target within Short Range.')).toEqual({ lists: {}, children: [] });
  });
});

describe('frenzyStructure — what it refuses to structure', () => {
  it('leaves a dice table entirely alone — only one face ever happens', () => {
    expect(
      read('Roll 1G to determine the outcome. Blank: 6G damage, Hit: Dazed [6B], Ace: Burned [2].'),
    ).toEqual({ lists: {}, children: [] });
  });

  it('leaves a choice the other side makes alone', () => {
    expect(
      read('Any player attacking it must convert all Gold dice to Black or immediately take Dazed [2].'),
    ).toEqual({ lists: {}, children: [] });
  });

  it('drops a duration with nothing to time — it means it read nothing', () => {
    expect(read('Every target nearby is overwhelmed for two rounds of combat.')).toEqual({
      lists: {},
      children: [],
    });
  });

  it('gives a paragraph it cannot read no lists at all', () => {
    expect(read('It taps the ground, and more of its kind answer the call.')).toEqual({
      lists: {},
      children: [],
    });
  });
});

describe('findAttack', () => {
  it('prefers the longest name, so a short one does not answer for it', () => {
    const attacks = [
      { id: 'atk_bolt', name: 'Web Bolt' },
      { id: 'atk_long', name: 'Long Web Bolt' },
    ];
    expect(findAttack('Its Long Web Bolt attack changes.', attacks).id).toBe('atk_long');
  });

  it('is nothing when the sentence names none of them', () => {
    expect(findAttack('It simply lumbers about.', context.attacks)).toBeUndefined();
  });
});

describe('frenzyChildren with a creature to read against', () => {
  it('carries the gate, the structure and the untouched prose together', () => {
    const [child] = frenzyChildren(
      'Guillotine (30 Health). Its Iron Jaw attack now does 6B6G damage.',
      () => 'frz_test',
      context,
    );
    expect(child.lists.gate).toEqual([{ name: 'Health', value: 30 }]);
    expect(child.children[0].refs.attack.id).toBe('atk_jaws');
    expect(child.notes).toBe('Its Iron Jaw attack now does 6B6G damage.');
  });

  it('is the old shape exactly when nothing is handed in to read against', () => {
    const [child] = frenzyChildren('Guillotine (30 Health). It bites clean through.', () => 'frz_test');
    expect(child).toEqual({
      id: 'frz_test',
      name: 'Guillotine',
      type: 'frenzy',
      lists: { gate: [{ name: 'Health', value: 30 }] },
      notes: 'It bites clean through.',
    });
  });
});
