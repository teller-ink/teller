// One entity, rendered — shared by `roster` and `runner` (the same
// statblock, rendered the same in both places: `0b1f1eb`, extended here
// to the console's own furniture rather than only the encounter panel).
//
// This is deliberately NOT a new rendering — it fetches the entity, the
// campaign's records (accents/dials/brand/portraits) and the 'sheet'
// panel declaration, and hands them to `PanelSurface`, the same seam
// `PanelRoute` in `App.tsx` uses for a seat's own screen. A tool that
// re-implemented fields/counters/tags here would be a second statblock;
// this one borrows the first.
//
// Always rendered as `held` glass, whatever the console's own glass is:
// these cards sit several to a scrolling grid, so they want a natural,
// elastic single column — the `mounted` arrangement's fixed-height,
// never-scroll, multi-column contract (rule 6) is for a screen's WHOLE
// surface, not a card nested inside one.

import type { ReactNode } from 'react';
import type { Entity } from '../../../core/entity.ts';
import type { PanelDef } from '../../../core/panels.ts';
import { api } from '../../lib/api.ts';
import { DECLARED, useLive } from '../../lib/use-session.ts';
import { useOptimistic, writeEntry, type EntryEdit } from '../../lib/entry.ts';
import { card } from '../../lib/ui.ts';
import { PanelSurface, Refusal, type BlockCtx } from '../../panels/render.tsx';

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

/** The 'sheet' panel declaration — the one every entity card is drawn from. */
export function useSheetPanel() {
  const panels = useLive(() => api<PanelDef[]>('/api/stack/declarations/panels'), [], {
    on: DECLARED,
  });
  return panels.data?.find((p) => p.name === 'sheet');
}

export function EntityCard({
  id,
  panel,
  records,
  actions,
}: {
  id: string;
  panel: PanelDef;
  records: BlockCtx['records'];
  /** Buttons in the card's top-right corner — delete, etc. Tool's call. */
  actions?: ReactNode;
}) {
  const entity = useLive(() => api<Entity>(`/api/entities/${id}?resolved=1`), [id], {
    on: ['entities'],
  });
  const shown = useOptimistic(entity.data);
  if (!shown) return null;
  const ctx: BlockCtx = {
    glass: 'held',
    entity: shown as unknown,
    records,
    write: (edit) => writeEntry(id, edit as EntryEdit),
  };
  return (
    <article className={`${card} space-y-3`}>
      {actions && <div className="flex justify-end gap-1">{actions}</div>}
      <PanelSurface
        panel={panel}
        ctx={ctx}
        fallback={<Refusal>this card failed to render — the floor has it</Refusal>}
      />
    </article>
  );
}
