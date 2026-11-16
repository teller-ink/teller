// The stream asked for in pieces must say exactly what the stream says:
// every word the room says, the handle's own mail and nobody else's,
// and an honest `gap` whenever it can't vouch for what was missed.

import { describe, expect, it } from 'vitest';
import { pollWords } from './stream-poll.ts';
import { Room } from './session.ts';

describe('pollWords', () => {
  it('starts with a gap, then hands back what was said since the cursor', () => {
    const room = new Room();
    const first = pollWords(room, 'dm', null);
    expect(first.gap).toBe(true);
    expect(first.words).toEqual([]);

    room.changed('turn');
    room.changed('entities');
    room.changed('turn');
    const next = pollWords(room, 'dm', first.cursor);
    expect(next.gap).toBe(false);
    expect(next.words).toEqual(['turn', 'entities']);

    const quiet = pollWords(room, 'dm', next.cursor);
    expect(quiet).toEqual({ cursor: next.cursor, words: [], gap: false });
  });

  it("carries a screen's own mail, and only its own", () => {
    const room = new Room();
    const tv = pollWords(room, 'tv-handle', null);
    const dm = pollWords(room, 'dm', null);
    room.notify('tv-handle', 'identify');
    room.notify('other-handle', 'assign');
    room.changed('board');
    expect(pollWords(room, 'tv-handle', tv.cursor).words).toEqual(['identify', 'board']);
    expect(pollWords(room, 'dm', dm.cursor).words).toEqual(['board']);
  });

  it('says gap for a cursor it cannot vouch for', () => {
    const room = new Room();
    const a = pollWords(room, 'dm', null);
    // Another ring's cursor (a restarted host) or nonsense.
    expect(pollWords(room, 'dm', 'zzz.0').gap).toBe(true);
    expect(pollWords(room, 'dm', `${a.cursor.split('.')[0]}.999`).gap).toBe(true);
    // Fell off the ring.
    for (let i = 0; i < 300; i++) room.changed('turn');
    const late = pollWords(room, 'dm', a.cursor);
    expect(late.gap).toBe(true);
    expect(late.words).toEqual(['turn']);
  });
});
