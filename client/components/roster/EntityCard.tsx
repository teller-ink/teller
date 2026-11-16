// One entity on the roster, at two sizes — the TILE you scan a grid of,
// and the SHEET you open one of (Brian, 2026-11-05: the roster drew every
// character at full size, which took a screen per sheet and named none
// of them, because the 'sheet' panel has no header — a seat's chrome
// supplies that, and the roster has no chrome).
//
// The tile is deliberately NOT a rendering of the panel: it's the
// glance — name, type, portrait, the bounded counters as bars, the
// conditions actually held — in the runner's own grammar (`VitalBar`,
// `StatusChip`), so a thing you read eight of at once reads the way the
// order does. Nothing in it names a counter (rule 2): "bounded" is the
// whole test, `resources` first because that's where a system files
// them, the same walk `vitalOf` in the runner makes.
//
// The sheet is the panel, whole — it fetches the entity, the campaign's
// records (accents/dials/brand/portraits) and the 'sheet' declaration
// and hands them to `PanelSurface`, the same seam `PanelRoute` in
// `App.tsx` uses for a seat's own screen. A dialog that re-implemented
// fields/counters/tags would be a second statblock; this one borrows
// the first. It's a DIALOG for the reason the bestiary's printing is: a
// look at one sheet is a detour from the roster, and a detour should
// announce itself and end.
//
// Glass: `held` in the dialog, always. The panel's `mounted`
// arrangement is three columns designed for a rail's 1920px, and a
// dialog on a laptop is a third of that — the columns would clip, and
// clipping is the diagnostic for "wrong glass" (rule 6), not a look.
// The held arrangement is the phone's single column, which is what a
// scrolling dialog is.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DRAFT_LIST, DRAFT_MARK, hasEntry, isDraft, type Entity, type Entry } from '../../../core/entity.ts';
import { SIDE_LIST, SIDE_MARK, SIDES, storedSide, type Side } from '../../../core/side.ts';
import type { PanelDef } from '../../../core/panels.ts';
import { api } from '../../lib/api.ts';
import { useArtMap } from '../../lib/art.ts';
import { DECLARED, useLive } from '../../lib/use-session.ts';
import { useOptimistic, writeEntry, type EntryEdit } from '../../lib/entry.ts';
import { btn, btnGhost, card, sectionLabel } from '../../lib/ui.ts';
import { PanelSurface, Refusal, RenderBlock, type BlockCtx } from '../../panels/render.tsx';
import { shaped } from '../../panels/blocks.tsx';
import { HIDDEN_LIST, HIDDEN_MARK } from '../../panels/floor.ts';
import { StatusChip } from '../encounters/TemplateSheet.tsx';
import { VitalBar } from '../Vitals.tsx';

// The SAME slots a seat fetches (`SeatChrome.tsx`), not a hand-picked
// few: this dialog renders the same 'sheet' panel a seat does, and a
// block reads whichever record it needs. Leaving `pins` out is how the
// dialog lost Health, Aces, Supplies and Dollars — the sheet's gauges are
// the entries something is PINNED to (`shaped()` in panels/blocks.tsx),
// and with no pins record nothing was, so the block drew nothing and
// said nothing. A missing record isn't an error anywhere; it's a quieter
// sheet. Kept in step with the seat's list on purpose.
const RECORD_SLOTS = [
  'accents',
  'dials',
  'brand',
  'portraits',
  'pins',
  'use',
  'carry',
  'currency',
  'icons',
  'groups',
  'dice',
  'marks',
  'spends',
  'vocabulary',
];

/** The identity-layer records every card needs — fetched once, shared. */
export function usePanelRecords() {
  return useLive(
    () =>
      Promise.all(
        RECORD_SLOTS.map((slot) =>
          api<Record<string, unknown>>(`/api/stack/record/${slot}`).then(
            (r) => [slot, r] as const,
          ),
        ),
      ).then(Object.fromEntries),
    [],
    { on: DECLARED },
  );
}

/** The 'sheet' panel declaration — the one every entity sheet is drawn from. */
export function useSheetPanel() {
  const panels = useLive(() => api<PanelDef[]>('/api/stack/declarations/panels'), [], {
    on: DECLARED,
  });
  return panels.data?.find((p) => p.name === 'sheet');
}

/** The entity, resolved and live — thin foes read their blueprint through this. */
function useEntity(id: string) {
  const entity = useLive(() => api<Entity>(`/api/entities/${id}?resolved=1`), [id], {
    on: ['entities'],
  });
  return useOptimistic(entity.data);
}

