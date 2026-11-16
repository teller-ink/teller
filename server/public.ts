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
//     Who counts as one is DECLARED and asked fail-closed (`sideAt`) —
//     the audit of 2026-08-24 found the question asked the other way
//     round, and a foe nobody typed a word onto came through as posse.
//   * A HIDDEN THING IS HIDDEN EVERYWHERE. The same audit found the
//     ambush's token stripped from the board while its name rode the
//     roster and the turn order out to the same screen, so both are cut
//     by `hiddenFromTable` and the turn's pointer re-aimed after —
//     whichever board is up, or none (the audit, 2026-11-16).
//   * A DRAFT IS PREP. A half-made character belongs to the console
//     until creation clears its mark.
//   * `notes` never travel, for anyone.
//   * `children` never travel — what a character carries is their own
//     business, and a passive surface has no use for a weapon list.
//   * `refs` never travel: provenance is the DM's business.
//   * Hidden map secrets never transmit. A hidden placement is REMOVED
//     from the payload, not styled away — an ambush the table cannot
//     find in devtools — and fog travels as the bare set of dark cells,
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
import { sideOf, type Side } from '../core/side.ts';
import { hasEntry, isDraft, numberOf } from '../core/entity.ts';
import { toFog } from '../core/fog.ts';
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
  side: Side;
  lists: Record<string, Entry[]>;
  vitality?: Vitality;
};

