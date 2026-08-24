// The 'runner' tool — the turn order, running. Rebuilt against the old
// app's shape (src/components/EncounterPanel.tsx + TurnStage.tsx), which
// is the visual and behavioural spec:
//
//   * the ORDER on the left, a thing you SCAN — a number, a name, a bar,
//     a dot — with the acting row picked out and the health steppers on
//     the row you're hovering. The edit you make most often is to
//     somebody ELSE'S health, on the turn of the thing that just hit
//     them, so it lives there and never costs you the stage;
//   * the STAGE on the right, one combatant at full size (`TurnStage`);
//   * the controls under it: back, next turn, end;
//   * and setup folded to one line the moment a fight is running.
//
// The old panel's ✦ card is back, in one piece, under the stage — and
// it is assembled HERE, out of two things that know nothing about each
// other: a `ProviderSlot` (this file names a POINT, 'propose.turn', and
// cannot learn what provides it) holding an `Exchange` (teller's own
// roll/target/defense/resolve flow). The card and every step in it draw
// with every plugin turned off; the ask in its header, and the freeform
// line under it, are the only parts that come and go with a provider.
// Arming an action is a tap on the stage, and the exchange runs
// identically either way. What the
// runner hands down is what the fight needs and this file doesn't know —
// the order, the sheets, and the system's own records (dice, pins, use).
//
// The order DRAGS (rule 5 — "the DM can always drag, and dragging beats
// anything teller worked out"). The handle is the position number,
// which costs the row no width, and the gesture is POINTER-based rather
// than the browser's own drag-and-drop: this console is an iPad as
// often as it's a laptop, and HTML5 dnd does not exist under a finger.
// The drop settles instantly and then goes through the same door the
// arrows use — `{op:'set'}` — so the optimistic list is only ever
// standing in for a round trip that's already on its way. The arrows
// stay: a drag is a gesture, and a gesture wants an affordance that
// isn't one.
//
// Also owns the 'turn' BLOCK (entity panels' slice of the same state):
// a seat's own sheet can show "you're up" without importing this whole
// tool.

import { useEffect, useRef, useState, type PointerEvent as PointerEvt } from 'react';
import type { Entity } from '../../core/entity.ts';
import type { TurnProposal } from '../../core/registry.ts';
import { pendingEvents } from '../../core/frenzy.ts';
import { api } from '../lib/api.ts';
import { rollPool, tallyFaces, type DiceRecord } from '../lib/dice.ts';
import { DECLARED, useLive } from '../lib/use-session.ts';
import { useOptimisticAll, writeEntry } from '../lib/entry.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';
import { registerBlock, type BlockCtx } from '../panels/render.tsx';
import { ProviderSlot } from '../components/ProviderSlot.tsx';
import { VitalBar } from '../components/Vitals.tsx';
import { Exchange, type Armed, type StatusDecl } from '../components/encounters/Exchange.tsx';
import { TurnStage } from '../components/encounters/TurnStage.tsx';
import { registerTool } from './index.ts';

// The `initiative` stack record (docs/CORE-NEXT.md §J, same shallow-merge
// slot as `dice`/`marks`): which skill decides order, and which way it
// reads. Ported straight off the old app's template row — Guidebook,
// Turn Order: "the Warden will ask the players to roll with Finesse to
// determine turn order. The player with the highest number of Hits will
// go first" — `{ field: 'finesse', highWins: true }`. Fetching it live
// rather than hardcoding "finesse" is what makes this generic: a
// different system's row changes the record, not this file.
type InitiativeRecord = { field?: string; highWins?: boolean };

/**
 * The `use` record — what an action is paid out of. Already declared for
 * the carried screens' fire button; the runner needs the same counter,
 * which is what keeps a cost from being a word spelled in this file.
 */
type UseRecord = { costCounter?: string };

/** Enough of a kind declaration to read a list's ceiling off it. */
type KindDecl = { name: string; domain?: { kind?: string; cap?: number } };

/**
 * Which list a hung condition is written to — the same word the stage
 * already draws its status chips from, and the one the system declares a
 * kind for (its label and its ceiling ride that declaration, so the
 * VOCABULARY is the pack's; only the slot is spelled here).
 */
const CONDITIONS = 'conditions';

// ---- the shape of /api/turn (server/turn.ts) — mirrored, not imported:
// the server module isn't otherwise part of the client's dependency
// graph, and this is the whole of what the tool needs from it. ----

type TurnEntry = {
  id: string;
  entityId?: string;
  label?: string;
  score?: number | null;
};

type TurnState = {
  order: TurnEntry[];
  turn: number | null;
  round: number;
  rolling?: boolean;
};

