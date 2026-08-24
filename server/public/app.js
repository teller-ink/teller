// The client, rebuilt on the .panel collection (§E).
//
// The console is not a page; it's a DIRECTORY of panels. The merged
// collection (teller's standard furniture, then system → packs →
// campaign, later winning by name) feeds three consumers: the home
// directory, the `#panel=` hash routes, and the Screens tool's
// assignment picker — the panes.ts law: a panel nobody can be assigned
// to doesn't exist.
//
// Routes (hash first, `?` still honored; switching never reloads):
//   #console            → the directory
//   #panel=<name>       → one panel (add &entity=<id> for entity panels)
//   #entity=<id>        → the floor (§7), stored values
//   #board=<id>         → one board
//   (bare)              → a screen: hello, pairing code, assignment

import { renderPanel } from '/panel.js';
import { renderPanelDef } from '/panels.js';

const app = document.getElementById('app');

const stored = {
  get key() { return localStorage.getItem('teller.key') ?? ''; },
  set key(v) { v ? localStorage.setItem('teller.key', v) : localStorage.removeItem('teller.key'); },
  get display() { return localStorage.getItem('teller.display') ?? ''; },
  set display(v) { v ? localStorage.setItem('teller.display', v) : localStorage.removeItem('teller.display'); },
};

