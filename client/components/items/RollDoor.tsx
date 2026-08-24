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
import type { Reroll } from '../../../core/exchange.ts';
import type { Price } from '../../../core/spend.ts';
import { sayLedger } from '../../../core/spend.ts';
import { api } from '../../lib/api.ts';
import { expandPool, rollPool, tallyFaces, type DiceRecord } from '../../lib/dice.ts';
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
  rerolls?: Reroll[];
};

/** One armed move riding this squeeze, as the door has to say it. */
export type Grant = { name: string; text?: string; reroll?: number };

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
  granted,
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
  /**
   * The moves armed against this squeeze. They're SAID here because
   * this is the moment they apply — a reticle lit two taps ago on a
   * tile that has since scrolled away is not a reminder — and one of
   * them may grant a throw the door can carry out.
   */
  granted?: Grant[];
  onFire: () => void;
  onClose: () => void;
}) {
  const [faces, setFaces] = useState<(string | null)[] | undefined>(undefined);
  const [gone, setGone] = useState(false);
  // Every die teller threw again, in the order it happened — the record
  // carries these, so what the log keeps is what the table saw and not
  // a tidied-up version of it (rule 3).
  const [thrown, setThrown] = useState<Reroll[]>([]);
  // Whether TELLER threw this handful. A reroll button only makes sense
  // over dice teller rolled: a person holding real dice rerolls a real
  // die and retypes what it showed, and offering to re-randomise their
  // tapped face would be teller overwriting the table's own evidence.
  const [teller, setTeller] = useState(false);
  const { set, total } = tallyFaces(faces ?? [], dice);
  // What's left of the grant. Several armed moves granting throws add
  // up, because two grants are two throws — the arithmetic a table
  // would do out loud.
  const allowed = (granted ?? []).reduce((n, g) => n + (g.reroll ?? 0), 0);
  const left = allowed - thrown.length;

  /** Throw one die again, keeping both faces in the record. */
  const again = (at: number) => {
    if (!dice || left <= 0) return;
    const was = faces?.[at];
    if (!was) return;
    const [became] = rollPool('1' + (expandPool(pool)[at] ?? ''), dice);
    if (!became) return;
    const next = [...(faces ?? [])];
    next[at] = became;
    setFaces(next);
    const by = (granted ?? []).find((g) => (g.reroll ?? 0) > 0)?.name;
    setThrown([...thrown, { at, was, became, ...(by ? { by } : {}) }]);
  };

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
      ...(thrown.length ? { rerolls: thrown } : {}),
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
          onRoll={
            dice
              ? () => {
                  setFaces(rollPool(pool, dice));
                  setThrown([]);
                  setTeller(true);
                }
              : undefined
          }
        />

        {/* WHAT'S ARMED, said at the moment it applies — a chip per
            move, wearing the system's own words for it. Nothing is
            parsed out of those words: a move that grants a throw says
            so with a number (`reroll`), and one that doesn't gets the
            chip and nothing else. */}
        {(granted ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(granted ?? []).map((g) => (
              <span
                key={g.name}
                className="rounded-full border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider"
                style={{
                  borderColor: 'var(--sheet-accent, #f59e0b)',
                  color: 'var(--sheet-accent, #f59e0b)',
                }}
                title={g.text}
              >
                {g.name}
                {g.reroll ? ` · throw ${g.reroll} again` : ''}
              </span>
            ))}
          </div>
        )}

        {/* The grant, AVAILABLE IF YOU WANT IT (Brian's words). Over
            real dice it stays a hint — you throw the die in your hand
            and retype the face — and only over dice TELLER threw does
            it become a button, because only there is there anything for
            teller to do. Declining is the default: nothing here has to
            be pressed for the shot to go. */}
        {allowed > 0 && (
          teller ? (
            <div className="flex flex-col gap-1">
              <p className="text-[0.7rem] text-stone-400">
                {left > 0
                  ? `you may throw ${left} of these again — or leave them`
                  : 'nothing left to throw again'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(faces ?? []).map((face, at) =>
                  face ? (
                    <button
                      key={at}
                      type="button"
                      className="rounded-md border border-stone-700 px-2 py-1 font-mono text-[0.65rem] text-stone-300 transition-colors hover:border-amber-600 hover:text-amber-200 disabled:opacity-30"
                      disabled={left <= 0 || gone}
                      onClick={() => again(at)}
                      aria-label={`throw the ${icons?.[face] ?? face} again`}
                    >
                      ↻ {icons?.[face] ?? face}
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          ) : (
            <p className="text-[0.7rem] text-stone-400">
              you may throw {allowed} of these again — reroll the die in your hand and tap what it
              becomes
            </p>
          )
        )}

        {/* What was thrown again, kept in sight: the record carries it,
            so the surface may as well be honest about it too. */}
        {thrown.length > 0 && (
          <p className="text-[0.7rem] text-stone-500">
            {thrown
              .map((r) => `${icons?.[r.was] ?? r.was} → ${icons?.[r.became] ?? r.became}`)
              .join(' · ')}
          </p>
        )}

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
