// THE ART FRAME — a fullscreen surface for the thing the table is
// meant to be looking at: a letter, a WANTED poster, the scene's own
// picture. DM-screen wings, a spare tablet on the shelf.
//
// It has its fact now. The handout the console is showing rides in the
// public snapshot as `refs.handout`, resolved to `{id, name, key}` —
// the shape this file's own note predicted, and for the reason it gave:
// "the active handout" is a fact about the campaign in exactly the way
// "the active board" is, so it is one ordinary manifest ref beside it.
// The bytes need nothing new; `fileUrl` puts a ticketed url on a key in
// the data dir, the same door the table's board draws through (rule 7 —
// an `<img>` cannot send a header).
//
// Full-bleed and CONTAINED: a handout is a picture of a whole thing —
// a map, a letter — and cropping a letter to fill the glass is the one
// way to make it useless. Letterboxing against the same near-black the
// idle mark rests on is what a picture frame does.
//
// A PASSED note never comes here. This is glass in the middle of the
// room; anything aimed at one player arrives at that player's own seat
// (`server/notes.ts`). What the frame shows, the whole table sees, and
// that is the only thing it is for.
//
// Passive throughout: no controls, and nothing here writes.

import { useEffect, useState } from 'react';
import { fileUrl, publicSnapshot, type PublicSnapshot } from '../lib/api.ts';
import { PUBLIC, useLive } from '../lib/use-session.ts';
import { useWakeLock } from '../lib/use-wake-lock.ts';
import { ConnectionHint } from '../components/ConnectionHint.tsx';

export function ArtView() {
  useWakeLock();
  const snapshot = useLive<PublicSnapshot>(publicSnapshot, [], { on: PUBLIC });
  const handout = snapshot.data?.handout ?? null;
  // A NOTICE does come here, and the distinction above is exactly why:
  // a passed note is aimed at one player, a notice is the DM's words
  // for the room, and this is the room's own glass. It sits over the
  // picture rather than beside it — the frame is full-bleed and a line
  // nobody can see is a line nobody was told.
  const notice = snapshot.data?.notice ?? null;
  const [src, setSrc] = useState<string | undefined>(undefined);

  // Keyed by the KEY, not the row: renaming a handout must not make the
  // frame blink, and swapping which one is showing must.
  const key = handout?.key;
  useEffect(() => {
    if (!key) {
      setSrc(undefined);
      return;
    }
    let cancelled = false;
    fileUrl(key)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  const banner = notice && (
    <p className="pointer-events-none absolute inset-x-6 top-6 z-10 animate-pulse rounded-2xl bg-amber-700 px-8 py-3 text-center font-serif text-4xl text-stone-950 shadow-lg shadow-amber-900/50">
      {notice.text}
    </p>
  );

  if (handout && src) {
    return (
      <main className="relative flex h-dvh items-center justify-center overflow-hidden bg-stone-950">
        <ConnectionHint />
        {banner}
        <img
          src={src}
          alt={handout.name}
          className="max-h-full max-w-full object-contain"
        />
      </main>
    );
  }

  return (
    <main className="relative flex h-dvh flex-col items-center justify-center gap-3 overflow-hidden bg-stone-950">
      <ConnectionHint />
      {banner}
      <h1 className="font-serif text-5xl text-stone-800">teller</h1>
      {snapshot.data && (
        <p className="text-lg text-stone-800">{snapshot.data.campaign.name}</p>
      )}
    </main>
  );
}
