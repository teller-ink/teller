// The campaign screen — which story this table is running.
//
// APP CHROME, not a panel, and the distinction is load-bearing: panels
// come from the content stack, and the content stack is exactly what a
// host with no campaign hasn't got. This screen has to exist before
// anything resolves, so it is hand-written React in the console's own
// card grammar rather than a `tool` block.
//
// One host, one active campaign, and every screen follows (rule 9).
// Activating nudges the room before the swap, so a seat pointed at a
// character that no longer exists simply refetches and says so — the
// displays are on the shelf and are never touched by any of this.

import { useState } from 'react';
import { ImportStory } from '../components/story/ImportStory.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';

type CampaignRow = {
  slug: string;
  name: string;
  active: boolean;
  system: { id: string; name: string; installed: boolean } | null;
};
type CampaignsOut = { active: string | null; campaigns: CampaignRow[] };
type ShelfOut = { systems: { id: string; name: string; version: number }[] };

function Row({ row, onSwitched }: { row: CampaignRow; onSwitched: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <li
      className={`flex flex-wrap items-center gap-2 rounded-md px-3 py-2 ${
        row.active ? 'bg-amber-950/40 ring-1 ring-amber-800/60' : 'bg-stone-900'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-stone-100">{row.name}</span>
        <span className="block truncate font-mono text-[11px] text-stone-600">
          {row.slug}
          {row.system ? ` · ${row.system.name}` : ' · no system'}
          {row.system && !row.system.installed ? ' (missing)' : ''}
        </span>
      </span>
      {row.active ? (
        <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
          at the table
        </span>
      ) : (
        <button
          className={btn}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            api(`/api/campaigns/${row.slug}/activate`, { method: 'POST' })
              .then(onSwitched)
              .finally(() => setBusy(false));
          }}
        >
          play this
        </button>
      )}
    </li>
  );
}

function StartOne({ onStarted }: { onStarted: () => void }) {
  const shelf = useLive(() => api<ShelfOut>('/api/shelf'), [], { on: ['books'] });
  const [name, setName] = useState('');
  const [system, setSystem] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const systems = shelf.data?.systems ?? [];

  const start = () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    api('/api/campaigns', { body: { name: name.trim(), system: system || undefined } })
      .then(() => {
        setName('');
        onStarted();
      })
      .catch((e: ApiError) => setErr(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <span className={sectionLabel}>Start a new one</span>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="what's it called?"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={input}
          value={system}
          onChange={(e) => setSystem(e.target.value)}
        >
          <option value="">no system</option>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className={btnPrimary} type="submit" disabled={busy || !name.trim()}>
          begin
        </button>
      </div>
      {err && <p className="text-sm text-red-500">{err}</p>}
      <p className="text-[11px] text-stone-600">
        the file is named after the title. everything here stays editable — a system
        picked now is a starting point, not a commitment.
      </p>
    </form>
  );
}

/**
 * `onBack`, when given, is the console's way home. Absent means this
 * host has no campaign at all and there is nowhere to go back TO —
 * which is exactly the state a fresh data dir boots into.
 */
export function CampaignScreen({ onBack }: { onBack?: () => void }) {
  const { data, error, reload } = useLive(() => api<CampaignsOut>('/api/campaigns'), [], {
    on: ['books'],
  });
  const [opening, setOpening] = useState(false);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-xl space-y-4">
        <div className="flex items-baseline justify-between">
          <p className="font-serif text-2xl text-stone-200">teller</p>
          {onBack && (
            <button className={btnGhost} onClick={onBack}>
              ← back to the table
            </button>
          )}
        </div>

        <section className={`${card} space-y-3`}>
          <div className="flex items-center justify-between">
            <span className={sectionLabel}>Campaigns on this host</span>
            <span className="font-mono text-[11px] text-stone-600">
              {data?.campaigns.length ?? 0}
            </span>
          </div>
          {error && <p className="text-sm text-red-500">{error.message}</p>}
          <ul className="space-y-1">
            {(data?.campaigns ?? []).map((c) => (
              <Row key={c.slug} row={c} onSwitched={reload} />
            ))}
            {data && data.campaigns.length === 0 && (
              <li className="text-sm text-stone-600">
                nothing here yet — the first one goes below.
              </li>
            )}
          </ul>
        </section>

        <section className={`${card} space-y-3`}>
          <StartOne onStarted={reload} />
        </section>

        {/*
          The third way in, beside "start a new one" and "play this": a
          campaign somebody wrote out as a file. It belongs HERE because
          starting one fresh needs no table to be running — it IS the
          door (TEL-87).
        */}
        <section className={`${card} space-y-2`}>
          <span className={sectionLabel}>Start from a .story</span>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => setOpening(true)}>
              open a file…
            </button>
            <span className="text-[11px] text-stone-600">
              a backup, or someone else’s campaign. you’ll see what’s inside before
              anything is applied.
            </span>
          </div>
        </section>

        <p className="text-[11px] text-stone-600">
          one campaign at a time, and every screen in the room follows this choice.
          the screens themselves belong to the table, not to any campaign — they stay
          adopted across a switch.
        </p>
      </div>

      {opening && (
        <ImportStory canLayer={false} onClose={() => setOpening(false)} onImported={reload} />
      )}
    </div>
  );
}
