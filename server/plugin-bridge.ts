// THE BRIDGE — how a `door.*` call gets from a screen to a plugin and
// back, and how what a plugin ASKS FOR becomes what the host DID
// (docs/CORE-NEXT.md §15, the plugin UI tier, 2026-08-20).
//
// Three jobs, and the separation between them is the security model the
// same way the discover/enable/load split is:
//
//   * THE SNAPSHOT (`snapshotFor`) assembles the slice of the table the
//     plugin's manifest asked for — `read:templates/catalog` and
//     nothing it didn't name. This is §15's held line, unbroken: the
//     plugin is PUSHED what it needs and never queries. A door that
//     wants a slot its manifest doesn't name gets an absent key, not an
//     error, and degrades like anything else missing.
//   * THE CALL (`callDoor`) resolves WHO IS ASKING first — the server
//     decides, out of the key and the screen's assignment (rule 7) —
//     and hands the plugin facts, never headers. A plugin cannot
//     re-derive authority because it is never given anything to derive
//     it from.
//   * THE EFFECTS (`applyEffects`) execute what came back, through the
//     session's own doors, as an ordinary logged write. Every effect
//     maps onto a method teller already had, so rule 1 and rule 3 hold
//     by construction rather than by a plugin's good behaviour: a
//     plugin's write is undoable and overtypeable exactly like a DM's.
//
// **A plugin never holds the session.** It holds no live object at all:
// the boundary is `structuredClone` in both directions (`core/plugins.ts`),
// and the only thing that crosses it is data. The bridge is the only
// code that touches both sides, which is why it is one small file with
// the whole vocabulary in it rather than a helper in every route.
//
// **State lives here, keyed by Session, and dies with it.** The carts
// precedent, kept exactly (`server/notes.ts`, and the store-flow this
// tier was built to extract): a `WeakMap<Session, …>` means a campaign
// switch builds a new Session and every plugin's memory of the old
// table is unreferenced without anything having to remember to clear
// it. A plugin's memory is per-table by construction, and losing it on
// a reboot is fine — it holds what nobody is owed, like a cart nobody
// was in the room for.

import type { Entity } from '../core/entity.ts';
import type { LoadedPlugin } from '../core/plugins.ts';
import { grants, type DoorRequest, type DoorResult, type Effect, type Need, type TableSnapshot } from '../core/registry.ts';
import { fightGeometry } from './geometry.ts';
import { adopted, canDm, type Auth } from './auth.ts';
import type { Session } from './session.ts';

/** Per-table plugin memory: session → plugin id → whatever it left there. */
const memory = new WeakMap<Session, Map<string, unknown>>();

function memoryOf(session: Session): Map<string, unknown> {
  let held = memory.get(session);
  if (!held) {
    held = new Map();
    memory.set(session, held);
  }
  return held;
}

/** What a plugin remembers about this table — exported for the tests that check it dies. */
export function pluginState(session: Session, pluginId: string): unknown {
  return memoryOf(session).get(pluginId);
}

/**
 * The slice of the table this plugin's `needs` named.
 *
 * Every branch is a `read:` need doing its job. The gate is not a
 * courtesy: a plugin that never asked for `read:entities` is handed a
 * snapshot with no entities in it, and no amount of asking differently
 * at the door changes that, because there is nowhere to ask.
 */
export function snapshotFor(session: Session, needs: Need[]): TableSnapshot {
  const manifest = session.loaded.manifest;
  const out: TableSnapshot = {
    campaign: { slug: session.campaign.slug, name: manifest.name, rootId: manifest.id },
    declarations: {},
    templates: {},
    records: {},
  };
  for (const need of needs) {
    if (need.verb !== 'read') continue;
    if (need.subject === 'declarations' && need.slot) {
      out.declarations[need.slot] = {
        merged: session.loaded.declarations(need.slot),
        // The campaign's OWN rows, raw — what an editing surface needs
        // to know which rows are its to edit and which a pack wrote.
        own: session.campaign.templatesIn(need.slot),
      };
    } else if (need.subject === 'templates' && need.slot) {
      out.templates[need.slot] = session.loaded.templates(need.slot);
    } else if (need.subject === 'records' && need.slot) {
      out.records[need.slot] = session.loaded.record(need.slot);
    } else if (need.subject === 'board') {
      // The ground, measured here rather than described here: whoever
      // asked gets inches and cells, not coordinates to do sums on.
      // Whose turn it is comes out of the turn order, so a door that
      // reads the board reads it from the acting creature's point of
      // view without having to say so.
      const turn = session.turnState();
      const acting = turn.turn === null ? undefined : turn.order[turn.turn];
      out.board = fightGeometry(session, acting?.entityId);
    } else if (need.subject === 'entities') {
      // Both readings of every top-level entity, because both are true
      // about different questions: a purse is what the READING holds,
      // and a save must not thicken what was STORED.
      out.entities = session.campaign
        .children(manifest.id)
        .map((stored) => ({ stored, reading: session.reading(stored) }));
    }
  }
  return out;
}

/** The facts of the decision the server already made, as a door sees them. */
export function whoOf(auth: Auth, actor: string): DoorRequest['who'] {
  const display = auth.display;
  const who: DoorRequest['who'] = {
    actor,
    role: canDm(auth) ? 'dm' : adopted(display) ? (display.role ?? 'blank') : 'none',
  };
  if (adopted(display) && typeof display.params.entityId === 'string') {
    who.entityId = display.params.entityId;
  }
  return who;
}

/**
 * Which need one effect requires. The map IS the vocabulary's gate, so
 * it lives beside the vocabulary rather than being re-derived per call
 * site — a new effect that forgets to appear here is refused by default,
 * which is the right direction to fail in.
 */
