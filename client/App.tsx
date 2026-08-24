// Boot + routes. Hash-first, matching the vanilla client exactly so
// bookmarks and assignments survive the swap: #console, #panel=<name>
// (&entity=<id>), #entity=<id>, #board=<id>. Bare hash = this screen's
// assignment (pairing flow when unclaimed).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  api,
  displaySlot,
  hello,
  panes as fetchPanes,
  reportViewport,
  stored,
  forgetSlips,
  type DisplayInfo,
  type Pane,
} from './lib/api.ts';
import { pluginCtx, paneToPanel, surfaces } from './lib/panes.ts';
import { useOptimistic, writeEntry, type EntryEdit } from './lib/entry.ts';
import { DECLARED, onIdentify, PROVIDED, resetStream, useLive } from './lib/use-session.ts';
import { btnPrimary, card, input, sectionLabel } from './lib/ui.ts';
import type { PanelDef } from '../core/panels.ts';
import type { Entity } from '../core/entity.ts';
import { PanelCollection, PanelSurface, type BlockCtx, type Glass } from './panels/render.tsx';
import { SeatChrome } from './components/seat/SeatChrome.tsx';
import { CampaignScreen } from './views/campaigns.tsx';
import { CalibrationOverlay } from './components/board/CalibrationOverlay.tsx';
import { TableView } from './views/TableView.tsx';
import { BoardView } from './views/BoardView.tsx';
import { BadgeView } from './views/BadgeView.tsx';
import { ArtView } from './views/ArtView.tsx';

function useHash(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash.replace(/^#/, ''),
  );
}

function hashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash);
}

// ---- identify flash ----------------------------------------------------

function IdentifyFlash({ me }: { me?: DisplayInfo }) {
  const [shown, setShown] = useState(false);
  useEffect(
    () =>
      onIdentify(() => {
        setShown(true);
        setTimeout(() => setShown(false), 2500);
      }),
    [],
  );
  if (!shown || !me) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: me.color ?? '#b45309' }}
    >
      <p className="font-serif text-6xl text-stone-50">{me.name ?? 'this screen'}</p>
    </div>
  );
}

// ---- key gate ----------------------------------------------------------

function KeyGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <div className="flex min-h-dvh items-center justify-center p-8">
      <form
        className={`${card} flex w-80 flex-col gap-3`}
        onSubmit={(e) => {
          e.preventDefault();
          stored.key = value.trim();
          forgetSlips();
          api('/api/campaign')
            .then(() => onUnlock())
            .catch(() => {
              stored.key = null;
              setBad(true);
            });
        }}
      >
        <p className={sectionLabel}>the key</p>
        <input
          className={input}
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="DM key"
        />
        {bad && <p className="text-sm text-red-500">that's not it</p>}
        <button className={btnPrimary} type="submit">
          unlock
        </button>
      </form>
    </div>
  );
}

// ---- panel route -------------------------------------------------------

/** Aspect-derived glass, live: a rotated tablet re-renders, it doesn't
 * keep the arrangement it woke up with. An ASSIGNED glass still wins. */
function useGlass(params: Record<string, unknown> | undefined): Glass {
  const aspect = useSyncExternalStore(
    (cb) => {
      window.addEventListener('resize', cb);
      return () => window.removeEventListener('resize', cb);
    },
    // ≥ 1.3, the old app's own `wide` threshold (src/views/SeatView.tsx)
    // — a desktop browser is wide glass; only a genuinely portrait hand
    // gets the held arrangement.
    () => (window.innerWidth / window.innerHeight >= 1.3 ? 'mounted' : 'held'),
  );
  const declared = params?.glass;
  if (declared === 'mounted' || declared === 'held') return declared;
  return aspect;
}

/** A SEAT: role and character, and nothing else (Brian, 2026-08-20).
 * There is no layout in this route because a seat takes none — the
 * shape comes off the merge inside `SeatChrome`, which fetches the
 * declarations itself. All this owes it is the glass and the clip
 * (rule 6, held OUTSIDE whatever the frame draws). */
function SeatRoute({ entityId, seatName }: { entityId: string; seatName?: string }) {
  const glass = useGlass(undefined);
  return (
    <div className={glass === 'mounted' ? 'h-dvh overflow-hidden p-3' : 'min-h-dvh p-3'}>
      <SeatChrome entityId={entityId} seatName={seatName} glass={glass} />
    </div>
  );
}

