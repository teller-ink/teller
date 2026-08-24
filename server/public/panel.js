// The bare panel — docs/CORE-NEXT.md §7, rendered literally.
//
// The control follows the VALUE'S SHAPE, not a declaration:
//
//   {name}                    → a chip; tap × to remove, + add to create
//   {name, value: number}     → the number, with − / +
//   {name, value, max}        → a bar, capped
//   {name, value: string}     → an inline text field
//   child entity              → a titled sub-block, recursive
//   ref                       → a link chip; cached name; clear
//
// List name → heading. Entity name → title. Notes → textarea. `type` →
// an editable word. Everything writes. The one thing never rendered is
// `id`. This is the whole floor: a complete, ugly, fully-operable
// sheet with zero declarations — what a human still has when nothing
// above Core showed up.
//
// Edits mutate the entity object in place and call save(entity); the
// server stores it whole and the stored value is the authority.

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

function entryRow(list, i, save) {
  const entry = list[i];
  const remove = () => {
    list.splice(i, 1);
    save();
  };

  // {name} — a chip.
  if (entry.value === undefined && entry.max === undefined) {
    return el(
      'span',
      { class: 'chip' },
      entry.name,
      el('span', { class: 'x', title: 'remove', onclick: remove }, '×'),
    );
  }

  const name = el('span', { class: 'entry-name' }, entry.name);

  // {name, value: string} — inline text.
  if (typeof entry.value === 'string') {
    return el(
      'div',
      { class: 'row' },
      name,
      el('input', {
        value: entry.value,
        onchange: (e) => {
          entry.value = e.target.value;
          save();
        },
      }),
      el('span', { class: 'x dim', title: 'remove', onclick: remove }, '×'),
    );
  }

  // Numbers, capped or not.
  const value = typeof entry.value === 'number' ? entry.value : 0;
  const bump = (delta) => {
    entry.value = value + delta;
    save();
  };
  const minus = el('button', { title: '−1', onclick: () => bump(-1) }, '−');
  const plus = el('button', { title: '+1', onclick: () => bump(+1) }, '+');

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
      el('span', { class: 'x dim', title: 'remove', onclick: remove }, '×'),
    );
  }

  return el(
    'div',
    { class: 'row' },
    name,
    minus,
    el('span', { class: 'num' }, String(value)),
    plus,
    el('span', { class: 'x dim', title: 'remove', onclick: remove }, '×'),
  );
}

function addEntry(list, save) {
  return el(
    'button',
    {
      class: 'add',
      onclick: () => {
        const name = prompt('name?');
        if (!name || !name.trim()) return;
        const raw = prompt('value? (blank = held, number = count, words = text)') ?? '';
        const entry = { name: name.trim() };
        const trimmed = raw.trim();
        if (trimmed) {
          const asNumber = Number(trimmed);
          entry.value = Number.isFinite(asNumber) ? asNumber : trimmed;
          if (typeof entry.value === 'number') {
            const cap = prompt('max? (blank = none)') ?? '';
            if (cap.trim() && Number.isFinite(Number(cap))) entry.max = Number(cap);
          }
        }
        list.push(entry);
        save();
      },
    },
    '+ add',
  );
}

function refChips(entity, save) {
  const refs = entity.refs ?? {};
  const out = [];
  for (const [slot, held] of Object.entries(refs)) {
    for (const ref of Array.isArray(held) ? held : [held]) {
      out.push(
        el(
          'span',
          { class: 'chip ref', title: ref.id },
          `${slot}: ${ref.name || ref.id}`,
          el(
            'span',
            {
              class: 'x',
              title: 'clear this reference',
              onclick: () => {
                if (Array.isArray(refs[slot])) {
                  refs[slot] = refs[slot].filter((r) => r !== ref);
                  if (!refs[slot].length) delete refs[slot];
                } else {
                  delete refs[slot];
                }
                if (!Object.keys(refs).length) delete entity.refs;
                save();
              },
            },
            '×',
          ),
        ),
      );
    }
  }
  return out;
}

/** The whole panel for one entity. `save` persists it; re-render is the caller's. */
export function renderPanel(entity, save) {
  const root = el('div', { class: 'panel' });

  root.append(
    el(
      'h1',
      {},
      el('input', {
        value: entity.name,
        onchange: (e) => {
          entity.name = e.target.value.trim() || entity.name;
          save();
        },
      }),
    ),
    el(
      'div',
      { class: 'row' },
      el('span', { class: 'dim' }, 'type:'),
      el('input', {
        value: entity.type ?? '',
        placeholder: '(none)',
        onchange: (e) => {
          const type = e.target.value.trim();
          if (type) entity.type = type;
          else delete entity.type;
          save();
        },
      }),
      ...refChips(entity, save),
    ),
  );

  for (const [listName, entries] of Object.entries(entity.lists ?? {})) {
    root.append(el('h2', {}, listName));
    entries.forEach((_, i) => root.append(entryRow(entries, i, save)));
    root.append(addEntry(entries, save));
  }
  root.append(
    el('h2', {}, ''),
    el(
      'button',
      {
        class: 'add',
        onclick: () => {
          const name = prompt('list name? (skills, resources, conditions, …)');
          if (!name || !name.trim()) return;
          entity.lists = entity.lists ?? {};
          entity.lists[name.trim()] = entity.lists[name.trim()] ?? [];
          save();
        },
      },
      '+ add list',
    ),
  );

  root.append(el('h2', {}, 'notes'));
  root.append(
    el('textarea', {
      value: entity.notes ?? '',
      onchange: (e) => {
        const notes = e.target.value;
        if (notes.trim()) entity.notes = notes;
        else delete entity.notes;
        save();
      },
    }),
  );

  for (const child of entity.children ?? []) {
    const block = el('div', { class: 'child' });
    block.append(renderPanel(child, save));
    root.append(block);
  }

  return root;
}