type TurnOp =
  | { op: 'set'; order: TurnEntry[] }
  | { op: 'add'; entityId?: string; label?: string }
  | { op: 'remove'; entryId: string }
  | { op: 'next' }
  | { op: 'prev' }
  | { op: 'end' }
  | { op: 'rolling'; on: boolean }
  | { op: 'score'; entryId: string; score: number | null };

type RosterEntry = { id: string; name: string; type: string | null };

/**
 * Enough of the live board to answer one question per row: is this
 * creature ON the table? A placement links an entity the same way a
 * turn entry does, so the answer is set membership and nothing more.
 *
 * Read in two hops, and the split is deliberate. WHICH board is active
 * comes off the public snapshot, because that is the one endpoint that
 * reads the live manifest — `/api/campaign` answers from the LOADED
 * one, which a board swap pointedly does not re-resolve, so it would
 * still be naming yesterday's map. WHAT is standing on it comes off
 * `/api/board-state`, because the runner is DM glass and a hidden
 * placement is still a mini somebody put down; the public copy has it
 * stripped, correctly, for screens the table can see.
 */
type Placement = { entityId?: string };
type BoardState = { placements?: Placement[] };
type PublicBoard = { board: { board?: { id?: string } } | null };

/** Mirrors `Display` (core/store.ts) — same reasoning as `TurnState`. */
type Display = {
  id: string;
  role: string;
  color?: string;
  params: Record<string, unknown>;
  lastSeenAt?: string;
};

/** A screen is "live" if it has spoken to us lately (ported from `screens.tsx`). */
function isLive(display: Display): boolean {
  if (!display.lastSeenAt) return false;
  const raw = display.lastSeenAt;
  const seen = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return Number.isFinite(seen) && Date.now() - seen < 60_000;
}

