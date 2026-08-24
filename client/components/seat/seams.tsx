// The seat's five chrome seams — §M-5a, "the seat dissolves into files".
//
// The chrome was the last un-authorable surface: plate, cost chips and
// the segmented bar hardcoded in `SeatChrome` while every screen behind
// them rode the ladder. It dissolves along the same line as everything
// else — **facts stay teller's, rendering is summonable**. teller
// assembles the tab LIST, reads the order, holds the note; a
// presentation only draws what it's handed.
//
// Each seam resolves by NAME through the one summoning seam every other
// face uses (`client/lib/presentations.ts`): the active system's
// presentations first, then each trusted pack's in declared precedence
// order — so the system ships the plain functional bar and the book's
// pack skins it, which is the whole point — then teller's floor, below,
// which is what a table with no code at all still gets.
//
// A composite's `chrome` map names a presentation per seam as an
// OVERRIDE (`{ "chrome": { "header": "WantedPoster" } }`); absent, the
// seam resolves its default word, so a themed set arrives with zero
// composite edits.
//
// **The floors below were MOVED, not written**: `Plate`, `CostChip` and
// the two-glass top bar came out of `SeatChrome.tsx` unchanged, and the
// segmented bar with them. What changed is only who may replace them.
//
// One law is NOT themeable and does not live here: the outer glass clip
// (mounted glass is `h-dvh overflow-hidden`, in `App.tsx`) wraps OUTSIDE
// whatever `SeatFrame` renders. A frame decides how the seat LOOKS; it
// never decides whether a screwed-down panel may page-scroll (rule 6).

import { useState, type ComponentType, type ReactNode } from 'react';
import type { Entity } from '../../../core/entity.ts';
import type { PanelChrome } from '../../../core/panels.ts';
import type { PassedNote } from '../../lib/api.ts';
import { presentationOf, useSystemFaces } from '../../lib/presentations.ts';
import { entryNamed } from '../../panels/blocks.tsx';
import type { Glass } from '../../panels/render.tsx';
import { Glyph } from '../sheet/glyphs.tsx';
import { PassedNoteFloor } from './PassedNote.tsx';
import { TurnCallFloor } from './TurnCall.tsx';

type Records = Record<string, Record<string, unknown>>;

// -- the five props contracts (public API the day a shelf file uses one) ---

export type SeatHeaderProps = {
  /** The subject, resolved. Absent while it's still loading. */
  entity?: Entity;
  /**
   * The order's call, ALREADY DRAWN by its own seam — teller hands the
   * header the rendered `TurnCall` and asks it to find room in the
   * bar's own run (Brian, 2026-08-24: on deck was a separate block to
   * the right of the header, and on a 515px strip the bar has no width
   * to give a chip that says two words).
   *
   * The seam contract stays honest because the FACTS still arrive
   * through `TurnCall` — the header hosts the affordance, it never
   * re-derives whose turn it is, and a header that drops the slot is a
   * theme suppressing a delivery affordance, which §M-5a already
   * allows. What it must never do is draw its own idea of the order.
   *
   * The ring is unaffected: it is absolutely positioned against the
   * FRAME, so nesting the call inside the bar leaves "you're up" ringing
   * the whole seat exactly as before.
   */
  turn?: ReactNode;
  /** This screen's own name (rule 7 — a seat belongs to a person). */
  seatName?: string;
  /** The merged records: `accents`, `use`, `dials`, `portraits`, … */
  records: Records;
  glass: Glass;
  /** The write door, sparse, already bound to this seat's entity. */
  write?: (edit: Record<string, unknown>) => void;
};

export type SeatTab = { name: string; label: string; icon?: string };

export type ScreenBarProps = {
  /** The list teller assembled. A theme orders nothing — it draws. */
  tabs: SeatTab[];
  current: string;
  onGo: (name: string) => void;
  glass: Glass;
};

export type TurnCallProps = {
  up: boolean;
  onDeck: boolean;
  rolling: boolean;
  /** This seat's own score, when it has one. `undefined` while rolling
   * is the honest reading of "we're waiting on you". */
  myScore?: number;
  /** The one thing a seat may write into the order (rule 5). Absent
   * when this seat has no row in it. */
  submitScore?: (score: number) => Promise<void>;
  glass: Glass;
};

export type NoteBannerProps = {
  /** The newest note waiting, if any. */
  note?: PassedNote;
  /** How many more are queued behind it. */
  waiting: number;
  onDismiss: (id: string) => void;
  glass: Glass;
};

export type SeatFrameProps = {
  glass: Glass;
  /** The subject's accent, for a frame that wants to wear it. */
  accent?: string;
  children: ReactNode;
};

// -- teller's floors -------------------------------------------------------