function needFor(effect: Effect): { verb: Need['verb']; subject: string; slot?: string } | undefined {
  switch (effect.effect) {
    case 'entity.create':
    case 'entity.save':
    case 'entity.remove':
      return { verb: 'write', subject: 'entities' };
    case 'entry.write':
      return { verb: 'write', subject: 'entries' };
    case 'template.save':
    case 'template.remove':
      return { verb: 'write', subject: 'templates', slot: effect.slot };
    case 'log':
      return { verb: 'write', subject: 'log' };
    default:
      return undefined;
  }
}

/** Every effect this plugin didn't declare it would ask for, named. */
export function refusals(effects: Effect[], needs: Need[]): string[] {
  const out: string[] = [];
  for (const effect of effects) {
    const need = needFor(effect);
    if (!need) {
      out.push(`'${(effect as { effect?: string }).effect ?? '?'}' is not an effect`);
      continue;
    }
    if (!grants(needs, need.verb, need.subject, need.slot)) {
      out.push(
        `'${effect.effect}' wants ${need.verb}:${need.subject}${need.slot ? `/${need.slot}` : ''}, which this plugin never declared`,
      );
    }
  }
  return out;
}

/**
 * `{{label}}` → the id that effect minted, everywhere in a later effect
 * or in the answer being shipped.
 *
 * Exact matches only. A substring rewrite would mean a plugin could
 * never send the literal text, and the one thing this exists for —
 * naming a thing that didn't exist when the answer was written — never
 * needs half a string.
 */
function substitute<T>(value: T, minted: Map<string, string>): T {
  if (typeof value === 'string') {
    const hit = /^\{\{([^}]+)\}\}$/.exec(value);
    const id = hit ? minted.get(hit[1]) : undefined;
    return (id ?? value) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, minted)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substitute(v, minted);
    }
    return out as T;
  }
  return value;
}

/**
 * Run what the plugin asked for, in order, as the actor
 * `plugin:<plg_id>`.
 *
 * The actor is the point of the whole exercise: the log says a plugin
 * wrote this, so a DM reading history back can see that the counter
 * moved money rather than that "dm" mysteriously did. Every row is
 * still an ordinary row `/undo` walks.
 */
export function applyEffects(
  session: Session,
  pluginId: string,
  effects: Effect[],
): { minted: Map<string, string> } {
  const actor = `plugin:${pluginId}`;
  const minted = new Map<string, string>();
  for (const raw of effects) {
    const effect = substitute(raw, minted);
    switch (effect.effect) {
      case 'entity.create': {
        const made = session.create(
          effect.draft as Parameters<Session['create']>[0],
          actor,
          effect.parentId,
        );
        if (effect.as) minted.set(effect.as, made.id);
        break;
      }
      case 'entity.save':
        session.save(effect.entity as Entity, actor);
        break;
      case 'entity.remove':
        session.remove(effect.id, actor);
        break;
      case 'entry.write': {
        const { effect: _kind, entityId, ...edit } = effect;
        session.writeEntry(entityId, edit, actor);
        break;
      }
      case 'template.save': {
        const made = session.campaign.putTemplate(effect.slot, effect.template, actor);
        if (effect.as) minted.set(effect.as, made.id);
        session.changed('templates');
        break;
      }
      case 'template.remove':
        session.campaign.removeTemplate(effect.id, actor);
        session.changed('templates');
        break;
      case 'log':
        session.campaign.append(effect.entityId ?? null, actor, effect.kind, effect.payload);
        break;
    }
  }
  return { minted };
}

/** What the bridge answers a route with — a status and a body, like any door. */
export type BridgeReply = { status: number; body: unknown };

/**
 * One door call, end to end.
 *
 * The order matters and is the contract: authority is resolved by the
 * SERVER (the caller did it and hands the facts in), the snapshot is
 * assembled from `needs`, the plugin answers, the effects are CHECKED
 * against `needs` before any of them runs, then they run, then the ids
 * they minted are substituted into the answer on its way out.
 */
export async function callDoor(
  session: Session,
  plugin: LoadedPlugin,
  door: string,
  call: { method: string; path: string[]; body: Record<string, unknown>; who: DoorRequest['who'] },
): Promise<BridgeReply> {
  const point = `door.${door}` as const;
  const handler = plugin.provides[point];
  if (!handler) return { status: 404, body: { error: `${plugin.manifest.name} has no door '${door}'` } };

  const request: DoorRequest = {
    door,
    method: call.method,
    path: call.path,
    body: call.body,
    who: call.who,
    table: snapshotFor(session, plugin.manifest.needs),
    state: memoryOf(session).get(plugin.manifest.id) ?? null,
  };

  const answered = (await handler(request)) as DoorResult | undefined;
  const result: DoorResult = answered && typeof answered === 'object' ? answered : {};

  const effects = Array.isArray(result.effects) ? result.effects : [];
  const refused = refusals(effects, plugin.manifest.needs);
  if (refused.length) {
    // Nothing has run: the whole list is checked first, so a plugin
    // asking for one thing it never declared doesn't get the other
    // three through the door first. Loud, and with its own name on it.
    return { status: 403, body: { error: `${plugin.manifest.name}: ${refused.join('; ')}` } };
  }

  const { minted } = applyEffects(session, plugin.manifest.id, effects);
  if ('state' in result) memoryOf(session).set(plugin.manifest.id, result.state ?? null);
  for (const what of result.changed ?? []) session.changed(String(what));

  return {
    status: typeof result.status === 'number' ? result.status : 200,
    body: substitute(result.body ?? null, minted),
  };
}
