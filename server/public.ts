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
//     Who counts as one is DECLARED and asked fail-closed (`isParty`) —
//     the audit of 2026-08-24 found the question asked the other way
//     round, and a foe nobody typed a word onto came through as posse.
//   * A HIDDEN THING IS HIDDEN EVERYWHERE. The same audit found the
//     ambush's token stripped from the board while its name rode the
//     roster and the turn order out to the same screen, so both are cut
//     by `hiddenOnActiveBoard` and the turn's pointer re-aimed after.
//   * A DRAFT IS PREP. A half-made character belongs to the console
//     until creation clears its mark.
//   * `notes` never travel, for anyone.
//   * `children` never travel — what a character carries is their own
//     business, and a passive surface has no use for a weapon list.
//   * `refs` never travel: provenance is the DM's business.
//   * Hidden map secrets never transmit. A hidden placement is REMOVED
//     from the payload, not styled away — an ambush the table cannot
//     find in devtools — and fog is flattened to one mask of cells,
//     since nobody needs the shape of a room they haven't walked into.
//     The board's own AREAS go the same way: a named patch of map is
//     the name AND the shape of a secret, so the row is stripped of
//     them before it travels (`publicBoardRow`).
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
import { isDraft, numberOf } from '../core/entity.ts';
import { flatFog, toFog, type Area } from '../core/fog.ts';
import { kindFor, toKindDef, type KindDef } from '../core/kind.ts';
import type { Board } from '../core/store.ts';
import { activeHandout, type Handout } from './handouts.ts';
import { noticeOf, type Notice } from './notice.ts';
import type { Session } from './session.ts';
import type { TurnEntry, TurnState } from './turn.ts';

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
  /** The shelf row MINUS its areas — see `publicBoardRow`. */
  board: Board;
  /** Placements minus the hidden ones, fog flattened. Never the raw row. */
  state: unknown;
};

/**
 * The board asset as the room may see it: everything that makes a
 * drawn square a real inch, and nothing that names a place.
 *
 * The picture, the width and the grid are calibration —
 * teller-the-program, and the table cannot render without them. AREAS
 * are the opposite: "the vault", with its exact rectangle, is the
 * shape and the name of a room nobody has walked into, and it would
 * have ridden out beside the flattened mask that exists precisely to
 * withhold it. A board row is not player-safe by default and no future
 * field on it should be assumed to be.
 */
export function publicBoardRow(board: Board): Board {
  const { areas: _areas, ...rest } = board;
  return rest;
}

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
  /**
   * The line the DM put up for the ROOM, and the one thing in here
   * that was never redacted from anything — a notice is words the DM
   * typed FOR the players (`server/notice.ts`). A passed NOTE is still
   * absent and always will be: aimed at one person, answered
   * per-screen, and this payload goes to the whole table.
   */
  notice: Notice | null;
};

/**
 * WHO IS ON THE PARTY'S SIDE — the one question the whole redaction
 * hangs off, asked FAIL-CLOSED (the adversarial audit, 2026-08-24).
 *
 * It used to be asked the other way round — `type === 'foe'` meant foe
 * and everything else was party — and that read the type field as
 * though it held a side. It never did. `type` is DOUBLE-BOOKED: a live
 * character carries its TRADE there (creation writes `type: trade.name`
 * — "Marshal", "Trapper"), the roster bar mints `npc`/`pc`, and a foe
 * stamped from a template whose author never typed the word arrives
 * with no type at all. Every one of those fell through to "party" and
 * put a full sheet of numbers on the glass in the middle of the room.
 *
 * So the question is now asked from the party's end, where the answer
 * is DECLARED rather than assumed: an entity is party if it says `pc`,
 * or if its type is one of the trades the system declares — the same
 * list creation picked the trade from. Everything else — `npc`, `foe`,
 * `vendor`, a word nobody recognises, no word at all — gets the foe
 * treatment: a name and a vitality band, no numbers, no lists. A system
 * that declares no trades leaves `pc` as the only way in, which is the
 * honest floor and not a failure.
 *
 * **The known cost, stated rather than discovered**: a friendly NPC —
 * the sheriff fighting beside the posse — now has its numbers hidden on
 * player-facing glass. That is the constitution's own line ("NPC numbers
 * never shown", rule 6), not a regression; the real fix is a STORED
 * side a human can set and overrule (TEL-126), which is rule 1's answer
 * to every question this shape raises. Until it exists, over-stripping
 * is the safe direction and always was.
 */
export function isParty(entity: { type?: string }, trades: ReadonlySet<string>): boolean {
  const type = (entity.type ?? '').trim().toLowerCase();
  if (!type) return false;
  return type === 'pc' || trades.has(type);
}

/**
 * The trades this table's stack declares, lowered for the comparison —
 * `declarations('trades')` is the same merged slot the creation engine
 * reads (`system/creation`), so the two can't drift into disagreeing
 * about what a Marshal is.
 */
