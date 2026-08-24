// The 'shelf' tool — what this host holds, ported in the old app's
// library/store list-card grammar (src/components/BooksPanel.tsx,
// StorePanel.tsx: a card per section, a row per item, a dim chip for
// the version/status). Read-mostly, same as the vanilla client's shelf
// tool (`server/public/app.js`) — installing a system or pack is still
// the sweep's job (drop it in the data dir), never a console upload.
//
// `/api/shelf` says what's on the host; `/api/campaign` says which of
// it this table actually runs on, and in what precedence order — the
// "runs #N" chip and the missing-ref lines mirror the vanilla tool.

import { useState } from 'react';
import { registerTool } from './index.ts';
import { api } from '../lib/api.ts';
import { Export } from './export.tsx';
import { ExportStory } from '../components/story/ExportStory.tsx';
import { ImportStory } from '../components/story/ImportStory.tsx';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, card, input, sectionLabel } from '../lib/ui.ts';

type ShelfSystem = { id: string; name: string; version: number };
type ShelfPack = { id: string; system?: string; name: string; version: number };
type ShelfBoard = { id: string; name: string };
type ShelfOut = { systems: ShelfSystem[]; packs: ShelfPack[]; boards: ShelfBoard[] };

type CampaignOut = {
  slug: string;
  /** The manifest itself — its `refs` are what says DECLARED vs default. */
  manifest: { refs?: Record<string, { id: string; name: string } | { id: string; name: string }[]> } | null;
  system: { id: string; name: string; version: number } | null;
  packs: { id: string; name: string; version: number }[];
  missing: { slot: 'system' | 'pack'; ref: { id: string; name: string } }[];
};

/**
 * Which system and packs this table runs on — the manifest's refs, and
 * the one place they're editable.
 *
 * The DECLARED list is precedence order and later wins, so the arrows
 * are the whole feature (same reindex-on-move shape as the screens
 * tool). An empty declaration is not "no packs": it's the DEFAULT —
 * every pack for the system, in arrival order — which is why "use all"
 * is a first-class button and not a trick. A host with one pack must
 * never make anyone tick a box.
 */
function ThisCampaign({
  shelf,
  campaign,
  onChanged,
}: {
  shelf: ShelfOut;
  campaign: CampaignOut;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');
  const [writing, setWriting] = useState(false);
  const [opening, setOpening] = useState(false);
  const declared = campaign.packs.map((p) => p.id);
  // No declared list is the default reading; the endpoint answers with
  // what actually LOADED either way, so telling them apart needs the
  // manifest's own refs — which `/api/campaign` carries.
  const explicit = ((campaign.manifest?.refs?.packs ?? []) as { id: string }[]).map(
    (r) => r.id,
  );
  const usingDefault = explicit.length === 0;
  const forSystem = shelf.packs.filter(
    (p) => !campaign.system || p.system === campaign.system.id,
  );
  const available = forSystem.filter((p) => !declared.includes(p.id));

  const write = (body: Record<string, unknown>) => {
    setBusy(true);
    api('/api/campaign/refs', { method: 'PUT', body })
      .then(onChanged)
      .catch(onChanged)
      .finally(() => setBusy(false));
  };

  const nudge = (index: number, delta: -1 | 1) => {
    const list = usingDefault ? declared : explicit;
    if (!list[index] || !list[index + delta]) return;
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    write({ packs: next });
  };

  return (
    <section className={`${card} space-y-3`}>
      <span className={sectionLabel}>This campaign</span>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-stone-400">system</span>
        <select
          className={input}
          disabled={busy}
          value={campaign.system?.id ?? ''}
          onChange={(e) => write({ system: e.target.value || null })}
        >
          <option value="">(none)</option>
          {shelf.systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} v{s.version}
            </option>
          ))}
        </select>
        {campaign.system && (
          <span className="font-mono text-[11px] text-stone-600">
            {campaign.system.id}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-400">
            packs, in precedence order — later wins
          </span>
          {usingDefault ? (
            <span className="font-mono text-[11px] text-stone-600">
              default: all for the system
            </span>
          ) : (
            <button className={btnGhost} disabled={busy} onClick={() => write({ packs: null })}>
              use all (default)
            </button>
          )}
        </div>
        <ul className="space-y-1">
          {campaign.packs.map((p, i) => (
            <li
              key={p.id}
              className="flex items-center gap-1 rounded-md bg-stone-900 px-2 py-1.5"
            >
              <span className="font-mono text-[11px] text-stone-600">#{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-stone-100" title={p.id}>
                {p.name}
              </span>
              <button
                className="rounded-md px-1.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200 disabled:opacity-30"
                title="earlier — loses to what's below it"
                disabled={busy || i === 0}
                onClick={() => nudge(i, -1)}
              >
                ▲
              </button>
              <button
                className="rounded-md px-1.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200 disabled:opacity-30"
                title="later — wins over what's above it"
                disabled={busy || i === campaign.packs.length - 1}
                onClick={() => nudge(i, 1)}
              >
                ▼
              </button>
              <button
                className="rounded-md px-2 py-1 text-sm text-stone-600 transition-colors hover:bg-red-950 hover:text-red-300"
                title="stop running this pack at this table"
                disabled={busy}
                onClick={() =>
                  write({
                    packs: (usingDefault ? declared : explicit).filter((id) => id !== p.id),
                  })
                }
              >
                ✕
              </button>
            </li>
          ))}
          {campaign.packs.length === 0 && (
            <li className="text-sm text-stone-600">no packs load for this campaign</li>
          )}
        </ul>
        {available.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            <select
              className={input}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            >
              <option value="">add a pack…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className={btn}
              disabled={busy || !adding}
              onClick={() => {
                write({ packs: [...(usingDefault ? declared : explicit), adding] });
                setAdding('');
              }}
            >
              add
            </button>
          </div>
        )}
      </div>

      {campaign.missing.map((m, i) => (
        <p key={i} className="font-mono text-[11px] text-amber-500/80">
          missing {m.slot}: {m.ref.name} ({m.ref.id})
        </p>
      ))}
      {/*
        The campaign as a FILE, and it lives here because this card is
        where this campaign is managed. Both doors, unlike the campaign
        screen's one: there is a table running, so layering onto it is a
        thing you can actually mean.
      */}
      <div className="space-y-1 border-t border-stone-800 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-stone-400">this campaign, as a file</span>
          <button className={btn} onClick={() => setWriting(true)}>
            save as .story
          </button>
          <button className={btnGhost} onClick={() => setOpening(true)}>
            open one…
          </button>
        </div>
        <p className="text-[11px] text-stone-600">
          the backup, and the only copy there is — packs and books are referenced, so
          back the data dir's packs up alongside it.
        </p>
      </div>

      {writing && <ExportStory onClose={() => setWriting(false)} />}
      {opening && (
        <ImportStory
          canLayer
          onClose={() => setOpening(false)}
          onImported={onChanged}
        />
      )}

      <p className="text-[11px] text-stone-600">
        installing is still the sweep's job — drop a system or pack in the data dir and it
        shows up here on its own. there is no upload from the console.
      </p>
    </section>
  );
}