function PanelRoute({
  name,
  entityId,
  seatName,
}: {
  name: string;
  entityId?: string;
  /** This screen's own name — the seat chrome's player line (rule 7). */
  seatName?: string;
}) {
  const glass = useGlass(undefined);
  const panels = useLive(
    () => api<PanelDef[]>('/api/stack/declarations/panels'),
    [],
    { on: DECLARED },
  );
  // Provisions, beside the declarations (§M-2) — a screen may be
  // assigned to a plugin's pane exactly as to a system's panel, and
  // this route is what a `#panel=` hash resolves through.
  const panes = useLive(() => fetchPanes(), [], { on: PROVIDED });
  const records = useLive(
    () =>
      Promise.all(
        ['accents', 'dials', 'brand', 'portraits', 'dice', 'marks', 'carry'].map((slot) =>
          api<Record<string, unknown>>(`/api/stack/record/${slot}`).then(
            (r) => [slot, r] as const,
          ),
        ),
      ).then(Object.fromEntries),
    [],
    { on: DECLARED },
  );
  const provided = panes.data?.find((p) => p.name === name);
  const panel = panels.data?.find((p) => p.name === name) ?? (provided ? paneToPanel(provided) : undefined);
  // An entity-subject panel is rendered by `SeatChrome`, which fetches
  // the sheet itself — so this route asking for the same one is two
  // requests where the wire only needed one. It asks only when the ctx
  // it builds is the one that gets used.
  const ownEntity = Boolean(entityId) && panel?.subject !== 'entity';
  const entity = useLive(
    () =>
      ownEntity
        ? api(`/api/entities/${entityId}?resolved=1`)
        : Promise.resolve(undefined),
    [entityId, ownEntity],
    { on: ['entities'] },
  );
  // What's stored, plus whatever a tap is still asking for — the tapped
  // number moves in the same frame and the server's answer lands on top
  // of it (rule 1, `client/lib/entry.ts`).
  const shown = useOptimistic(entity.data as Entity | undefined);

  if (panels.error)
    return <p className="p-8 text-sm text-red-500">{panels.error.message}</p>;
  if (!panels.data) return null;
  if (!panel)
    return (
      <p className="p-8 text-sm text-stone-500">no panel named '{name}'</p>
    );
  if (panel.subject === 'entity' && !entityId)
    return (
      <p className="p-8 text-sm text-stone-500">
        '{name}' arranges an entity, and this screen isn't pointed at one
      </p>
    );

  const ctx: BlockCtx = {
    glass,
    entity: shown,
    records: (records.data ?? {}) as BlockCtx['records'],
    write: entityId ? (edit) => writeEntry(entityId, edit as EntryEdit) : undefined,
    ...(provided ? { plugin: pluginCtx(provided) } : {}),
  };
  // Glass discipline (rule 6): mounted is fixed-height and never scrolls
  // — overflow is CLIPPED, the diagnostic that a layout doesn't fit that
  // glass. Held is elastic and scrolls down, same as the page always has.
  return (
    <div
      className={
        ctx.glass === 'mounted'
          ? 'h-dvh overflow-hidden p-3'
          : 'min-h-dvh p-3'
      }
    >
      {/* An entity-subject panel is a SEAT, wherever it's viewed from — a
          real seat, or the console previewing one — so it always wears
          the seat chrome (top bar + the segmented bar across the other
          declared layouts). A tool panel (Roster, Runner, …) has no
          subject and stays bare. */}
      {panel.subject === 'entity' && entityId ? (
        <SeatChrome
          entityId={entityId}
          initialPanel={panel.name}
          seatName={seatName}
          glass={ctx.glass}
        />
      ) : (
        // The collection an include resolves against (§M-5a′) — the same
        // merged list this route picked the panel out of, so a
        // `{ block: 'panel', name }` inside it reaches whatever that
        // name merges to.
        <PanelCollection panels={panels.data}>
          <PanelSurface
            panel={panel}
            ctx={ctx}
            fallback={
              <p className="p-8 text-sm text-stone-500">
                '{name}' failed to render — the floor has it
              </p>
            }
          />
        </PanelCollection>
      )}
    </div>
  );
}

// ---- the console -------------------------------------------------------
// One stable URL, a pane bar that swaps content IN PLACE — the old
// DmView's shape. The hash never changes while the DM clicks around:
// with slots, the URL is the screen's IDENTITY, so navigation must not
// rewrite it. `#panel=` remains the ASSIGNMENT route for screens the
// console points somewhere.

