// The 'roster' tool — every entity at the table, filterable, each a
// TILE you glance at and open into its 'sheet' (same statblock as the
// seat's own screen, per `EntityCard.tsx`). Ported grammar from the old
// app's DmView cast section + CharacterCard's header
// (src/views/DmView.tsx, ~1185-1287; src/components/CharacterCard.tsx):
// filter chips with counts, a search box, a grid, an "add" bar at the
// bottom. What CharacterCard did with fields/counters/items/tags/notes,
// the sheet panel now does, behind a tap — this tool supplies the list,
// the filter, the one open sheet, and entity CRUD around it.

import { useState } from 'react';
import type { ComponentType } from 'react';
import type { Entity, Side } from '../../core/entity.ts';
import { SIDE_LIST, SIDE_MARK, SIDES } from '../../core/side.ts';
import { api } from '../lib/api.ts';
import { presentationOf, useSystemFaces } from '../lib/presentations.ts';
import { addChild } from '../lib/refs.ts';
import { useLive } from '../lib/use-session.ts';
import { writeEntry } from '../lib/entry.ts';
import { btn, btnGhost, card, input, sectionLabel } from '../lib/ui.ts';
import { Refusal } from '../panels/render.tsx';
import { EntitySheet, EntityTile, usePanelRecords, useSheetPanel } from '../components/roster/EntityCard.tsx';
import { registerTool } from './index.ts';

type RosterEntry = { id: string; name: string; type: string | null; side: Side };

/**
 * The system's own way of making a character, if it has one.
 *
 * teller ships NO builder — "ships empty" applied to creation. Composing
 * a character out of trades, tiers and starting kits is a claim about
 * how a particular game works, so the claim (and the code) lives on the
 * system's shelf and is SUMMONED by name here. The floor when nobody
 * supplies one is the plain create bar below: a name, a type, and a
 * human filling in the rest — which is exactly how a data-only system
 * hand-assembles an entity, and it is honest rather than apologetic.
 *
 * Every prop is a DOOR, never a fact. The roster cannot know which slots
 * a builder reads without learning some game's words, and it isn't
 * allowed to (the seam resolves the component; the component names its
 * own vocabulary). All five are module-level and therefore stable — a
 * fresh identity each render would relaunch whatever the dialog loads.
 */
type CreationDialogProps = {
  declarations: (slot: string) => Promise<unknown[]>;
  record: (slot: string) => Promise<Record<string, unknown>>;
  create: (draft: unknown) => Promise<{ id: string }>;
  carry: (entityId: string, child: Entity) => Promise<unknown>;
  entry: (
    entityId: string,
    write: {
      list: string;
      name: string;
      value?: number | string;
      max?: number | null;
      remove?: boolean;
    },
  ) => Promise<unknown>;
  onDone: (id: string) => void;
  onClose: () => void;
};

const doors: Omit<CreationDialogProps, 'onDone' | 'onClose'> = {
  declarations: (slot) => api<unknown[]>(`/api/stack/declarations/${slot}`),
  record: (slot) => api<Record<string, unknown>>(`/api/stack/record/${slot}`),
  create: (draft) => api<{ id: string }>('/api/entities', { body: { draft } }),
  // §K: a carried thing is an INLINE child of the character's own blob,
  // never a stamped row under it in the campaign's parent tree.
  carry: (entityId, child) => addChild(entityId, child),
  entry: (entityId, write) => writeEntry(entityId, write),
};

const FILTERS: {
  key: string;
  label: string;
  match: (e: RosterEntry) => boolean;
}[] = [
  { key: 'all', label: 'all', match: () => true },
  // The side is the host's answer (`core/side.ts`, TEL-126): stored
  // where a human set it, derived from the declared trades otherwise,
  // and furniture — a live vendor — on no side at all. The filter reads
  // it and never the type word, which is a trade here and was never a
  // side.
  { key: 'party', label: 'party', match: (e) => e.side === 'party' },
  { key: 'foes', label: 'foes', match: (e) => e.side === 'foe' },
];