function move(order: TurnEntry[], from: number, to: number): TurnEntry[] {
  if (to < 0 || to >= order.length) return order;
  const next = order.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The counter a hit comes off — the first BOUNDED one, as everywhere.
 * `resources` first because that's where the system files them; any
 * other list is the floor under a sheet that doesn't (rule 2 — teller
 * never learns a counter's name).
 */
function vitalOf(entity: Entity | undefined) {
  if (!entity) return undefined;
  const ordered = [
    ...(entity.lists.resources ?? []),
    ...Object.entries(entity.lists)
      .filter(([key]) => key !== 'resources')
      .flatMap(([, entries]) => entries),
  ];
  return ordered.find((e) => typeof e.max === 'number' && e.max > 0);
}

function RunnerTool() {
  const turn = useLive(() => api<TurnState>('/api/turn'), [], { on: ['turn'] });
  const roster = useLive(() => api<RosterEntry[]>('/api/entities'), [], { on: ['entities'] });
  // The system's own vocabulary, all of it: dice, statuses, accents,
  // icons, pins, defenses, kinds. None of it moves while a fight runs —
  // it re-resolves on a sweep and grows when a plugin is enabled, and
  // that is the whole of its interest (`client/lib/use-session.ts`).
  const dice = useLive(() => api<DiceRecord>('/api/stack/record/dice'), [], { on: DECLARED });
  const initiative = useLive(() => api<InitiativeRecord>('/api/stack/record/initiative'), [], {
    on: DECLARED,
  });
  const statuses = useLive(() => api<StatusDecl[]>('/api/stack/declarations/statuses'), [], {
    on: DECLARED,
  });
  const accents = useLive(() => api<Record<string, string>>('/api/stack/record/accents'), [], {
    on: DECLARED,
  });
  const icons = useLive(() => api<Record<string, string>>('/api/stack/record/icons'), [], {
    on: DECLARED,
  });
  const pins = useLive(() => api<Record<string, string[]>>('/api/stack/record/pins'), [], {
    on: DECLARED,
  });
  const defenses = useLive(() => api<Record<string, unknown>>('/api/stack/record/defenses'), [], {
    on: DECLARED,
  });
  const use = useLive(() => api<UseRecord>('/api/stack/record/use'), [], { on: DECLARED });
  const kinds = useLive(() => api<KindDecl[]>('/api/stack/declarations/kinds'), [], {
    on: DECLARED,
  });
  const displays = useLive(() => api<Display[]>('/api/displays'), [], {
    on: ['displays', 'assign'],
  });
  // Which board the table is looking at, then what is standing on it.
  // No board active means no markers and no noise.
  const board = useLive(async () => {
    const snapshot = await api<PublicBoard>('/api/public');
    const id = snapshot.board?.board?.id;
    if (!id) return null;
    return await api<BoardState | null>(`/api/board-state/${id}`);
    // Which board is up and what stands on it — neither of which the
    // turn moving can change.
  }, [], { on: ['board', 'boards'] });
  const [draft, setDraft] = useState('');
  /** What the thing ON STAGE is about to do. Cleared when the stage changes. */
  const [armed, setArmed] = useState<Armed | undefined>(undefined);
  /** The words a proposal offered to read aloud — the narration's front bookend. */
  const [spoken, setSpoken] = useState<string | undefined>(undefined);
  /**
   * A DETOUR: which row the DM clicked to look at, if it isn't the one
   * acting (Brian, 2026-08-20 — "switch which thing I'm looking at
   * during the encounter just by clicking its row"). `null` means the
   * fight, which is the stage's default job; a click is a look aside,
   * and the moment acting changes it snaps back on its own. View-local
   * and nobody else's business — a screen deciding what IT is looking
   * at is not state anyone argues about (rule 9).
   */
  const [viewing, setViewing] = useState<string | null>(null);
  const [rollingFoes, setRollingFoes] = useState(false);
  /** Setup, while a fight is running — closed by default, on purpose. */
  const [setupOpen, setSetupOpen] = useState(false);
  /**
   * A drag in flight. `rects` is the list's layout as it stood when the
   * finger went down: the dragged row is transformed while it lifts, so
   * hit-testing against live rectangles would have the row chasing
   * itself down the list.
   */
  const [drag, setDrag] = useState<{
    entryId: string;
    from: number;
    startY: number;
    y: number;
    rects: DOMRect[];
  } | null>(null);
  /** Where the row would land — an insertion point, 0…order.length. */
  const [over, setOver] = useState<number | null>(null);
  /**
   * The order as the drop left it, held only until the host says the
   * same thing back. Optimism with an expiry date: the drop still goes
   * through `{op:'set'}` like the arrows do, and this only stands in for
   * the round trip it started.
   */
  const [settled, setSettled] = useState<TurnEntry[] | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  const served = turn.data?.order ?? [];
  const servedIds = served.map((e) => e.id).join(',');
  useEffect(() => {
    if (settled && settled.map((e) => e.id).join(',') === servedIds) setSettled(null);
  }, [servedIds, settled]);

  const order = settled ?? served;
  const running = turn.data?.turn !== null && turn.data !== undefined;
  const rolling = turn.data?.rolling ?? false;

  // Every sheet in the order, resolved, in ONE go — the bars, the
  // steppers and the stage all read the same fetch, so a row and the
  // stage can never disagree about a number. Keyed on the ids so adding
  // somebody refetches and nothing else does.
  const ids = order.map((e) => e.entityId).filter((id): id is string => Boolean(id));
  const sheets = useLive(
    async () =>
      Object.fromEntries(
        await Promise.all(
          ids.map(async (id) => [id, await api<Entity>(`/api/entities/${id}?resolved=1`)] as const),
        ),
      ) as Record<string, Entity>,
    [ids.join(',')],
    { on: ['entities'] },
  );
  // Stored, plus whatever a tap is still asking for — the stage, the
  // rows and the exchange all read this one map, so a stepper on the
  // stage moves in the same frame everywhere it shows.
  const shown = useOptimisticAll(sheets.data);
  const sheetOf = (id: string | undefined) => (id ? shown?.[id] : undefined);

  /** The declared ceiling for hung conditions, presented and never enforced. */
  const conditionCap = (kinds.data ?? []).find((k) => k.name.toLowerCase() === CONDITIONS)?.domain
    ?.cap;

  const op = (o: TurnOp) => {
    // Walking the order puts down whatever was armed: an action belongs
    // to the turn that armed it, and carrying one forward is how a
    // creature ends up swinging somebody else's attack.
    if (o.op === 'next' || o.op === 'prev' || o.op === 'end') setArmed(undefined);
    return api('/api/turn', { body: o }).then(turn.reload);
  };

  // The drag, in three handlers. The pointer is captured by the handle
  // it went down on, so the gesture survives the row moving out from
  // under it, and the drop is one `{op:'set'}` — a move is a move, and
  // it goes through the door the arrows already use.
  const startDrag = (entryId: string, from: number, e: PointerEvt<HTMLElement>) => {
    const rows = listRef.current ? Array.from(listRef.current.children) : [];
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      entryId,
      from,
      startY: e.clientY,
      y: e.clientY,
      rects: rows.map((el) => el.getBoundingClientRect()),
    });
    setOver(null);
  };

  const moveDrag = (e: PointerEvt<HTMLElement>) => {
    if (!drag) return;
    let at = drag.rects.length;
    for (let i = 0; i < drag.rects.length; i++) {
      if (e.clientY < drag.rects[i].top + drag.rects[i].height / 2) {
        at = i;
        break;
      }
    }
    setDrag({ ...drag, y: e.clientY });
    // Either side of where it already sits is not a move, and an
    // indicator that says otherwise is a lie about what a drop will do.
    setOver(at === drag.from || at === drag.from + 1 ? null : at);
  };

  const endDrag = () => {
    if (!drag) return;
    const insert = over;
    const from = drag.from;
    setDrag(null);
    setOver(null);
    if (insert === null) return;
    const to = insert > from ? insert - 1 : insert;
    if (to === from) return;
    const next = move(order, from, to);
    setSettled(next);
    op({ op: 'set', order: next }).catch(() => setSettled(null));
  };


  const names = new Map((roster.data ?? []).map((e) => [e.id, e.name]));
  const roles = new Map((roster.data ?? []).map((e) => [e.id, e.type]));
  const seated = new Set(order.map((e) => e.entityId).filter(Boolean));
  const unlisted = (roster.data ?? []).filter((e) => e.type && e.type !== 'foe' && !seated.has(e.id));

  /** Which entities somebody is sitting in front of, and whether they're live. */
  const seats = new Map(
    (displays.data ?? [])
      .filter((d) => d.role === 'seat' && typeof d.params?.entityId === 'string')
      .map((d) => [String(d.params.entityId), d]),
  );

  /**
   * Who is standing on the live board. A marker and never a control —
   * where a mini goes is decided by a hand, and this only says the hand
   * already went there.
   */
  const placed = new Set(
    (board.data?.placements ?? [])
      .map((p) => p.entityId)
      .filter((id): id is string => Boolean(id)),
  );

  const addEntry = (label: string, entityId: string | null) => {
    const trimmed = label.trim();
    if (!trimmed && !entityId) return;
    op({ op: 'add', entityId: entityId ?? undefined, label: trimmed || undefined });
    setDraft('');
  };

  // Foes with a seat in the order and nothing rolled yet — a re-run
  // after someone's hand-typed a score leaves that entry alone.
  const unrolledFoes = order.filter(
    (e) => e.entityId && roles.get(e.entityId) === 'foe' && e.score == null,
  );

  /**
   * Roll initiative (rule 5, as amended — teller may roll for monsters;
   * the players' dice stay physical). One press does what the old app's
   * did: opens the rolling phase, clearing every score so a stale number
   * can't silently sort somebody wrong, then throws for the foes and
   * writes each total the same way a hand-typed score would — a proposal
   * into `POST /api/turn {op:'score'}`, one drag from being overruled.
   *
   * It reads the `initiative` record for which skill decides it and the
   * `dice` record for how this system's dice read, so a different system
   * changes a row, not this file.
   *
   * Deliberately does NOT touch `dice.banks` (Ace → Aces): banking an
   * Ace onto a counter is a player-facing beat at the table, and a foe
   * rolled by teller has nobody to hand that beat to.
   */
  const rollInitiative = async () => {
    setRollingFoes(true);
    try {
      const fresh = await api<TurnState>('/api/turn', { body: { op: 'rolling', on: true } });
      const field = initiative.data?.field?.toLowerCase();
      if (dice.data && field) {
        for (const entry of fresh.order) {
          if (!entry.entityId || roles.get(entry.entityId) !== 'foe') continue;
          const foe = sheetOf(entry.entityId) ?? (await api<Entity>(`/api/entities/${entry.entityId}?resolved=1`));
          const skill = (foe.lists?.skills ?? []).find((s) => s.name.toLowerCase() === field);
          if (!skill || typeof skill.value !== 'string') continue;
          const faces = rollPool(skill.value, dice.data);
          const { total } = tallyFaces(faces, dice.data);
          await api('/api/turn', { body: { op: 'score', entryId: entry.id, score: total } });
        }
      }
      turn.reload();
    } finally {
      setRollingFoes(false);
    }
  };

  const acting = turn.data?.turn !== null && turn.data ? order[turn.data.turn!] : undefined;
  const actingId = acting?.id;

  // Whoever is ON the stage: the detour if there is one and it's still
  // in the order, otherwise the fight.
  const detour = viewing ? order.find((e) => e.id === viewing) : undefined;
  const staged = detour ?? acting;
  const stagedId = staged?.id;
  const stagedSheet = sheetOf(staged?.entityId);
  const stagedIndex = staged ? order.findIndex((e) => e.id === staged.id) : -1;
  /** Looking at something other than the fight — the only time the way back is offered. */
  const asideFrom = detour && detour.id !== actingId ? detour : undefined;

  // Acting changes, the stage goes back to the fight. A click is a
  // detour and a detour has a natural end: the turn passing.
  useEffect(() => {
    setViewing(null);
  }, [actingId]);

  // The op() clear above only covers walks THIS screen made. The stage
  // can also change under us — another console, a score reshuffle, or
  // this screen's own detour — and an action armed for the last thing
  // on stage must never stand for the next one (it's how a creature
  // ends up swinging somebody else's attack). What's staged changes,
  // the arm drops.
  useEffect(() => {
    setArmed(undefined);
  }, [stagedId]);

  // ------------------------------------------------------------- the order

  const rosterRow = (entry: TurnEntry, i: number) => {
    const sheet = sheetOf(entry.entityId);
    const vital = vitalOf(sheet);
    const isTurn = turn.data?.turn === i;
    const foe = entry.entityId ? roles.get(entry.entityId) === 'foe' : false;
    const label = entry.label ?? (entry.entityId && names.get(entry.entityId)) ?? '?';
    // Mid-roll, the LIST is the status board: a row still owed a number
    // says so on the row, not in a sentence above it.
    const owed = rolling && entry.score == null;
    const seat = entry.entityId ? seats.get(entry.entityId) : undefined;
    const accent = sheet?.type ? accents.data?.[sheet.type] : undefined;
    // A one-shot whose line has just been crossed doesn't wait for its
    // owner's turn, so the ROW is where it has to say so — the stage is
    // showing somebody else. It only ever proposes: crossing it is still
    // a tap, over on that creature's own turn (rule 1).
    const pending = pendingEvents(sheet);
    const lifting = drag?.entryId === entry.id;
    const onTable = entry.entityId ? placed.has(entry.entityId) : false;
    // Two different facts, two different looks: the acting row keeps its
    // amber whatever anyone is looking at, and the row being LOOKED at
    // gets a quiet outline that never competes with it.
    const isAside = asideFrom?.id === entry.id;

    // The line the row would land on. Drawn INSIDE the row rather than
    // between rows, because a list that grows a gap while you drag is a
    // list whose rows move away from the finger holding one.
    const marker = <div className="pointer-events-none -mx-1.5 h-0.5 rounded bg-amber-400" />;

    return (
      <li
        key={entry.id}
        className={`group border-l-2 py-1.5 pl-2 pr-1.5 transition-colors ${
          owed
            ? 'border-l-amber-500 bg-stone-900'
            : isTurn
              ? 'border-l-amber-600 bg-amber-950/40'
              : foe
                ? 'border-l-red-900/70 bg-stone-900/40 hover:bg-stone-900'
                : 'border-l-stone-700 bg-stone-900/40 hover:bg-stone-900'
        } ${isAside ? 'ring-1 ring-inset ring-stone-500/70' : ''} ${
          lifting ? 'relative z-10 scale-[1.02] shadow-lg shadow-stone-950/60' : ''
        }`}
        style={{
          ...(!isTurn && !owed && !foe && accent ? { borderLeftColor: accent } : {}),
          ...(lifting && drag ? { transform: `translateY(${drag.y - drag.startY}px)` } : {}),
        }}
      >
        {over === i && marker}
        <div className="flex items-center gap-1.5">
          {/* The position number IS the handle — it costs the row no
              width, and the thing you grab to move a row to third is the
              thing that says which place it's in. */}
          <span
            className={`w-4 shrink-0 cursor-grab touch-none select-none text-right font-mono text-[10px] ${
              isTurn ? 'text-amber-300' : 'text-stone-600'
            } ${lifting ? 'cursor-grabbing text-amber-200' : ''}`}
            title="drag to reorder"
            onPointerDown={(e) => {
              if (e.button !== 0 && e.pointerType === 'mouse') return;
              e.preventDefault();
              startDrag(entry.id, i, e);
            }}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {i + 1}
          </span>

          {/* During rolls the score sits where the position number is:
              it's the thing you're scanning for. */}
          {rolling &&
            (owed ? (
              <>
                <span
                  className="animate-pulse rounded bg-amber-700 px-1 py-0.5 font-mono text-[9px] font-semibold text-stone-950"
                  title="hasn't rolled yet"
                >
                  ROLL
                </span>
                <input
                  className="w-10 rounded bg-stone-800 px-1 py-0.5 text-center font-mono text-[11px] text-stone-100 focus:outline-none"
                  inputMode="numeric"
                  placeholder="—"
                  aria-label={`${label} rolled`}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const n = Number(e.currentTarget.value.trim());
                    if (!Number.isFinite(n)) return;
                    op({ op: 'score', entryId: entry.id, score: n });
                  }}
                />
              </>
            ) : (
              <span className="rounded bg-stone-800 px-1 py-0.5 font-mono text-[10px] text-amber-300">
                {entry.score}
              </span>
            ))}

          {/* The NAME is the way onto the stage — the handle still drags,
              the steppers still edit, and clicking what a row IS puts
              that thing under the light. Clicking it again lets go. */}
          <button
            className={`min-w-0 flex-1 truncate text-left text-[13px] ${
              isTurn ? 'text-amber-100' : 'text-stone-300'
            } hover:text-amber-200`}
            title="put on the stage"
            onClick={() => setViewing((v) => (v === entry.id ? null : entry.id))}
          >
            {label}
          </button>

          {/* The one thing on this row that can't wait for a turn. */}
          {pending.length > 0 && (
            <span
              className="shrink-0 animate-pulse font-mono text-[11px] text-rose-300"
              title={`${pending.map((f) => f.name).join(', ')} — happens now, once`}
            >
              ◈
            </span>
          )}

          {/* There's a mini for this one on the live board. A GLYPH, not
              a dot, so it can't be read as one more condition — and
              nothing at all when no board is up. */}
          {onTable && (
            <span
              className="shrink-0 font-mono text-[10px] leading-none text-emerald-500/80"
              title="on the table"
            >
              ▣
            </span>
          )}

          {/* Somebody is sitting in front of this one, and whether their
              screen is still talking to us. */}
          {seat && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: isLive(seat) ? seat.color || '#34d399' : '#44403c' }}
              title={isLive(seat) ? 'seated, live' : 'seated, not answering'}
            />
          )}

          {/* Conditions, as colour. The chips live on the stage. */}
          {(sheet?.lists.conditions ?? []).length > 0 && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400"
              title={(sheet?.lists.conditions ?? [])
                .map((c) => (c.value === undefined ? c.name : `${c.name} ${c.value}`))
                .join(', ')}
            />
          )}

          {/* The edit you make most often is to somebody ELSE'S health,
              on the turn of the thing that just hit them. */}
          {vital && entry.entityId && (
            <span
              className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
                isTurn ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
              }`}
            >
              <button
                className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                aria-label={`${vital.name} down`}
                onClick={() =>
                  writeEntry(entry.entityId!, {
                    list: 'resources',
                    name: vital.name,
                    value: Math.max(0, (typeof vital.value === 'number' ? vital.value : 0) - 1),
                  })
                }
              >
                −
              </button>
              <span className="min-w-9 text-center font-mono text-[11px] text-stone-300">
                {typeof vital.value === 'number' ? vital.value : 0}
                {typeof vital.max === 'number' && (
                  <span className="text-stone-600">/{vital.max}</span>
                )}
              </span>
              <button
                className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                aria-label={`${vital.name} up`}
                onClick={() =>
                  writeEntry(entry.entityId!, {
                    list: 'resources',
                    name: vital.name,
                    value: Math.min(
                      typeof vital.max === 'number' ? vital.max : Number.MAX_SAFE_INTEGER,
                      (typeof vital.value === 'number' ? vital.value : 0) + 1,
                    ),
                  })
                }
              >
                +
              </button>
            </span>
          )}

          {/* The rare row actions — reorder, remove — ride along on hover
              rather than crowding a row you read eight of at a glance.
              HIDDEN rather than transparent, unlike the steppers: a
              stepper reserves its space so the number it edits doesn't
              jump under the hand, and these have no such number. Held
              transparent they cost 3rem of every name, and a column of
              "Bark Wa…" is what the sidebar is for reading. */}
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button
              className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100 disabled:opacity-30"
              disabled={i === 0}
              title="earlier in the order"
              onClick={() => op({ op: 'set', order: move(order, i, i - 1) })}
            >
              ▲
            </button>
            <button
              className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100 disabled:opacity-30"
              disabled={i === order.length - 1}
              title="later in the order"
              onClick={() => op({ op: 'set', order: move(order, i, i + 1) })}
            >
              ▼
            </button>
            <button
              className="rounded px-1 text-xs text-stone-500 hover:bg-red-950 hover:text-red-300"
              title="remove from the order"
              onClick={() => op({ op: 'remove', entryId: entry.id })}
            >
              ✕
            </button>
          </span>
        </div>

        {vital && <VitalBar entry={vital} className="mt-1.5" />}
        {over === order.length && i === order.length - 1 && marker}
      </li>
    );
  };

  const setupTools = (
    <div className="space-y-2">
      {unlisted.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-stone-900/60 px-2 py-2">
          <span className={sectionLabel}>Not in the order yet</span>
          <div className="flex flex-wrap gap-1.5">
            {unlisted.map((c) => (
              <button
                key={c.id}
                className={btnGhost}
                onClick={() => addEntry(c.name, c.id)}
                title={`put ${c.name} in the turn order`}
              >
                + {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="ad-hoc: 3 prairie wolves…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addEntry(draft, null)}
        />
        <button className={btn} onClick={() => addEntry(draft, null)}>
          add
        </button>
      </div>
    </div>
  );

  const turnControls = (
    <div className="flex items-center gap-2">
      <button className={btn} disabled={!running} onClick={() => op({ op: 'prev' })}>
        ◂ back
      </button>
      <button
        className={`${btnPrimary} px-6`}
        disabled={order.length === 0}
        onClick={() => op({ op: 'next' })}
      >
        {running ? 'next turn ▸' : 'start combat'}
      </button>
      <button
        className={`${btn} ml-auto hover:bg-red-950`}
        disabled={!running}
        onClick={() => op({ op: 'end' })}
      >
        end
      </button>
    </div>
  );

  return (
    <div className="@container space-y-3">
      <div className={`${card} space-y-3`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Runner</span>
          {running && (
            <span className="rounded bg-amber-950 px-2 py-0.5 font-mono text-xs text-amber-300">
              round {turn.data!.round}
            </span>
          )}
        </div>

        {order.length === 0 && (
          <p className="text-sm text-stone-600">
            add combatants, arrange to match the table, then start
          </p>
        )}

        {/* Taking rolls. Players roll real dice and report on their own
            seat; teller has already rolled for anything it deployed. */}
        {order.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
            {rolling ? (
              <>
                <span className="font-mono text-xs text-amber-300">taking rolls</span>
                <span
                  className={`font-mono text-[11px] ${
                    order.some((e) => e.score == null) ? 'text-stone-400' : 'text-emerald-400'
                  }`}
                >
                  {order.filter((e) => e.score == null).length
                    ? `${order.filter((e) => e.score == null).length} still to roll`
                    : 'everyone is in'}
                </span>
                <button
                  className={`${btn} ml-auto text-xs`}
                  onClick={() => op({ op: 'rolling', on: false })}
                >
                  done
                </button>
              </>
            ) : (
              <>
                <span className="font-mono text-[11px] text-stone-600">
                  seats can enter their own initiative
                </span>
                <button
                  className={`${btn} ml-auto text-xs`}
                  disabled={rollingFoes}
                  title={`clear every score, ask each seat for a fresh roll, and throw ${initiative.data?.field ?? 'initiative'} for the foes — you can still overrule any of it`}
                  onClick={rollInitiative}
                >
                  {rollingFoes ? 'rolling…' : 'roll initiative'}
                </button>
              </>
            )}
            {!rolling && unrolledFoes.length > 0 && (
              <span className="font-mono text-[10px] text-stone-700">
                {unrolledFoes.length} foe{unrolledFoes.length === 1 ? '' : 's'} unrolled
              </span>
            )}
          </div>
        )}

        <div className="grid items-start gap-4 @2xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            {order.length > 0 ? (
              <ol
                ref={listRef}
                className={`divide-y divide-stone-800/60 rounded-lg ${
                  drag ? 'select-none' : 'overflow-hidden'
                }`}
              >
                {order.map(rosterRow)}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed border-stone-800 px-3 py-6 text-center text-[11px] text-stone-600">
                the turn order builds here
              </p>
            )}

            {/* While a fight runs, setup is one line until asked for. */}
            {running ? (
              <div>
                <button
                  className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-stone-600 transition-colors hover:bg-stone-900 hover:text-stone-300"
                  onClick={() => setSetupOpen((v) => !v)}
                >
                  {setupOpen ? '▾' : '＋'} add to the fight
                </button>
                {setupOpen && <div className="mt-2">{setupTools}</div>}
              </div>
            ) : (
              setupTools
            )}
          </div>

          <div className="space-y-3">
            {/* The stage's default job is the fight, so a detour says so
                quietly and hands back the way out. Nothing else changes
                — the acting row is still amber over in the order. */}
            {running && asideFrom && (
              <button
                className="w-full rounded-md bg-stone-900/70 px-2 py-1 text-left text-[11px] text-stone-500 transition-colors hover:bg-stone-900 hover:text-stone-300"
                onClick={() => setViewing(null)}
              >
                viewing{' '}
                <span className="text-stone-300">
                  {asideFrom.label ??
                    (asideFrom.entityId && names.get(asideFrom.entityId)) ??
                    '?'}
                </span>{' '}
                — ◂ back to the fight
              </button>
            )}

            {running && staged && stagedSheet ? (
              <>
                <TurnStage
                  key={stagedSheet.id}
                  acting={stagedSheet}
                  index={stagedIndex}
                  total={order.length}
                  round={turn.data!.round}
                  statuses={statuses.data ?? []}
                  accent={stagedSheet.type ? accents.data?.[stagedSheet.type] : undefined}
                  onWrite={(edit) => writeEntry(stagedSheet.id, edit)}
                  armed={armed}
                  onArm={setArmed}
                  costCounter={use.data?.costCounter}
                />

                {/*
                  The ✦ card, at the foot of the stage. `ProviderSlot`
                  draws it and owns the ask; the exchange inside it is
                  teller's own and is what makes the card render at all
                  when nothing provides the point — an armed action has
                  to have somewhere to be resolved, plugin or no plugin.
                  `offer` is the one gate that isn't about providers:
                  teller does not play player characters, so a posse
                  member's turn is nobody's to propose, and the same card
                  still hosts the flow that records what they swung.
                */}
                <ProviderSlot
                  point="propose.turn"
                  plain="the exchange"
                  offer={stagedSheet.type === 'foe'}
                  ask="what would they do?"
                  placeholder="…or tell it what they do, and press enter"
                  // Arming something IS a decision, so it goes over as
                  // the thing to work around rather than a hint — the
                  // old app's own move ("if I want to just say that I
                  // think it would use the frenzy attack now because I
                  // decided, but I still want the rest"). The flow below
                  // never reads this back.
                  payload={() =>
                    armed
                      ? { intent: [armed.name, armed.note].filter(Boolean).join(' — ') }
                      : {}
                  }
                  // The preface is the ONE fact the host cannot
                  // assemble for the narration afterwards: it never
                  // existed anywhere but on this screen. Caught here,
                  // handed down, and gone the moment the card clears.
                  onProposed={(answers) =>
                    setSpoken(
                      answers
                        .map((a) => (a.proposal as TurnProposal | undefined)?.preface)
                        .find((p): p is string => Boolean(p)),
                    )
                  }
                  {...(armed
                    ? {
                        onDismiss: () => {
                          setArmed(undefined);
                          setSpoken(undefined);
                        },
                      }
                    : {})}
                >
                  {armed && (
                    // Keyed on what was armed, so arming something else
                    // starts a clean exchange rather than inheriting the
                    // last one's dice.
                    <Exchange
                      key={armed.id}
                      actor={stagedSheet}
                      armed={armed}
                      order={order
                        .filter((e) => e.entityId)
                        .map((e) => ({
                          id: e.entityId!,
                          label: e.label ?? names.get(e.entityId!) ?? '?',
                        }))}
                      sheetOf={(id) => shown?.[id]}
                      dice={dice.data}
                      icons={icons.data}
                      pins={pins.data}
                      defenses={defenses.data}
                      statuses={statuses.data ?? []}
                      conditionsList={CONDITIONS}
                      conditionCap={conditionCap}
                      costCounter={use.data?.costCounter}
                      round={turn.data!.round}
                      spoken={spoken}
                      onWrite={writeEntry}
                    />
                  )}
                </ProviderSlot>

                {/* A player's turn gets no proposal, and the stage says
                    why rather than going blank. teller does not play
                    player characters. */}
                {stagedSheet.type !== 'foe' && (
                  <p className="px-1 text-[12px] italic text-stone-600">
                    {stagedSheet.name} plays themselves.
                  </p>
                )}
              </>
            ) : running && staged ? (
              <p className="text-sm text-stone-600">
                {staged.label ?? 'unlabeled'} {asideFrom ? 'is' : 'is up —'} an ad-hoc entry, so
                there's no sheet to show.
              </p>
            ) : running ? (
              <p className="text-sm text-stone-600">no one is up</p>
            ) : (
              <p className="text-sm text-stone-600">
                not running — start combat to open the stage
              </p>
            )}

            {turnControls}
          </div>
        </div>
      </div>
    </div>
  );
}

registerTool('runner', () => <RunnerTool />);

// ---- the 'turn' block — one entity's own slice of the same state -----

function TurnBlock({ ctx }: { ctx: BlockCtx }) {
  const e = ctx.entity as Entity | undefined;
  const turn = useLive(() => api<TurnState>('/api/turn'), [], { on: ['turn'] });
  if (!e || !turn.data) return null;
  const idx = turn.data.order.findIndex((entry) => entry.entityId === e.id);
  if (idx === -1) return null;
  const entry = turn.data.order[idx];
  const isActing = turn.data.turn === idx;
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 font-mono text-xs ${
        isActing ? 'bg-amber-950/60 text-amber-300' : 'bg-stone-900 text-stone-500'
      }`}
    >
      <span>{isActing ? 'acting now' : `#${idx + 1} in the order`}</span>
      {typeof entry.score === 'number' && (
        <span className="ml-auto text-stone-400">score {entry.score}</span>
      )}
    </div>
  );
}

registerBlock('turn', (_block, ctx) => <TurnBlock ctx={ctx} />);