export type PublicBoard = {
  /** The shelf row MINUS its areas and its terrain — see `publicBoardRow`. */
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
 *
 * TERRAIN is the same answer, arrived at the same way: "the ford is
 * here, it is waist-deep, and the ridge behind it blocks sight" is the
 * Warden's prep and half of it is written about ground nobody has
 * reached yet. Whether a display RENDERS inherent data is a later,
 * per-display choice (docs/BATTLEMAP-NEXT.md); until that ships the
 * boundary answer is the strict one, and the redaction is the ABSENCE
 * — nothing is flattened, nothing is dimmed, the field is not there.
 */
export function publicBoardRow(board: Board): Board {
  const { areas: _areas, terrain: _terrain, ...rest } = board;
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
export const FURNITURE: ReadonlySet<string> = new Set(['vendor']);

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
 * hangs off, asked FAIL-CLOSED (the adversarial audit, 2026-08-24) and
 * answered by `core/side.ts` since TEL-126: a side a human stored wins,
 * the declared trades derive the default, furniture is on no side, and
 * everything else gets the foe treatment — a name and a vitality band,
 * no numbers, no lists. The sheriff fighting beside the posse shows
 * their numbers the moment the DM flips them to `party` (rule 1), which
 * is the answer this shape always wanted.
 */
export function sideAt(session: Session, entity: Entity): Side {
  return sideOf(entity, tradeNames(session), FURNITURE);
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
  const side = sideOf(reading, trades, FURNITURE);
  const foe = side !== 'party';
  const lists: Record<string, Entry[]> = {};
  for (const [list, entries] of Object.entries(reading.lists ?? {})) {
    if (foe && !tagLike(kinds, list)) continue;
    lists[list] = entries.map((e) => ({ ...e }));
  }
  const out: PublicEntity = {
    id: reading.id,
    name: reading.name,
    side,
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
 * Hidden placements are removed rather than flagged, and fog is
 * NORMALISED — read through `toFog` so that whatever shape it was
 * written in, what leaves is `{ dark }` and nothing else. That used to
 * be a flattening job, folding per-area state into a mask; since the
 * rethink the set IS the mask and there is nothing to fold, which is
 * the clearest evidence the old model had more moving parts than the
 * feature did.
 *
 * Everything else about the state passes through: a passive surface has
 * to render this whole, and the view / scale metadata beside the tokens
 * is what makes a drawn square a real inch (§4's calibration, which is
 * teller-the-program, not a secret).
 *
 * The AREAS are not in here at all, and that is the point: "the vault",
 * drawn as a rectangle the posse hasn't walked into, is the shape and
 * the name of a secret. They live on the board row and are stripped
 * from it before it travels (`publicBoardRow`) — so a name has no route
 * to a passive screen through either half of the payload.
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
  if (state.fog !== undefined) state.fog = toFog(state.fog);
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
    state: publicBoardState(session.campaign.boardState(id) ?? null),
  };
}

/**
 * THE DEPLOYED-HIDDEN MARK — an entry called `hidden` in the `meta`
 * list, beside the draft mark and the side, for the one ambusher that
 * has no token to be hidden by: a foe the recipe sent in out of sight
 * on a table with no board up at all (`Session.deployEncounter`). With
 * a board up, a hidden deploy is a hidden TOKEN instead, because the
 * token is the thing the Warden already knows how to reveal.
 *
 * The mark retires itself: once the entity stands openly on any board
 * the room has been shown it, and the mark stops counting without
 * anybody having to find it. Removing it through the entry door is the
 * other way out.
 */
export const HIDDEN_LIST = 'meta';
export const HIDDEN_MARK = 'hidden';

/**
 * WHO IS LYING IN WAIT — the entities the Warden hid, whatever the
 * table happens to be showing.
 *
 * Stripping the token was never enough (the audit, 2026-08-24). The
 * placement came out of the board state and the ambusher's NAME rode
 * the public roster and the public turn order anyway, so the table read
 * "Pondweed Peril, healthy" off the board view of a scene it could not
 * see a token in. A hidden thing is hidden in every payload or it is
 * not hidden.
 *
 * And not only while its own board is up (the audit, 2026-11-16). This
 * used to read the ACTIVE board and nothing else, so blanking the table
 * mid-fight, or putting a handout scene up, named every ambusher on
 * every passive screen and took the names back when the fight's map
 * returned. Hidden-ness is the Warden's act on a token, not a property
 * of which picture is showing — so a hidden placement on ANY board
 * veils, and the only thing that lifts it is a reveal.
 *
 * A reveal is a placement the room can SEE: an open token on the active
 * board. An entity standing openly there has already been shown, and
 * taking its name away would leave its own visible token nameless.
 * Un-hiding the token, removing it, or clearing the fight all leave no
 * hidden placement behind, so nothing is stranded veiled.
 *
 * The party is spared the off-board half. New tokens start hidden, so a
 * Warden laying out next session's map would otherwise take the posse
 * off its own badges and out of its own turn order — and who is in the
 * party is not a secret from the party. A hidden party token on the
 * ACTIVE board still veils, as it always has. Everyone else gets the
 * fail-closed reading: the side is asked of the stored row, and a row
 * that says nothing about itself is a foe (`sideOf`).
 */
export function hiddenFromTable(session: Session): Set<string> {
  const activeId = session.activeBoardId();
  const trades = tradeNames(session);
  const hereHidden = new Set<string>();
  const elsewhereHidden = new Set<string>();
  const openHere = new Set<string>();
  const openAnywhere = new Set<string>();
  for (const { boardId, data } of session.campaign.boardStates()) {
    const placements = (data as { placements?: unknown })?.placements;
    if (!Array.isArray(placements)) continue;
    const here = boardId === activeId;
    for (const item of placements) {
      if (!item || typeof item !== 'object') continue;
      const { entityId, hidden: veiled } = item as { entityId?: unknown; hidden?: unknown };
      if (typeof entityId !== 'string' || !entityId) continue;
      if (veiled) (here ? hereHidden : elsewhereHidden).add(entityId);
      else {
        openAnywhere.add(entityId);
        if (here) openHere.add(entityId);
      }
    }
  }
  const hidden = new Set<string>(hereHidden);
  for (const id of elsewhereHidden) {
    const entity = session.campaign.get(id);
    if (entity && sideOf(entity, trades, FURNITURE) === 'party') continue;
    hidden.add(id);
  }
  // The mark is only read for the roster's own rows — it is a fight
  // being deployed, and a fight's foes are children of the root.
  for (const entity of session.campaign.children(session.campaign.root().id)) {
    if (!hasEntry(entity.lists?.[HIDDEN_LIST] ?? [], HIDDEN_MARK)) continue;
    if (!openAnywhere.has(entity.id)) hidden.add(entity.id);
  }
  for (const id of openHere) hidden.delete(id);
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
  const hidden = hiddenFromTable(session);
  return session.campaign
    .children(session.campaign.root().id)
    .filter((entity) => sideOf(entity, trades, FURNITURE) !== 'none')
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

/**
 * Every entity the room may not see in the turn order: the ambush, and
 * the two the roster already leaves out — a DRAFT and anything on side
 * `none`. The roster dropped them and the turn order still carried
 * their ids (the audit, 2026-11-16), so the same screen learned there
 * was a row it couldn't name. One set, both payloads.
 */
function offTheTurn(session: Session): Set<string> {
  const out = hiddenFromTable(session);
  const trades = tradeNames(session);
  for (const entry of session.turnState().order) {
    if (!entry.entityId || out.has(entry.entityId)) continue;
    const entity = session.campaign.get(entry.entityId);
    if (!entity) continue;
    if (sideOf(entity, trades, FURNITURE) === 'none' || isDraft(session.reading(entity))) {
      out.add(entry.entityId);
    }
  }
  return out;
}

/**
 * The same turn, asked of the session — one call for every door.
 *
 * `keep` is a seat's own character, put back if the room may not see
 * it: a player whose character is hidden or still being made can still
 * answer when initiative is called. Everyone else in the order is what
 * the room sees.
 */
export function publicTurnState(session: Session, keep?: string): TurnState {
  const hidden = offTheTurn(session);
  if (keep) hidden.delete(keep);
  return publicTurn(session.turnState(), hidden);
}

// -- the file door's half of the snapshot -----------------------------
//
// A `/files/` ticket used to open every byte under `art/` and `map/` to
// any adopted screen (the audit, 2026-11-16): the never-shown handout,
// the map of next week's scene. A picture is as much a secret as its
// name, so the door asks the same question the snapshot answers — is
// this key something the room can see RIGHT NOW — and this is the one
// place that answer lives, so the snapshot and the door can't disagree.
//
// What fog cannot do: fog is a mask the browser draws over the whole
// map image, so the active board's bytes include the parts still in the
// dark. Rendering fog into the image on the server is a different
// feature; until it exists the active map is public whole.

/** Any string inside a value that names a file under the door's roots. */
export function fileKeysIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    const key = value.replace(/^\/+/, '');
    if (key.startsWith('art/') || key.startsWith('map/')) into.add(key);
  } else if (Array.isArray(value)) {
    for (const item of value) fileKeysIn(item, into);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) fileKeysIn(item, into);
  }
  return into;
}

