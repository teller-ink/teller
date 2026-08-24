// What a weapon's dice actually ARE, once what's bolted on and what's
// chambered have had their say.
//
// The data ported, the fitting ported, and nothing read the arithmetic:
// a Damage +1B fitted to a rifle drew the printed pool at the table, so
// the numbers on the glass were the book's rather than the table's. The
// arithmetic itself is core's (`amendStats`) and pure; this file is the
// wiring — where the effects come from, and when.
//
// **A fitting's effects live on its TEMPLATE.** A carried upgrade is a
// thin child (§K) whose whole content is `refs.from`, so reading what it
// does means reading the catalogue it was stamped from — the same door
// the spend menu already opens (`/api/stack/templates/<slot>`, seat-side,
// `client/lib/spend.ts`). Fetched once per screen and cached, because a
// shelf of 300 templates is not something a rail panel should re-read
// per tile.
//
// The reading is computed here and stored NOWHERE (§8): the printed
// value stays the stored value, a pack correction reaches a gun bought
// a month ago, and every number remains one a person can type over in
// the ordinary slot (rule 1).

import { useMemo } from 'react';
import { amendStats, type Amendment, type Fitting } from '../../core/effects.ts';
import type { Entity, Ref } from '../../core/entity.ts';
import type { Template } from '../../core/stamp.ts';
import type { DiceRecord } from './dice.ts';
import { api } from './api.ts';
import { CATALOG_SLOT } from './spend.ts';
import { DECLARED, useLive } from './use-session.ts';

/**
 * Slots a fitting can have been stamped from — the same posture as the
 * server's `STAMP_SLOTS` (`server/session.ts`), and the same small
 * number of slot words in code. A pack that files its fittings under
 * another name is read by adding it here, not by teaching this file
 * about any system's vocabulary.
 */
export const FITTING_SLOTS = [CATALOG_SLOT, 'upgrades'];

function refsIn(entity: Entity, slot: string): Ref[] {
  const held = entity.refs?.[slot];
  return Array.isArray(held) ? held : held ? [held] : [];
}

/** Every template a fitting could have come from, by id. */
export function loadFittings(): Promise<Map<string, Template>> {
  return Promise.all(
    FITTING_SLOTS.map((slot) =>
      api<Template[]>(`/api/stack/templates/${slot}`).catch(() => [] as Template[]),
    ),
  ).then((slots) => {
    const out = new Map<string, Template>();
    for (const templates of slots) {
      for (const template of templates) out.set(template.id, template);
    }
    return out;
  });
}

/**
 * Every carried thing's amended stats, keyed by the child's id — and
 * only the stats something actually changed, so a tile with nothing
 * fitted gets an empty map and renders exactly what it stored.
 *
 * ORDER: the weapon's upgrades in the order they were fitted, and
 * what's CHAMBERED last — the round is the final thing that happens to
 * a pool before it's rolled (the old app's rule, kept).
 */
export function useAmendments(
  children: Entity[],
  dice?: DiceRecord,
): Map<string, Map<string, Amendment>> {
  const { data } = useLive(loadFittings, [], { on: [...DECLARED, 'templates'] });
  const faces = dice?.faces;
  return useMemo(() => {
    const out = new Map<string, Map<string, Amendment>>();
    if (!data || !faces || !Object.keys(faces).length) return out;
    const held = new Map(children.map((c) => [c.id, c]));
    // A fitting names itself by the instance's own name where there is
    // one — a person who renamed their scope should read that name in
    // the reading it explains — and degrades to the template's.
    const fittingOf = (ref: Ref): Fitting | undefined => {
      const child = held.get(ref.id);
      const from = child ? refsIn(child, 'from')[0] : undefined;
      const template = data.get(from?.id ?? ref.id);
      const effects = template?.effects ?? [];
      if (!effects.length) return undefined;
      return { name: child?.name || ref.name || template?.name || '', effects };
    };
    for (const child of children) {
      const fittings = [
        ...refsIn(child, 'upgrades'),
        ...refsIn(child, 'chambered'),
      ]
        .map(fittingOf)
        .filter((f): f is Fitting => f !== undefined);
      if (!fittings.length) continue;
      const amended = amendStats(child.lists.stats ?? [], fittings, faces);
      if (amended.size) out.set(child.id, amended);
    }
    return out;
  }, [data, children, faces]);
}

// WHAT DOESN'T LIVE HERE YET, and why (2026-08-24, Brian, from the
// Guidebook): a person's own stats amended by their gear — Defense over
// a breastplate. The arithmetic is ready (`amendStats` already reports
// its working, `Amendment.steps`), and the reading is drawn (the pinned
// stat opens a breakdown with an innate line waiting for modifier
// lines). What's missing is the only thing that decides which gear
// counts: the book keys the modifier on WORN, not on carried — one
// piece of armor at a time, weapons wielded or holstered or stored —
// and nothing in the data expresses carry state yet. Applying the
// effects of everything CARRIED would have shipped a coat in a
// saddlebag defending its owner. The wiring arrives with `refs.worn`.
