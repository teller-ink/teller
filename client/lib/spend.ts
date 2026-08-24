// Wiring between a declared `spends` menu and the doors that already
// exist — the client half of `core/effects.ts`.
//
// The interpreter is pure and lives in core; nothing there writes
// anything. This file is the other end: it assembles the declared
// world a plan is computed against, and it APPLIES a plan the person
// confirmed, through the ordinary endpoints. No new door was opened
// for advancement — a purchase is a handful of sparse entry writes and
// (for a purchase that hands you a thing) an ordinary stamp, which is
// why the event log carries every one of them for free (rule 3) and
// why every number it moves is one a stepper can move back (rule 1).
//
// The writes go one at a time, in the plan's own order — cost first.
// That is not atomic, and saying so is better than pretending: the door
// takes one entry, a half-applied purchase leaves the debit visible
// rather than the gift, and both halves are ordinary values a person
// can fix. A batch door would be the wrong thing to build for this.

import type { SpendPlan, SpendWorld } from '../../core/effects.ts';
import type { Entity } from '../../core/entity.ts';
import { stamp, type Template } from '../../core/stamp.ts';
import { api } from './api.ts';
import { addChild } from './refs.ts';
import { writeEntry } from './entry.ts';

/** Slots a purchase may draw a carried thing from. The catalogue is the one that stamps today. */
export const CATALOG_SLOT = 'catalog';

/**
 * The declared world an effect is computed against — every piece of it
 * a record or a template slot, none of it named in code.
 */
export function spendWorld(
  entity: Entity | undefined,
  records: Record<string, Record<string, unknown> | undefined>,
  catalog?: Template[],
): SpendWorld {
  const marks = records.marks as
    | { categories?: string[]; list?: string }
    | undefined;
  const dice = records.dice as { faces?: Record<string, string[]> } | undefined;
  return {
    entity,
    groups: records.groups as Record<string, string[]> | undefined,
    faces: dice?.faces ?? {},
    marks: marks?.categories?.length
      ? { list: marks.list ?? 'marks', categories: marks.categories }
      : undefined,
    catalog: catalog?.length
      ? {
          slot: CATALOG_SLOT,
          items: catalog.map((t) => ({ id: t.id, name: t.name, type: t.type })),
        }
      : undefined,
  };
}

/** The stampable templates a purchase may draw from — empty on a host with no pack. */
export function loadCatalog(): Promise<Template[]> {
  return api<Template[]>(`/api/stack/templates/${CATALOG_SLOT}`).catch(() => []);
}

/**
 * Carry out a confirmed plan against one entity.
 *
 * A purchase that hands you a thing stamps THIN, client-side — a name
 * and a ref to the template, exactly what the carried screens already
 * hold — and lands as an inline child through the same door every other
 * child edit uses (`client/lib/refs.ts`). Not `POST /api/stamp`: that
 * route makes a stored entity ROW under the character in the CAMPAIGN's
 * parent tree, which is the roster's shape, not the character's own
 * `children` (§K). Both are called "a child" and only one of them is a
 * thing you carry.
 */
export async function applyPlan(
  entityId: string,
  plan: SpendPlan,
  catalog: Template[] = [],
): Promise<void> {
  for (const write of plan.entries) {
    await writeEntry(entityId, write);
  }
  for (const wanted of plan.stamps) {
    const template = catalog.find((t) => t.id === wanted.templateId);
    // Reported, never silently skipped: a purchase whose template went
    // missing between the menu opening and the tap is the person's to
    // hear about, and the debit above already happened.
    if (!template) throw new Error(`no template ${wanted.templateId} — missing pack?`);
    await addChild(entityId, stamp(template, { name: wanted.name }));
  }
}
