// The 'roster' tool — every entity at the table, filterable, each drawn
// with the 'sheet' panel (same statblock as the seat's own screen, per
// `EntityCard.tsx`). Ported grammar from the old app's DmView cast
// section + CharacterCard's header (src/views/DmView.tsx, ~1185-1287;
// src/components/CharacterCard.tsx): filter chips with counts, a search
// box, a card grid, an "add" bar at the bottom. What CharacterCard did
// with fields/counters/items/tags/notes, the sheet panel now does —
// this tool supplies the list, the filter, and entity CRUD around it.

import { useState } from 'react';
import type { ComponentType } from 'react';
import type { Entity } from '../../core/entity.ts';
import { api } from '../lib/api.ts';
import { presentationOf, useSystemFaces } from '../lib/presentations.ts';
import { addChild } from '../lib/refs.ts';
import { useLive } from '../lib/use-session.ts';
import { writeEntry } from '../lib/entry.ts';
import { btn, btnGhost, card, input, sectionLabel } from '../lib/ui.ts';
import { Refusal } from '../panels/render.tsx';
import { EntityCard, usePanelRecords, useSheetPanel } from '../components/roster/EntityCard.tsx';
import { registerTool } from './index.ts';

type RosterEntry = { id: string; name: string; type: string | null };

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
  // core-next dropped the old `kind: 'pc'|'npc'` column — `type` is now
  // free text (rule 2: no game-specific column). WiW's own convention,
  // seen live in the campaign this was verified against, is a trade
  // name ("Gunslinger", "Doctor") for the posse and the literal string
  // 'foe' for anything stamped from the bestiary — so that's what these
  // filter on. A pack using a different word for its foes reads as
  // "party" here; there's no generic signal left to tell the two apart.
  // …and a live vendor is neither. It's an entity like any other — it
  // has to be, so its depleted shelf is a stored value a human can
  // retype — but it is nobody's posse member, and it turned up under
  // 'party' the moment a shop first transacted. The store stamps it
  // with a type saying so (`VENDOR_TYPE`, `server/store-flow.ts`), so
  // this excludes something declared rather than guessing at a name.
  {
    key: 'party',
    label: 'party',
    match: (e) => !!e.type && e.type !== 'foe' && e.type !== 'vendor',
  },
  { key: 'foes', label: 'foes', match: (e) => e.type === 'foe' },
];

function RosterTool() {
  const list = useLive(() => api<RosterEntry[]>('/api/entities'), [], { on: ['entities'] });
  const panel = useSheetPanel();
  const records = usePanelRecords();

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'pc' | 'npc'>('pc');
  const [building, setBuilding] = useState(false);

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
    api('/api/entities', { body: { draft: { name, type: newType, lists: {} } } })
      .then(() => {
        setNewName('');
        list.reload();
      })
      .catch(() => {});
  };

  const remove = (id: string, name: string) => {
    if (!window.confirm(`Delete ${name}?`)) return;
    api(`/api/entities/${id}`, { method: 'DELETE' }).then(list.reload);
  };

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

      <div className="grid gap-4 xl:grid-cols-2">
        {shown.length === 0 && (
          <p className="text-sm text-stone-600">
            {query ? 'nobody by that name' : 'nobody here yet'}
          </p>
        )}
        {panel &&
          shown.map((e) => (
            <EntityCard
              key={e.id}
              id={e.id}
              panel={panel}
              records={records.data ?? {}}
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
        {!panel && shown.length > 0 && (
          <Refusal>the 'sheet' panel isn't declared — nothing to render a card with</Refusal>
        )}
      </div>

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
            value={newType}
            onChange={(e) => setNewType(e.target.value as 'pc' | 'npc')}
          >
            <option value="pc">PC</option>
            <option value="npc">NPC</option>
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
