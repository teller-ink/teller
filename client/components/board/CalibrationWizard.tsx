// Calibrating a screen against something physical — the console half.
// Ported from the old app (src/components/CalibrationWizard.tsx), whose
// ORDER is the design and is not to be rearranged:
//
//   1. corners, because if the TV is overscanning then every later
//      number describes a picture you can't fully see;
//   2. across, then 3. down — the two axes, MATCHED rather than
//      measured: the DM lays a reference on the glass and nudges until
//      the drawn ticks sit on the physical ones. Matching over a long
//      baseline divides the error — a 1/16" misjudgement over 40" is
//      0.16%, over a credit card it's 2%;
//   3. verify, one-inch boxes against a card. An ID or credit card is
//      exactly 3.37 × 2.13 inches by standard, so it's a reference
//      everybody already has in their pocket.
//
// teller never needs the screen's SIZE, only the ratio: px per inch.
//
// A TARGETED run skips the corners step — overscan is a TV disease, and
// a tablet or panel shows its whole picture. Here every run is targeted,
// because in the new world calibration is a fact about one display row
// rather than about the campaign; the corners step is offered when the
// screen being measured is the TABLE, which is the one that's a TV.

import { useEffect, useState } from 'react';
import { aimCalibration, type CalibrationStep } from '../../lib/api.ts';
import { btn, btnPrimary, input } from '../../lib/ui.ts';

const STEPS: CalibrationStep[] = ['corners', 'across', 'down', 'verify'];

export function CalibrationWizard({
  displayId,
  name,
  role,
  ppi: initialPpi,
  ppiY: initialPpiY,
  viewport,
  onDone,
  onCancel,
}: {
  displayId: string;
  name?: string;
  role?: string | null;
  ppi?: number;
  ppiY?: number;
  /** What the screen reported about itself, so we can tell when a strip won't fit. */
  viewport?: { w: number; h: number };
  onDone: (ppi: number, ppiY: number) => void;
  onCancel: () => void;
}) {
  const isTv = role === 'table';
  const steps = isTv ? STEPS : STEPS.slice(1);
  const [stepIndex, setStepIndex] = useState(0);
  // Start with a strip that actually fits the screen, biased long:
  // precision comes from the baseline, so use most of the glass.
  const [inches, setInches] = useState(() => {
    const guess = initialPpi || 96;
    const fits = viewport ? Math.floor(viewport.h / guess) - 1 : 0;
    return String(Math.max(4, Math.min(24, fits || 12)));
  });
  const [ppi, setPpi] = useState(initialPpi || 96);
  const [ppiY, setPpiY] = useState(initialPpiY || initialPpi || 96);
  const step = steps[stepIndex];
  const span = Math.max(1, Math.round(Number(inches) || 12));

  // Push the candidate to the screen being calibrated on every change.
  useEffect(() => {
    aimCalibration(displayId, { step, ppi, ppiY, inches: span }).catch(() => {});
  }, [displayId, step, ppi, ppiY, span]);

  // Whatever happens next, the screen goes back to being itself.
  useEffect(() => {
    return () => {
      aimCalibration(displayId, null).catch(() => {});
    };
  }, [displayId]);

  const axis = step === 'down' ? 'down' : 'across';
  const value = axis === 'down' ? ppiY : ppi;
  const setValue = axis === 'down' ? setPpiY : setPpi;
  const nudge = (delta: number) =>
    setValue((v) => Math.max(10, Math.round((v + delta) * 10) / 10));

  // A strip longer than the glass hides its own end marks — and those
  // are the ones you match against.
  const roomInches = viewport
    ? Math.floor((axis === 'down' ? viewport.h : viewport.w) / value)
    : null;
  const overflows = roomInches !== null && span > roomInches;

  const nudgeRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-28 text-xs text-stone-500">drawn strip</span>
      <button className={btn} onClick={() => nudge(-1)} title="much shorter">
        −−
      </button>
      <button className={btn} onClick={() => nudge(-0.1)} title="a little shorter">
        −
      </button>
      <button className={btn} onClick={() => nudge(0.1)} title="a little longer">
        +
      </button>
      <button className={btn} onClick={() => nudge(1)} title="much longer">
        ++
      </button>
      <span className="ml-1 font-mono text-xs text-stone-400">{value.toFixed(1)} px/in</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-stone-800 bg-stone-950 p-5 shadow-2xl">
        <header className="flex items-baseline justify-between">
          <h2 className="font-serif text-2xl text-stone-100">
            Calibrate {name ? `"${name}"` : 'the screen'}
          </h2>
          <span className="font-mono text-xs text-stone-600">
            {stepIndex + 1}/{steps.length}
          </span>
        </header>

        {step === 'corners' && (
          <div className="space-y-3 text-sm text-stone-400">
            <p>That screen is showing a bracket in each corner. Go and look at it.</p>
            <p>
              If any bracket is cut off or hidden under the bezel, the screen is cropping
              the picture. Set its aspect mode to{' '}
              <span className="text-stone-200">Just Scan</span>,{' '}
              <span className="text-stone-200">Screen Fit</span> or{' '}
              <span className="text-stone-200">1:1</span> and look again — nothing measured
              after this is trustworthy until all four show.
            </p>
          </div>
        )}

        {(step === 'across' || step === 'down') && (
          <div className="space-y-3 text-sm text-stone-400">
            <p>
              Lay your reference {axis === 'down' ? 'down' : 'across'} the strip on that
              screen, then nudge until the drawn ticks sit exactly on the physical inches.
              Longer is better — a long match is a precise one.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28 text-xs text-stone-500">inches it spans</span>
              <input
                className={`${input} w-24`}
                type="number"
                value={inches}
                onChange={(e) => setInches(e.target.value)}
                aria-label="inches the reference spans"
              />
              <span className="text-xs text-stone-600">count them, don't measure</span>
            </div>
            {nudgeRow}
            {overflows && (
              <p className="text-xs text-amber-500/80">
                A {span}" strip is longer than the screen{' '}
                {axis === 'down' ? 'is tall' : 'is wide'} — its end marks are off the glass.
                Use {roomInches}" or fewer.
              </p>
            )}
          </div>
        )}

        {step === 'verify' && (
          <div className="space-y-3 text-sm text-stone-400">
            <p>
              That screen is drawing one-inch boxes in the middle and at two corners. Check
              them against a card — an ID or credit card is exactly 3.37 × 2.13 inches by
              standard, so it's a reference you always have.
            </p>
            <p className="font-mono text-xs text-stone-500">
              {ppi.toFixed(1)} × {ppiY.toFixed(1)} px/in
              {Math.abs(ppiY / ppi - 1) > 0.02 && (
                <span className="text-amber-500/80"> — axes disagree, the picture is being stretched</span>
              )}
            </p>
          </div>
        )}

        <footer className="flex items-center justify-between gap-2 pt-1">
          <button className={btn} onClick={onCancel}>
            cancel
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button className={btn} onClick={() => setStepIndex((i) => i - 1)}>
                back
              </button>
            )}
            {step === 'verify' ? (
              <button className={btnPrimary} onClick={() => onDone(ppi, ppiY)}>
                save calibration
              </button>
            ) : (
              <button className={btnPrimary} onClick={() => setStepIndex((i) => i + 1)}>
                {step === 'corners' ? 'all four visible' : 'next'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
