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

import { useConnection } from '../lib/use-session.ts';

export function ConnectionHint() {
  const connected = useConnection();
  if (connected) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50 flex animate-pulse items-center gap-2 rounded-full bg-stone-900/90 px-3 py-1.5 text-sm text-amber-300 shadow-lg backdrop-blur">
      <span className="h-2 w-2 rounded-full bg-amber-400" />
      reconnecting…
    </div>
  );
}