async function api(method, path, body) {
  const headers = {};
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

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

const ROLES = ['console', 'table', 'board', 'art', 'seat', 'badge', 'blank'];

const panelsList = () => api('GET', '/api/stack/declarations/panels');

/** Which family of glass this window is. The assignment wins; aspect decides otherwise. */
function glassOf(params = {}) {
  if (params.glass === 'mounted' || params.glass === 'held') return params.glass;
  return innerWidth / innerHeight > 2 ? 'mounted' : 'held';
}

// ------------------------------------------------------------------ tools
//
// Tool panels are teller furniture: behavior stays code, addressed by
// name from the collection. Each renders into its mount and refreshes
// itself after its own actions.

const tools = {
  async roster(mount) {
    const [roster, bestiary, accents] = await Promise.all([
      api('GET', '/api/entities'),
      api('GET', '/api/stack/templates/bestiary'),
      api('GET', '/api/stack/record/accents'),
    ]);
    const dot = (type) => {
      const mark = el('span', { class: 'accent-dot' });
      if (type && accents?.[type]) mark.style.background = accents[type];
      return mark;
    };
    mount.replaceChildren(
      ...roster.map((row) =>
        el(
          'div',
          { class: 'row' },
          dot(row.type),
          el(
            'button',
            { class: 'open', onclick: () => (location.hash = `panel=sheet&entity=${row.id}`) },
            `${row.name}${row.type ? ` · ${row.type}` : ''}`,
          ),
          el('a', { href: `#entity=${row.id}`, class: 'dim', title: 'the floor: stored values only' }, 'floor'),
          el(
            'button',
            {
              class: 'danger',
              onclick: async () => {
                if (!confirm(`remove ${row.name}?`)) return;
                await api('DELETE', `/api/entities/${row.id}`);
                tools.roster(mount);
              },
            },
            '×',
          ),
        ),
      ),
      el(
        'button',
        {
          class: 'add',
          onclick: async () => {
            const name = prompt('name?');
            if (!name || !name.trim()) return;
            const made = await api('POST', '/api/entities', { draft: { name: name.trim() } });
            location.hash = `entity=${made.id}`;
          },
        },
        '+ new entity',
      ),
      bestiary.length
        ? el(
            'div',
            { class: 'row' },
            el('span', { class: 'dim' }, 'stamp:'),
            ...bestiary.slice(0, 12).map((t) =>
              el(
                'button',
                {
                  title: t.id,
                  onclick: async () => {
                    await api('POST', '/api/stamp', { slot: 'bestiary', templateId: t.id });
                    tools.roster(mount);
                  },
                },
                t.name,
              ),
            ),
            bestiary.length > 12 ? el('span', { class: 'dim' }, `… ${bestiary.length - 12} more in the bestiary`) : '',
          )
        : '',
    );
  },

  async runner(mount) {
    const [turn, roster] = await Promise.all([
      api('GET', '/api/turn'),
      api('GET', '/api/entities'),
    ]);
    const names = new Map(roster.map((r) => [r.id, r.name]));
    const whoOf = (e) =>
      e.label ?? (e.entityId ? (names.get(e.entityId) ?? `missing: ${e.entityId}`) : '?');
    const op = async (body) => {
      await api('POST', '/api/turn', body);
      tools.runner(mount);
    };
    mount.replaceChildren(
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'dim' }, `round ${turn.round}`),
        el('button', { onclick: () => op({ op: 'next' }) }, turn.turn === null ? 'start' : 'next'),
        el('button', { onclick: () => op({ op: 'prev' }) }, 'prev'),
        el('button', { onclick: () => op({ op: 'end' }) }, 'end'),
        el(
          'button',
          { onclick: () => op({ op: 'rolling', on: !turn.rolling }) },
          turn.rolling ? 'stop rolling' : 'roll!',
        ),
        turn.turn !== null
          ? el(
              'button',
              {
                title: 'ask the plugins for a proposal — words, nothing else',
                onclick: async () => {
                  const target = mount.querySelector('.proposals');
                  if (target) target.textContent = 'asking…';
                  const out = await api('POST', '/api/propose/turn', {});
                  if (!target) return;
                  target.textContent = out.providers
                    ? out.proposals
                        .map((p) =>
                          p.error
                            ? `${p.plugin}: ${p.error}`
                            : p.proposal == null
                              ? `${p.plugin}: (nothing — configured?)`
                              : JSON.stringify(p.proposal, null, 2),
                        )
                        .join('\n\n')
                    : 'no plugin offers propose.turn (see the Plugins panel)';
                },
              },
              'assist',
            )
          : '',
      ),
      el('pre', { class: 'dim proposals' }, ''),
      ...turn.order.map((e, i) =>
        el(
          'div',
          { class: 'row' },
          el('span', { class: i === turn.turn ? '' : 'dim' }, i === turn.turn ? '▶' : '·'),
          el('span', { class: 'entry-name', title: e.entityId ?? '' }, whoOf(e)),
          turn.rolling || typeof e.score === 'number'
            ? el('input', {
                class: 'score',
                value: typeof e.score === 'number' ? String(e.score) : '',
                placeholder: '—',
                onchange: (ev) => {
                  const n = Number(ev.target.value);
                  op({ op: 'score', entryId: e.id, score: Number.isFinite(n) ? n : null });
                },
              })
            : '',
          el(
            'span',
            { class: 'x dim', title: 'remove', onclick: () => op({ op: 'remove', entryId: e.id }) },
            '×',
          ),
        ),
      ),
      el(
        'button',
        {
          class: 'add',
          onclick: () => {
            const lines = roster.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
            const pick = prompt(`add who? (a number, or type a label)\n${lines}`);
            if (!pick || !pick.trim()) return;
            const linked = roster[Number(pick) - 1];
            op(linked ? { op: 'add', entityId: linked.id } : { op: 'add', label: pick.trim() });
          },
        },
        '+ add to order',
      ),
    );
  },

  async encounters(mount) {
    const [encounters, bestiary] = await Promise.all([
      api('GET', '/api/templates/encounters'),
      api('GET', '/api/stack/templates/bestiary'),
    ]);
    mount.replaceChildren(
      ...encounters.map((enc) =>
        el(
          'div',
          { class: 'row' },
          el('span', {}, enc.name),
          el('span', { class: 'dim' }, `${(enc.foes ?? []).reduce((n, f) => n + (f.count ?? 1), 0)} foes`),
          el(
            'button',
            {
              onclick: async () => {
                const out = await api('POST', `/api/encounters/${enc.id}/deploy`, {});
                alert(`deployed ${out.deployed?.length ?? 0} foes into the order`);
                tools.encounters(mount);
              },
            },
            'deploy',
          ),
          el(
            'button',
            {
              class: 'danger',
              onclick: async () => {
                if (!confirm(`remove ${enc.name}?`)) return;
                await api('DELETE', `/api/templates/encounters/${enc.id}`);
                tools.encounters(mount);
              },
            },
            '×',
          ),
        ),
      ),
      el(
        'button',
        {
          class: 'add',
          onclick: async () => {
            const name = prompt('encounter name?');
            if (!name || !name.trim()) return;
            const foes = [];
            while (bestiary.length) {
              const lines = bestiary.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
              const pick = prompt(`add which foe? (blank = done)\n${lines}`);
              if (!pick || !pick.trim()) break;
              const t = bestiary[Number(pick) - 1];
              if (!t) continue;
              const count = Number(prompt(`how many ${t.name}?`) ?? 1) || 1;
              foes.push({ templateId: t.id, count });
            }
            await api('POST', '/api/templates/encounters', { template: { name: name.trim(), foes } });
            tools.encounters(mount);
          },
        },
        '+ new encounter',
      ),
    );
  },

  async screens(mount) {
    const [displays, roster, panels] = await Promise.all([
      api('GET', '/api/displays'),
      api('GET', '/api/entities'),
      panelsList(),
    ]);
    const entityPanels = panels.filter((p) => p.subject === 'entity');
    const consolePanels = panels.filter((p) => p.subject !== 'entity');
    const row = (d) => {
      const jobOf = () => {
        if (d.role === 'seat') {
          const who = roster.find((r) => r.id === d.params.entityId);
          return `${who ? ` → ${who.name}` : ' → (unassigned)'}${d.params.layout ? ` · ${d.params.layout}` : ''}`;
        }
        if (d.role === 'console' && d.params.pane) return ` → ${d.params.pane}`;
        return '';
      };
      const roleSelect = el(
        'select',
        {
          onchange: async () => {
            const role = roleSelect.value;
            const patch = { role, params: {} };
            if (role === 'seat') {
              const lines = roster.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
              const pick = Number(prompt(`which entity?\n${lines}`) ?? 0);
              const who = roster[pick - 1];
              if (!who) return tools.screens(mount);
              const layouts = entityPanels.map((p, i) => `${i + 1}. ${p.name} — ${p.blurb ?? ''}`).join('\n');
              const which = Number(prompt(`which arrangement?\n${layouts}`) ?? 1);
              patch.params = { entityId: who.id, layout: (entityPanels[which - 1] ?? entityPanels[0])?.name ?? 'sheet' };
            }
            if (role === 'console') {
              const lines = consolePanels.map((p, i) => `${i + 1}. ${p.name} — ${p.blurb ?? ''}`).join('\n');
              const pick = prompt(`one pane, or blank for the whole console?\n${lines}`);
              const chosen = consolePanels[Number(pick) - 1];
              if (chosen) patch.params = { pane: chosen.name };
            }
            await api('PATCH', `/api/displays/${d.id}`, patch);
            tools.screens(mount);
          },
        },
        ...ROLES.map((r) => el('option', { value: r, selected: d.role === r }, r)),
      );
      return el(
        'div',
        { class: 'row' },
        d.code
          ? el('span', { class: 'chip' }, `waiting · code ${d.code}`)
          : el('span', {}, `${d.name ?? '(unnamed)'}${jobOf()}`),
        d.code ? '' : roleSelect,
        d.code
          ? ''
          : el(
              'button',
              { title: 'flash its name on it', onclick: () => api('POST', `/api/displays/${d.id}/identify`) },
              'identify',
            ),
        el(
          'button',
          {
            class: 'danger',
            onclick: async () => {
              if (!confirm(`forget ${d.name ?? 'this screen'}?`)) return;
              await api('DELETE', `/api/displays/${d.id}`);
              tools.screens(mount);
            },
          },
          '×',
        ),
      );
    };
    mount.replaceChildren(
      ...displays.map(row),
      el(
        'div',
        { class: 'row' },
        el('input', { id: 'claim-code', placeholder: 'pairing code', maxLength: 6 }),
        el(
          'button',
          {
            class: 'add',
            onclick: async () => {
              const code = mount.querySelector('#claim-code')?.value ?? '';
              if (!code.trim()) return;
              const claimed = await api('POST', '/api/displays/claim', {
                code,
                name: prompt('name this screen?') ?? undefined,
              });
              if (claimed.error) alert(claimed.error);
              tools.screens(mount);
            },
          },
          'adopt',
        ),
      ),
    );
  },

  async shelf(mount) {
    const [shelf, campaign] = await Promise.all([
      api('GET', '/api/shelf'),
      api('GET', '/api/campaign'),
    ]);
    const packRow = (p) => {
      const declared = campaign.packs.find((x) => x.id === p.id);
      return el(
        'div',
        { class: 'row' },
        el('span', { title: p.id }, p.name),
        el('span', { class: 'dim' }, `v${p.version}${p.system ? ` · ${p.system}` : ''}`),
        declared ? el('span', { class: 'chip' }, `runs #${campaign.packs.indexOf(declared) + 1}`) : el('span', { class: 'dim' }, 'not declared'),
      );
    };
    mount.replaceChildren(
      el('h2', {}, 'systems'),
      ...shelf.systems.map((s) =>
        el('div', { class: 'row' }, el('span', { title: s.id }, s.name), el('span', { class: 'dim' }, `v${s.version}`)),
      ),
      el('h2', {}, 'packs'),
      ...shelf.packs.map(packRow),
      el('h2', {}, 'this campaign'),
      el(
        'div',
        { class: 'dim' },
        campaign.system
          ? `${campaign.system.name} v${campaign.system.version} · packs in precedence: ${campaign.packs.map((p) => p.name).join(' → ') || '(all for the system)'}`
          : 'no system resolved',
      ),
      ...campaign.missing.map((m) =>
        el('div', { class: 'missing' }, `MISSING ${m.slot}: ${m.ref.name} (${m.ref.id})`),
      ),
      el('p', { class: 'dim' }, 'installing is still the sweep’s job: drop a pack in the data dir.'),
    );
  },

  async plugins(mount) {
    const out = await api('GET', '/api/plugins');
    if (out.error) {
      mount.replaceChildren(el('p', { class: 'missing' }, out.error));
      return;
    }
    mount.replaceChildren(
      ...out.found.map((f) =>
        el(
          'div',
          { class: 'row' },
          el('span', { title: f.manifest.id }, f.manifest.name),
          el('span', { class: 'dim' }, `v${f.manifest.version} · provides ${f.manifest.provides.join(', ') || '(nothing)'} · needs ${f.manifest.needs.join(', ') || '(nothing)'}`),
          out.running.includes(f.manifest.id) ? el('span', { class: 'chip' }, 'running') : '',
          el(
            'button',
            {
              onclick: async () => {
                await api('POST', `/api/plugins/${f.manifest.id}`, { enabled: !f.enabled });
                tools.plugins(mount);
              },
            },
            f.enabled ? 'disable' : 'enable',
          ),
          el(
            'button',
            {
              onclick: async () => {
                const raw = prompt('config (JSON)?');
                if (raw === null) return;
                try {
                  await api('PUT', `/api/plugins/${f.manifest.id}/config`, {
                    config: raw.trim() ? JSON.parse(raw) : null,
                  });
                } catch (err) {
                  alert(`not JSON: ${err}`);
                }
                tools.plugins(mount);
              },
            },
            'configure',
          ),
        ),
      ),
      ...(out.found.length ? [] : [el('p', { class: 'dim' }, 'nothing on the shelf — drop a plugin folder in <data>/plugins/')]),
      ...out.problems.map((p) => el('div', { class: 'missing' }, `${p.dir}: ${p.problem}`)),
      el('p', { class: 'dim' }, 'the sweep only discovers; enabling is yours alone (§15).'),
    );
  },

  async boards(mount) {
    const boards = await api('GET', '/api/boards');
    mount.replaceChildren(
      ...boards.map((b) => el('div', { class: 'row' }, el('a', { href: `#board=${b.id}` }, b.name))),
      ...(boards.length ? [] : [el('p', { class: 'dim' }, 'no boards on the shelf')]),
    );
  },

  async log(mount) {
    const events = await api('GET', '/api/events?limit=30');
    mount.replaceChildren(
      ...(events.error ? [el('p', { class: 'missing' }, events.error)] : events).map((e) =>
        el('div', { class: 'dim' }, `${e.createdAt.slice(11, 19)} · ${e.actor} · ${e.kind}`),
      ),
    );
  },
};

