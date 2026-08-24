// YOUR TURN, and the one thing a seat may say back to the order.
//
// Two affordances, one reading of `GET /api/turn`. The badge already
// does this reading for the panel facing the rest of the table
// (`client/views/BadgeView.tsx` — the flare when it's their turn); this
// is the same fact turned inward, for the person the seat belongs to.
//
// What a seat may WRITE is exactly one thing (rule 5, and the server's
// own door in `server/turn.ts`): a score for its own row. Not `next`,
// not somebody else's row — the DM drives the order and dragging beats
// anything anyone typed. So the entry line appears only while the
// rolling phase is open and only for the entry that names this seat's
// entity, and the client never widens that: it asks for the one op the
// assignment already allows and lets the server refuse the rest.
//
// Both glasses, and neither may grow (rule 6). Mounted glass is a fixed
// 515px that never scrolls, so nothing here adds a row to the seat: the
// flag and the entry line ride in the top bar's own spare width, beside
// the hairlines. Held glass is elastic, so there they stack. Nothing
// renders at all when the fight isn't asking anything of you, which is
// most of the time — the first screen's economy is the design.

import { useState } from 'react';
import { turnState, type TurnEntry } from '../../lib/api.ts';
import { useLive } from '../../lib/use-session.ts';
// Type-only, so the pair `seams.tsx` ↔ this file makes no runtime cycle:
// the seam contract is declared beside the other four, and the floor
// that satisfies it stays with the reading it grew up with.
import type { TurnCallProps } from './seams.tsx';

const LABEL = 'text-[0.7rem] uppercase tracking-[0.18em] text-stone-500';

export type TurnCall = {
  /** This seat's own row in the order, if it has one. */
  entry?: TurnEntry;
  up: boolean;
  onDeck: boolean;
  rolling: boolean;
  reload: () => void;
};

/** Where this seat stands in the order. Refetches on every nudge, and
 *  `useLive` holds off while a field has focus — which is what keeps a
 *  score arriving from another seat from wiping what you're typing. */
export function useTurnCall(entityId: string): TurnCall {
  const turn = useLive(turnState, [], { on: ['turn'] });
  const state = turn.data;
  const order = state?.order ?? [];
  const entry = order.find((e) => e.entityId === entityId);
  const at = state?.turn ?? null;
  const current = at !== null ? order[at] : undefined;
  const next = at !== null && order.length ? order[(at + 1) % order.length] : undefined;
  const up = Boolean(entry && current && current.id === entry.id);
  return {
    entry,
    up,
    // On deck is the quieter half and it only ever means "after this
    // one" — never shown alongside your own turn, which outranks it.
    onDeck: Boolean(!up && entry && next && next.id === entry.id),
    rolling: Boolean(state?.rolling),
    reload: turn.reload,
  };
}

/** The frame's own answer: a ring drawn OVER the seat rather than around
 *  it, so it costs no layout on glass that can't spare any. Sits in the
 *  padding the seat already had. */
export function TurnRing({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-1 z-20 animate-pulse rounded-lg ring-2 ring-amber-500/90"
    />
  );
}

/** The number, and the only write on this screen that isn't the sheet's.
 *  Not optimistic on purpose: the round trip is a nudge away and a score
 *  that only LOOKS set is worse than one that took a beat. */
function Initiative({
  submit: send,
}: {
  submit: (score: number) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(text.trim());
    if (!text.trim() || Number.isNaN(n)) return;
    setBusy(true);
    setProblem(false);
    send(n)
      .then(() => setText(''))
      .catch(() => setProblem(true))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className="flex shrink-0 items-center gap-1.5">
      <span className={LABEL}>{problem ? 'say again?' : 'your initiative'}</span>
      <input
        type="number"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="your initiative"
        className="h-7 w-[3.4rem] rounded-md border border-amber-600/70 bg-stone-900 text-center font-mono text-sm text-stone-100 outline-none focus:border-amber-400"
      />
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="h-7 rounded-full bg-amber-500 px-3 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-stone-950 disabled:opacity-40"
      >
        set
      </button>
    </form>
  );
}

/**
 * The TurnCall SEAM's floor (§M-5a) — what the seat shows about the
 * order, in priority: the one thing being asked of you first, then
 * whose turn it is, plus the ring drawn over the whole seat when it IS
 * your turn.
 *
 * The rolling phase wipes every score when it opens (`server/turn.ts`),
 * so "no score yet" is the honest test for "we're waiting on you" —
 * distinct from a genuine 0, which reads back as a number and quietly
 * shows itself instead.
 *
 * A theme may quiet or even suppress this — rule 1 for UI, the author's
 * own table — which is exactly why the FACTS arrive as props and the
 * one write it may make arrives as a bound function: nothing here reads
 * the order and nothing here decides what a seat is allowed to say.
 */
export function TurnCallFloor({ up, onDeck, rolling, myScore, submitScore }: TurnCallProps) {
  const flag = (): React.ReactNode => {
    if (rolling && submitScore)
      return typeof myScore === 'number' ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={LABEL}>initiative</span>
          <span className="font-mono text-sm text-stone-300">{myScore}</span>
        </span>
      ) : (
        <Initiative submit={submitScore} />
      );
    if (up)
      return (
        <span className="shrink-0 animate-pulse whitespace-nowrap rounded-full bg-amber-500 px-3 py-0.5 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-stone-950">
          you're up
        </span>
      );
    if (onDeck)
      return (
        <span className="shrink-0 whitespace-nowrap rounded-full border border-amber-700/60 px-3 py-0.5 text-[0.7rem] uppercase tracking-[0.18em] text-amber-300/90">
          on deck
        </span>
      );
    return null;
  };
  const shown = flag();
  if (!up && !shown) return null;
  return (
    <>
      <TurnRing on={up} />
      {shown}
    </>
  );
}
