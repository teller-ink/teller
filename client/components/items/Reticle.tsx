// The armed-action control — a scope reticle you arm, not a checkbox
// you tick. Ported from the old app's `src/components/sheet/Reticle.tsx`,
// visual grammar unchanged.
//
// Same reasoning as the Grit cylinder: this is the right CONTROL as
// well as the right picture. Arming it is declaring intent ("I'm lining
// this one up"), so the reticle lights; the spend happens later, all at
// once, when the trigger goes — deduct-at-fire, with the rare
// announced-then-aborted action left to the table and the steppers.
//
// Three states, all visible at arm's length on a rail bar:
//   idle   — grey ring, waiting
//   armed  — accent ring + centre dot, applied to the next shot
//   spent  — dimmed and slashed until the cost counter REFILLS, because
//            a refill is what "your turn came back around" looks like
//            in the data.
//
// It knows no action by name: what a system's per-turn moves ARE
// arrives as data (`use.actions`), and this draws whichever one it's
// handed.

export function Reticle({
  armed,
  spent,
  disabled,
  onToggle,
  label,
}: {
  armed: boolean;
  /** Used this turn — locked until the cost counter refills. */
  spent: boolean;
  /** Can't afford it right now. */
  disabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  const stroke = spent
    ? '#44403c' // stone-700 — burnt out until the reload
    : armed
      ? 'var(--sheet-accent, #f59e0b)'
      : '#a8a29e'; // stone-400

  return (
    <button
      type="button"
      role="switch"
      aria-checked={armed}
      aria-label={label}
      title={label}
      disabled={disabled || spent}
      onClick={onToggle}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-opacity active:bg-stone-800 ${
        disabled && !spent ? 'opacity-40' : ''
      }`}
    >
      <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden>
        <circle cx="20" cy="20" r="13" fill="none" stroke={stroke} strokeWidth="2" />
        {/* Crosshair ticks, riding through the rim like a scope's. */}
        {[
          [20, 2, 20, 11],
          [20, 29, 20, 38],
          [2, 20, 11, 20],
          [29, 20, 38, 20],
        ].map(([x1, y1, x2, y2], i) => (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
          />
        ))}
        {/* On target only when armed. */}
        {armed && !spent && <circle cx="20" cy="20" r="3" fill="var(--sheet-accent, #f59e0b)" />}
        {/* Spent: the shot's been taken. */}
        {spent && (
          <line
            x1="11"
            y1="29"
            x2="29"
            y2="11"
            stroke="#44403c"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}