// ------------------------------------------------------------------ views

function crumb(...rest) {
  return el('div', { class: 'crumb' }, el('a', { href: '#console' }, '← console'), ...rest);
}

/** The directory: what this table can show, from the merged collection. */
async function home() {
  const [campaign, panels] = await Promise.all([api('GET', '/api/campaign'), panelsList()]);
  if (campaign.error) return keyView(campaign.error);
  app.replaceChildren(
    el('h1', {}, campaign.manifest.name),
    el(
      'div',
      { class: 'crumb' },
      campaign.system
        ? `${campaign.system.name} · packs: ${campaign.packs.map((p) => p.name).join(', ') || '(none)'}`
        : 'no system loaded',
      ...campaign.missing.map((m) => el('span', { class: 'missing' }, `  MISSING ${m.slot}: ${m.ref.name}`)),
      el('span', { class: 'dim' }, '  ·  '),
      el('a', { href: '#console', onclick: (e) => { e.preventDefault(); stored.key = ''; current(); } }, 'lock'),
    ),
    el(
      'div',
      { class: 'directory' },
      ...panels.map((p) =>
        el(
          'a',
          {
            class: 'card',
            href: p.subject === 'entity' ? '#panel=roster' : `#panel=${p.name}`,
            title: p.subject === 'entity' ? 'an arrangement — open someone from the roster, or assign it to a seat' : '',
          },
          el('div', { class: 'card-name' }, p.label ?? p.name),
          el('div', { class: 'card-blurb dim' }, p.blurb ?? ''),
          p.subject === 'entity' ? el('div', { class: 'card-tag dim' }, 'arrangement') : '',
        ),
      ),
    ),
  );
}

