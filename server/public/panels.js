// The .panel renderer — §E, settled.
//
// A `.panel` declares an ARRANGEMENT: two authored block lists
// (`mounted` / `held` — never one responsive layout; the assignment
// decides which family of glass a screen is), where every block is a
// noun. Layout + components only, never control flow. The floor (§7's
// value-shape grammar) is the default presentation — `as: 'auto'` —
// and declarations only dress it.
//
// Degradation, out loud: a block kind this build doesn't know renders
// as a labeled refusal; a panel that fails entirely falls back to the
// floor; a subject-entity panel with no entity says so. Nothing blank,
// nothing silent.
//
// ctx: { stored, reads, stack: {statuses, kinds}, writeEntry,
//        saveStored, tools: {name → render()}, floor }

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node[k] = v;
  }
  node.append(...children);
  return node;
}

const sameName = (a, b) =>
  String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// ------------------------------------------------------------ presentations

/** §7's grammar — the floor presentation every `as` defaults to. */
function autoRow(list, entry, writeEntry) {
  const touch = (patch) => writeEntry({ list, name: entry.name, ...patch });

  if (entry.value === undefined && entry.max === undefined) {
    return el(
      'span',
      { class: 'chip' },
      entry.name,
      el('span', { class: 'x', title: 'remove', onclick: () => touch({ remove: true }) }, '×'),
    );
  }
  const name = el('span', { class: 'entry-name' }, entry.name);
  if (typeof entry.value === 'string') {
    return el(
      'div',
      { class: 'row' },
      name,
      el('input', { value: entry.value, onchange: (e) => touch({ value: e.target.value }) }),
    );
  }
  const value = typeof entry.value === 'number' ? entry.value : 0;
  const minus = el('button', { title: '−1', onclick: () => touch({ value: value - 1 }) }, '−');
  const plus = el('button', { title: '+1', onclick: () => touch({ value: value + 1 }) }, '+');
  if (typeof entry.max === 'number' && entry.max > 0) {
    const fill = el('div', { class: 'fill' });
    fill.style.width = `${Math.max(0, Math.min(100, (value / entry.max) * 100))}%`;
    return el(
      'div',
      { class: 'row' },
      name,
      minus,
      el('div', { class: 'bar' }, fill, el('div', { class: 'cap' }, `${value} / ${entry.max}`)),
      plus,
    );
  }
  return el('div', { class: 'row' }, name, minus, el('span', { class: 'num' }, String(value)), plus);
}

function skillRow(list, entry, writeEntry, ctx) {
  const die = el('input', {
    class: 'skill-die',
    value: entry.value ?? '',
    onchange: (e) => writeEntry({ list, name: entry.name, value: e.target.value }),
  });
  if (ctx?.accent) die.style.color = ctx.accent;
  return el(
    'div',
    { class: 'skill-row' },
    el('span', { class: 'skill-name' }, entry.name),
    die,
  );
}

function bigCounter(list, entry, writeEntry, ctx) {
  const value = typeof entry.value === 'number' ? entry.value : 0;
  const touch = (next) => writeEntry({ list, name: entry.name, value: next });
  const box = el('div', { class: 'vital' });
  box.append(
    el('div', { class: 'vital-name' }, entry.name),
    el(
      'div',
      { class: 'vital-row' },
      el('button', { class: 'big', onclick: () => touch(value - 1) }, '−'),
      el(
        'div',
        { class: 'vital-value' },
        String(value),
        typeof entry.max === 'number' ? el('span', { class: 'vital-max' }, ` / ${entry.max}`) : '',
      ),
      el('button', { class: 'big', onclick: () => touch(value + 1) }, '+'),
    ),
  );
  if (typeof entry.max === 'number' && entry.max > 0) {
    const fill = el('div', { class: 'fill' });
    fill.style.width = `${Math.max(0, Math.min(100, (value / entry.max) * 100))}%`;
    if (ctx?.accent) fill.style.background = ctx.accent;
    box.append(el('div', { class: 'bar wide' }, fill));
  }
  return box;
}