/** The header's plate: who this is, and the trade as its caption. */
function Plate({
  name,
  trade,
  accent,
  mounted,
}: {
  name?: string;
  trade?: string;
  accent?: string;
  mounted: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col items-center px-1">
      {name && (
        <span
          className={`min-w-0 font-serif text-[1.35rem] font-bold leading-tight text-stone-100 ${
            mounted ? 'max-w-full truncate' : 'break-words text-center'
          }`}
        >
          {name}
        </span>
      )}
      {trade && (
        <span
          className="whitespace-nowrap text-[0.7rem] uppercase leading-tight tracking-[0.18em]"
          style={{ color: accent ?? '#f59e0b' }}
        >
          The {trade}
        </span>
      )}
    </span>
  );
}

function CostChip({
  name,
  value,
  face,
  accent,
  onSet,
}: {
  name: string;
  value: number;
  face?: string;
  accent: string;
  onSet: (next: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${name}: ${value}`}
        aria-expanded={open}
        className="flex items-center gap-1.5"
      >
        <span className="text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">{name}</span>
        {face === 'cards' ? (
          <span className="flex h-8 w-6 items-center justify-center rounded-[4px] border border-stone-400 bg-[#f4efe4] font-mono text-sm font-bold text-stone-900">
            {value}
          </span>
        ) : (
          <span
            className={`flex h-7 min-w-[2.6rem] items-center justify-center border font-mono text-sm text-stone-100 ${
              face === 'cylinder'
                ? 'rounded-l-sm rounded-r-full border-l-2 pl-1.5 pr-2.5'
                : 'rounded-full px-2.5'
            }`}
            style={{ borderColor: accent, background: `${accent}1f` }}
          >
            {value}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex items-center gap-1 rounded-lg border border-stone-700 bg-stone-950 p-1 shadow-lg">
          <button
            type="button"
            aria-label={`decrease ${name}`}
            onClick={() => onSet(Math.max(0, value - 1))}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-stone-800 font-mono text-lg text-stone-100 hover:bg-stone-700"
          >
            −
          </button>
          <span className="min-w-[2rem] text-center font-mono text-sm text-stone-100">{value}</span>
          <button
            type="button"
            aria-label={`increase ${name}`}
            onClick={() => onSet(value + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-stone-800 font-mono text-lg text-stone-100 hover:bg-stone-700"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

/** The chip's own reading: a counter nobody has yet shows a zero, not a blank. */
function countOf(entry: { value?: number | string } | undefined): number {
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/**
 * The Header floor — identity and the turn's wallet.
 *
 * The old app's `SheetHeader` read the trade off a `groups.title` FIELD
 * and priced its chips off `use.costCounter`/`use.costs`. The entity
 * gives the type for free and the player is the SEAT's own identity now
 * (rule 7), so `seatName` is preferred and a `meta` "Player" entry is
 * only the fallback. The chips still come from `use` — that's the
 * system's own word for what a turn costs.
 */
export function HeaderFloor({ entity, seatName, records, glass, write, turn }: SeatHeaderProps) {
  const mounted = glass === 'mounted';
  const accent = entity?.type
    ? ((records.accents?.[entity.type] as string | undefined) ?? '#f59e0b')
    : '#f59e0b';
  const player = seatName?.trim() || entryNamed(entity, 'player')?.value?.toString().trim();
  const use = records.use as { costCounter?: string; costs?: { counter: string }[] } | undefined;
  const dials = records.dials as Record<string, string> | undefined;
  const costNames = [
    ...(use?.costCounter ? [use.costCounter] : []),
    ...(use?.costs ?? []).map((c) => c.counter),
  ].filter((n, i, a) => a.indexOf(n) === i);
  const chips = costNames.flatMap((n) => {
    const entry = entryNamed(entity, n);
    if (!entry) return [];
    return [
      <CostChip
        key={n}
        name={n}
        value={countOf(entry)}
        face={dials?.[n]}
        accent={accent}
        onSet={(v) => write?.({ list: 'resources', name: n, value: v })}
      />,
    ];
  });

  // Nothing to plate, but the fight may still be asking something of
  // this seat — the call is teller's, not the plate's, and it doesn't
  // wait for a name to load.
  if (!entity && !player) return turn ? <>{turn}</> : null;

  if (!mounted) {
    return (
      <div
        className="flex shrink-0 flex-col gap-1.5 rounded-md border px-3 py-1.5"
        style={{ borderColor: `${accent}66` }}
      >
        <div className="flex items-center gap-2.5">
          <span className="h-px flex-1" style={{ background: `${accent}55` }} />
          <Plate name={entity?.name} trade={entity?.type} accent={accent} mounted={mounted} />
          <span className="h-px flex-1" style={{ background: `${accent}55` }} />
        </div>
        {(player || chips.length > 0 || turn) && (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">
              {player}
            </span>
            <div className="flex shrink-0 items-center gap-3">
              {turn}
              {chips}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 rounded-md border px-3 py-1.5"
      style={{ borderColor: `${accent}66` }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {player && (
          <span className="min-w-0 truncate text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">
            {player}
          </span>
        )}
        <span className="h-px flex-1" style={{ background: `${accent}55` }} />
      </div>

      <Plate name={entity?.name} trade={entity?.type} accent={accent} mounted={mounted} />

      {/* The right-hand run: the rule, then the order's call, then the
          turn's wallet. Inside the bar's own border, so a two-word chip
          costs the strip nothing it wasn't already spending. */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-px flex-1" style={{ background: `${accent}55` }} />
        {turn}
        {chips}
      </div>
    </div>
  );
}

/**
 * The ScreenBar floor — one button per screen teller assembled. Ported
 * from the old app's `Screens`: each tab wears the glyph its declaration
 * named (sixgun/star/satchel/…), same glyph set.
 */
export function ScreenBarFloor({ tabs, current, onGo }: ScreenBarProps) {
  if (tabs.length <= 1) return null;
  // `@container` + the label's `@[30rem]:inline`: on glass too narrow for
  // five worded tabs the words go and the glyphs stay, because the PAGE
  // never pans sideways (rule 6) and a wrapping tab bar is worse than an
  // iconic one. A tab with no glyph keeps its word — a row of blank
  // buttons isn't a bar, it's a mystery.
  return (
    <nav
      aria-label="screens"
      className="@container flex min-w-0 gap-1 rounded-lg bg-stone-950/85 p-1 backdrop-blur-sm"
    >
      {tabs.map((t) => (
        <button
          key={t.name}
          type="button"
          onClick={() => onGo(t.name)}
          aria-current={t.name === current}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors ${
            t.name === current
              ? 'text-stone-950'
              : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
          }`}
          style={t.name === current ? { background: 'var(--sheet-accent, #f59e0b)' } : undefined}
        >
          {t.icon && <Glyph name={t.icon} className="h-[1.15rem] w-[1.15rem] shrink-0" />}
          <span className={`min-w-0 break-words ${t.icon ? 'hidden @[30rem]:inline' : ''}`}>
            {t.label}
          </span>
        </button>
      ))}
    </nav>
  );
}