/** Does this panel already draw an entity's every list? True when a
 * `floor` or a `rest` block is anywhere in its arrangement, however
 * deeply a `columns` block has tucked it. */
function drawsEverything(panel: PanelDef): boolean {
  const has = (blocks: unknown): boolean =>
    Array.isArray(blocks) &&
    blocks.some((b) =>
      Array.isArray(b)
        ? has(b)
        : !!b &&
          typeof b === 'object' &&
          (['floor', 'rest'].includes(String((b as { block?: unknown }).block)) ||
            has((b as { columns?: unknown }).columns) ||
            has((b as { blocks?: unknown }).blocks)),
    );
  return has(panel.held) || has(panel.mounted);
}

/**
 * The panel as the DIALOG draws it — with no head of its own. The
 * dialog heads the sheet itself (portrait, a name you can type over, the
 * type, the side switch), so a `header` block in the panel said the
 * name a second time, and the floor's built-in header a third (the
 * stranger's first run, 2026-11-16: Starter's sheet showed the name
 * twice). Dropped here, for this one surface, rather than in the panel:
 * a seat has no header of its own and still wants the panel's. Walks
 * `columns` the way `drawsEverything` does; a panel INCLUDED by name is
 * out of reach and keeps whatever it says.
 */
function headless(panel: PanelDef): PanelDef {
  const strip = (blocks: unknown): unknown =>
    Array.isArray(blocks)
      ? blocks
          .filter((b) => !(b && typeof b === 'object' && (b as { block?: unknown }).block === 'header'))
          .map((b) => {
            if (Array.isArray(b)) return strip(b);
            if (!b || typeof b !== 'object') return b;
            const out = { ...(b as Record<string, unknown>) };
            if (out.block === 'floor') out.header = false;
            if (Array.isArray(out.columns)) out.columns = strip(out.columns);
            if (Array.isArray(out.blocks)) out.blocks = strip(out.blocks);
            return out;
          })
      : blocks;
  return {
    ...panel,
    ...(panel.held ? { held: strip(panel.held) as PanelDef['held'] } : {}),
    ...(panel.mounted ? { mounted: strip(panel.mounted) as PanelDef['mounted'] } : {}),
  };
}

/** The list a table's counters live in — the same one the tile's bar and
 * the runner's steppers already read. */
const LEDGER_LIST = 'resources';

/**
 * Every bounded counter, `resources` first — the ones a bar can be drawn
 * for. A counter with no max has no bar, because a bar would have to
 * invent a ceiling (`Vitals.tsx`), so it isn't a glance and stays on
 * the sheet.
 */
function boundedOf(e: Entity): Entry[] {
  const ordered = [
    ...(e.lists.resources ?? []),
    ...Object.entries(e.lists)
      .filter(([key]) => key !== 'resources')
      .flatMap(([, entries]) => entries),
  ];
  return ordered.filter((entry) => typeof entry.max === 'number' && entry.max > 0);
}

function accentOf(records: BlockCtx['records'], e: Entity): string | undefined {
  const accents = records.accents as Record<string, unknown> | undefined;
  const hit = e.type ? accents?.[e.type] : undefined;
  return typeof hit === 'string' ? hit : undefined;
}

function Portrait({
  records,
  e,
  size,
}: {
  records: BlockCtx['records'];
  e: Entity;
  size: string;
}) {
  const path = e.type ? (records.portraits?.[e.type] as string | undefined) : undefined;
  const url = useArtMap(path ? { portrait: path } : undefined).portrait;
  const accent = accentOf(records, e);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      className={`${size} shrink-0 rounded-full border-2 object-cover`}
      style={{ borderColor: accent ? `${accent}88` : '#57534e' }}
    />
  );
}

/**
 * The side, as the tile's left edge — which side someone is on is the
 * row's edge in the runner too, and saying it twice makes a party
 * shout. The posse is silent; a foe is red; nobody's is grey.
 */
const SIDE_EDGE: Record<Side, string> = {
  party: '',
  foe: 'border-l-2 border-l-red-900/70',
  none: 'border-l-2 border-l-stone-600',
};

/**
 * The one control TEL-126 is for: a human setting the side over whatever
 * the host derived (rule 1). Writes the `meta` mark through the ordinary
 * entry door, so it's logged, undone and read back like any edit; the
 * tooltip says what each side DOES, since that's the only reason to pick.
 */
const SIDE_MEANS: Record<Side, string> = {
  party: 'party — numbers shown on the table, offered a seat',
  foe: 'foe — numbers hidden from the table, swept by clear',
  none: 'nobody’s — off the public roster, never offered a turn, spared by clear',
};

