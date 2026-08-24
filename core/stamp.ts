// The stamp — one link, variable thickness. `docs/CORE-NEXT.md` §13/§14.
//
// A template is content: the monster in the bestiary, the gun in the
// catalogue, the shop as written. An entity is an instance: the foe on
// the board at Health 5. The link between them is always `refs.from` —
// a template id minted at authoring, plus the cached name that degrades
// when the template is gone.
//
// Thickness is a property of the stamping ACTION, not the link. A THIN
// stamp stores nothing and derives everything through `from` — it's the
// book's gun until the table says otherwise, and a pack correction
// reaches it at the next render. A THICK stamp copied every value at
// birth — creation is authorship — and behaves identically thereafter,
// because the rule is one rule: everything derives through `from`, and
// stored values win.
//
// > Copy as little as the thing's nature allows.
//
// Resolution is a READING, computed at the point of use and stored
// nowhere (§8) — which is why a stamp can't go stale.

import {
  refIn,
  toEntity,
  toEntries,
  type Entity,
  type Entry,
  type Ref,
} from './entity.ts';
import { toPoolEffects, type PoolEffect } from './effects.ts';
import { mergeById, mergeNamed } from './merge.ts';
import { newId } from './id.ts';

/**
 * Entity-shaped content: what a bestiary blueprint, a catalogue item or
 * a shop-as-written carries. Not an entity — it isn't in play — but the
 * same limbs, which is what lets one stamp cover all of them.
 */
export type Template = {
  id: string;
  name: string;
  type?: string;
  lists?: Record<string, Entry[]>;
  notes?: string;
  /**
   * Content inside content — a foe's attacks, a shop's stock as
   * written. Templates all the way down, so a thin stamp's `children`
   * resolves them through the same link (§9, §I): an attack is a
   * child of the FOE TEMPLATE, never authored on the instance.
   */
  children?: Template[];
  /**
   * The author's own shelf label — "Rifles", "Perishables". Filing,
   * not a mechanic: it groups a picker and it is what a shop's derived
   * stock names when it says which shelves this vendor carries.
   */
  group?: string;
  /** The page it's printed on, when it came from a book — the same enrichment a blueprint carries. */
  page?: number;
  /** How many upgrades the thing takes. A number the author wrote down; nothing here reads it. */
  slots?: number;
  /**
   * What FITTING this to something does to that thing's dice — an
   * upgrade's, a round's. The stamp itself does nothing with them: a
   * fitting's arithmetic is a reading of the thing it's fitted TO,
   * computed at the point of use (`amendStats`, `core/effects.ts`),
   * which is why it is carried here and applied nowhere near here.
   */
  effects?: PoolEffect[];
  /**
   * A BUNDLE: template ids this entry unpacks into when acquired — an
   * outfit that is really eight things. Carried so whoever unpacks one
   * can; the stamp itself unpacks nothing.
   */
  contents?: string[];
};

/** Where resolution looks templates up — the caller brings the merge. */
export type TemplateOf = (id: string) => Template | undefined;

/**
 * A new entity from a template.
 *
 * Thin unless told otherwise. `name` lets a deployment christen the
 * instance ("Bark Watcher 2"); the ref keeps the template's own name
 * for degradation either way.
 *
 * `refs` is what the stamping ACTION knows and the template doesn't —
 * which fight put this foe on the table (`refs.encounter`), so a second
 * deploy can find its own last generation and clear it. `from` is
 * teller's and can't be restated here: the link is the one thing a
 * stamp is.
 */
export function stamp(
  template: Template,
  opts: { thick?: boolean; name?: string; refs?: Record<string, Ref | Ref[]> } = {},
): Entity {
  const from: Ref = { id: template.id, name: template.name };
  const out: Entity = {
    id: newId('ent'),
    name: opts.name ?? template.name,
    lists: {},
    refs: { ...opts.refs, from },
  };
  if (template.type) out.type = template.type;
  if (opts.thick) {
    out.lists = structuredClone(template.lists ?? {});
    if (template.notes) out.notes = template.notes;
    if (template.children?.length) {
      out.children = structuredClone(template.children).map(templateChildToEntity);
    }
  }
  return out;
}

/**
 * A template's child, read as the entity it would resolve to with no
 * override — used both for a thick stamp's birth copy and for a thin
 * stamp's read-through (`resolve`). Not itself stamped: an attack has
 * no `from` of its own to derive through, it's already the content.
 */