function Console() {
  // Which campaign is at the table, asked FIRST: a host with none has
  // no content stack, so there are no panels to render and the console
  // is the campaign screen until the DM picks one. This endpoint
  // answers on a bare host too (slug: null) precisely so this check
  // isn't an error path.
  const campaign = useLive(
    () => api<{ slug: string | null; manifest: { name: string } | null }>('/api/campaign'),
    [],
    // Nothing narrower than the always-words: which campaign is at the
    // table changes on 'campaign' and on nothing else.
    { on: [] },
  );
  const [picking, setPicking] = useState(false);
  const panels = useLive(
    () => api<PanelDef[]>('/api/stack/declarations/panels'),
    [],
    { on: DECLARED },
  );
  // The tab bar reads TWO sources and always has, since the day a
  // plugin could put a screen up (§15's UI tier): the merged `panels`
  // slot, and whatever the enabled plugins provide. `surfaces()` is
  // where they become one list, ordered by the one comparator. A host
  // with no plugins gets `[]` back and the bar is exactly what it was.
  const panes = useLive(() => fetchPanes(), [], { on: PROVIDED });
  const records = useLive(
    () =>
      Promise.all(
        ['accents', 'dials', 'brand', 'portraits', 'dice', 'marks', 'carry'].map((slot) =>
          api<Record<string, unknown>>(`/api/stack/record/${slot}`).then(
            (r) => [slot, r] as const,
          ),
        ),
      ).then(Object.fromEntries),
    [],
    { on: DECLARED },
  );
  // A PREFERENCE, not a declaration: 'roster' is where a table wants to
  // land, but it's a system-layer panel now (2026-08-19) and a bare host
  // has none — so the `?? tools[0]` below is the real contract, and the
  // highlight reads from `current`, never from `pane`.
  //
  // Remembered per SCREEN, never in the URL: the hash is the screen's
  // IDENTITY (rule 6) and must not change as the DM clicks around — but
  // a refresh mid-fight landing back on the roster loses the runner, so
  // the last pick survives in storage. Keyed by the slot, exactly like
  // the display id one shelf over: two slotted tabs in one browser are
  // two screens, and one screen's click must not aim the other on its
  // next refresh (found live by Brian, 2026-08-20). A remembered pane a
  // later system doesn't declare falls through `?? tools[0]`.
  const paneKey = displaySlot() ? `teller.console.pane.${displaySlot()}` : 'teller.console.pane';
  const [pane, setPaneState] = useState(
    () => localStorage.getItem(paneKey) ?? 'roster',
  );
  const setPane = (name: string) => {
    setPaneState(name);
    try {
      localStorage.setItem(paneKey, name);
    } catch {
      // Storage full or blocked — the click still works for this visit.
    }
  };
  const tools = surfaces(panels.data, panes.data, 'none');
  const current = tools.find((p) => p.name === pane) ?? tools[0];
  const currentPane = (panes.data ?? []).find(
    (p) => p.subject !== 'entity' && p.name === current?.name,
  );

  // In-place view state, never a route: the console is ONE stable url
  // (rule 6), and a bookmark into "the campaign screen" would be a
  // bookmark into a state that stops existing the moment someone picks.
  if (campaign.data && !campaign.data.slug) return <CampaignScreen />;
  if (picking) return <CampaignScreen onBack={() => setPicking(false)} />;

  if (!panels.data) return null;
  const ctx: BlockCtx = {
    glass: 'held',
    records: (records.data ?? {}) as BlockCtx['records'],
    ...(currentPane ? { plugin: pluginCtx(currentPane) } : {}),
  };
  return (
    <div className="min-h-dvh p-4">
      <nav className="mb-4 flex flex-wrap items-center gap-1.5">
        {tools.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => setPane(p.name)}
            className={`rounded-full px-3 py-1 font-mono text-sm transition-colors ${
              current?.name === p.name
                ? 'bg-amber-700 text-stone-50'
                : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            {(p.label ?? p.name).toLowerCase()}
          </button>
        ))}
        {/* Which story this is, and the way to another one. Far right,
            quiet: it's the room's title bar, not a tool. */}
        <button
          type="button"
          onClick={() => setPicking(true)}
          title="switch campaign"
          className="ml-auto rounded-full px-3 py-1 font-mono text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
        >
          {(campaign.data?.manifest?.name ?? campaign.data?.slug ?? '—').toLowerCase()}
        </button>
      </nav>
      {current ? (
        <PanelSurface
          panel={current}
          ctx={ctx}
          fallback={
            <p className="p-8 text-sm text-stone-500">
              '{current.name}' failed to render
            </p>
          }
        />
      ) : (
        <p className="p-8 text-sm text-stone-500">no tools declared</p>
      )}
    </div>
  );
}

// ---- pairing -----------------------------------------------------------

function PairScreen() {
  const me = useLive(() => hello(), [], { on: ['displays', 'assign'] });
  const display = me.data?.display;
  // Heartbeat: quick while a code is showing (the DM is typing it),
  // slow forever after — an adopted screen that never says hello reads
  // as dead in the console (grey dot, "last seen an hour ago").
  useEffect(() => {
    const t = setInterval(() => me.reload(), display?.code ? 3000 : 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display?.code]);
  // Adoption invalidates the slips: on a key-holding machine the stream
  // bound to 'dm' before the DM adopted this screen, and identify aims
  // at the screen's OWN handle — reconnect under the new identity.
  const wasCode = useRef(false);
  useEffect(() => {
    if (display?.code) wasCode.current = true;
    else if (display && wasCode.current) {
      wasCode.current = false;
      forgetSlips();
      resetStream();
    }
  }, [display, display?.code]);
  if (!display) return null;
  if (display.code)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <p className={sectionLabel}>pair this screen</p>
        <p className="font-mono text-7xl tracking-[0.3em] text-amber-500">
          {display.code}
        </p>
        <p className="text-sm text-stone-500">
          read this code to the DM — they'll adopt it from the console
        </p>
      </div>
    );
  const params = (display.params ?? {}) as Record<string, unknown>;
  if (display.role === 'seat' && typeof params.entityId === 'string')
    return <SeatRoute entityId={params.entityId} seatName={display.name} />;
  if (display.role === 'console')
    return typeof params.pane === 'string' ? (
      <PanelRoute name={params.pane} />
    ) : (
      <Console />
    );
  // The passive surfaces (rule 6). Each renders the player-safe
  // snapshot whole and offers nothing to touch; the table's calibration
  // is its own row, so it comes off this display and not the campaign.
  if (display.role === 'table')
    return <TableView ppi={display.ppi} ppiY={display.ppiY} />;
  if (display.role === 'board') return <BoardView />;
  if (display.role === 'art') return <ArtView />;
  if (display.role === 'badge' && typeof params.entityId === 'string')
    return <BadgeView entityId={params.entityId} />;
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-stone-500">
        adopted as '{display.role ?? 'blank'}' — waiting for a job
      </p>
    </div>
  );
}

// ---- app ---------------------------------------------------------------

export default function App() {
  const hash = useHash();
  const [unlocked, setUnlocked] = useState(() => Boolean(stored.key));
  const me = useLive(() => hello(), [], { on: ['displays', 'assign'] });

  // How big this glass is, told once and again when it changes. The
  // console reads it back to draw what the table can actually SHOW at
  // true scale, and to warn when a calibration strip runs off the edge
  // — neither of which can be derived from anywhere else, because only
  // the screen knows its own pixel count.
  const ready = Boolean(me.data?.display?.id);
  useEffect(() => {
    if (!ready) return;
    void reportViewport();
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void reportViewport(), 500);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, [ready]);

  const params = hashParams(hash);
  const wantsConsole =
    hash === 'console' ||
    params.has('panel') ||
    params.has('entity') ||
    params.has('board');

  let view: React.ReactNode;
  if (wantsConsole && !unlocked) view = <KeyGate onUnlock={() => setUnlocked(true)} />;
  else if (params.has('panel'))
    view = (
      <PanelRoute
        name={params.get('panel')!}
        entityId={params.get('entity') ?? undefined}
        seatName={me.data?.display?.name}
      />
    );
  else if (hash === 'console') view = <Console />;
  // Bare url on a key-holding browser is the console, as it always was.
  // A named slot (`#warden_left`) is its OWN screen — even here — so a
  // DM's machine can host the console AND any number of paired panels.
  else if (!hash && !displaySlot() && unlocked) view = <Console />;
  else view = <PairScreen />;

  return (
    <>
      {view}
      <IdentifyFlash me={me.data?.display} />
      {/* Beside the identify flash and for the same reason: both are
          console-driven things that must reach a surface whatever that
          surface's job is, and neither belongs to the view underneath
          (rule 6). A screen being measured against a physical inch is
          not doing its job at that moment — the ruler covers the lot. */}
      <CalibrationOverlay />
    </>
  );
}
