// The stream, asked for instead of held.
//
// A browser allows six HTTP/1.1 connections per origin and an SSE
// stream never gives one back (rule 6). The client caps how many
// streams one browser holds across ALL its display slots
// (`client/lib/stream-budget.ts`), and a slot past the cap still has to
// hear the room — so it asks, every few seconds, "what would my stream
// have said since I last asked?", and this is the answer.
//
// It is the stream's twin, not a second channel: same ticket, same
// handle, same words. A poller is a subscriber in the room like any
// stream (so `notify` aimed at its handle reaches it, and `watching`
// counts it), that writes into a short ring instead of a socket. The
// ring is the only state, it lives per handle, and it lets go of its
// subscription once nobody has asked for a minute.
//
// A cursor names the ring it came from. A cursor from another ring — a
// host restart, an expired recorder, an identity that changed at
// adoption — or one older than the ring remembers answers `gap`, and
// the client hears that as `sync`: nobody knows what was missed, so
// everything is suspect, exactly as after a dropped stream.

import type { ServerResponse } from 'node:http';
import { adopted, checkTicket, displayHandle } from './auth.ts';
import type { Host, Room } from './session.ts';

/** How many words a ring remembers. A poll every few seconds needs a handful. */
const RING = 256;
/** A recorder nobody has asked of for this long unsubscribes. */
const IDLE_MS = 60_000;

type Recorder = {
  epoch: string;
  seq: number;
  said: { seq: number; what: string }[];
  off: () => void;
  idle: ReturnType<typeof setTimeout> | null;
};

const rooms = new WeakMap<Room, Map<string, Recorder>>();

export type PollAnswer = { cursor: string; words: string[]; gap: boolean };

/**
 * What a handle's stream would have said since `cursor`. Pure enough to
 * test: the route below is only the ticket check around it.
 */
export function pollWords(room: Room, handle: string, cursor: string | null): PollAnswer {
  let recorders = rooms.get(room);
  if (!recorders) {
    recorders = new Map();
    rooms.set(room, recorders);
  }
  let rec = recorders.get(handle);
  if (!rec) {
    const fresh: Recorder = {
      epoch: Math.random().toString(36).slice(2, 10),
      seq: 0,
      said: [],
      off: () => {},
      idle: null,
    };
    // 'dm' subscribes as the console's own stream does — to everything
    // said to the room, and to no one screen's mail.
    fresh.off = room.subscribe(
      (what) => {
        fresh.seq += 1;
        fresh.said.push({ seq: fresh.seq, what });
        if (fresh.said.length > RING) fresh.said.shift();
      },
      handle === 'dm' ? undefined : handle,
    );
    recorders.set(handle, fresh);
    rec = fresh;
  }
  const kept = rec;
  if (kept.idle) clearTimeout(kept.idle);
  kept.idle = setTimeout(() => {
    kept.off();
    recorders.delete(handle);
  }, IDLE_MS);
  kept.idle.unref?.();

  const now = `${kept.epoch}.${kept.seq}`;
  const [epoch, at] = (cursor ?? '').split('.');
  const from = Number(at);
  if (epoch !== kept.epoch || !Number.isInteger(from) || from > kept.seq) {
    return { cursor: now, words: [], gap: true };
  }
  const oldest = kept.said[0]?.seq ?? kept.seq + 1;
  // Words between `from` and the oldest still held fell off the ring.
  const gap = from + 1 < oldest && from < kept.seq;
  const words = [...new Set(kept.said.filter((w) => w.seq > from).map((w) => w.what))];
  return { cursor: now, words, gap };
}

/**
 * `GET /api/stream/poll?handle=&ticket=&cursor=` — the same ticket law
 * as `/api/stream`, because it IS the stream, asked for in pieces.
 */
export function pollStream(host: Host, key: string, url: URL, res: ServerResponse): void {
  const handle = url.searchParams.get('handle') ?? '';
  const ticket = url.searchParams.get('ticket');
  let valid = Boolean(handle) && checkTicket(key, `stream:${handle}`, ticket);
  if (valid && handle !== 'dm') {
    const display = host.shelf.displays().find((d) => displayHandle(d.id) === handle);
    valid = adopted(display);
  }
  if (!valid) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('ticket required');
    return;
  }
  const answer = pollWords(host.room, handle, url.searchParams.get('cursor'));
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(answer));
}