/**
 * The SeatFrame floor — the container's look, and nothing structural.
 * The accent every block below reads (`--sheet-accent`) is set here
 * because it is the frame's own paint; the glass clip is NOT here,
 * deliberately (see the note at the top of this file).
 */
export function SeatFrameFloor({ glass, accent, children }: SeatFrameProps) {
  return (
    <div
      className={`relative flex min-h-0 flex-col gap-2 ${glass === 'mounted' ? 'h-full' : 'min-h-full'}`}
      style={{ '--sheet-accent': accent ?? '#f59e0b' } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

// -- resolution ------------------------------------------------------------

/** The word each seam answers to when a composite names nothing. */
const SEAM_DEFAULTS = {
  header: 'Header',
  bar: 'ScreenBar',
  turncall: 'TurnCall',
  notebanner: 'NoteBanner',
  frame: 'SeatFrame',
} as const;

export type Seams = {
  Header: ComponentType<SeatHeaderProps>;
  ScreenBar: ComponentType<ScreenBarProps>;
  TurnCall: ComponentType<TurnCallProps>;
  NoteBanner: ComponentType<NoteBannerProps>;
  SeatFrame: ComponentType<SeatFrameProps>;
};

/**
 * Which component draws each seam, right now: the composite's override
 * word if it named one, else the seam's default word, resolved
 * system-first / pack-winning by `presentationOf`, else teller's floor.
 *
 * Every seam has an answer for `undefined` and it is the floor — a
 * system that ships no code at all still seats a player (§L's law,
 * pointed at the chrome).
 */
export function useSeams(chrome?: PanelChrome): Seams {
  useSystemFaces(); // the system module lands asynchronously; re-render when it does
  const of = <T,>(seam: keyof typeof SEAM_DEFAULTS, floor: T): T =>
    (presentationOf<T>(chrome?.[seam] ?? SEAM_DEFAULTS[seam]) ?? floor);
  return {
    Header: of('header', HeaderFloor),
    ScreenBar: of('bar', ScreenBarFloor),
    TurnCall: of('turncall', TurnCallFloor),
    NoteBanner: of('notebanner', PassedNoteFloor),
    SeatFrame: of('frame', SeatFrameFloor),
  };
}
