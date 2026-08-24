// The one door for editing a CHILD's own refs or list entries.
//
// The sparse-write door (`POST /api/entities/:id/entry`) only reaches
// the entity it's addressed to — `Session.writeEntry` (`server/session.ts`)
// reads `campaign.get(entityId)` and writes straight back to that one
// row's `lists`. It has no notion of "which child" at all, so it can
// touch a weapon's own Grit cost only if the weapon IS the addressed
// entity — never a character's carried child.
//
// Two things this port needs and the sparse door can't do:
//   - flip `refs.chambered` / `refs.upgrades` on a WEAPON child (§K —
//     "fit/unfit and chambering are the SAME kind of edit, a ref flip")
//   - decrement an AMMO child's own round count (§K — "ammo counts
//     live on the ammo item")
//
// Both go through the whole-entity door instead: `GET /api/entities/:id`
// (STORED, never `?resolved=1` — writing back a resolved read would
// bake the template's own values into the instance) → find the child by
// id → mutate → `PUT /api/entities/:id`. One helper, one seam, so the
// fetch→mutate→PUT pattern exists exactly once in the client.
//
// Race, noted honestly: two people editing two different children of
// the same character at once can clobber each other — the PUT writes
// the whole entity back, not a diff. Acceptable for v1 (the task's own
// call); the fix is a child-addressable write door on the server, which
// is server scope and out of this port's files.

import type { Entity, Entry, Ref } from '../../core/entity.ts';
import { api } from './api.ts';

/** Fetch → mutate the character and its children → PUT. Returns the saved entity. */
async function patchEntity(
  entityId: string,
  mutate: (stored: Entity) => Entity,
): Promise<Entity> {
  const stored = await api<Entity>(`/api/entities/${entityId}`);
  const next = mutate(stored);
  return api<Entity>(`/api/entities/${entityId}`, {
    method: 'PUT',
    body: { entity: next },
  });
}

function withChild(entity: Entity, childId: string, mutate: (child: Entity) => Entity): Entity {
  const children = (entity.children ?? []).map((c) => (c.id === childId ? mutate(c) : c));
  return { ...entity, children };
}

/**
 * Flip a ref slot on a carried child — chambering an ammo, fitting or
 * unfitting an upgrade. `null` clears the slot; a `Ref[]` for an
 * ordered slot (`upgrades`) replaces the whole list.
 */
export function writeRef(
  characterId: string,
  childId: string,
  slot: string,
  ref: Ref | Ref[] | null,
): Promise<Entity> {
  return patchEntity(characterId, (stored) =>
    withChild(stored, childId, (child) => {
      const refs = { ...(child.refs ?? {}) };
      if (ref === null) delete refs[slot];
      else refs[slot] = ref;
      return Object.keys(refs).length ? { ...child, refs } : { ...child, refs: undefined };
    }),
  );
}

/**
 * Flip a ref slot on the PERSON rather than on something they carry —
 * where a thing is carried (§K: worn, wielded, put away are refs on the
 * one doing the carrying, never a state written onto the thing).
 *
 * Same door and the same race as the child writes above: a whole-entity
 * PUT, so two screens moving two different things at once can clobber
 * each other, and both halves stay ordinary values a person can fix.
 *
 * SEVERAL SLOTS AT ONCE, on purpose: taking a thing out of one hand and
 * putting it in the other is one edit, and doing it as two PUTs would
 * leave a moment where the thing was in both places — the second write
 * reading a person the first had already changed.
 */
export function writeOwnRefs(
  entityId: string,
  edits: Record<string, Ref | Ref[] | null>,
): Promise<Entity> {
  return patchEntity(entityId, (stored) => {
    const refs = { ...(stored.refs ?? {}) };
    for (const [slot, ref] of Object.entries(edits)) {
      if (ref === null || (Array.isArray(ref) && !ref.length)) delete refs[slot];
      else refs[slot] = ref;
    }
    return Object.keys(refs).length ? { ...stored, refs } : { ...stored, refs: undefined };
  });
}

/**
 * Toggle one ref out of / into an ordered slot (`refs.upgrades`) by id
 * — fit adds it, unfit removes it, order otherwise preserved.
 */
export function toggleRef(
  characterId: string,
  childId: string,
  slot: string,
  ref: Ref,
  fit: boolean,
): Promise<Entity> {
  return patchEntity(characterId, (stored) =>
    withChild(stored, childId, (child) => {
      const held = child.refs?.[slot];
      const list = Array.isArray(held) ? held : held ? [held] : [];
      const next = fit
        ? [...list.filter((r) => r.id !== ref.id), ref]
        : list.filter((r) => r.id !== ref.id);
      const refs = { ...(child.refs ?? {}) };
      if (next.length) refs[slot] = next;
      else delete refs[slot];
      return Object.keys(refs).length ? { ...child, refs } : { ...child, refs: undefined };
    }),
  );
}

/**
 * Write one entry on a carried CHILD (never the character itself — that
 * has the sparse door already). Same edit shape as `EntryEdit`
 * (`server/session.ts`), applied by hand since there's no `setEntry`
 * import worth pulling into the client for one call site.
 */
export function writeChildEntry(
  characterId: string,
  childId: string,
  list: string,
  entryName: string,
  edit: { value?: number | string; max?: number | null; remove?: boolean },
): Promise<Entity> {
  return patchEntity(characterId, (stored) =>
    withChild(stored, childId, (child) => {
      const lists = { ...child.lists };
      let entries = [...(lists[list] ?? [])];
      if (edit.remove) {
        entries = entries.filter((e) => e.name.toLowerCase() !== entryName.toLowerCase());
      } else {
        const at = entries.findIndex((e) => e.name.toLowerCase() === entryName.toLowerCase());
        const base: Entry = at >= 0 ? entries[at] : { name: entryName };
        const next: Entry = { ...base };
        if (edit.value !== undefined) next.value = edit.value;
        if (edit.max === null) delete next.max;
        else if (edit.max !== undefined) next.max = edit.max;
        if (at >= 0) entries[at] = next;
        else entries = [...entries, next];
      }
      if (entries.length) lists[list] = entries;
      else delete lists[list];
      return { ...child, lists };
    }),
  );
}

/**
 * Add one carried child to a character — the same fetch→mutate→PUT
 * seam, for the one edit that adds rather than changes.
 *
 * `POST /api/stamp` is NOT this door and the difference cost an
 * afternoon: that route creates a stored entity ROW whose `parent_id`
 * is the character, which is the campaign's own parent tree (the
 * roster's shape), not the character's `children`. A carried thing is
 * an INLINE child of the character's own blob (§K), which is why the
 * seat's screens read `entity.children` and never saw a thing stamped
 * the other way. Stamping happens client-side (`core/stamp.ts` — thin,
 * a ref to the template) and lands here.
 */
export function addChild(characterId: string, child: Entity): Promise<Entity> {
  return patchEntity(characterId, (stored) => ({
    ...stored,
    children: [...(stored.children ?? []), child],
  }));
}
