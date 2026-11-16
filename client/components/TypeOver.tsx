// A number a human can type over — rule 1, made a control.
//
// Every counter in this client was a readout between two steppers, so a
// 34-point foe taking nine was nine clicks. This is the readout, made a
// door: tap or click it, type, Enter or blur commits, Escape cancels.
// `typedValue` (lib/typed.ts) reads what was typed — a bare number is
// exactly that number, a leading sign is relative — and anything it
// can't read cancels rather than writing garbage. Nothing is clamped:
// what the human typed is what gets written.
//
// The write goes wherever the caller's steppers already go (the one
// entry door), so a typed number is logged and undone like a tap.
//
// No `onSet` and it's a plain readout. That's the MOUNTED case (rule 6):
// a strip screwed to a rail never asks for a gesture nobody can make at
// it, so a caller that can't tell what glass it's on leaves this off and
// the steppers carry the job, exactly as before.

import { useRef, useState } from 'react';
import { typedValue } from '../lib/typed.ts';

export function TypeOver({
  value,
  label,
  onSet,
  className = '',
}: {
  value: number;
  /** What this number IS, for the reader that can't see the row — "Health", "Health max". */
  label: string;
  /** What to write. Absent means a readout and nothing more. */
  onSet?: (next: number) => void;
  /** The readout's own typography — the input wears it too, so nothing jumps. */
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Escape blurs on its way out, and a blur commits — this is what tells
  // the two apart.
  const cancelled = useRef(false);

  if (!onSet) return <span className={className}>{value}</span>;

  const commit = () => {
    const text = draft;
    setDraft(null);
    if (cancelled.current || text === null) return;
    const next = typedValue(text, value);
    if (next !== null && next !== value) onSet(next);
  };

  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label={label}
        title="a number sets it · -9 or +3 adjusts it · Esc leaves it"
        enterKeyHint="done"
        autoComplete="off"
        spellCheck={false}
        onFocus={(ev) => ev.target.select()}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            ev.currentTarget.blur();
          } else if (ev.key === 'Escape') {
            // Ours, not the dialog's: Escape here un-types a number, and
            // a sheet that closed under it would take the edit with it.
            ev.stopPropagation();
            cancelled.current = true;
            ev.currentTarget.blur();
          }
        }}
        onClick={(ev) => ev.stopPropagation()}
        className={`${className} rounded-sm bg-stone-950 px-0.5 text-right ring-1 ring-amber-700 focus:outline-none`}
        style={{ width: `${Math.max(2, draft.length) + 1}ch` }}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`${label}, ${value} — type to change`}
      title="type over it"
      onClick={(ev) => {
        ev.stopPropagation();
        cancelled.current = false;
        setDraft(String(value));
      }}
      className={`${className} -mx-0.5 cursor-text rounded-sm px-0.5 transition-colors hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-700`}
    >
      {value}
    </button>
  );
}