/** One panel from the collection, by name. */
async function panelView(name, entityId) {
  const panels = await panelsList();
  const def = panels.find((p) => p.name === name);
  if (!def) {
    app.replaceChildren(crumb(), el('p', { class: 'missing' }, `no panel named '${name}'`));
    return;
  }
  const glass = glassOf();
  if (def.subject === 'entity') {
    if (!entityId) {
      app.replaceChildren(crumb(), el('p', { class: 'missing' }, `'${name}' arranges an entity — open one from the roster`));
      return;
    }
    const ctx = await entityCtx(entityId, () => panelView(name, entityId));
    if (!ctx) return;
    app.replaceChildren(
      crumb(el('span', { class: 'dim' }, `  ${def.label ?? name}`)),
      renderPanelDef(def, glass, ctx),
    );
    return;
  }
  app.replaceChildren(
    crumb(el('span', { class: 'dim' }, `  ${def.label ?? name}`)),
    el('h1', {}, def.label ?? def.name),
    renderPanelDef(def, glass, { tools }),
  );
}

/** Everything an entity arrangement needs: reads, stored, stack, the doors. */
async function entityCtx(id, rerender) {
  const [storedEntity, reads, statuses, kinds, accents, dials, brand, portraits] =
    await Promise.all([
      api('GET', `/api/entities/${id}`),
      api('GET', `/api/entities/${id}?resolved=1`),
      api('GET', '/api/stack/declarations/statuses'),
      api('GET', '/api/stack/declarations/kinds'),
      api('GET', '/api/stack/record/accents'),
      api('GET', '/api/stack/record/dials'),
      api('GET', '/api/stack/record/brand'),
      api('GET', '/api/stack/record/portraits'),
    ]);
  if (storedEntity.error) {
    app.replaceChildren(el('p', { class: 'missing' }, storedEntity.error));
    return undefined;
  }
  const saveStored = async (entity) => {
    await api('PUT', `/api/entities/${id}`, { entity });
    rerender();
  };
  return {
    stored: storedEntity,
    reads,
    stack: { statuses, kinds, dials, brand, portraits },
    fileUrl,
    // The system's own color for this type, when it declares one.
    accent: reads.type ? accents?.[reads.type] : undefined,
    writeEntry: async (edit) => {
      await api('POST', `/api/entities/${id}/entry`, edit);
      rerender();
    },
    saveStored,
    floor: (target) => renderPanel(target, () => saveStored(storedEntity)),
    tools,
  };
}

