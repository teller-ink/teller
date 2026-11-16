// Is the host still there? — the question a socket can't answer.
//
// A host that is KILLED closes its sockets, the browser hears the FIN,
// and the EventSource errors within seconds. A host that VANISHES —
// the laptop lid shut, the power cord pulled, the machine off the
// Wi-Fi — sends nothing at all. No FIN arrives, the EventSource sits
// "open" forever, and the glass goes on showing the last thing it heard
// as if it were live. A seat was seen sitting like that for hours, which
// is the silently-stale failure rule 6 calls the worst one a shared
// screen has.
//
// So the host beats (`server/stream-poll.ts`): a small named event on
// every open stream, every fifteen seconds. Silence for three beats is
// a host that isn't there, and the stream is treated exactly like one
// that errored — closed, the pill up, reconnecting on the usual backoff.
//
// The judgement is by the CLOCK, never by counting ticks, and that is
// the one subtle part. A pocketed phone or a background tab has its
// timers throttled or frozen while it sleeps; when it wakes, the first
// look happens before the events that queued up behind the nap have
// been handed over, and a stopwatch that ran through the nap would call
// a perfectly healthy stream dead. A look that comes long after the
// last one means THIS tab wasn't watching, so the silence it measured
// isn't evidence — the host gets a fresh beat-and-a-bit to prove itself
// instead.
//
// Pure, so the races can be tested without a browser.

/** How often the host beats. Mirrors `BEAT_MS` on the server. */
export const BEAT_MS = 15_000;

/** Three missed beats is a host that isn't there. */
export const SILENT_MS = 3 * BEAT_MS;

/** How often a tab holding a stream looks at the clock. */
export const LOOK_MS = 5_000;

/**
 * A gap between looks longer than this was a nap, not a look — the
 * tab's timers were throttled or frozen. Generous on purpose: a busy
 * main thread delays a timer by a little, a sleeping tab by a lot.
 */
export const NAP_MS = LOOK_MS + BEAT_MS;

/**
 * What a woken tab allows the host before judging it: one beat plus
 * slack. A live host beats inside that whatever the tab was doing; a
 * dead one is called within twenty seconds of anybody looking.
 */
export const WAKE_GRACE_MS = BEAT_MS + LOOK_MS;

/** How long a poll may hang before it counts as not answered. */
export const POLL_TIMEOUT_MS = 10_000;

/** Consecutive unanswered polls before the polling glass says "down". */
export const POLL_MISSES = 2;

export type Watch = {
  /** When the stream last proved the host was there (open, word, beat). */
  heard: number;
  /** When this tab last looked. */
  looked: number;
};

/**
 * One look at the clock. Returns the watch to keep and whether the
 * stream is to be treated as down.
 */
export function sniff(watch: Watch, now: number): Watch & { down: boolean } {
  // A clock that ran backwards (a kiosk Pi finding NTP) proves nothing
  // either way: start counting again from here.
  if (now < watch.heard || now < watch.looked) {
    return { heard: now, looked: now, down: false };
  }
  let heard = watch.heard;
  if (now - watch.looked > NAP_MS) {
    // This tab was asleep. Whatever silence it measured happened while
    // it wasn't listening — give the host a fresh chance to beat.
    heard = Math.max(heard, now - SILENT_MS + WAKE_GRACE_MS);
  }
  return { heard, looked: now, down: now - heard > SILENT_MS };
}
