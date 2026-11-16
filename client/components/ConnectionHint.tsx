// THE PILL — invisible while the wire is healthy, a small fixed badge
// when it drops.
//
// Ported from the old app (src/components/ConnectionHint.tsx), whose
// look is the spec, and it exists for one failure: a passive screen
// whose stream died goes on showing whatever it had, and stale numbers
// on a screen nobody can touch look exactly like fresh ones. The pill
// is the difference between "the room is quiet" and "the room is
// wrong".
//
// It is a STATUS THE SCREEN WEARS, not a control — same class as the
// identify flash (rule 6). No button, no dismiss, nothing to press: it
// appears when the wire is down, and it leaves when the wire comes
// back. `pointer-events-none` says so structurally, so a passive
// surface still answers no gesture at all.
//
// It takes no props deliberately. The old app threaded `connected`
// down from a hook every view happened to call; the new stream is a
// module with a subscriber set (rule 6's connection budget), so the
// pill asks it directly and no view has to carry a fact it doesn't
// otherwise use.
//
// It has a quieter sibling state: POLLING, a screen past the browser's
// stream budget (`client/lib/stream-budget.ts`) hearing every word a few
// seconds late. That glass is live, just slower, and must not wear the
// pulsing amber that means stale — so it gets a still, dim pill of the
// same shape, enough for the DM to see why a number took a beat.

import { useEffect, useState } from 'react';
import { onWriteTrouble } from '../lib/api.ts';
import { useWire } from '../lib/use-session.ts';

export function ConnectionHint() {
  const wire = useWire();
  if (wire === 'live') return null;
  if (wire === 'polling')
    return (
      <div className="pointer-events-none fixed right-3 top-3 z-50 flex items-center gap-2 rounded-full bg-stone-900/70 px-2.5 py-1 text-xs text-stone-400 backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
        live · every few seconds
      </div>
    );
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50 flex animate-pulse items-center gap-2 rounded-full bg-stone-900/90 px-3 py-1.5 text-sm text-amber-300 shadow-lg backdrop-blur">
      <span className="h-2 w-2 rounded-full bg-amber-400" />
      reconnecting…
    </div>
  );
}

/** How long a "didn't land" stays up — long enough to be read mid-fight. */
const FAILED_MS = 6_000;

/**
 * A WRITE that didn't land, said out loud.
 *
 * The pill's counterpart for the screens that press things. Every tool
 * repaints a press before the host answers, and the overlay already
 * rolls back when the answer is no — but a number quietly snapping back
 * reads as a misclick, and a write the host never answered doesn't snap
 * back at all. So the one door every write goes through
 * (`api()`) reports its trouble, and this wears it: "waiting on the
 * host" while something is out too long, "didn't land" when it failed.
 * Same class as the pill — a status, no button, nothing to dismiss.
 */
export function WriteNotice() {
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState<{ message: string; at: number } | null>(null);
  useEffect(
    () =>
      onWriteTrouble((t) => {
        if (t.kind === 'waiting') setWaiting(true);
        else if (t.kind === 'clear') setWaiting(false);
        else setFailed({ message: t.message, at: t.at });
      }),
    [],
  );
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => setFailed(null), FAILED_MS);
    return () => clearTimeout(t);
  }, [failed]);
  if (!failed && !waiting) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-stone-900/90 px-4 py-2 text-sm shadow-lg backdrop-blur"
    >
      {failed ? (
        <>
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
          <span className="text-red-300">
            that change didn't land — {failed.message}
          </span>
        </>
      ) : (
        <>
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <span className="text-amber-300">waiting on the host…</span>
        </>
      )}
    </div>
  );
}