/** The keys the public snapshot itself names: the active board's picture and the handout on show. */
export function publicFileKeys(session: Session): Set<string> {
  const out = new Set<string>();
  // The row and not `activeBoard()`: that one assembles the state too,
  // and a picture request has no use for the placements.
  const boardId = session.activeBoardId();
  const board = boardId ? session.shelf.board(boardId) : undefined;
  if (board?.key) out.add(board.key.replace(/^\/+/, ''));
  const handout = activeHandout(session);
  if (handout?.key) out.add(handout.key.replace(/^\/+/, ''));
  return out;
}

/**
 * Where one screen's legitimate pictures can come from, besides the
 * snapshot: what it was handed in a passed note, and — for a screen
 * that reads more than the room — the slots and the sheet it reads.
 * Gathered lazily: most requests are answered by the snapshot alone.
 */
export type FileSources = {
  /** Handouts passed to this screen (`server/notes.ts`'s own answer). */
  notes: { handout?: { key?: string } }[];
  /** Everything else this screen reads, as values to search for keys. */
  reads: () => unknown[];
};

/**
 * May a screen that is not the DM fetch this key? The snapshot's own
 * keys first, then its notes; a map or a handout picture is public ONLY
 * that way, because both are a scene or a reveal the Warden decides on.
 * Everything else under `art/` — pack art, portraits, a trade's face —
 * is public exactly when something the screen may already read names
 * it, which is the redaction law applied to pictures: a bestiary
 * portrait arrives with the bestiary, and the bestiary is prep.
 */
export function fileIsPublic(session: Session, key: string, sources: FileSources): boolean {
  const wanted = key.replace(/^\/+/, '');
  if (publicFileKeys(session).has(wanted)) return true;
  for (const note of sources.notes) {
    if (note.handout?.key && note.handout.key.replace(/^\/+/, '') === wanted) return true;
  }
  if (wanted.startsWith('map/') || wanted.startsWith('art/handouts/')) return false;
  return fileKeysIn(sources.reads()).has(wanted);
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
