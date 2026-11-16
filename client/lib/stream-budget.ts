// How many streams one browser may hold, across ALL its screens.
//
// `use-session.ts` already pools a screen's tabs onto one socket. That
// keeps the count at one per SLOT — and a DM running the console plus
// `#tv`, `#board`, `#art`, `#seat` as windows on one laptop is five
// slots, five sockets, and the sixth slot took the last connection the
// origin had: every later request queued, a write sat pending for two
// minutes behind an optimistic repaint, and nothing said so (found
// live, 2026-11-16).
//
// So the slots share a budget. Each slot's leader already stamps a
// record in localStorage for its own election; the record now also
// says when the slot first asked for a stream and whether it holds one.
// Every leader reads every slot's record on each election beat and runs
// this function. The first CAP claimants hold streams; the rest poll
// (`server/stream-poll.ts`) and say so on the glass. Nobody coordinates
// beyond that — the same read-everyone, decide-alone shape as the
// election, and for the same reason: Web Locks is [SecureContext] and
// therefore absent on exactly the LAN origin where this matters.
//
// Pure, so the races can be tested without a browser.

/** Four streams leaves two of the origin's six connections for everything else. */
export const STREAM_CAP = 4;

/**
 * A slot is counted while its record is this fresh. Longer than the
 * same-slot election's stale timer on purpose: a hidden tab's timers
 * can be throttled to once a minute, and a slot whose socket is open
 * but whose heartbeat napped must still be counted as holding one —
 * undercounting is the failure that starves the pool. Overcounting a
 * crashed tab costs one slot a minute of polling.
 */
export const BUDGET_STALE_MS = 75_000;

export type Claim = {
  slot: string;
  /** Last heartbeat. */
  at: number;
  /** When this slot's leader first asked for a stream — its place in the queue. */
  since: number;
  /** Holding (or opening) a stream right now. */
  open: boolean;
  /** The DM's own console goes first: it is where a stale number does harm. */
  first?: boolean;
};

/** The order streams are granted in: console first, then first come, then by name. */
export function rank(claims: Claim[]): Claim[] {
  return [...claims].sort(
    (a, b) =>
      Number(Boolean(b.first)) - Number(Boolean(a.first)) ||
      a.since - b.since ||
      (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0),
  );
}

/**
 * Should `me` hold a stream or poll?
 *
 * Granted means ranked within the cap among slots still alive. A slot
 * granted a stream it doesn't hold yet opens one only while fewer than
 * CAP other slots hold one: when a newly-ranked slot (the console
 * arriving, a stale slot waking) displaces a holder, the holder lets go
 * on its own next beat and only then does the newcomer open — so the
 * count never climbs past the cap waiting for somebody to notice.
 */
export function streamOrPoll(
  claims: Claim[],
  me: Claim,
  now: number,
  cap = STREAM_CAP,
  staleMs = BUDGET_STALE_MS,
): 'stream' | 'poll' {
  const others = claims.filter((c) => c.slot !== me.slot && now - c.at < staleMs);
  const ranked = rank([...others, me]);
  const place = ranked.findIndex((c) => c.slot === me.slot);
  if (place >= cap) return 'poll';
  if (me.open) return 'stream';
  return others.filter((c) => c.open).length < cap ? 'stream' : 'poll';
}