function ledgerRow(list, entry, writeEntry) {
  const value = typeof entry.value === 'number' ? entry.value : 0;
  return el(
    'div',
    { class: 'ledger-row' },
    el('span', { class: 'entry-name' }, entry.name),
    el('button', { onclick: () => writeEntry({ list, name: entry.name, value: value - 1 }) }, '−'),
    el('span', { class: 'num' }, String(value)),
    el('button', { onclick: () => writeEntry({ list, name: entry.name, value: value + 1 }) }, '+'),
  );
}

function chipRow(list, entry, writeEntry) {
  return el(
    'span',
    { class: 'chip' },
    entry.name,
    el(
      'span',
      { class: 'x', title: 'remove', onclick: () => writeEntry({ list, name: entry.name, remove: true }) },
      '×',
    ),
  );
}

function traitRow(list, entry) {
  return el('div', { class: 'trait' }, el('div', { class: 'trait-name' }, entry.name), String(entry.value ?? ''));
}

/**
 * The revolver — `dials: { Grit: 'cylinder' }` made real. Chambers are
 * the max, loaded ones are the value; spending one rotates the
 * cylinder a step before the write lands. Pure presentation: the value
 * is the same stored number every other control edits.
 */
function cylinder(list, entry, writeEntry, ctx) {
  const max = Math.max(2, Math.min(12, typeof entry.max === 'number' ? entry.max : 6));
  const value = Math.max(0, typeof entry.value === 'number' ? entry.value : 0);
  const step = 360 / max;
  const accent = ctx?.accent ?? '#f59e0b';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'cylinder');
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('class', 'cylinder-drum');
  group.style.transform = `rotate(${(max - value) * step}deg)`;
  const frame = document.createElementNS(NS, 'circle');
  frame.setAttribute('cx', '50');
  frame.setAttribute('cy', '50');
  frame.setAttribute('r', '46');
  frame.setAttribute('class', 'cylinder-frame');
  svg.append(frame, group);
  for (let i = 0; i < max; i++) {
    const angle = ((i * step - 90) * Math.PI) / 180;
    const chamber = document.createElementNS(NS, 'circle');
    chamber.setAttribute('cx', String(50 + 30 * Math.cos(angle)));
    chamber.setAttribute('cy', String(50 + 30 * Math.sin(angle)));
    chamber.setAttribute('r', '10');
    chamber.setAttribute('class', i < value ? 'chamber loaded' : 'chamber');
    if (i < value) chamber.style.fill = accent;
    group.append(chamber);
  }
  const pin = document.createElementNS(NS, 'circle');
  pin.setAttribute('cx', '50');
  pin.setAttribute('cy', '50');
  pin.setAttribute('r', '7');
  pin.setAttribute('class', 'cylinder-pin');
  svg.append(pin);

  const spend = (delta) => {
    // Turn the drum first — the table hears the click — then write.
    const next = value + delta;
    group.style.transform = `rotate(${(max - next) * step}deg)`;
    setTimeout(() => writeEntry({ list, name: entry.name, value: next }), 220);
  };
  return el(
    'div',
    { class: 'vital' },
    el('div', { class: 'vital-name' }, entry.name),
    el(
      'div',
      { class: 'vital-row' },
      el('button', { class: 'big', title: 'spend one', onclick: () => spend(-1) }, '−'),
      el(
        'div',
        { class: 'cylinder-box' },
        svg,
        el('div', { class: 'cylinder-count' }, `${value} / ${typeof entry.max === 'number' ? entry.max : max}`),
      ),
      el('button', { class: 'big', title: 'reload one', onclick: () => spend(+1) }, '+'),
    ),
  );
}

const AS = {
  auto: autoRow,
  chips: chipRow,
  rows: skillRow,
  big: bigCounter,
  ledger: ledgerRow,
  cylinder,
};

function presentation(entry, as, ctx) {
  // The system's dial for this NAME beats the arrangement's generic
  // word — the system knows Grit is a cylinder; the panel only knows
  // it wanted something big. An unknown dial word falls through.
  const dial = ctx?.stack?.dials?.[entry.name];
  if (dial && AS[dial]) return AS[dial];
  if (as && AS[as]) return AS[as];
  // auto with one nicety: long prose values read as traits, not inputs.
  if (typeof entry.value === 'string' && entry.value.length > 40) return traitRow;
  return autoRow;
}

// ------------------------------------------------------------ blocks

