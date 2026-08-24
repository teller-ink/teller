// Where the two sources of surfaces become one list (§15's UI tier,
// §M-2's line).
//
// The MERGE gives a table its panels — teller's floor, the system's, a
// pack's, the campaign's, the table's own, later winning by name. The
// REGISTRY gives it whatever the enabled plugins provide. Those are
// different mechanisms answering different questions ("whose
// arrangement wins?" versus "what else is running?"), and this file is
// deliberately the only place they touch: a provided pane is turned
// into a `PanelDef` the existing renderer already knows how to draw,
// and the combined list is sorted with the one comparator every bar of
// panels has always used.
//
// **A provision never overrides a declaration.** If a plugin provides
// `store` and a system declares `store`, the console shows two tabs
// with the same word, because they are two things and neither is in
// the other's argument. That reads odd exactly once, and it reads
// TRUE: the fix is to stop declaring the one you replaced, which is
// what the store's extraction did to the system-layer store panel.
//
// A pane is always a TAKEOVER (§E rung 5) — it brought a component,
// not an arrangement — so the `PanelDef` this makes carries `code`
// and no blocks, and `PanelSurface` renders it by the same path a
// panel folder's `panel.tsx` takes. Nothing in the renderer learned
// that plugins exist.

import { byPanelOrder, surfaceable, type PanelDef } from '../../core/panels.ts';
import { pluginCall, type Pane } from './api.ts';
import type { BlockCtx } from '../panels/render.tsx';

/** The pane's own identity as a panel: `plg_x:store`. Namespaces its stylesheet. */
export function paneId(pane: Pane): string {
  return `${pane.plugin}:${pane.name}`;
}

/** One provision, as the renderer's own shape. */
export function paneToPanel(pane: Pane): PanelDef {
  const out: PanelDef = {
    name: pane.name,
    subject: pane.subject ?? 'none',
    id: paneId(pane),
    code: { takeover: pane.code.takeover, ...(pane.code.style ? { style: pane.code.style } : {}) },
  };
  if (pane.label) out.label = pane.label;
  if (pane.blurb) out.blurb = pane.blurb;
  if (pane.order !== undefined) out.order = pane.order;
  return out;
}

/**
 * Declarations and provisions, in the one order a bar of panels is
 * drawn in. Panes go in AFTER the declarations of equal order, which is
 * the only tie-break worth having an opinion about: teller's own
 * furniture and the system's screens are what a table came for, and a
 * plugin is an addition to it.
 */
export function surfaces(
  panels: PanelDef[] | undefined,
  panes: Pane[] | undefined,
  subject: 'entity' | 'none',
): PanelDef[] {
  // `surface: false` leaves here and nowhere else (§M-5a′): a FRAGMENT
  // merges, overrides and can be included by name, but it is never
  // offered — not as a console tab, not in the Screens picker, not as a
  // seat's layout. The panes.ts law inverted on purpose.
  const declared = (panels ?? [])
    .filter(surfaceable)
    .filter((p) => (subject === 'entity' ? p.subject === 'entity' : p.subject !== 'entity'));
  const provided = (panes ?? [])
    .filter((p) => (subject === 'entity' ? p.subject === 'entity' : p.subject !== 'entity'))
    .map(paneToPanel);
  return [...declared, ...provided].sort(byPanelOrder);
}

/**
 * The plugin seam a pane's own component is handed — its id, already
 * bound, so the component never spells it out and never reaches another
 * plugin's doors.
 */
export function pluginCtx(pane: Pane): NonNullable<BlockCtx['plugin']> {
  return {
    id: pane.plugin,
    call: (door, opts) => pluginCall(pane.plugin, door, opts),
  };
}

/**
 * Which of these panes are SHOWING right now.
 *
 * A pane with no `when` is always offered. One with a `when` names a
 * door, and the door's answer decides: null (or a refusal) means the
 * pane isn't offered at all. That generalises the one conditional
 * surface teller used to have hard-coded — the seat's shop tab, present
 * while the Warden had a shop open — into a declared word, so the next
 * plugin that wants a tab that comes and goes writes `when` instead of
 * a patch to the seat chrome.
 */
export async function showing(panes: Pane[]): Promise<Pane[]> {
  const answers = await Promise.all(
    panes.map(async (pane) => {
      if (!pane.when) return true;
      try {
        return (await pluginCall<unknown>(pane.plugin, pane.when)) !== null;
      } catch {
        return false;
      }
    }),
  );
  return panes.filter((_, i) => answers[i]);
}