export function tradeNames(session: Session): Set<string> {
  const out = new Set<string>();
  for (const item of session.loaded.declarations('trades')) {
    const name = (item as { name?: unknown })?.name;
    if (typeof name === 'string' && name.trim()) out.add(name.trim().toLowerCase());
  }
  return out;
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
export function publicEntity(
  reading: Entity,
  kinds: KindDef[],
  trades: ReadonlySet<string>,
): PublicEntity {
  const foe = !isParty(reading, trades);
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
 * to its EFFECTIVE MASK — one flat list of cells and the base that says
 * what they mean (`core/fog.ts`). Everything else about the state
 * passes through: a passive surface has to render this whole, and the
 * view / scale metadata beside the tokens is what makes a drawn square
 * a real inch (§4's calibration, which is teller-the-program, not a
 * secret).
 *
 * The AREAS are the reason this takes a second argument. They live on
 * the board row now, and they are exactly the kind of thing that must
 * not travel: "the vault", drawn as a rectangle the posse hasn't
 * walked into, is the shape and the name of a secret. So the mask is
 * computed here, from the board's areas and the fight's freehand
 * cells, and what leaves is cells — under `dark` the lit ones, under
 * `clear` the covered ones, and in neither case anything with a name
 * on it.
 */
export function publicBoardState(data: unknown, areas: Area[] = []): unknown {
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
  if (state.fog !== undefined) state.fog = flatFog(toFog(state.fog), areas);
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
  return {
    board: publicBoardRow(board),
    state: publicBoardState(session.campaign.boardState(id) ?? null, board.areas ?? []),
  };
}

/**
 * WHO IS LYING IN WAIT — the entities whose only tokens on the active
 * board are hidden ones.
 *
 * Stripping the token was never enough (the audit, 2026-08-24). The
 * placement came out of the board state and the ambusher's NAME rode
 * the public roster and the public turn order anyway, so the table read
 * "Pondweed Peril, healthy" off the board view of a scene it could not
 * see a token in. A hidden thing is hidden in every payload or it is
 * not hidden.
 *
 * "Only" is the load-bearing word: an entity standing openly somewhere
 * on the same board has already been shown to the room, and taking its
 * name away would leave its own visible token nameless. So a placement
 * anyone can see counts as a reveal, and the ambush is the entity whose
 * every placement here is hidden.
 */
export function hiddenOnActiveBoard(session: Session): Set<string> {
  const hidden = new Set<string>();
  const boardId = session.activeBoardId();
  if (!boardId) return hidden;
  const state = session.campaign.boardState(boardId);
  const placements = (state as { placements?: unknown })?.placements;
  if (!Array.isArray(placements)) return hidden;
  const open = new Set<string>();
  for (const item of placements) {
    if (!item || typeof item !== 'object') continue;
    const { entityId, hidden: veiled } = item as { entityId?: unknown; hidden?: unknown };
    if (typeof entityId !== 'string' || !entityId) continue;
    (veiled ? hidden : open).add(entityId);
  }
  for (const id of open) hidden.delete(id);
  return hidden;
}

/**
 * The roster a passive screen may see: furniture out (§14), DRAFTS out,
 * ambushers out, and everything that remains redacted by the party rule
 * above.
 *
 * Drafts leave for the same reason prep does (the audit, 2026-08-24): a
 * half-made character is somebody mid-sentence at the console — its
 * `meta` mark and its half-filled stats are the making of it, not the
 * table's business — and creation clears the mark at the last step, so
 * the moment there is a character there is a roster row.
 */
export function publicRoster(session: Session): PublicEntity[] {
  const kinds = kindsOf(session);
  const trades = tradeNames(session);
  const hidden = hiddenOnActiveBoard(session);
  return session.campaign
    .children(session.campaign.root().id)
    .filter((entity) => !FURNITURE_TYPES.includes(entity.type ?? ''))
    .filter((entity) => !hidden.has(entity.id))
    .map((entity) => session.reading(entity))
    .filter((reading) => !isDraft(reading))
    .map((reading) => publicEntity(reading, kinds, trades));
}

/**
 * The turn order a passive screen may see — the ambush taken out of the
 * list, and the pointer moved to follow it.
 *
 * Filtering an ordered list without re-aiming its index is how a
 * highlight ends up on the wrong name, which is worse than showing
 * nothing: if the acting row survived, the index finds it again by id;
 * if the acting row was the hidden one, the index lands on the next
 * surviving row after it, wrapping — the turn is still passing, the
 * table just isn't told whose it is while the thing in the reeds takes
 * it.
 */
export function publicTurn(turn: TurnState, hidden: ReadonlySet<string>): TurnState {
  const shown = (entry: TurnEntry) => !(entry.entityId && hidden.has(entry.entityId));
  const order = turn.order.filter(shown);
  if (order.length === turn.order.length) return turn;
  let at: number | null = null;
  if (turn.turn !== null && order.length) {
    for (let n = 0; n < turn.order.length; n++) {
      const candidate = turn.order[(turn.turn + n) % turn.order.length];
      if (candidate && shown(candidate)) {
        at = order.findIndex((e) => e.id === candidate.id);
        break;
      }
    }
  }
  return { ...turn, order, turn: at === -1 ? null : at };
}

/** The same turn, asked of the session — one call for the two doors. */
export function publicTurnState(session: Session): TurnState {
  return publicTurn(session.turnState(), hiddenOnActiveBoard(session));
}

/**
 * The roster as the ROSTER DOOR answers it (`GET /api/entities`) for a
 * caller who may only watch: identity and nothing else, cut by exactly
 * the filters the snapshot uses. One redactor, two doors — the audit
 * found them disagreeing, and a second spelling of "what may the room
 * see" is a second thing to forget to fix.
 */
export function publicEntityList(session: Session): {
  id: string;
  name: string;
  type: string | null;
}[] {
  return publicRoster(session).map((e) => ({ id: e.id, name: e.name, type: e.type ?? null }));
}

/** The whole snapshot, assembled once so no passive screen assembles anything. */
export function publicSnapshot(session: Session): PublicSnapshot {
  const manifest = session.campaign.root();
  return {
    campaign: { slug: session.campaign.slug, name: manifest.name },
    roster: publicRoster(session),
    turn: publicTurnState(session),
    board: activeBoard(session),
    handout: publicHandout(activeHandout(session)),
    notice: noticeOf(session),
  };
}

/** The active handout, stripped to what a frame needs to draw it. */
export function publicHandout(handout: Handout | null): PublicHandout | null {
  return handout ? { id: handout.id, name: handout.name, key: handout.key } : null;
}