function addEntry(list, writeEntry) {
  return el(
    'button',
    {
      class: 'add',
      onclick: () => {
        const name = prompt('name?');
        if (!name || !name.trim()) return;
        const raw = (prompt('value? (blank = held, number = count, words = text)') ?? '').trim();
        const edit = { list, name: name.trim() };
        if (raw) {
          const asNumber = Number(raw);
          edit.value = Number.isFinite(asNumber) ? asNumber : raw;
        }
        writeEntry(edit);
      },
    },
    '+ add',
  );
}

function listBlock(b, ctx, listName, entries) {
  const filtered = entries.filter((e) => {
    if (b.filter === 'capped') return typeof e.max === 'number' && e.max > 0;
    if (b.filter === 'uncapped') return !(typeof e.max === 'number' && e.max > 0);
    return true;
  });
  const out = [el('h2', {}, b.label ?? listName)];
  for (const entry of filtered) {
    out.push(presentation(entry, b.as, ctx)(listName, entry, ctx.writeEntry, ctx));
  }
  if (!b.filter) out.push(addEntry(listName, ctx.writeEntry));
  return out;
}

const BLOCKS = {
  header(b, ctx) {
    const reads = ctx.reads;
    const meta = reads.lists?.meta ?? [];
    const head = el(
      'header',
      { class: 'sheet-head' },
      el('input', {
        class: 'sheet-name',
        value: reads.name,
        onchange: (e) => {
          ctx.stored.name = e.target.value.trim() || ctx.stored.name;
          ctx.saveStored(ctx.stored);
        },
      }),
      el(
        'div',
        { class: 'sheet-sub dim' },
        reads.type ? el('span', { class: 'sheet-type' }, reads.type) : '',
        ...meta.map((m) => el('span', {}, ` · ${m.name}: ${m.value ?? ''}`)),
        reads.refs?.from ? el('span', {}, ` · from ${reads.refs.from.name}`) : '',
      ),
    );
    // The system's color for this type (accents) — identity from the
    // stack, not the stylesheet.
    if (ctx.accent) {
      head.style.borderBottomColor = `${ctx.accent}66`;
      const type = head.querySelector('.sheet-type');
      if (type) type.style.color = ctx.accent;
    }
    // And its face, when the pack brought one (record 'portraits').
    const portrait = reads.type ? ctx.stack?.portraits?.[reads.type] : undefined;
    if (portrait && ctx.fileUrl) {
      const img = el('img', { class: 'portrait', alt: '' });
      if (ctx.accent) img.style.borderColor = `${ctx.accent}88`;
      ctx.fileUrl(portrait).then((url) => {
        if (url) img.src = url;
      });
      head.append(img);
      head.classList.add('with-portrait');
    }
    return [head];
  },

  /** The system's mark, when a pack brought one (record 'brand'). */
  brand(b, ctx) {
    const logo = ctx.stack?.brand?.logo;
    if (!logo || !ctx.fileUrl) return [];
    const img = el('img', { class: 'brand-logo', alt: '' });
    ctx.fileUrl(logo).then((url) => {
      if (url) img.src = url;
    });
    return [img];
  },

  columns(b, ctx) {
    const wrap = el('div', { class: 'sheet-cols mounted' });
    for (const column of Array.isArray(b.columns) ? b.columns : []) {
      const col = el('div', { class: 'sheet-col' });
      for (const inner of column) col.append(...renderBlock(inner, ctx));
      wrap.append(col);
    }
    return [wrap];
  },

  list(b, ctx) {
    const listName = String(b.list ?? '');
    const entries = ctx.reads.lists?.[listName];
    if (!entries) return []; // an absent list is absent, not an error
    return listBlock(b, ctx, listName, entries);
  },

  rest(b, ctx) {
    const except = Array.isArray(b.except) ? b.except.map(String) : [];
    const out = [];
    for (const [listName, entries] of Object.entries(ctx.reads.lists ?? {})) {
      if (except.some((x) => sameName(x, listName))) continue;
      out.push(...listBlock({ block: 'list' }, ctx, listName, entries));
    }
    return out;
  },

  /** The system's whole list with a severity box each — a menu of what
      can happen to you, not a report of what has. */
  statuses(b, ctx) {
    const statuses = ctx.stack?.statuses ?? [];
    if (!statuses.length) return [];
    const kinds = ctx.stack?.kinds ?? [];
    const conditionsKind = kinds.find((k) => sameName(k.name, 'conditions'));
    const cap = conditionsKind?.domain?.cap;
    const held = ctx.reads.lists?.conditions ?? [];
    const out = [el('h2', {}, (conditionsKind?.label ?? 'Conditions').toLowerCase())];
    for (const status of statuses) {
      const mine = held.find((e) => sameName(e.name, status.name));
      const severity = typeof mine?.value === 'number' ? mine.value : mine ? 1 : 0;
      const touch = (next) => ctx.writeEntry({ list: 'conditions', name: status.name, value: next });
      out.push(
        el(
          'div',
          { class: `status-row${severity ? ' held' : ''}` },
          el(
            'span',
            { class: 'status-name', title: status.relief ? `relieved by ${status.relief}` : '' },
            status.name,
          ),
          status.relief ? el('span', { class: 'status-relief dim' }, status.relief) : '',
          el('button', { onclick: () => touch(severity - 1) }, '−'),
          el(
            'span',
            { class: 'status-severity' },
            severity ? String(severity) : '·',
            status.uncapped !== true && typeof cap === 'number' && severity
              ? el('span', { class: 'dim' }, `/${cap}`)
              : '',
          ),
          el('button', { onclick: () => touch(severity + 1) }, '+'),
        ),
      );
    }
    return out;
  },

  notes(b, ctx) {
    return [
      el('h2', {}, 'notes'),
      el('textarea', {
        value: ctx.stored.notes ?? '',
        onchange: (e) => {
          const notes = e.target.value;
          if (notes.trim()) ctx.stored.notes = notes;
          else delete ctx.stored.notes;
          ctx.saveStored(ctx.stored);
        },
      }),
    ];
  },

  children(b, ctx) {
    const kids = ctx.stored?.children ?? [];
    return kids.map((child) => {
      const block = el('div', { class: 'child' });
      // Children render on the floor — stored values, whole-entity save.
      block.append(ctx.floor(child));
      return block;
    });
  },

  /** §7 itself, as a block — the degradation target made addressable. */
  floor(b, ctx) {
    return [ctx.floor(ctx.stored)];
  },

  tool(b, ctx) {
    const name = String(b.tool ?? '');
    const render = ctx.tools?.[name];
    if (!render) {
      return [el('p', { class: 'missing' }, `this build has no tool '${name}'`)];
    }
    const mount = el('div', { class: `tool tool-${name}` }, 'loading…');
    Promise.resolve(render(mount)).catch((err) => {
      mount.replaceChildren(el('p', { class: 'missing' }, String(err)));
    });
    return [mount];
  },
};