/** The floor itself — stored values, whole-entity saves, reads-as aside. */
async function entityView(id, seat) {
  const entity = await api('GET', `/api/entities/${id}`);
  if (entity.error) {
    app.replaceChildren(el('p', { class: 'missing' }, entity.error));
    return;
  }
  const save = async () => {
    await api('PUT', `/api/entities/${id}`, { entity });
    render();
  };
  const render = () => {
    app.replaceChildren(
      seat ? el('div', { class: 'crumb' }, `seat · ${entity.name}`) : crumb(),
      renderPanel(entity, save),
      el(
        'details',
        {},
        el('summary', { class: 'dim' }, 'reads as (resolved through templates)'),
        el('pre', { id: 'resolved' }, '…'),
      ),
    );
    api('GET', `/api/entities/${id}?resolved=1`).then((resolved) => {
      const target = document.getElementById('resolved');
      if (target) target.textContent = JSON.stringify(resolved, null, 2);
    });
  };
  render();
}

async function boardView(id, passive) {
  const [boards, roster] = await Promise.all([api('GET', '/api/boards'), api('GET', '/api/entities')]);
  const board = boards.find((b) => b.id === id);
  const state = (await api('GET', `/api/board-state/${id}`)) ?? {};
  const placements = Array.isArray(state.placements) ? state.placements : [];
  const names = new Map(roster.map((r) => [r.id, r.name]));
  const whoOf = (p) =>
    p.label ?? (p.entityId ? (names.get(p.entityId) ?? `missing: ${p.entityId}`) : '?');
  const save = async () => {
    await api('PUT', `/api/board-state/${id}`, { data: { ...state, placements } });
    boardView(id, passive);
  };
  app.replaceChildren(
    passive ? el('div', { class: 'crumb' }, 'board') : crumb(),
    el('h1', {}, board ? board.name : id),
    el('h2', {}, 'placements'),
    el(
      'table',
      {},
      el('tr', {}, el('th', {}, 'who'), el('th', {}, 'u'), el('th', {}, 'v'), el('th', {}, '')),
      ...placements.map((p, i) =>
        el(
          'tr',
          {},
          el('td', { title: p.entityId ?? '' }, whoOf(p)),
          el('td', {}, String(p.u)),
          el('td', {}, String(p.v)),
          el(
            'td',
            {},
            passive
              ? ''
              : el('button', { class: 'danger', onclick: () => { placements.splice(i, 1); save(); } }, '×'),
          ),
        ),
      ),
    ),
    passive
      ? ''
      : el(
          'button',
          {
            class: 'add',
            onclick: () => {
              const label = prompt('label (or entity id)?');
              if (!label) return;
              const u = Number(prompt('u?') ?? 0) || 0;
              const v = Number(prompt('v?') ?? 0) || 0;
              const placement = { u, v, sizeInches: 1 };
              if (label.startsWith('ent_')) placement.entityId = label;
              else placement.label = label;
              placements.push(placement);
              save();
            },
          },
          '+ place',
        ),
  );
}