function SideControl({ e, onPick }: { e: Entity; onPick: (side: Side) => void }) {
  // The stored mark first so a tap reads back in the same frame; the
  // host's reading until there is one.
  const current = storedSide(e) ?? e.side;
  return (
    <span className="flex gap-0.5" role="radiogroup" aria-label="side">
      {SIDES.map((side) => {
        const on = current === side;
        return (
          <button
            key={side}
            type="button"
            role="radio"
            aria-checked={on}
            title={SIDE_MEANS[side]}
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
              on ? 'bg-amber-700 text-stone-950' : 'bg-stone-800 text-stone-500 hover:text-stone-200'
            }`}
            onClick={() => !on && onPick(side)}
          >
            {side}
          </button>
        );
      })}
    </span>
  );
}

/**
 * One of teller's own marks, as a caption — the half-made draft, the
 * ambusher still out of sight. On the sheet it carries a ✕: the floor
 * no longer draws these marks as entries (they'd have said the side
 * twice, `client/panels/floor.ts`), so the header is the one place a
 * human strikes one off by hand (rule 1 — `core/entity.ts` promises
 * exactly that for the draft).
 */
function MarkBadge({ label, title, onClear }: { label: string; title?: string; onClear?: () => void }) {
  return (
    <span
      className="flex items-center gap-1 rounded bg-amber-950 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-400"
      title={title}
    >
      {label}
      {onClear && (
        <button
          type="button"
          className="text-amber-500/60 transition-colors hover:text-red-300"
          onClick={onClear}
          aria-label={`clear ${label}`}
          title={`clear ${label}`}
        >
          ✕
        </button>
      )}
    </span>
  );
}

/** The half-made mark, as a caption — the only trace a draft carries. */
function DraftBadge({ onClear }: { onClear?: () => void }) {
  return <MarkBadge label="draft" title="still being made" onClear={onClear} />;
}

/** Is this one deployed out of sight, with no token to be hidden by? */
function isHidden(e: Entity | undefined): boolean {
  return hasEntry(e?.lists?.[HIDDEN_LIST] ?? [], HIDDEN_MARK);
}

// ---- the tile ----------------------------------------------------------

export function EntityTile({
  id,
  records,
  onOpen,
  actions,
}: {
  id: string;
  records: BlockCtx['records'];
  onOpen: () => void;
  /** Buttons in the tile's top-right corner — delete, etc. Tool's call. */
  actions?: ReactNode;
}) {
  const e = useEntity(id);
  if (!e) return null;
  const accent = accentOf(records, e);
  const [vital, ...rest] = boundedOf(e);
  const held = e.lists.conditions ?? [];

  return (
    <article
      className={`${card} ${SIDE_EDGE[e.side ?? 'foe']} group cursor-pointer space-y-3 transition-colors hover:border-stone-700 hover:bg-stone-900`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onOpen();
        }
      }}
      aria-label={`open ${e.name}`}
    >
      <header className="flex items-center gap-3">
        <Portrait records={records} e={e} size="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-serif text-lg leading-tight text-stone-100">{e.name}</h3>
          <div className="flex items-center gap-1.5">
            {e.type && (
              <span className={sectionLabel} style={accent ? { color: accent } : undefined}>
                {e.type}
              </span>
            )}
            {isDraft(e) && <DraftBadge />}
          </div>
        </div>
        {actions && (
          <div
            className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => ev.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </header>

      {/* The first bounded counter gets the bar — it's the one a hit
          comes off, the same reading the runner's order makes — and the
          rest ride one figure strip, so a tile stays a glance however
          many counters a system caps. */}
      {vital && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-stone-500">
              {vital.name}
            </span>
            <span className="font-mono text-xs text-stone-300">
              {vital.value ?? 0}
              <span className="text-stone-600">/{vital.max}</span>
            </span>
          </div>
          <VitalBar entry={vital} className="mt-0.5" />
        </div>
      )}
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {rest.map((entry) => (
            <span key={entry.name} className="text-[10px] uppercase tracking-wider text-stone-500">
              <span className="font-mono text-xs normal-case tracking-normal text-stone-300">
                {entry.value ?? 0}
                <span className="text-stone-600">/{entry.max}</span>
              </span>{' '}
              {entry.name}
            </span>
          ))}
        </div>
      )}

      {held.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {held.map((entry) => (
            <StatusChip key={entry.name} entry={entry} />
          ))}
        </div>
      )}
    </article>
  );
}

// ---- the sheet ---------------------------------------------------------

/**
 * Rename through the whole-entity door: `PUT` replaces what's STORED,
 * so the read is the raw row, never the resolved reading — writing a
 * thin foe's resolved stats back would bake its blueprint onto it
 * (the handoff's standing landmine).
 */
async function rename(id: string, name: string): Promise<void> {
  const raw = await api<Entity>(`/api/entities/${id}`);
  await api(`/api/entities/${id}`, { method: 'PUT', body: { entity: { ...raw, name } } });
}

export function EntitySheet({
  id,
  panel,
  records,
  onClose,
  actions,
}: {
  id: string;
  panel: PanelDef;
  records: BlockCtx['records'];
  onClose: () => void;
  /** Footer actions handed in by the caller — delete, etc. */
  actions?: ReactNode;
}) {
  const e = useEntity(id);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [name, setName] = useState<string | null>(null);
  const commitName = () => {
    const next = (name ?? '').trim();
    setName(null);
    if (!e || !next || next === e.name) return;
    rename(id, next).catch(() => {});
  };

  const ctx: BlockCtx | undefined = e
    ? {
        glass: 'held',
        entity: e as unknown,
        records,
        write: (edit) => writeEntry(id, edit as EntryEdit),
      }
    : undefined;
  const accent = e ? accentOf(records, e) : undefined;
  const sheet = useMemo(() => headless(panel), [panel]);
  // The counters the sheet's own plates leave for other screens — asked
  // with the SAME question the sheet asks (`shaped`), so the two can't
  // drift into both drawing Health or neither drawing Aces.
  //
  // …unless the sheet draws everything already. A floor or a `rest`
  // block IS the whole ledger (Starter's sheet is one), and drawing the
  // rest of it underneath would show every counter twice.
  const unshaped =
    e && ctx && !drawsEverything(panel)
      ? (e.lists[LEDGER_LIST] ?? []).filter((entry) => !shaped(ctx, e, entry)).map((entry) => entry.name)
      : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-950/80 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-stone-800 bg-stone-900 shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={e?.name ?? 'sheet'}
      >
        <div className="flex items-center gap-3 border-b border-stone-800 px-5 py-4">
          {e && <Portrait records={records} e={e} size="h-14 w-14" />}
          <div className="min-w-0 flex-1">
            <input
              className="w-full min-w-0 bg-transparent font-serif text-2xl text-amber-50 focus:outline-none"
              value={name ?? e?.name ?? ''}
              onChange={(ev) => setName(ev.target.value)}
              onBlur={commitName}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
              }}
              aria-label="name"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {e?.type && (
                <span className={sectionLabel} style={accent ? { color: accent } : undefined}>
                  {e.type}
                </span>
              )}
              {isDraft(e) && (
                <DraftBadge
                  onClear={() =>
                    writeEntry(id, { list: DRAFT_LIST, name: DRAFT_MARK, remove: true }).catch(() => {})
                  }
                />
              )}
              {isHidden(e) && (
                <MarkBadge
                  label="out of sight"
                  title="kept off the table’s screens until its token stands in the open — or until this is cleared"
                  onClear={() =>
                    writeEntry(id, { list: HIDDEN_LIST, name: HIDDEN_MARK, remove: true }).catch(() => {})
                  }
                />
              )}
              {e && (
                <SideControl
                  e={e}
                  onPick={(side) =>
                    writeEntry(id, { list: SIDE_LIST, name: SIDE_MARK, value: side }).catch(() => {})
                  }
                />
              )}
            </div>
          </div>
          <button className={btnGhost} onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {ctx && (
            <PanelSurface
              panel={sheet}
              ctx={ctx}
              fallback={<Refusal>this sheet failed to render — the floor has it</Refusal>}
            />
          )}
          {/* A seat keeps a character across SEVERAL screens, and the
              sheet is only the first: what its two plates don't draw
              (the Ace hand, the coin, the supplies) lives on the header
              and on 'More'. The Warden opens ONE dialog, so the rest of
              the ledger sits under the sheet — every counter the sheet
              didn't shape, each one a number to type over (rule 1). The
              2026-11-16 audit found this dialog showing a character
              with no way to reach half its numbers. */}
          {ctx && unshaped.length > 0 && (
            <div className="space-y-2 border-t border-stone-800 pt-4">
              <span className={sectionLabel}>the rest of the ledger</span>
              <RenderBlock
                block={{
                  block: 'list',
                  list: LEDGER_LIST,
                  as: 'ledger',
                  filter: 'named',
                  names: unshaped,
                }}
                ctx={ctx}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-stone-800 px-5 py-3">
          {actions}
          <button className={btn} onClick={onClose}>
            done
          </button>
        </div>
      </div>
    </div>
  );
}
