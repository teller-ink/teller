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

import { useEffect, useRef, useState } from 'react';
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

/** One slug, safe in a path — the campaign's name on disk is its id. */
const pathSlug = (slug: string) => encodeURIComponent(slug);

/**
 * The armed delete — two presses, and the second one names what it is
 * about to take. Deliberately not `window.confirm`: this is a campaign,
 * meaning every character and the whole event log, and a modal nobody
 * reads is exactly the affordance that gets clicked through. The arm
 * disarms itself after a few seconds, so a press left hanging while
 * somebody answers the door goes cold instead of waiting to be nudged.
 */
function DeleteCampaign({
  slug,
  onGone,
  onRefused,
}: {
  slug: string;
  onGone: (where: string) => void;
  onRefused: (why: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const arm = () => {
    setArmed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), 5000);
  };

  if (!armed) {
    return (
      <button className={btnGhost} onClick={arm}>
        delete…
      </button>
    );
  }
  return (
    <button
      className="rounded-md bg-red-900 px-3 py-1.5 text-sm text-red-100 transition-colors hover:bg-red-800 active:bg-red-700 disabled:opacity-40"
      disabled={busy}
      onClick={() => {
        clearTimeout(timer.current);
        setBusy(true);
        api<{ trashed: string }>(`/api/campaigns/${pathSlug(slug)}`, { method: 'DELETE' })
          .then((out) => onGone(out.trashed))
          .catch((e: ApiError) => {
            setArmed(false);
            onRefused(e.message);
          })
          .finally(() => setBusy(false));
      }}
    >
      really delete {slug}?
    </button>
  );
}

function Row({
  row: campaign,
  onSwitched,
  onSaid,
}: {
  row: CampaignRow;
  onSwitched: () => void;
  onSaid: (words: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [slug, setSlug] = useState(campaign.slug);
  const [err, setErr] = useState('');

  const rename = () => {
    const wanted = slug.trim();
    if (!wanted || wanted === campaign.slug) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    setErr('');
    api(`/api/campaigns/${pathSlug(campaign.slug)}`, { method: 'PATCH', body: { slug: wanted } })
      .then(() => {
        setRenaming(false);
        onSaid(`${campaign.slug} is now ${wanted}`);
        onSwitched();
      })
      .catch((e: ApiError) => setErr(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <li
      className={`flex flex-wrap items-center gap-2 rounded-md px-3 py-2 ${
        campaign.active ? 'bg-amber-950/40 ring-1 ring-amber-800/60' : 'bg-stone-900'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-stone-100">{campaign.name}</span>
        <span className="block truncate font-mono text-[11px] text-stone-600">
          {campaign.slug}
          {campaign.system ? ` · ${campaign.system.name}` : ' · no system'}
          {campaign.system && !campaign.system.installed ? ' (missing)' : ''}
        </span>
      </span>
      {campaign.active ? (
        <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
          at the table
        </span>
      ) : (
        <>
          {/*
            Both doors are for campaigns NOT at the table — the server
            refuses the running one, and offering a button that can only
            be told no is worse than not offering it.
          */}
          <button className={btnGhost} onClick={() => setRenaming((r) => !r)}>
            rename
          </button>
          <DeleteCampaign
            slug={campaign.slug}
            onGone={(where) => {
              onSaid(`${campaign.slug} moved to ${where}`);
              onSwitched();
            }}
            onRefused={setErr}
          />
          <button
            className={btn}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              api(`/api/campaigns/${pathSlug(campaign.slug)}/activate`, { method: 'POST' })
                .then(onSwitched)
                .finally(() => setBusy(false));
            }}
          >
            play this
          </button>
        </>
      )}
      {renaming && (
        <form
          className="flex w-full flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <input
            className={`${input} min-w-0 flex-1 font-mono`}
            autoFocus
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="the-file-name"
          />
          <button className={btnPrimary} type="submit" disabled={busy}>
            rename the file
          </button>
          <p className="w-full text-[11px] text-stone-600">
            this is the file on disk — lowercase letters, digits and dashes. the
            campaign’s own title is edited at the table.
          </p>
        </form>
      )}
      {err && <p className="w-full text-sm text-red-500">{err}</p>}
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
  // What the last file operation did, in the words the server used.
  // There is no shelf-level event log for machine state, so this line
  // and the response it echoes ARE the record a delete leaves behind:
  // "where did it go" gets an answer while the DM is still looking.
  const [said, setSaid] = useState('');

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
              <Row key={c.slug} row={c} onSwitched={reload} onSaid={setSaid} />
            ))}
            {data && data.campaigns.length === 0 && (
              <li className="text-sm text-stone-600">
                nothing here yet — the first one goes below.
              </li>
            )}
          </ul>
          {said && <p className="font-mono text-[11px] text-stone-500">{said}</p>}
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
