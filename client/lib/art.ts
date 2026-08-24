// Pictures a RECORD names, resolved to fetchable urls.
//
// A record may carry art the same way it carries words: `portraits` maps
// a type to a picture, `brand` maps a name to a logo, and `dice.art` maps
// a die FACE to one. All of them hold the same kind of string — a key
// into the data dir (`art/<pak_id>/…`), written relative in the folder
// and rewritten at install (rule 4a) — and all of them need the same
// thing done to it: a ticket, because `/files/…` is authenticated and an
// `<img>` cannot send a header (rule 7).
//
// So this is `fileUrl` with a React shape on it, and nothing else. It
// exists as its own file because the two callers are on opposite sides
// of the frozen seam: teller's own floor imports it directly, and a
// system's presentation gets it from `teller`. A hook that only one of
// them could reach would push the other into hand-rolling the ticket
// dance, which is exactly the sort of duplication the seam exists to
// prevent.
//
// A MAP rather than a single path on purpose: the callers hold a record
// of them (six faces, seven trades), and one hook per picture would be a
// hook called in a loop — the rule React actually enforces. Resolving
// the map once keeps the hook count fixed however many pictures a record
// grew since the last render.

import { useEffect, useState } from 'react';
import { fileUrl } from './api.ts';

/**
 * Every path in a record, as a ticketed url — keyed the same way it came
 * in, so a caller looks its picture up by the name it already had.
 *
 * Empty until the tickets land, and empty forever if there was nothing
 * to resolve. Both are the same answer to the caller, which is what lets
 * every consumer degrade to text with one `??` rather than a loading
 * state: no picture yet and no picture ever look alike on purpose.
 */
export function useArtMap(paths: Record<string, string> | undefined): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // The VALUES are the dependency, not the object — a record read off a
  // merged stack is a fresh object every render and would otherwise
  // re-fetch tickets forever.
  const key = paths ? JSON.stringify(paths) : '';

  useEffect(() => {
    const held = key ? (JSON.parse(key) as Record<string, string>) : {};
    const names = Object.keys(held);
    if (!names.length) {
      setUrls({});
      return;
    }
    let cancelled = false;
    Promise.all(names.map((name) => fileUrl(held[name])))
      .then((resolved) => {
        if (cancelled) return;
        setUrls(Object.fromEntries(names.map((name, i) => [name, resolved[i]])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return urls;
}
