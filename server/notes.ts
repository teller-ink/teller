// PASSED NOTES — the folded scrap of paper, slid across the table to
// one person (§M-6's handouts half; the ratified design, 2026-08-20).
//
// A handout is CAMPAIGN CONTENT: a named row in the `handouts` template
// slot, a file on the host, and one of them at a time is `refs.handout`
// — the thing the art frame is showing. That half lives where campaign
// facts live and travels with the campaign.
//
// A note is not that. A note is table TRAFFIC — "the barkeep leans over
// and tells YOU the sheriff's already looking for you" — and it is over
// the moment it's been read. So it is deliberately NOT stored:
//
//   * not in the templates table, which is prep and travels in a
//     `.story`; a fight's whispers are nobody's campaign;
//   * not on the campaign at all, which is why this file holds them in
//     memory, hung off the live Session by a WeakMap. A campaign switch
//     builds a new Session (server/session.ts's `Host#adopt`), so the
//     notes of the table you just left die with it, unreferenced, and
//     nothing has to remember to clear anything.
//
// The PERMANENT record still exists and is exactly where rule 3 says it
// is: `note.passed` in the event log, with recipients and text. The log
// is DM-only, so a secret written down there is no more exposed than
// the DM's own screen. Losing the pending list on a reboot is the point
// — a note nobody was in the room for is not owed to anyone.
//
// DELIVERY IS PER-DISPLAY AND NEVER THE PUBLIC SNAPSHOT. `/api/public`
// is one payload every passive surface renders whole; a note aimed at
// one player put in there would be aimed at the room. So the server
// answers `visibleTo` per ASKING screen, from the assignment the DM
// made (rule 7 — role-derived, never re-derived from a secret the
// client holds), and the snapshot never learns notes exist.

import { newId } from '../core/id.ts';
import { adopted, canDm, type Auth } from './auth.ts';
import type { Session } from './session.ts';

/** The handout riding along, resolved at pass time so a recipient needs no second door. */
export type NoteHandout = { id: string; name: string; key: string };

/** One scrap of paper. `to` EMPTY means the whole table — which is also the DM notice. */
export type PassedNote = {
  id: string;
  /** ISO, minted here — a seat orders its own stack and nothing else reads it. */
  at: string;
  text?: string;
  handout?: NoteHandout;
  /** Entity ids. Empty is not "nobody"; empty is "everyone". */
  to: string[];
};

/**
 * How many are kept. Small on purpose: this is the pile beside the DM,
 * not a history — the history is the event log, and it is complete.
 */
export const KEPT = 30;

const books = new WeakMap<Session, PassedNote[]>();

/** This session's pile, created on first ask. */
export function notebook(session: Session): PassedNote[] {
  let held = books.get(session);
  if (!held) {
    held = [];
    books.set(session, held);
  }
  return held;
}

/** Newest first — the order both the DM's review list and a seat read it in. */
export function notesOf(session: Session): PassedNote[] {
  return [...notebook(session)].reverse();
}

/** Add one, oldest falling off the end. Returns what was actually filed. */
export function passNote(
  session: Session,
  note: Omit<PassedNote, 'id' | 'at'>,
): PassedNote {
  const filed: PassedNote = { id: newId('note'), at: new Date().toISOString(), ...note };
  const held = notebook(session);
  held.push(filed);
  while (held.length > KEPT) held.shift();
  return filed;
}

/**
 * WHO SEES WHAT — the whole law, in one function so there is one place
 * to read it and one place to test it.
 *
 *   * the DM (key, or a console screen) sees everything, targeted or
 *     not: passing a note is the DM's own act and the review list is
 *     how they remember what they passed;
 *   * a SEAT sees a note addressed to the entity it was pointed at, and
 *     every untargeted one — the untargeted case being the table-wide
 *     notice, which is the parity gap this closes;
 *   * a BADGE sees NOTHING, ever. It is outward-facing glass — the back
 *     panel of a rail unit, aimed at the rest of the room — so a note
 *     on a badge is a note read aloud, which is the precise opposite of
 *     passing one;
 *   * every other role (table, board, art, blank) sees nothing either,
 *     for the plainer reason: no surface renders one, and a door that
 *     answers with secrets nobody draws is a leak with no upside. The
 *     table-wide handout already reaches the room the honest way —
 *     `refs.handout`, through the art frame.
 *
 * A note passed to a SUBSET is never promoted to the table by anything
 * here. Widening it is a second, deliberate pass.
 */
export function visibleTo(notes: PassedNote[], auth: Auth): PassedNote[] {
  if (canDm(auth)) return notes;
  const display = auth.display;
  if (!adopted(display) || display.role !== 'seat') return [];
  const mine = display.params.entityId;
  if (typeof mine !== 'string' || !mine) return [];
  return notes.filter((n) => n.to.length === 0 || n.to.includes(mine));
}