function renderBlock(b, ctx) {
  const kind = BLOCKS[b.block];
  if (!kind) {
    // Refused out loud — the registry posture, applied to arrangement.
    return [el('p', { class: 'missing dim' }, `this build doesn't know the block '${b.block}'`)];
  }
  try {
    return kind(b, ctx);
  } catch (err) {
    return [el('p', { class: 'missing' }, `block '${b.block}' failed: ${String(err)}`)];
  }
}

/**
 * One panel, on one family of glass. Picks the authored arrangement
 * for `glass` ('mounted' | 'held'), falling back to the other, falling
 * back to the floor.
 */
export function renderPanelDef(def, glass, ctx) {
  const blocks = def?.[glass] ?? def?.[glass === 'mounted' ? 'held' : 'mounted'];
  const root = el('div', { class: `panel-surface glass-${glass}` });
  if (def?.subject === 'entity' && !ctx.reads) {
    root.append(el('p', { class: 'missing' }, `'${def.name}' arranges an entity, and no entity is assigned`));
    return root;
  }
  if (!Array.isArray(blocks) || !blocks.length) {
    if (ctx.stored) root.append(ctx.floor(ctx.stored));
    else root.append(el('p', { class: 'missing' }, `'${def?.name ?? '?'}' has nothing to arrange here`));
    return root;
  }
  try {
    for (const b of blocks) root.append(...renderBlock(b, ctx));
  } catch (err) {
    root.replaceChildren(
      el('p', { class: 'missing' }, `panel failed (${String(err)}) — the floor instead:`),
      ctx.stored ? ctx.floor(ctx.stored) : '',
    );
  }
  return root;
}
