// The 'screens' tool — every screen in the room, and what each one is.
// Ported grammar from the old app's DisplaysPanel
// (src/components/DisplaysPanel.tsx): an "add a screen" card with the
// pairing-code box, one card per adopted screen with a live dot, a
// rename field, identify/forget, and a row of role/assignment selects
// with the colour swatches pinned to the right.
//
// Trimmed for this host (single campaign, no `campaignId` on a
// `Display` — core-next serves one table): no "on another campaign" /
// "bring here" section, since there's nowhere else for a screen to be.
// The CALIBRATION wizard is here now (it was the noted gap): every
// screen row carries a "calibrate" button, and the pattern it draws
// arrives at that screen over the stream — console-driven, because a
// passive surface grows no controls of its own (rule 6). Still left
// out: pretend-glass sizing.
//
// What came BACK is the last entry in the seat's picker: "+ new
// character…", which the old app had and this didn't. The old one
// then asked the console for a tier and stamped the whole thing here;
// this one writes an empty draft and stops, because the seat now has
// a builder of its own — the draft mark is the whole handoff (§M-4a).
// So the console's job shrank to two ordinary writes a human can undo:
// make an entity wearing the mark, and point the screen at it.

import { useState } from 'react';
import { DRAFT_LIST, DRAFT_MARK } from '../../core/entity.ts';
import { api, panes as fetchPanes } from '../lib/api.ts';
import { CalibrationWizard } from '../components/board/CalibrationWizard.tsx';
import { surfaces } from '../lib/panes.ts';
import { useLive } from '../lib/use-session.ts';
import { btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';
import { registerTool } from './index.ts';

// Mirrors `Display`/`DisplayRole` (core/store.ts) — not imported, same
// reasoning as `runner.tsx`'s local `TurnState`: the server module isn't
// otherwise part of the client's graph.
type DisplayRole = 'console' | 'table' | 'board' | 'art' | 'seat' | 'badge' | 'blank';

type Display = {
  id: string;
  name?: string;
  color?: string;
  role: DisplayRole;
  params: Record<string, unknown>;
  code?: string;
  position?: number;
  lastSeenAt?: string;
  /** This screen's own calibration — px per true inch, per axis. */
  ppi?: number;
  ppiY?: number;
  /** What it last reported about itself; the wizard sizes its strip by it. */
  viewport?: { w: number; h: number };
};

type PanelDecl = { name: string; label?: string; subject?: 'entity' | 'none' };
type RosterEntry = { id: string; name: string; type: string | null };

const ROLES: { value: DisplayRole; label: string; needsEntity?: boolean }[] = [
  { value: 'blank', label: 'blank' },
  { value: 'table', label: 'table' },
  { value: 'board', label: 'board' },
  { value: 'art', label: 'art' },
  { value: 'badge', label: 'badge', needsEntity: true },
  { value: 'seat', label: 'seat', needsEntity: true },
  { value: 'console', label: 'console' },
];

const COLORS = ['#f59e0b', '#38bdf8', '#a3e635', '#f472b6', '#c084fc', '#fb7185'];
const SLOT_SUGGESTIONS = ['tv', 'board', 'art', 'seat'];

/**
 * The picker's last entry, and the sentinel it wears. A `<select>`
 * option needs a value, and every other one here is an entity id — so
 * the new-character door is spelled as something no id can be.
 */
const NEW_ENTITY = '__new';
/**
 * What a character is called before anybody has named it. Ported
 * verbatim from the old app, which stamped a fresh seat as this: a
 * placeholder the builder's first step types over, not a decision.
 */
const FRESH_NAME = 'Drifter';

/** A screen is "live" if it has spoken to us lately. */
function isLive(display: Display): boolean {
  if (!display.lastSeenAt) return false;
  // The new store writes real ISO strings; the massage below is only
  // for the old worker's SQLite spelling ("YYYY-MM-DD HH:MM:SS") and
  // appending 'Z' to an ISO string made every screen read dead (…ZZ).
  const raw = display.lastSeenAt;
  const seen = Date.parse(
    raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z',
  );
  return Number.isFinite(seen) && Date.now() - seen < 60_000;
}

function ScreensTool() {
  const displays = useLive(() => api<Display[]>('/api/displays'), [], {
    on: ['displays', 'assign'],
  });
  const panels = useLive(() => api<PanelDecl[]>('/api/stack/declarations/panels'), [], {
    on: ['plugins'],
  });
  // The provisions, beside the declarations (§15's UI tier, §M-2): a
  // pane nobody can be assigned to is a pane that doesn't exist, and
  // that law never said which of the two sources a pane came from.
  const provided = useLive(() => fetchPanes(), [], { on: ['plugins'] });
  const roster = useLive(() => api<RosterEntry[]>('/api/entities'), [], { on: ['entities'] });

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [calibrating, setCalibrating] = useState<Display | null>(null);

  // Only ADOPTED screens get a card. An unclaimed screen is showing its
  // code across the room and the adopt box above is how it arrives
  // (rule 6: the screen shows the code, the DM types it) — listing the
  // waiting ones just mirrors every open tab back at the console. A dim
  // count keeps them discoverable without giving them furniture.
  const all = displays.data ?? [];
  // The DM's own order (position, assigned at adoption, moved by the
  // arrows) — never by who spoke last: a row must not leap out from
  // under the hand about to touch it. Id breaks ties for stability.
  const list = all
    .filter((d) => !d.code)
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.position ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
    );
  const waiting = all.length - list.length;

  /**
   * Move a row and REINDEX the whole room, 1..n. Swapping raw values
   * broke on rows adopted before ordering existed (their missing
   * position could collide with a neighbor's real one and the swap
   * became a no-op) — writing every row its own index is idempotent,
   * and heals the legacy rows the first time anything moves.
   */
  const nudgeRow = (index: number, delta: -1 | 1) => {
    if (!list[index] || !list[index + delta]) return;
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    Promise.all(
      next.map((d, i) =>
        d.position === i + 1
          ? Promise.resolve()
          : api(`/api/displays/${d.id}`, {
              method: 'PATCH',
              body: { position: i + 1 },
            }),
      ),
    )
      .then(displays.reload)
      .catch(displays.reload);
  };
  // Panels are OFFERED in exactly one dropdown: the console role's
  // pane picker. A seat's shape is the merge's business, not a DM's
  // (Brian, 2026-08-20) — so there is no `'entity'` list here.
  const panes = surfaces(panels.data as PanelDecl[] | undefined, provided.data, 'none');
  // core-next has no reliable PC/NPC signal left on an entity (rule 2 —
  // `type` is free text, a trade name here, and often absent on a fresh
  // character). The old app could restrict this to `kind === 'pc'`;
  // this can't, so a seat or badge picks from everyone, sorted by name —
  // a DM finding the wrong name in a short list beats a right name
  // that never appears because a guessed filter excluded it.
  const party = [...(roster.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const claim = () => {
    if (!code.trim()) return;
    api<Display>('/api/displays/claim', { body: { code: code.trim() } })
      .then(() => {
        setCode('');
        setError('');
        displays.reload();
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  };

  const patch = (id: string, body: Record<string, unknown>) => {
    api(`/api/displays/${id}`, { method: 'PATCH', body }).then(displays.reload).catch(displays.reload);
  };

  /**
   * Make somebody for this seat to be, and point it at them.
   *
   * Two ordinary writes through the ordinary doors — an entity wearing
   * the draft mark, then the assignment — so this is undoable, editable
   * and deletable like anything else (rule 1). Nothing else happens
   * here: the seat notices the mark on its own and puts the builder up.
   * The display's other params are SPREAD, because who a seat shows is
   * a different question from how it's set up.
   */
  const freshFor = (d: Display) => {
    api<{ id: string }>('/api/entities', {
      body: {
        draft: {
          name: FRESH_NAME,
          type: 'pc',
          lists: { [DRAFT_LIST]: [{ name: DRAFT_MARK }] },
        },
      },
    })
      .then((made) => {
        patch(d.id, { params: { ...(d.params ?? {}), entityId: made.id } });
        setError('');
        roster.reload();
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  };

  return (
    <div className="space-y-3">
      {calibrating && (
        <CalibrationWizard
          displayId={calibrating.id}
          name={calibrating.name}
          role={calibrating.role}
          ppi={calibrating.ppi}
          ppiY={calibrating.ppiY}
          viewport={calibrating.viewport}
          onCancel={() => setCalibrating(null)}
          onDone={(ppi, ppiY) => {
            patch(calibrating.id, { ppi, ppiY });
            setCalibrating(null);
          }}
        />
      )}
      <section className={`${card} space-y-2`}>
        <span className={sectionLabel}>Add a screen</span>
        <p className="text-sm text-stone-500">
          Open teller on it — phone, tablet, panel, TV — and type the code it's showing.
        </p>
        <div className="flex gap-2">
          <input
            className={`${input} flex-1 font-mono uppercase tracking-widest`}
            placeholder="K7RM4P"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && claim()}
          />
          <button className={btnPrimary} onClick={claim}>
            adopt
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-sm text-stone-500">
          <span>No spare device? Open one on this machine:</span>
          {SLOT_SUGGESTIONS.map((slot) => (
            <a
              key={slot}
              className="rounded-full bg-stone-900 px-2 py-0.5 font-mono text-xs text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
              href={`/#${slot}`}
              target="_blank"
              rel="noreferrer"
            >
              #{slot}
            </a>
          ))}
          <span className="text-stone-600">— any name works, and each one is its own screen</span>
        </div>
        {waiting > 0 && (
          <p className="mt-2 text-xs text-stone-600">
            {waiting} screen{waiting === 1 ? '' : 's'} showing a code, waiting to be adopted
          </p>
        )}
      </section>

      {list.map((d, i) => {
        const role = ROLES.find((r) => r.value === d.role);
        const params = d.params ?? {};
        return (
          <section key={d.id} className={`${card} space-y-2`}>
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: isLive(d) ? d.color || '#f59e0b' : '#44403c' }}
                title={isLive(d) ? 'live' : d.lastSeenAt ? `last seen ${d.lastSeenAt}` : 'never seen'}
              />
              <input
                className={`${input} min-w-0 flex-1`}
                defaultValue={d.name}
                aria-label="screen name"
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== d.name) patch(d.id, { name });
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <button
                className="rounded-md px-1.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200 disabled:opacity-30"
                title="move up"
                disabled={i === 0}
                onClick={() => nudgeRow(i, -1)}
              >
                ▲
              </button>
              <button
                className="rounded-md px-1.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200 disabled:opacity-30"
                title="move down"
                disabled={i === list.length - 1}
                onClick={() => nudgeRow(i, 1)}
              >
                ▼
              </button>
              <button
                className="rounded-md px-2 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
                title="flash this screen so you can tell which one it is"
                onClick={() => api(`/api/displays/${d.id}/identify`, { method: 'POST' })}
              >
                identify
              </button>
              {/* An inch is an inch on every display, via that display's
                  own ppi — and this is where a human works it out.
                  Offered on every screen, not just the table: a rail
                  panel draws inch-sized things too. */}
              <button
                className={`rounded-md px-2 py-1 text-sm transition-colors hover:bg-stone-800 hover:text-stone-200 ${
                  d.ppi ? 'text-emerald-600/90' : 'text-stone-500'
                }`}
                title={
                  d.ppi
                    ? `calibrated: ${d.ppi.toFixed(1)} × ${(d.ppiY ?? d.ppi).toFixed(1)} px/in`
                    : 'measure this screen against a real inch'
                }
                onClick={() => setCalibrating(d)}
              >
                calibrate
              </button>
              <button
                className="rounded-md px-2 py-1 text-sm text-stone-600 transition-colors hover:bg-red-950 hover:text-red-300"
                title="forget this screen"
                onClick={() => {
                  if (!window.confirm(`Forget "${d.name ?? 'this screen'}"? It'll show a new code.`))
                    return;
                  api(`/api/displays/${d.id}`, { method: 'DELETE' }).then(displays.reload);
                }}
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className={input}
                value={d.role}
                onChange={(e) => patch(d.id, { role: e.target.value as DisplayRole })}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>

              {role?.needsEntity && (
                <select
                  className={input}
                  value={typeof params.entityId === 'string' ? params.entityId : ''}
                  onChange={(e) => {
                    if (e.target.value === NEW_ENTITY) return freshFor(d);
                    patch(d.id, { params: { ...params, entityId: e.target.value || null } });
                  }}
                >
                  <option value="">— whose? —</option>
                  {party.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                  {/* Only a seat: a badge shows somebody who already
                      exists, and a blank draft on one would be a card
                      with nothing on it and no way to fill it in. */}
                  {d.role === 'seat' && <option value={NEW_ENTITY}>+ new character…</option>}
                </select>
              )}

              {/* A seat takes exactly two things — the role and the
                  character — and NO layout (Brian, 2026-08-20). The
                  dropdown that used to sit here offered a seat every
                  entity-subject panel as a "layout", which was the
                  console-pane law leaking into a role it was never
                  written for. Panels are picked in ONE place now: the
                  console's pane picker below. */}

              {d.role === 'console' && (
                <select
                  className={input}
                  value={typeof params.pane === 'string' ? params.pane : ''}
                  onChange={(e) =>
                    patch(d.id, { params: { ...params, pane: e.target.value || null } })
                  }
                >
                  <option value="">full console</option>
                  {panes.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.label ?? p.name}
                    </option>
                  ))}
                </select>
              )}

              <span className="ml-auto flex gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`h-5 w-5 rounded-full transition-transform ${
                      d.color === c ? 'scale-110 ring-2 ring-stone-300' : ''
                    }`}
                    style={{ backgroundColor: c }}
                    title="identify colour"
                    onClick={() => patch(d.id, { color: c })}
                  />
                ))}
              </span>
            </div>
          </section>
        );
      })}

      {list.length === 0 && <p className="px-1 text-sm text-stone-500">No screens yet.</p>}
    </div>
  );
}

registerTool('screens', () => <ScreensTool />);