// ------------------------------------------------------------------ seat

/** A player's sheet: the assigned arrangement, resolve + sparse write. */
async function seatView(id, layout, params) {
  const [panels, turn, roster] = await Promise.all([
    panelsList(),
    api('GET', '/api/turn'),
    api('GET', '/api/entities'),
  ]);
  const def =
    panels.find((p) => p.name === (layout ?? 'sheet') && p.subject === 'entity') ??
    panels.find((p) => p.name === 'sheet');
  const ctx = await entityCtx(id, () => seatView(id, layout, params));
  if (!ctx) return;
  app.replaceChildren(
    el('div', { class: 'crumb' }, `seat · ${ctx.reads.name}`),
    seatTurnStrip(turn, roster, id),
    renderPanelDef(def, glassOf(params), ctx),
  );
}

function seatTurnStrip(turn, roster, myEntityId) {
  if (!turn.order.length) return el('span', {});
  const names = new Map(roster.map((r) => [r.id, r.name]));
  const whoOf = (e) => e.label ?? names.get(e.entityId) ?? '?';
  const acting = turn.turn === null ? null : turn.order[turn.turn];
  const mine = turn.order.find((e) => e.entityId === myEntityId);
  const myTurn = acting && acting.entityId === myEntityId;
  return el(
    'div',
    { class: 'row turn-strip' },
    el('span', { class: 'dim' }, `round ${turn.round}`),
    acting
      ? el('span', { class: myTurn ? 'your-turn' : '' }, myTurn ? '▶ your turn' : `▶ ${whoOf(acting)}`)
      : el('span', { class: 'dim' }, turn.rolling ? 'rolling…' : 'between fights'),
    turn.rolling && mine && typeof mine.score !== 'number'
      ? el('input', {
          class: 'score',
          placeholder: 'your roll',
          onchange: async (ev) => {
            const n = Number(ev.target.value);
            if (!Number.isFinite(n)) return;
            await api('POST', '/api/turn', { op: 'score', entryId: mine.id, score: n });
            current();
          },
        })
      : '',
  );
}

