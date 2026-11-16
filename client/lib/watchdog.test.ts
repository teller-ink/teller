// A host that vanishes must be noticed; a tab that napped must not
// mistake its own sleep for the host's silence.

import { describe, expect, it } from 'vitest';
import { LOOK_MS, SILENT_MS, WAKE_GRACE_MS, sniff, type Watch } from './watchdog.ts';

/** Look every LOOK_MS from `from` to `until`, as an awake tab does. */
function watchAwake(start: Watch, from: number, until: number) {
  let w: Watch = start;
  let firstDown: number | null = null;
  for (let t = from; t <= until; t += LOOK_MS) {
    const r = sniff(w, t);
    w = { heard: r.heard, looked: r.looked };
    if (r.down && firstDown === null) firstDown = t;
  }
  return { watch: w, firstDown };
}

describe('sniff', () => {
  it('stays up while beats keep arriving', () => {
    let w: Watch = { heard: 0, looked: 0 };
    for (let t = LOOK_MS; t <= 120_000; t += LOOK_MS) {
      // A beat every fifteen seconds.
      if (t % 15_000 === 0) w = { ...w, heard: t };
      const r = sniff(w, t);
      expect(r.down).toBe(false);
      w = { heard: r.heard, looked: r.looked };
    }
  });

  it('calls a silent host down after three missed beats, and not before', () => {
    const { firstDown } = watchAwake({ heard: 0, looked: 0 }, LOOK_MS, 120_000);
    expect(firstDown).not.toBeNull();
    expect(firstDown!).toBeGreaterThan(SILENT_MS);
    expect(firstDown!).toBeLessThanOrEqual(SILENT_MS + LOOK_MS);
  });

  it('a tab waking from a long nap is not down on its first look', () => {
    // Last heard at 0, the tab slept for ten minutes: the queued beats
    // haven't been handed over yet when the first timer fires.
    const r = sniff({ heard: 0, looked: 0 }, 600_000);
    expect(r.down).toBe(false);
  });

  it('a woken tab whose stream really is silent is called within the grace', () => {
    const woke = 600_000;
    const r = sniff({ heard: 0, looked: 0 }, woke);
    const { firstDown } = watchAwake(r, woke + LOOK_MS, woke + 120_000);
    expect(firstDown).not.toBeNull();
    expect(firstDown! - woke).toBeLessThanOrEqual(WAKE_GRACE_MS + LOOK_MS);
  });

  it('a woken tab that hears a beat after waking stays up', () => {
    const woke = 600_000;
    let w: Watch = sniff({ heard: 0, looked: 0 }, woke);
    w = { ...w, heard: woke + 1_000 }; // the queued beat lands
    const { firstDown } = watchAwake(w, woke + LOOK_MS, woke + 40_000);
    expect(firstDown).toBeNull();
  });

  it('throttled to once a minute, a hidden tab never flaps', () => {
    // Intensive throttling: the timer fires once a minute while beats
    // keep arriving on the network.
    let w: Watch = { heard: 0, looked: 0 };
    for (let t = 60_000; t <= 600_000; t += 60_000) {
      w = { ...w, heard: t - 3_000 };
      const r = sniff(w, t);
      expect(r.down).toBe(false);
      w = { heard: r.heard, looked: r.looked };
    }
  });

  it('a clock that runs backwards proves nothing', () => {
    const r = sniff({ heard: 100_000, looked: 100_000 }, 10_000);
    expect(r).toEqual({ heard: 10_000, looked: 10_000, down: false });
  });
});