function RosterTool() {
  const list = useLive(() => api<RosterEntry[]>('/api/entities'), [], { on: ['entities'] });
  const panel = useSheetPanel();
  const records = usePanelRecords();

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newSide, setNewSide] = useState<Side>('party');
  const [building, setBuilding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // Re-render when the system module lands, so the builder appears
  // rather than staying missing for the life of the tab.
  useSystemFaces();
  const Builder = presentationOf<ComponentType<CreationDialogProps>>('CreationDialog');

  const entities = list.data ?? [];
  const shown = entities
    .filter((e) => FILTERS.find((f) => f.key === filter)?.match(e) ?? true)
    .filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()));

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    // A hand-made entity STATES its side — the one thing the bar used to
    // write (`pc`/`npc`) was a type word nothing read, and a nameless
    // character derives to foe, which is right for a boundary and wrong
    // for the posse member you just typed in.
    const lists = { [SIDE_LIST]: [{ name: SIDE_MARK, value: newSide }] };
    api('/api/entities', { body: { draft: { name, lists } } })
      .then(() => {
        setNewName('');
        list.reload();
      })
      .catch(() => {});
  };

  const remove = (id: string, name: string) => {
    if (!window.confirm(`Delete ${name}?`)) return;
    api(`/api/entities/${id}`, { method: 'DELETE' }).then(() => {
      setOpen((cur) => (cur === id ? null : cur));
      list.reload();
    });
  };

  // The one sheet open, if its entity is still at the table — a delete
  // from elsewhere closes it rather than leaving a dialog over nothing.
  const opened = open ? shown.find((e) => e.id === open) ?? entities.find((e) => e.id === open) : undefined;

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-center gap-2`}>
        {FILTERS.map((f) => {
          const n = entities.filter(f.match).length;
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              className={`rounded-md px-2 py-1 font-mono text-xs ${
                on
                  ? 'bg-amber-700 text-stone-950'
                  : 'bg-stone-900 text-stone-400 hover:text-stone-200'
              }`}
              onClick={() => setFilter(f.key)}
              aria-pressed={on}
            >
              {f.label} <span className="opacity-70">{n}</span>
            </button>
          );
        })}
        <input
          className={`${input} ml-auto w-44`}
          placeholder="find someone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="find an entity"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {shown.length === 0 && (
          <p className="text-sm text-stone-600">
            {query ? 'nobody by that name' : 'nobody here yet'}
          </p>
        )}
        {shown.map((e) => (
          <EntityTile
            key={e.id}
            id={e.id}
            records={records.data ?? {}}
            onOpen={() => setOpen(e.id)}
            actions={
              <button
                className={`${btnGhost} hover:text-red-300`}
                onClick={() => remove(e.id, e.name)}
                title="delete entity"
              >
                ✕
              </button>
            }
          />
        ))}
      </div>

      {opened && !panel && (
        <Refusal>the 'sheet' panel isn't declared — nothing to open a sheet with</Refusal>
      )}
      {opened && panel && (
        <EntitySheet
          id={opened.id}
          panel={panel}
          records={records.data ?? {}}
          onClose={() => setOpen(null)}
          actions={
            <button
              className={`${btnGhost} mr-auto hover:text-red-300`}
              onClick={() => remove(opened.id, opened.name)}
            >
              delete
            </button>
          }
        />
      )}

      <div className={`${card} space-y-2`}>
        <div className="flex items-baseline justify-between">
          <span className={sectionLabel}>New entity</span>
          {Builder && (
            <button className={btn} onClick={() => setBuilding(true)}>
              build one…
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className={`${input} min-w-0 flex-1`}
            placeholder="name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <select
            className={input}
            value={newSide}
            onChange={(e) => setNewSide(e.target.value as Side)}
            aria-label="side"
          >
            {SIDES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className={btn} onClick={add}>
            add
          </button>
        </div>
      </div>

      {Builder && building && (
        <Builder {...doors} onDone={() => list.reload()} onClose={() => setBuilding(false)} />
      )}
    </div>
  );
}

registerTool('roster', () => <RosterTool />);
