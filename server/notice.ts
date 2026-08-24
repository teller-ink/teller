// THE TABLE NOTICE — one line the DM puts up for the whole room.
//
// "BREAK". "everybody roll." The board goes amber and every player in
// the room looks up. It is the oldest piece of shared-glass furniture
// the old app had (src/views/DmView.tsx wrote it, BoardView drew it),
// and the port lost it: passed notes arrived and covered the aimed
// case, so the un-aimed one — the sentence for EVERYONE — had nowhere
// to land but a seat.
//
// So it is its own thing, and the split is the point:
//
//   * a NOTE is traffic aimed at somebody, answered per-screen from
//     that screen's own assignment, and never in the public payload
//     (`server/notes.ts`, and its test asserts the outward glass never
//     sees one — still true, and this file does not touch it);
//   * a NOTICE is aimed at the ROOM. It is player-safe by
//     construction: the DM typed it FOR the players to read. So it
//     rides the public snapshot, which is the one payload every
//     passive surface renders whole.
//
// Ephemeral, like a note and for the same reason (`WeakMap` off the
// live Session): a campaign switch builds a new Session and the old
// table's notice dies with it, unreferenced, with nothing to remember
// to clear. The PERMANENT record is where rule 3 says: `notice.posted`
// and `notice.cleared` in the event log.
//
// Passive surfaces RENDER it and never dismiss it — a screen with no
// controls cannot take a notice down, and one that could would be a
// button on glass that has none (rule 6). The console clears it.

import type { Session } from './session.ts';

/** What the room is being told, and when it went up. */
export type Notice = {
  text: string;
  /** ISO, minted here — a surface may age it; nothing here does. */
  at: string;
};

const posted = new WeakMap<Session, Notice>();

/** What is on the glass right now, if anything. */
export function noticeOf(session: Session): Notice | null {
  return posted.get(session) ?? null;
}

/** Put one up. Empty text takes it down — one door, both directions. */
export function setNotice(session: Session, text: string): Notice | null {
  const words = text.trim();
  if (!words) {
    posted.delete(session);
    return null;
  }
  const notice: Notice = { text: words, at: new Date().toISOString() };
  posted.set(session, notice);
  return notice;
}

// Who may READ one is not a question this file answers, deliberately:
// a notice has no gate of its own beyond the public snapshot's, which
// is being at the table at all (`canWatch`). That is the whole
// difference from a note, and a second door here would invite a second
// law to drift from the first.
