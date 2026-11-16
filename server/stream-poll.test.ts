// The stream asked for in pieces must say exactly what the stream says:
// every word the room says, the handle's own mail and nobody else's,
// and an honest `gap` whenever it can't vouch for what was missed.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { BEAT, holdStream, pollWords } from './stream-poll.ts';
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

describe('holdStream', () => {
  // A quiet room must still prove the host is there: a host that vanished
  // closes nothing, and the client calls three missed beats "down".
  it('beats on an open stream, as a named event and never as a word', async () => {
    const room = new Room();
    const server = createServer((_req, res) => {
      const end = holdStream(room, 'dm', res, { beatMs: 20 });
      res.on('close', end);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const stop = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: stop.signal });
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let got = '';
      room.changed('turn');
      while (got.split(BEAT).length < 3) {
        const { value } = await reader.read();
        got += decoder.decode(value);
      }
      expect(got).toContain('data: turn\n\n');
      expect(BEAT).toBe('event: beat\ndata: 1\n\n');
      // Never a bare `data:` — that would land in onmessage as a word.
      expect(got.replaceAll(BEAT, '')).not.toContain('beat');
      expect(room.size).toBe(1);
      stop.abort();
      // Hanging up lets go of the room.
      for (let i = 0; i < 50 && room.size > 0; i++) await new Promise((r) => setTimeout(r, 10));
      expect(room.size).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it('ends the stream when the screen is no longer what it was', async () => {
    const room = new Room();
    let still = true;
    const server = createServer((_req, res) => {
      holdStream(room, 'dm', res, { beatMs: 20, stillSo: () => still });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      still = false;
      // The body finishes on its own once the next beat finds it changed.
      await res.text();
      expect(room.size).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
