// SOMEBODY PASSED YOU A NOTE — the folded scrap, arriving at one seat.
//
// The whole point of the feature is that this is NOT the table's
// business, so the delivery is per-screen: `/api/notes/mine` is
// answered from this display's own assignment (rule 7), and the public
// snapshot every passive surface renders never learns notes exist. The
// seat asks on a nudge, exactly the way `TurnCall` asks about the
// order, and for the same reason — one stream per screen, and the page
// refetches what it cares about.
//
// It ARRIVES OVER whatever screen is showing, rather than taking a row
// in the layout. Mounted glass is a fixed 515px that never scrolls
// (rule 6) and had no row to give; and a note that waits politely at
// the bottom of the Inventory tab is a note nobody reads. So it is the
// SpendOverlay's shape — a fixed, bounded panel with its own scroll
// region, the deliberate-shelf exemption — and it goes away when the
// person says so.
//
// DISMISSAL IS LOCAL, and deliberately dumb: it means "this glass has
// seen it", held in this component for as long as the page lives. There
// is no ack, no read receipt, no server state — a v1 that told the DM
// who had read what would be a feature about surveillance, and the DM
// is sitting at the same table and can just look up.

import { useEffect, useState } from 'react';
import { fileUrl, myNotes, type PassedNote } from '../../lib/api.ts';
import { useLive } from '../../lib/use-session.ts';
import type { NoteBannerProps } from './seams.tsx';

/** Everything passed to this screen, newest first, minus what it has seen. */
export function usePassedNotes(): {
  notes: PassedNote[];
  dismiss: (id: string) => void;
} {
  const { data } = useLive(myNotes, [], { on: ['notes'] });
  const [seen, setSeen] = useState<string[]>([]);
  const notes = (data ?? []).filter((n) => !seen.includes(n.id));
  return { notes, dismiss: (id) => setSeen((s) => (s.includes(id) ? s : [...s, id])) };
}

/** The handout riding along, drawn at whatever size the card can spare. */
function Attachment({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fileUrl(path)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="mx-auto max-h-[45vh] min-h-0 w-auto max-w-full rounded-md object-contain"
    />
  );
}

/**
 * The NoteBanner SEAM's floor (§M-5a): the newest note, over
 * everything. The rest wait their turn — a stack of three notes read
 * one at a time is a stack of three notes read, where three cards at
 * once is a wall, so the chrome hands over one note and a count.
 *
 * A theme may draw this as a telegram, a wanted poster, or quietly
 * (rule 1 for UI) — what it may not do is decide whether the note was
 * delivered. That is the seat's own business and it happens above.
 */
export function PassedNoteFloor({ note, waiting, onDismiss }: NoteBannerProps) {
  if (!note) return null;

  return (
    <div
      role="dialog"
      aria-label="a note for you"
      className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/85 p-4"
      onClick={() => onDismiss(note.id)}
    >
      <div
        className="flex max-h-full w-full max-w-2xl min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border border-amber-700/60 bg-stone-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-baseline justify-between gap-3">
          <span className="text-[0.7rem] uppercase tracking-[0.18em] text-amber-400">
            {note.to.length ? 'a note for you' : 'for the table'}
          </span>
          {waiting > 0 && (
            <span className="font-mono text-[11px] text-stone-500">
              {waiting} more waiting
            </span>
          )}
        </div>

        {note.text && (
          <p className="whitespace-pre-wrap text-base leading-relaxed text-stone-100">
            {note.text}
          </p>
        )}

        {note.handout && <Attachment path={note.handout.key} alt={note.handout.name} />}

        <button
          type="button"
          onClick={() => onDismiss(note.id)}
          className="shrink-0 self-end rounded-full bg-amber-500 px-4 py-1 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-stone-950"
        >
          put it away
        </button>
      </div>
    </div>
  );
}
