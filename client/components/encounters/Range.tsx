// HOW FAR AWAY SOMETHING IS, said the way the world says it — with the
// tabletop measurement one tap underneath.
//
// Ported from the old app (src/components/Range.tsx), whose grammar is
// the spec and whose reasoning is unchanged: inches are teller's unit
// and nobody else's — nothing in anyone's fiction is two inches from
// anything — so the BAND leads, because that is what a ruling turns on,
// and the measurement is there for the moment someone wants to check
// the mat rather than the story.
//
// What changed is where the number comes from. The old one was handed
// inches and consulted the system's band table itself; the new one is
// handed BOTH, because the server already measured the board and
// already did the conversion (`server/geometry.ts` — measure, don't
// make the reader derive). One arithmetic, one place, and the console
// reads the same distance the proposer was told.
//
// A distance with no band renders as the bare measurement rather than
// nothing: teller has no opinion about how far away things are (a
// system declaring no ladder has none), but "3.2 in" is still the
// answer to the question that was asked.

import { useState } from 'react';

export function Range({
  inches,
  band,
  className = '',
}: {
  inches: number;
  /** The system's own word for that reach, when it declares a ladder. */
  band?: { name: string; world?: string };
  className?: string;
}) {
  const [onTable, setOnTable] = useState(false);
  const shown = !band || onTable;
  return (
    <button
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
        shown ? 'bg-stone-800 text-stone-300' : 'bg-sky-950/70 text-sky-300 hover:bg-sky-900/70'
      } ${className}`}
      title={
        band
          ? onTable
            ? 'what the world calls it'
            : `${Math.round(inches * 100) / 100} inches on the table — tap to show`
          : 'measured on the table; this system declares no range bands'
      }
      onClick={(e) => {
        e.stopPropagation();
        if (band) setOnTable((v) => !v);
      }}
    >
      {shown
        ? `${Math.round(inches * 10) / 10} in on the table`
        : `${band!.name}${band!.world ? ` · ${band!.world}` : ''}`}
    </button>
  );
}

/**
 * The whole line: how far this target is, and what the armed thing says
 * it reaches — the Warden's own ruling, laid out side by side.
 *
 * teller does NOT judge whether the shot is in range, and the absence
 * is the design (rule 1 read strictly: a number nobody can overrule is
 * the thing to avoid, and "out of range" rendered as a verdict is one
 * ruling teller would be making instead of proposing). It measures, it
 * translates, and the human at the table decides. Where the two words
 * disagree the declared one is simply shown beside the measured one,
 * which is all the prompting a Warden has ever needed.
 *
 * An unplaced token says so out loud. "Not on the board" is a fact
 * worth stating — an encounter deployed without minis is an ordinary
 * evening, and a blank space would read as "in range".
 */
export function RangeToTarget({
  name,
  measured,
  declared,
}: {
  name: string;
  /** What the board says, when both ends of the line have a token. */
  measured?: { inches: number; band?: { name: string; world?: string } };
  /** What the armed thing's own profile says it reaches. */
  declared?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-stone-500">{name} is</span>
      {measured ? (
        <Range inches={measured.inches} band={measured.band} />
      ) : (
        <span
          className="rounded bg-stone-800/60 px-1.5 py-0.5 font-mono text-[10px] text-stone-500"
          title="one of them has no token on the board, so nothing could be measured"
        >
          not on the board
        </span>
      )}
      {declared && (
        <span className="font-mono text-[10px] text-stone-600">
          — this reaches {declared}
        </span>
      )}
    </div>
  );
}
