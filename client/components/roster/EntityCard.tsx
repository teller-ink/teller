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

import { useEffect, useState, type ReactNode } from 'react';
import { isDraft, type Entity, type Entry } from '../../../core/entity.ts';
import type { PanelDef } from '../../../core/panels.ts';
import { api } from '../../lib/api.ts';
import { useArtMap } from '../../lib/art.ts';
import { DECLARED, useLive } from '../../lib/use-session.ts';
import { useOptimistic, writeEntry, type EntryEdit } from '../../lib/entry.ts';
import { btn, btnGhost, card, sectionLabel } from '../../lib/ui.ts';
import { PanelSurface, Refusal, type BlockCtx } from '../../panels/render.tsx';
import { StatusChip } from '../encounters/TemplateSheet.tsx';
import { VitalBar } from '../Vitals.tsx';

const RECORD_SLOTS = ['accents', 'dials', 'brand', 'portraits', 'dice', 'marks'];

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

/** The half-made mark, as a caption — the only trace a draft carries. */
function DraftBadge() {
  return (
    <span className="rounded bg-amber-950 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-400">
      draft
    </span>
  );
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
      className={`${card} group cursor-pointer space-y-3 transition-colors hover:border-stone-700 hover:bg-stone-900`}
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
            <div className="flex items-center gap-1.5">
              {e?.type && (
                <span className={sectionLabel} style={accent ? { color: accent } : undefined}>
                  {e.type}
                </span>
              )}
              {isDraft(e) && <DraftBadge />}
            </div>
          </div>
          <button className={btnGhost} onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {ctx && (
            <PanelSurface
              panel={panel}
              ctx={ctx}
              fallback={<Refusal>this sheet failed to render — the floor has it</Refusal>}
            />
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