function templateChildToEntity(child: Template): Entity {
  const out: Entity = { id: child.id, name: child.name, lists: child.lists ?? {} };
  if (child.type) out.type = child.type;
  if (child.notes) out.notes = child.notes;
  if (child.children?.length) out.children = child.children.map(templateChildToEntity);
  return out;
}

/**
 * The entity as the table should read it: template underneath, stored
 * values on top, stored wins by name — rule 1 wearing its merge shape.
 *
 * No `from`, or a template nobody has? The entity as it stands — the
 * cached name in the ref is the surface's business to mark. Children
 * resolve through the same lookup, recursively: a stamped gun inside a
 * stamped character reads right too.
 */
export function resolve(entity: Entity, templateOf: TemplateOf): Entity {
  const out: Entity = { ...entity };
  const from = refIn(entity.refs, 'from');
  const template = from ? templateOf(from.id) : undefined;
  if (template) {
    const lists: Record<string, Entry[]> = {};
    for (const key of new Set([
      ...Object.keys(template.lists ?? {}),
      ...Object.keys(entity.lists),
    ])) {
      lists[key] = mergeNamed(template.lists?.[key], entity.lists[key]);
    }
    out.lists = lists;
    if (out.notes === undefined && template.notes) out.notes = template.notes;
  }
  // A thin stamp copied no children — they read through the link, same
  // as lists. Own children (stored, or a thick stamp's birth copy) win
  // over the template's by id, the same stored-wins-by-identity rule
  // every stamped collection follows.
  const templateChildren = (template?.children ?? []).map(templateChildToEntity);
  const merged = mergeById(templateChildren, entity.children ?? []);
  if (merged.length) {
    out.children = merged.map((child) => resolve(child, templateOf));
  } else {
    delete out.children;
  }
  return out;
}

/**
 * A template from anything entity-shaped — a blueprint row, a catalogue
 * line. Forgiving, like every read.
 *
 * IT CARRIES WHAT THE AUTHOR WROTE. The template half is a
 * serialization, and a lossy serialization was always a bug: a
 * catalogue entry's shelf label, its page, its slots and its bundle
 * used to fall off here, so five of six shops read as empty and a box
 * of rounds arrived at the table with nothing to count. `children` was
 * the same gap, fixed first (§I); these are the rest of it.
 *
 * The one coercion: an old-world `counters` authored BESIDE the lists
 * rather than in them becomes a list — under the author's own word,
 * never renamed. Which list a system files its counters in is the
 * system's business (rule 2), so Core preserves the key and decides
 * nothing.
 */
export function toTemplate(raw: unknown): Template | undefined {
  const entity = toEntity(raw);
  if (!entity) return undefined;
  const o = raw as Record<string, unknown>;

  const out: Template = { id: entity.id, name: entity.name };
  if (entity.type) out.type = entity.type;
  const lists = { ...entity.lists };
  const counters = toEntries(o.counters);
  if (counters.length && !lists.counters) lists.counters = counters;
  if (Object.keys(lists).length) out.lists = lists;
  if (entity.notes) out.notes = entity.notes;

  // Children are re-read from the RAW child rather than from the
  // coerced entity's, because a child carries these same limbs and
  // reading the entity back would drop them all over again.
  const children = Array.isArray(o.children)
    ? o.children.map(toTemplate).filter((t): t is Template => t !== undefined)
    : [];
  if (children.length) out.children = children;

  const group = String(o.group ?? '').trim();
  if (group) out.group = group;
  if (typeof o.page === 'number' && Number.isFinite(o.page)) out.page = o.page;
  if (typeof o.slots === 'number' && Number.isFinite(o.slots)) out.slots = o.slots;
  // The fitting's arithmetic, kept whole. Dropping it here was the
  // quiet half of the same bug the rest of this comment describes: an
  // upgrade whose effects fell off the serialization is a Damage +1B
  // that adds nothing, and the table reads the unamended pool all fight.
  const effects = toPoolEffects(o.effects);
  if (effects.length) out.effects = effects;
  const contents = Array.isArray(o.contents)
    ? o.contents.map((id) => String(id ?? '').trim()).filter(Boolean)
    : [];
  if (contents.length) out.contents = contents;
  return out;
}
