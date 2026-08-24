// The 'bestiary' tool — browse the merged foe list, look one up, drop it
// on the table. Ported grammar from the old app's BestiaryPanel +
// QuickSpawn (src/components/BestiaryPanel.tsx): a search box, a type
// filter when there's more than one type to filter by, a row list, and
// a printing that opens as a DETOUR — an overlay you dismiss back to the
// list, same as `TemplateSheet` already does for the encounters tool.
//
// core-next's `Template` carries no `sources`/`from` provenance the old
// `SourcedNpc` had (that was the old app's own layer over the merge) —
// `/api/stack/templates/bestiary` hands back a plain merged `Template[]`
// with no per-item "which pack" — so the shelf-source chips don't port.
// `type` survives (WiW's own bestiary sets it to 'foe' uniformly, but a
// pack is free to vary it), so that's what the filter chips key off,
// same spirit as the old shelf chips: only shown once there's more than
// one to choose between.
//
// Quick-spawn stamps THIN (`POST /api/stamp`, §14) and mirrors the exact
// naming convention `Session.deployEncounter` already uses for multiples
// (`server/session.ts`): count 1 keeps the template's name, count > 1
// numbers each one `${name} 1`, `${name} 2`, … — so a spawned pack of
// wolves reads the same whether it came from an encounter or from here.

import { useMemo, useState } from 'react';
import type { Template } from '../../core/stamp.ts';
import type { Entity } from '../../core/entity.ts';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';
import { TemplateSheet } from '../components/encounters/TemplateSheet.tsx';
import { registerTool } from './index.ts';

/** Match against the name first, then anything printed in its lists. */
function matches(t: Template, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  if (t.name.toLowerCase().includes(q)) return true;
  return Object.values(t.lists ?? {}).some((entries) =>
    entries.some((e) => e.name.toLowerCase().includes(q) || String(e.value ?? '').toLowerCase().includes(q)),
  );
}

/** Stamp `count` instances of a template — thin, numbered like a deployed encounter. */
async function spawn(
  templateId: string,
  base: string,
  count: number,
  addToTurn: boolean,
): Promise<Entity[]> {
  const out: Entity[] = [];
  for (let n = 1; n <= count; n++) {
    const entity = await api<Entity>('/api/stamp', {
      body: {
        slot: 'bestiary',
        templateId,
        name: count > 1 ? `${base} ${n}` : undefined,
      },
    });
    out.push(entity);
    if (addToTurn) {
      await api('/api/turn', { body: { op: 'add', entityId: entity.id } });
    }
  }
  return out;
}

function CountStepper({ count, onChange }: { count: number; onChange: (n: number) => void }) {
  return (
    <span className="flex items-center gap-1 rounded-md bg-stone-900 px-1">
      <button className={btnGhost} onClick={() => onChange(Math.max(1, count - 1))} aria-label="fewer">
        −
      </button>
      <span className="w-7 text-center font-mono text-sm text-stone-300">×{count}</span>
      <button className={btnGhost} onClick={() => onChange(Math.min(20, count + 1))} aria-label="more">
        +
      </button>
    </span>
  );
}

function BestiaryTool() {
  const bestiary = useLive(() => api<Template[]>('/api/stack/templates/bestiary'), [], {
    on: ['templates'],
  });
  const use = useLive(() => api<{ costCounter?: string }>('/api/stack/record/use'), [], {
    on: ['plugins'],
  });
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [addToTurn, setAddToTurn] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const npcs = bestiary.data ?? [];

  // Every type represented, biggest first — a chooser only earns its
  // place once there's a second one (same call the old shelf chips made).
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of npcs) {
      if (t.type) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [npcs]);

  const found = useMemo(
    () => npcs.filter((t) => matches(t, query.trim()) && (!type || t.type === type)),
    [npcs, query, type],
  );

  const shown = open ? npcs.find((t) => t.id === open) : undefined;

  const doSpawn = async (t: Template) => {
    setBusy(true);
    setStatus(undefined);
    try {
      const made = await spawn(t.id, t.name, count, addToTurn);
      setStatus(`${made.length} ${made.length === 1 ? 'joined' : 'joined'} the table`);
      setOpen(null);
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} @container space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Bestiary</span>
        <span className="font-mono text-[11px] text-stone-600">
          {query || type ? `${found.length} of ${npcs.length}` : `${npcs.length} foes`}
        </span>
      </div>

      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="wolf, bear, 2G…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <CountStepper count={count} onChange={setCount} />
      </div>

      <label className="flex w-fit items-center gap-1.5 text-[11px] text-stone-500">
        <input
          type="checkbox"
          checked={addToTurn}
          onChange={(e) => setAddToTurn(e.target.checked)}
        />
        add to the turn order too
      </label>

      {types.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button
            className={`${btnGhost} font-mono text-[11px] ${type ? 'text-stone-600' : 'text-amber-400'}`}
            onClick={() => setType(null)}
            aria-pressed={!type}
          >
            all
          </button>
          {types.map(([name, n]) => (
            <button
              key={name}
              className={`${btnGhost} font-mono text-[11px] ${
                type === name ? 'text-amber-400' : 'text-stone-600'
              }`}
              onClick={() => setType(type === name ? null : name)}
              aria-pressed={type === name}
            >
              {name} <span className="text-stone-700">{n}</span>
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-1">
        {found.map((t) => (
          <li key={t.id} className="rounded-md bg-stone-900">
            <button
              className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left"
              onClick={() => setOpen(t.id)}
              title="see the whole printing"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-stone-100">{t.name}</span>
              {t.type && (
                <span className="font-mono text-[11px] text-stone-600">{t.type}</span>
              )}
            </button>
          </li>
        ))}
        {found.length === 0 && (
          <li className="text-sm text-stone-600">
            {!npcs.length
              ? 'no foes yet — a pack brings them'
              : query
                ? `nothing by that name${type ? ` in ${type}` : ''}`
                : `nothing in ${type}`}
          </li>
        )}
      </ul>

      {status && <p className="font-mono text-xs text-amber-400">{status}</p>}

      {/* Looking a printing up mid-fight is a detour, and a detour
          should announce itself and end — same call the encounters tool
          already made with this exact component. */}
      {shown && (
        <TemplateSheet
          template={shown}
          costCounter={use.data?.costCounter}
          onClose={() => setOpen(null)}
          actions={
            <button className={btnPrimary} disabled={busy} onClick={() => doSpawn(shown)}>
              spawn {count > 1 ? `${count} ` : ''}to the table
            </button>
          }
        />
      )}
    </section>
  );
}

registerTool('bestiary', () => <BestiaryTool />);
