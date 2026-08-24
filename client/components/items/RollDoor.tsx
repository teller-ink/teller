// What happens between pressing a band button and the shot having
// happened: the dice, said out loud, and one squeeze that pays for it.
//
// The old app fired in one tap and recorded nothing — the Grit came off
// and the dice were a thing that happened in the room. The runner
// already does the better version for foes (`encounters/Exchange.tsx`):
// tap the faces the plastic showed, or have teller throw them, and file
// the record. This is the same instrument pointed at a person's own
// weapon, and it reuses the same two pieces — `DicePool` (summoned,
// floor beneath) and `POST /api/rolls`.
//
// The order matters and is the whole reason this is a door rather than
// a button. RECORD FIRST, then spend: the record is what the log can
// replay (rule 3) and the spend is a handful of ordinary writes a
// stepper can undo (rule 1). A shot nobody paid for is a table's
// business; a shot nobody can account for is teller's fault.
//
// ONE SQUEEZE, exactly once: the button disables itself the moment it
// is pressed, because a double-tap on a rail panel is a slip of the
// thumb and a second debit is not what anybody meant by it.

import { useState } from 'react';
import type { Price } from '../../../core/spend.ts';
import { sayLedger } from '../../../core/spend.ts';
import { api } from '../../lib/api.ts';
import { rollPool, tallyFaces, type DiceRecord } from '../../lib/dice.ts';
import { DicePool } from '../Dice.tsx';

/** The roll as the log keeps it (`core/exchange.ts`'s `RollRecord`). */
type RollRecord = {
  by?: string;
  byName?: string;
  pool: string;
  faces: string[];
  total: number;
  unit?: string;
  for?: string;
};

export function RollDoor({
  who,
  whoName,
  what,
  band,
  pool,
  dice,
  icons,
  ledger,
  short,
  spends,
  onFire,
  onClose,
}: {
  /** Whose roll it is — the person, never the weapon (the log files it against them). */
  who: string;
  whoName: string;
  /** The thing being used, and the rung it's being used at. */
  what: string;
  band: string;
  /** The pool as AMENDED — what the table actually rolls (`amendStats`). */
  pool: string;
  dice: DiceRecord | undefined;
  icons?: Record<string, string>;
  /** Every price this squeeze owes, each against its own counter. */
  ledger: Price[];
  /** Which of those the pockets can't cover, for the button to say. */
  short: string[];
  /** What else goes with it — "one Knockback Round" — said, not computed here. */
  spends?: string;
  onFire: () => void;
  onClose: () => void;
}) {
  const [faces, setFaces] = useState<(string | null)[] | undefined>(undefined);
  const [gone, setGone] = useState(false);
  const { set, total } = tallyFaces(faces ?? [], dice);

  const fire = async () => {
    if (gone) return;
    setGone(true);
    const record: RollRecord = {
      by: who,
      byName: whoName,
      pool,
      faces: (faces ?? []).filter((f): f is string => Boolean(f)),
      total,
      ...(dice?.unit ? { unit: dice.unit } : {}),
      for: `${what} — ${band}`,
    };
    // Filed first and never blocking: a host that refuses the record
    // (a screen with no standing to file one) must not also refuse the
    // shot — the table is still where the person put it, and only the
    // history is thinner.
    await api('/api/rolls', { body: record }).catch(() => undefined);
    onFire();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-lg border border-stone-700 bg-stone-950 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-stone-100">{what}</span>
          <span
            className="text-[0.65rem] uppercase tracking-widest"
            style={{ color: 'var(--sheet-accent, #f59e0b)' }}
          >
            {band}
          </span>
          <span className="ml-auto font-mono text-sm text-stone-400">{pool}</span>
        </div>

        <DicePool
          pool={pool}
          dice={dice}
          faces={faces}
          onFaces={setFaces}
          icons={icons}
          // Teller throwing is a proposal like any other: the faces
          // land in the same chips a thumb can retype (rule 1).
          onRoll={dice ? () => setFaces(rollPool(pool, dice)) : undefined}
        />

        <p className="text-[0.7rem] text-stone-500">
          {set > 0
            ? `${set} recorded — ${total} ${dice?.unit ?? ''}`
            : 'tap each die to say what it showed, or have teller throw them'}
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-2 text-xs text-stone-400 hover:text-stone-200"
            onClick={onClose}
          >
            never mind
          </button>
          <button
            type="button"
            className="ml-auto flex h-10 items-center justify-center rounded-md border-2 px-4 font-mono text-sm font-bold tracking-wider disabled:opacity-35"
            style={{
              borderColor: 'var(--sheet-accent, #f59e0b)',
              color: 'var(--sheet-accent, #f59e0b)',
            }}
            disabled={gone || short.length > 0}
            onClick={fire}
            aria-label={`spend ${sayLedger(ledger)}${spends ? ` and ${spends}` : ''}${
              short.length ? ` (not enough ${short.join(', ')})` : ''
            }`}
          >
            {ledger.length ? `−${sayLedger(ledger)}` : 'take it'}
            {spends && <span className="ml-2 text-[0.65rem] opacity-70">· {spends}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
