// What a human typed over a number, read as the number they meant.
//
// Rule 1 in its plainest form: a counter is a stored value and a person
// can type over it. The steppers were the only way in, so 34 → 25 was
// nine clicks — and the table already has a shorthand for that, which
// this reads rather than invents:
//
//   25    set it to exactly 25 — a BARE number always means "this"
//   -9    nine less than it is now
//   +3    three more
//   =-2   exactly -2 — the escape hatch, since a leading sign is relative
//
// A sign is the whole distinction and it is never guessed at: `25` can't
// mean "add 25", and `-9` can't mean "set to -9". Nothing is clamped —
// a typed value past the ceiling, or below zero, is what the human said
// (nothing computed is enforced). Anything else — empty, a word, `5-` —
// reads as `null`, and the caller cancels rather than writing garbage.

const NUMBER = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const RELATIVE = new RegExp(`^([+-])\\s*(${NUMBER})$`);
const EXACT = new RegExp(`^=?\\s*(-?\\s*${NUMBER})$`);

/** The value `text` asks for, given what's stored now — or null for "never mind". */
export function typedValue(text: string, current: number): number | null {
  // A typographic minus is what the steppers print, so it's what a
  // pasted or autocorrected "−9" will carry.
  const t = text.trim().replace(/−/g, '-');
  if (!t) return null;
  const rel = RELATIVE.exec(t);
  if (rel) {
    const n = Number(rel[2]);
    return rel[1] === '-' ? current - n : current + n;
  }
  // A bare negative ("-9") was claimed above; only `=` reaches one here.
  if (!t.startsWith('=') && t.startsWith('-')) return null;
  const exact = EXACT.exec(t);
  if (!exact) return null;
  const n = Number(exact[1].replace(/\s+/g, ''));
  return Number.isFinite(n) ? n : null;
}