// ------------------------------------------------------------------ screen

let me = null;

async function screenView() {
  me = await api('POST', '/api/displays/hello', stored.display ? { id: stored.display } : {});
  if (!me.display) {
    app.replaceChildren(el('p', { class: 'missing' }, 'the host is not answering'));
    return;
  }
  stored.display = me.display.id;
  const { display } = me;

  if (display.code) {
    app.replaceChildren(
      el('div', { class: 'pairing' },
        el('div', { class: 'dim' }, 'adopt this screen from the console'),
        el('div', { class: 'code' }, display.code),
        el('div', {}, el('a', { href: '/#console', class: 'dim' }, 'this is the DM device — open the console')),
      ),
    );
    setTimeout(screenView, 5000);
    return;
  }

  api('POST', '/api/displays/viewport', { w: innerWidth, h: innerHeight });
  await ensureStream();

  if (display.role === 'console') {
    if (display.params.pane) return panelView(display.params.pane);
    return home();
  }
  if (display.role === 'seat' && display.params.entityId) {
    return seatView(display.params.entityId, display.params.layout, display.params);
  }
  if (display.role === 'board' && display.params.boardId) {
    return boardView(display.params.boardId, true);
  }
  app.replaceChildren(
    el('div', { class: 'pairing' },
      el('div', { class: 'code', id: 'self-name' }, display.name ?? '(unnamed)'),
      el('div', { class: 'dim' }, `${display.role} · waiting for a job`),
    ),
  );
}

function flashIdentity() {
  const name = me?.display?.name ?? '(unnamed)';
  const color = me?.display?.color ?? 'var(--accent)';
  const overlay = el('div', { class: 'identify' }, name);
  overlay.style.background = color;
  document.body.append(overlay);
  setTimeout(() => overlay.remove(), 2500);
}

function keyView(message) {
  app.replaceChildren(
    el('h1', {}, 'console'),
    message ? el('p', { class: 'missing' }, message) : '',
    el('p', { class: 'dim' }, 'paste the DM key — the host terminal prints it'),
    el(
      'div',
      { class: 'row' },
      el('input', { id: 'key-in', type: 'password', placeholder: 'DM key' }),
      el(
        'button',
        {
          onclick: () => {
            stored.key = document.getElementById('key-in')?.value.trim() ?? '';
            current();
          },
        },
        'unlock',
      ),
    ),
  );
}

// ------------------------------------------------------------------ stream

let stream = null;
let slipsPromise = null;

/** The permission slips (stream + files), fetched once and shared. */
function getSlips() {
  slipsPromise ??= api('GET', '/api/ticket').then((slip) => {
    if (slip.error) {
      slipsPromise = null;
      return undefined;
    }
    return slip;
  });
  return slipsPromise;
}

/** A data-dir file (pack art, board image) as a URL an <img> can open. */
async function fileUrl(path) {
  const slip = await getSlips();
  if (!slip) return undefined;
  return `/files/${path}?handle=${slip.handle}&ticket=${slip.files}`;
}

async function ensureStream() {
  if (stream) return;
  const slip = await getSlips();
  if (!slip) return;
  stream = new EventSource(`/api/stream?handle=${slip.handle}&ticket=${slip.ticket}`);
  stream.onmessage = (msg) => {
    if (msg.data === 'identify') return flashIdentity();
    if (msg.data === 'assign') return current();
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    current();
  };
  stream.onerror = () => {
    stream?.close();
    stream = null;
    slipsPromise = null;
    setTimeout(ensureStream, 3000);
  };
}

// ------------------------------------------------------------------ boot

function route() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const search = new URLSearchParams(location.search);
  const pick = (k) => hash.get(k) ?? search.get(k);
  const has = (k) => hash.has(k) || search.has(k);
  return {
    panel: pick('panel'),
    entity: pick('entity'),
    board: pick('board'),
    console: has('console') || has('panel') || has('entity') || has('board'),
  };
}

function current() {
  const r = route();
  if (r.console) {
    if (!stored.key) return keyView();
    ensureStream();
    if (r.panel) return panelView(r.panel, r.entity ?? undefined);
    if (r.entity) return entityView(r.entity, false);
    if (r.board) return boardView(r.board, false);
    return home();
  }
  return screenView();
}

window.addEventListener('hashchange', current);
current();
