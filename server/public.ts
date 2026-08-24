// The player-safe snapshot — one payload every passive surface renders
// whole (rule 6: table, board, badge and art consume this and nothing
// else).
//
// This is the old world's law (`worker/db.ts`'s `toPublicCharacter` /
// `publicScene`) re-enforced against the new data model. The law did
// not change; what it has to reason about did:
//
//   * NPC NUMBERS NEVER LEAVE THE SERVER. A foe's numeric stats are
//     stripped and a qualitative `vitality` substitutes — a STATE, not
//     a number, safe on a screen the players are looking at.
//   * Party members keep their numbers; they are on the table anyway.
//   * `notes` never travel, for anyone.
//   * `children` never travel — what a character carries is their own
//     business, and a passive surface has no use for a weapon list.
//   * `refs` never travel: provenance is the DM's business.
//   * Hidden map secrets never transmit. A hidden placement is REMOVED
//     from the payload, not styled away — an ambush the table cannot
//     find in devtools — and fog is flattened to revealed cells, since
//     nobody needs the shape of a room they haven't walked into.
//   * Statuses ARE visible, for everyone including foes: the poison
//     token is sitting on the mini, and its severity rides along.
//
// The one genuinely NEW judgement is which lists count as "numbers".
// The old world had a column (`counters` vs `tags`); the new one has
// `lists`, and what a list MEANS is a system-layer declaration (§2,
// `core/kind.ts`). So the answer comes from the declarations and never
// from a list name — there are no game words in here, and a system
// teller has never seen gets the same treatment:
//
//   a kind declaring `zero: 'clears'` is TAG-LIKE — easing it to
//   nothing removes it, which is what a condition does. Visible.
//   Everything else — `stays`, `text`, `steps`, and every undeclared
//   list — is treated as the sheet's own business and stripped for
//   foes.
//
// Over-stripping is the safe direction for a foe and only for a foe:
// the old world's redaction was an allowlist for exactly this reason
// ("anything new is private until someone decides otherwise"), and a
// party member keeps everything either way.

import type { Entity, Entry } from '../core/entity.ts';
import { numberOf } from '../core/entity.ts';
import { kindFor, toKindDef, type KindDef } from '../core/kind.ts';
import type { Board } from '../core/store.ts';
import { activeHandout, type Handout } from './handouts.ts';
import type { Session } from './session.ts';
import type { TurnState } from './turn.ts';

/**
 * Where the number stands, qualitatively. Deliberately `down` and not
 * `dead`: teller reports where the number is, and the table rules on
 * what that means. Nothing may branch on what `down` implies.
 */
export type Vitality = 'healthy' | 'bloodied' | 'critical' | 'down';

/** An entity as a passive screen may see it. */
export type PublicEntity = {
  id: string;
  name: string;
  type?: string;
  /** Which law was applied — the shape is the tag, so a view needn't re-derive it. */
  side: 'foe' | 'party';
  lists: Record<string, Entry[]>;
  vitality?: Vitality;
};

export type PublicBoard = {
  board: Board;
  /** Placements minus the hidden ones, fog flattened. Never the raw row. */
  state: unknown;
};

/**
 * What the art frame is showing — the ACTIVE handout and nothing else.
 *
 * The gallery is not in here and never will be: the snapshot is what a
 * passive screen renders whole, and the DM's shelf of pictures is prep
 * (`GET /api/handouts`, behind the prep gate). Its `notes` are stripped
 * for the same reason nobody's notes travel — the frame draws a
 * picture, not the Warden's reminder about it.
 *
 * A PASSED note is not here either, and that is the load-bearing
 * absence: this payload goes to the whole room, so anything aimed at
 * one player is answered per-screen instead (`server/notes.ts`).
 */
export type PublicHandout = { id: string; name: string; key: string };

/**
 * FURNITURE, not somebody at the table.
 *
 * A live shop is an entity like everything else (§14 — "the shop went
 * live"), and it is not a person: it carries no sheet, no vitality and
 * nothing a passive screen draws, only the counts it has sold down. So
 * it stays out of the public roster rather than arriving as a nameless
 * party member with one odd list.
 *
 * `vendor` is a convention WORD, the way `foe` above it is — not store
 * machinery, and nothing here knows what a shop is or does. It survived
 * the store's extraction into a plugin (§15) for that reason: the type
 * word is the entity's own, the plugin merely writes it, and a second
 * plugin that mints bookkeeping entities says the same word to get the
 * same courtesy. What went with the store is the SHOP LINE this
 * snapshot used to carry — a passive screen no longer announces that
 * the general store is open, because knowing that was store knowledge
 * living in teller. Whether a plugin should be able to contribute to
 * the public snapshot is a real question and an open one; it is not
 * answered by leaving half a store behind.
 */
const FURNITURE_TYPES = ['vendor'];

export type PublicSnapshot = {
  campaign: { slug: string; name: string };
  roster: PublicEntity[];
  turn: TurnState;
  board: PublicBoard | null;
  handout: PublicHandout | null;
};

/** §M-6's convention, and the client's: a foe says so on its type. */
export function isFoe(entity: { type?: string }): boolean {
  return entity.type === 'foe';
}

function kindsOf(session: Session): KindDef[] {
  return session.loaded
    .declarations('kinds')
    .map(toKindDef)
    .filter((k): k is KindDef => k !== undefined);
}