function ShelfTool() {
  const { data, reload } = useLive(
    () => Promise.all([api<ShelfOut>('/api/shelf'), api<CampaignOut>('/api/campaign')]),
    [],
    { on: ['books'] },
  );
  if (!data) return null;
  const [shelf, campaign] = data;
  const declaredAt = new Map(campaign.packs.map((p, i) => [p.id, i]));

  return (
    <div className="space-y-3">
      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Systems</span>
          <span className="font-mono text-[11px] text-stone-600">{shelf.systems.length}</span>
        </div>
        <ul className="space-y-1">
          {shelf.systems.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm text-stone-100" title={s.id}>
                {s.name}
              </span>
              <span className="font-mono text-[11px] text-stone-600">v{s.version}</span>
            </li>
          ))}
          {shelf.systems.length === 0 && (
            <li className="text-sm text-stone-600">no systems on this host</li>
          )}
        </ul>
      </section>

      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Packs</span>
          <span className="font-mono text-[11px] text-stone-600">{shelf.packs.length}</span>
        </div>
        <ul className="space-y-1">
          {shelf.packs.map((p) => {
            const at = declaredAt.get(p.id);
            return (
              <li key={p.id} className="flex items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-stone-100" title={p.id}>
                  {p.name}
                </span>
                <span className="font-mono text-[11px] text-stone-600">
                  v{p.version}
                  {p.system ? ` · ${p.system}` : ''}
                </span>
                {at !== undefined ? (
                  <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
                    runs #{at + 1}
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-stone-600">not declared</span>
                )}
                <Export
                  path={`/api/packs/${encodeURIComponent(p.id)}/export`}
                  filename={`${p.id}.pack`}
                />
              </li>
            );
          })}
          {shelf.packs.length === 0 && (
            <li className="text-sm text-stone-600">no packs on this host</li>
          )}
        </ul>
      </section>

      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Boards</span>
          <span className="font-mono text-[11px] text-stone-600">{shelf.boards.length}</span>
        </div>
        <ul className="space-y-1">
          {shelf.boards.map((b) => (
            <li key={b.id} className="rounded-md bg-stone-900 px-2 py-1.5 text-sm text-stone-100">
              {b.name}
            </li>
          ))}
          {shelf.boards.length === 0 && (
            <li className="text-sm text-stone-600">no boards on this host</li>
          )}
        </ul>
      </section>

      <ThisCampaign shelf={shelf} campaign={campaign} onChanged={reload} />
    </div>
  );
}

registerTool('shelf', () => <ShelfTool />);
