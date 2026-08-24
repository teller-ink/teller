// CALIBRATING A SCREEN against something physical.
//
// teller never needs a screen's SIZE, only the ratio: pixels per true
// inch, per axis. That number lives on the display row (`ppi`/`ppiY`,
// rule 9 — it's a fact about the glass, not about the campaign), and
// the table already renders through it. What was missing is the way a
// human arrives at it.
//
// The flow is the old world's, unchanged, because it was right: the DM
// lays a reference on the glass and NUDGES until the drawn ticks sit on
// the physical ones. Matching over a long baseline divides the error —
// a 1/16" misjudgement over 40" is 0.16%, over a credit card it's 2%.
// Corners first, because a TV that overscans is describing a picture
// you can't fully see and nothing measured after that is trustworthy.
//
// WHAT LIVES HERE is only the PATTERN IN FLIGHT: which screen is being
// calibrated, which step it's showing, at what candidate scale. It is
// deliberately in memory and deliberately not on the display row —
// a half-finished calibration is not a fact about the room, and a host
// that restarts mid-wizard should come back showing the ground rather
// than a ruler nobody is standing at. The RESULT is written through the
// ordinary display PATCH, and that is the only durable half.
//
// Rule 6's shape is preserved exactly: the console drives, the pattern
// arrives at a passive surface over SSE, and the surface grows no
// button of its own.

export type CalibrationStep = 'corners' | 'across' | 'down' | 'verify';

/** The pattern one screen is showing while it's being calibrated. */
export type Calibration = {
  step: CalibrationStep;
  /** The candidate, live — what the ruler is drawn at, not what's saved. */
  ppi: number;
  ppiY: number;
  /** How many inches the drawn strip spans. */
  inches: number;
};

const STEPS: CalibrationStep[] = ['corners', 'across', 'down', 'verify'];

/** In flight, by display id. Empty is the normal state of the world. */
const showing = new Map<string, Calibration>();

/** What the console is asking this screen to draw, if anything. */
export function calibrationFor(displayId: string): Calibration | null {
  return showing.get(displayId) ?? null;
}

/** Aim a pattern at one screen, or (null) send it back to being itself. */
export function setCalibration(displayId: string, pattern: Calibration | null): void {
  if (pattern) showing.set(displayId, pattern);
  else showing.delete(displayId);
}

/** Everything in flight goes — the host is putting the room down. */
export function clearCalibrations(): void {
  showing.clear();
}

/**
 * Read a pattern off a request body. Anything malformed is `undefined`
 * rather than a guess: this draws on a screen across the room, and a
 * ruler at a scale nobody asked for is worse than no ruler.
 */
export function toCalibration(raw: unknown): Calibration | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as { step?: unknown; ppi?: unknown; ppiY?: unknown; inches?: unknown };
  const step = STEPS.find((s) => s === o.step);
  if (!step) return undefined;
  const ppi = Number(o.ppi);
  const ppiY = Number(o.ppiY ?? o.ppi);
  if (!Number.isFinite(ppi) || ppi < 10 || ppi > 2000) return undefined;
  if (!Number.isFinite(ppiY) || ppiY < 10 || ppiY > 2000) return undefined;
  const inches = Math.round(Number(o.inches));
  if (!Number.isFinite(inches) || inches < 1 || inches > 200) return undefined;
  return { step, ppi, ppiY, inches };
}