/**
 * Does this list hold held things rather than the sheet's numbers?
 *
 * The discriminator is the declaration's zero rule and nothing else —
 * see the header. An undeclared list reads as private, which is the
 * conservative answer and matches `setEntry`'s own default posture.
 */
export function tagLike(kinds: KindDef[], list: string): boolean {
  const domain = kindFor(kinds, list)?.domain;
  return domain?.kind === 'count' && domain.zero === 'clears';
}

/**
 * Qualitative wound state from the first max-bearing entry — the
 * vitality-by-convention slot, the old world's own rule carried over.
 * Statuses are skipped: a severity with a ceiling is not a life bar.
 *
 * A max with no value reads as zero (§M-8, absent is zero), which is
 * the same arithmetic every other consumer runs.
 */
export function vitalityOf(
  lists: Record<string, Entry[]>,
  kinds: KindDef[],
): Vitality | undefined {
  for (const [list, entries] of Object.entries(lists)) {
    if (tagLike(kinds, list)) continue;
    for (const entry of entries) {
      if (typeof entry.max !== 'number' || entry.max <= 0) continue;
      const current = numberOf(entry) ?? 0;
      if (current <= 0) return 'down';
      const ratio = current / entry.max;
      return ratio <= 0.25 ? 'critical' : ratio <= 0.5 ? 'bloodied' : 'healthy';
    }
  }
  return undefined;
}

/**
 * One entity, redacted. `reading` is the RESOLVED entity (§14): a thin
 * stamp's ceiling lives in its template, and a vitality computed off
 * the stored half alone would be blank for every deployed foe.
 */
export function publicEntity(reading: Entity, kinds: KindDef[]): PublicEntity {
  const foe = isFoe(reading);
  const lists: Record<string, Entry[]> = {};
  for (const [list, entries] of Object.entries(reading.lists ?? {})) {
    if (foe && !tagLike(kinds, list)) continue;
    lists[list] = entries.map((e) => ({ ...e }));
  }
  const out: PublicEntity = {
    id: reading.id,
    name: reading.name,
    side: foe ? 'foe' : 'party',
    lists,
  };
  if (reading.type) out.type = reading.type;
  // Computed off the FULL reading, never the redacted copy — the whole
  // point is that the state survives the numbers being taken away. The
  // table's glow wants it for the posse too, so everyone gets one.
  const vitality = vitalityOf(reading.lists ?? {}, kinds);
  if (vitality) out.vitality = vitality;
  return out;
}

/**
 * Live board state as the table may see it.
 *
 * Hidden placements are removed rather than flagged, and fog collapses
 * to plain revealed cells. Everything else about the state passes
 * through: a passive surface has to render this whole, and the view /
 * scale metadata beside the tokens is what makes a drawn square a real
 * inch (§4's calibration, which is teller-the-program, not a secret).
 */
export function publicBoardState(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data ?? null;
  const state = { ...(data as Record<string, unknown>) };
  for (const key of ['placements', 'zones']) {
    const list = state[key];
    if (Array.isArray(list)) {
      state[key] = list.filter(
        (item) => !(item && typeof item === 'object' && (item as { hidden?: unknown }).hidden),
      );
    }
  }
  const fog = state.fog;
  if (fog && typeof fog === 'object' && !Array.isArray(fog)) {
    const f = fog as { on?: unknown; revealed?: unknown; regions?: unknown };
    const revealed = Array.isArray(f.revealed) ? [...f.revealed] : [];
    if (Array.isArray(f.regions)) {
      for (const region of f.regions) {
        const r = region as { revealed?: unknown; cells?: unknown };
        if (r?.revealed && Array.isArray(r.cells)) revealed.push(...r.cells);
      }
    }
    state.fog = { on: f.on ?? false, revealed };
  }
  return state;
}

/**
 * The campaign's active board — the table TV's "active scene", carried
 * as one ordinary manifest ref (`refs.board`) beside `refs.system`. No
 * ref means no active board, which means the table sits idle; a ref
 * naming a board this host hasn't got reports as absent rather than
 * pretending (the missing-not-dropped rule, rule 9's tail).
 */
export function activeBoard(session: Session): PublicBoard | null {
  // Read the LIVE manifest, not the loaded one: a board swap doesn't
  // re-resolve the content stack, so `loaded.manifest` is a snapshot
  // from the last load and would answer with yesterday's scene. That
  // read is `Session.activeBoardId` — deploy asks the same question
  // when it goes looking for somewhere to put the fight, and two
  // spellings of "which board" would eventually disagree.
  const id = session.activeBoardId();
  if (!id) return null;
  const board = session.shelf.board(id);
  if (!board) return null;
  return { board, state: publicBoardState(session.campaign.boardState(id) ?? null) };
}

/** The whole snapshot, assembled once so no passive screen assembles anything. */
export function publicSnapshot(session: Session): PublicSnapshot {
  const kinds = kindsOf(session);
  const manifest = session.campaign.root();
  return {
    campaign: { slug: session.campaign.slug, name: manifest.name },
    roster: session.campaign
      .children(manifest.id)
      .filter((entity) => !FURNITURE_TYPES.includes(entity.type ?? ''))
      .map((entity) => publicEntity(session.reading(entity), kinds)),
    turn: session.turnState(),
    board: activeBoard(session),
    handout: publicHandout(activeHandout(session)),
  };
}

/** The active handout, stripped to what a frame needs to draw it. */
export function publicHandout(handout: Handout | null): PublicHandout | null {
  return handout ? { id: handout.id, name: handout.name, key: handout.key } : null;
}
