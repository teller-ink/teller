// The neutral dice grid — the FLOOR under a summoned `DicePool` (§L
// phase 3.5).
//
// teller's own `DicePool` is gone: §M sorted it to the SYSTEM ("the
// `dice` record is system data and this draws it"), and the WiW system
// carries its own. But teller's runner still has to let somebody record
// what the plastic showed on a host whose system declares dice and
// ships no face for them — §M-5's manual floor is compatibility law,
// and a campaign on a data-only system plays fully. So this is what
// `presentationOf('DicePool')` degrades TO, and nothing more.
//
// What makes it the floor rather than the same component renamed: it is
// SHAPE-DERIVED end to end. A pool spelling expands to letters, each
// letter's face list comes off the `dice` record, tapping a die cycles
// through that list, and the tally is the record's own values under the
// record's own unit. Every die is drawn the same — the one thing §L
// named as a mechanic hiding in this file, `letter === 'G'` tinting the
// special die amber, is exactly the kind of thing a floor may not know,
// and a system that wants its special die to look special ships a face.
//
// Recording first, rolling second (rule 1): `onRoll` is offered only
// where teller is allowed to throw at all, and every die it fills stays
// one tap from being overruled.
//
// **The floor DOES draw face art** (§J, 2026-08-19), and the reason is
// the same one that lets it draw `unit`: art arrives as DATA on the
// `dice` record, keyed by a face the record itself named. Rendering a
// picture the record points at teaches this file nothing about the game
// — it still cannot tell a hit from a spur, only that face #3 has a
// picture and face #4 doesn't. That is precisely the line the tint
// failed: `letter === 'G'` was teller HOLDING an opinion about which die
// is special, where `art[face]` is teller holding none.
//
// The other half is the compatibility law: this must degrade to text
// with zero art, so the chain is art → glyph key → face name, and a
// record carrying no `art` renders exactly what it rendered before. A
// picture that fails to load falls back the same way, because the label
// is drawn underneath rather than replaced by the image.

import { expandPool, tallyFaces, type DiceRecord } from '../lib/dice.ts';
import { useArtMap } from '../lib/art.ts';

/** What every dice face — teller's floor and a system's own — is handed. */
export type DicePoolProps = {
  pool: string;
  dice: DiceRecord | undefined;
  faces: (string | null)[] | undefined;
  onFaces: (faces: (string | null)[]) => void;
  /** Face name → glyph key, from the `icons` record. Text either way. */
  icons?: Record<string, string>;
  /** Present = teller may throw these. Absent = recording only. */
  onRoll?: () => void;
  size?: 'sm' | 'md';
};

export function DiceFloor({
  pool,
  dice,
  faces,
  onFaces,
  icons,
  onRoll,
  size = 'md',
}: DicePoolProps) {
  // Before the early return: a hook may not be skipped, and the record
  // being absent is exactly when this one has nothing to resolve.
  const art = useArtMap(dice?.art);
  const letters = expandPool(pool);
  if (!letters.length || !dice) return null;
  const box = size === 'sm' ? 'h-8 w-8' : 'h-11 w-11';
  const { set, total } = tallyFaces(faces ?? [], dice);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {letters.map((letter, i) => {
        const face = faces?.[i] ?? null;
        // A letter can repeat a face twice in its list — de-duping keeps
        // one tap-stop per DISTINCT face rather than cycling through the
        // same label twice.
        const order = [...new Set(dice.faces[letter] ?? [])];
        const label = face ? (icons?.[face] ?? face) : letter;
        const picture = face ? art[face] : undefined;
        return (
          <button
            key={i}
            type="button"
            className={`relative flex ${box} items-center justify-center rounded-lg bg-stone-800 ring-1 ring-stone-600 transition-colors hover:bg-stone-700 ${
              face ? '' : 'opacity-45'
            }`}
            title={`${letter} die — tap to record what it showed`}
            onClick={() => {
              const next = [...(faces ?? letters.map(() => null))];
              const at = order.indexOf(next[i] ?? '');
              next[i] = at < 0 ? order[0] : at + 1 < order.length ? order[at + 1] : null;
              onFaces(next);
            }}
          >
            <span className="font-mono text-[10px] text-stone-300">{label}</span>
            {picture && (
              <img
                src={picture}
                alt={face ?? ''}
                // Over the label, not instead of it — a picture that
                // never arrives leaves the text standing.
                className="absolute inset-0 h-full w-full rounded-lg object-contain p-0.5"
              />
            )}
            <span className="absolute -bottom-1 -right-1 rounded bg-stone-600 px-0.5 font-mono text-[8px] leading-tight text-stone-100">
              {letter}
            </span>
          </button>
        );
      })}
      {set > 0 && (
        <span className="ml-1 font-mono text-sm text-amber-200">
          = {total} {dice.unit ?? ''}
        </span>
      )}
      {onRoll && (
        <button
          type="button"
          className="ml-auto rounded-md border border-stone-600 px-2.5 py-1 text-[11px] text-stone-300 transition-colors hover:border-amber-600 hover:text-amber-200"
          title="teller rolls these — tap any die to correct it"
          onClick={onRoll}
        >
          roll for me
        </button>
      )}
    </div>
  );
}
