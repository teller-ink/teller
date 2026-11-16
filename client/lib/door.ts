// The door's arithmetic, kept apart from the door (`api.ts`) because
// `api.ts` reads the window at load and these are the parts with races
// worth a test: when a permission slip is too old to trust, and when two
// readers asking for the same thing may share one request.

/**
 * Slips (stream and file tickets) live twelve hours on the host
 * (`server/auth.ts`, checked when a stream CONNECTS and when an <img>
 * loads). A screen that boots to the same address forever outlives
 * that, so it renews at half-life — measured on this screen's own clock
 * from when it asked, because the host's clock and a kiosk Pi's need not
 * agree about anything but elapsed time.
 */
export const SLIPS_RENEW_MS = 6 * 60 * 60_000;

/**
 * How young a slip may be and still be blamed for a refusal. A stream or
 * a picture refused within seconds of fresh slips is refused for some
 * other reason (a file that isn't there, a host not answering yet), and
 * asking again would only turn one failure into a stream of ticket
 * requests.
 */
export const SLIPS_GRACE_MS = 15_000;

/** Too old to hand out: past half-life, or the clock ran backwards under it. */
export function slipsDue(askedAt: number, now: number): boolean {
  return now < askedAt || now - askedAt >= SLIPS_RENEW_MS;
}

/** A refusal these slips could plausibly be to blame for. */
export function slipsSuspect(askedAt: number, now: number): boolean {
  return now < askedAt || now - askedAt >= SLIPS_GRACE_MS;
}

/**
 * Readers asking for the same thing at the same moment share one answer.
 *
 * A sheet opening mounts three blocks that each want the same notes
 * record; a nudge lands and every hook that cares refetches in the same
 * tick. Same URL, same instant, same bytes — so one request.
 *
 * "The same instant" is the GENERATION, not the clock: a request that
 * left before this screen heard a change may have been answered before
 * the change happened, and a reader that joins it would wear the old
 * number with nothing left to tell it otherwise. So a request is shared
 * only with readers asking in the generation it left in — the caller
 * bumps the generation on every word off the wire.
 */
export class Shared<T> {
  #out = new Map<string, { gen: number; answer: Promise<T> }>();

  run(key: string, gen: number, ask: () => Promise<T>): { answer: Promise<T>; joined: boolean } {
    const held = this.#out.get(key);
    if (held && held.gen === gen) return { answer: held.answer, joined: true };
    const answer = ask();
    const mine = { gen, answer };
    this.#out.set(key, mine);
    const done = () => {
      // A newer generation may have replaced this one under the same key.
      if (this.#out.get(key) === mine) this.#out.delete(key);
    };
    answer.then(done, done);
    return { answer, joined: false };
  }

  get size(): number {
    return this.#out.size;
  }
}
