// Rulebooks — the DM's own PDFs, on the DM's own host.
//
// Ported from the old world (`worker/books.ts`), which is where the law
// was worked out: search first so a bare `/api/books/:id` can't swallow
// it, a ticket because an iframe sends no headers, and ranged bytes
// because opening page 184 of a rulebook should fetch roughly page 184.
//
// WHAT DIDN'T PORT: the upload door. In the old world a book arrived by
// POSTing its bytes; here the road in is the SWEEP, the same one packs,
// systems and panels take — drop the PDF in `<data>/books/` and it is
// installed. That is not an omission, it is §L's posture ("the way IN
// is the sweep, which needs no route at all"), and it is what makes
// copying an existing `~/.teller/books/` folder across the whole
// migration. `/api/books/sweep` is the "I just dropped one in" button.
//
// THE GATE is `canPrep` — the DM and a seat. A book is table reference:
// a player looks a rule up mid-fight, which is the entire point of it
// living on the host. Passive glass (table, board, badge, art) may not,
// for the reason it may never do anything: it is player-facing glass in
// the middle of the room and nobody is standing at it.
//
// NOTHING HERE LOGS, and that is deliberate rather than an oversight of
// rule 3. The event log is the CAMPAIGN's — `/undo` walks it — and a
// book is a fact about the MACHINE (rule 9), on the shelf beside the
// packs and the systems, whose sweeps log nothing either. What a
// campaign says about a book (that it expects one) is a campaign
// mutation and logs where every other manifest edit does.

import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { bookPath, isBookId, sweepBooks } from '../core/books-shelf.ts';
import { packDir } from '../core/packs-shelf.ts';
import type { Book } from '../core/store.ts';
import { mintTicket } from './auth.ts';

/**
 * A book's permission slip lives an hour. Long enough that a DM who
 * opened the Guidebook before the session doesn't get thrown out of it
 * mid-fight; short enough that a URL copied out of a devtools panel is
 * worthless by the next one.
 */
export const BOOK_MINUTES = 60;

/** What a ticket opens: one book, and nothing else on this host. */
export const bookSubject = (id: string): string => `book:${id}`;

/** How many hits we'll return. Ranked, so this is "the best N", not "the first N". */
const HIT_LIMIT = 40;

/**
 * Turn what someone typed into an FTS5 expression.
 *
 * Raw input can't go near MATCH: `d20 "AC` is a syntax error, and `NOT`
 * is an operator, so a stray word would quietly change the question. So
 * the query is rebuilt from its words — every term quoted as a literal
 * phrase, all of them required. Punctuation is dropped rather than
 * escaped, since none of it means anything to a tokenizer anyway.
 */
export function ftsQuery(q: string): string | null {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)
    .slice(0, 12);
  if (!terms.length) return null;
  const quoted = terms.map((t) => `"${t.replace(/"/g, '')}"`);
  const all = quoted.join(' AND ');
  if (quoted.length < 2) return all;

  // Same results, better order. Every page still has to contain every
  // term, but a page where the words sit TOGETHER also matches the
  // phrase branch, and bm25 scores a page once per phrase it matched —
  // so "heavy cover" surfaces the rule that defines it above the wagon
  // that has some. Without this, bm25's length normalisation puts the
  // short stat block first.
  const phrase = `"${terms.map((t) => t.replace(/"/g, '')).join(' ')}"`;
  return `(${phrase}) OR (${all})`;
}

/**
 * The book ids the packs this campaign runs on say they're written
 * against — read from the pack MANIFESTS, which is where `books` lives
 * (`packs/README.md`). Read here rather than carried through the load
 * stack because it is the only consumer: a `books` list is not
 * vocabulary, it doesn't merge by name or by id, and it would ride the
 * declaration machinery for no reason.
 *
 * It is what makes a rule entry's bare `page` openable — WiW's sections
 * say "p.26" and the pack says which book page 26 is in.
 */
export function declaredBooks(dataDir: string | undefined, packIds: string[]): string[] {
  if (!dataDir) return [];
  const out: string[] = [];
  for (const packId of packIds) {
    const dir = packDir(dataDir, packId);
    if (!dir) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as {
        books?: unknown;
      };
      if (!Array.isArray(manifest.books)) continue;
      for (const id of manifest.books) {
        if (typeof id === 'string' && isBookId(id) && !out.includes(id)) out.push(id);
      }
    } catch {
      // A pack whose manifest won't parse is the sweep's problem to
      // report, not this route's to crash on.
    }
  }
  return out;
}

/**
 * A book's row plus whether its bytes are actually here. A row with no
 * file is kept and SAID — the campaign still refers to it, and "you
 * don't have this" beats an encounter that opens nothing (rule 9).
 */
export function withPresence(dataDir: string | undefined, books: Book[]): Book[] {
  return books.map((book) => ({
    ...book,
    present: Boolean(dataDir) && existsSync(bookPath(dataDir!, book.id)),
  }));
}

/**
 * What to send for a book's bytes — the file and a slice of it, never
 * the bytes themselves. A rulebook is a hundred megabytes and a table
 * has several screens; reading one whole into memory per request is
 * how a host with 8GB and a Pi kiosk falls over. The caller streams
 * `path` from `start` to `end`.
 */
export type BookBytes =
  | { status: 404 }
  | { status: 416; headers: Record<string, string> }
  | {
      status: 200 | 206;
      headers: Record<string, string>;
      path: string;
      start: number;
      end: number;
    };

/**
 * Range support is the difference between opening a book at page 184
 * and downloading a rulebook to read one paragraph — the browser's own
 * PDF viewer asks for exactly the bytes it needs, and a hundred-megabyte
 * Guidebook opens at a glance instead of after a minute of waiting.
 */
export function bookBytes(
  dataDir: string,
  id: string,
  range: string | undefined,
): BookBytes {
  if (!isBookId(id)) return { status: 404 };
  const path = bookPath(dataDir, id);
  if (!existsSync(path)) return { status: 404 };
  const size = statSync(path).size;
  const asked = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
  if (asked) {
    const start = asked[1] ? Number(asked[1]) : 0;
    const end = asked[2] ? Math.min(Number(asked[2]), size - 1) : size - 1;
    if (start >= size || end < start) {
      return { status: 416, headers: { 'Content-Range': `bytes */${size}` } };
    }
    return {
      status: 206,
      headers: {
        'Content-Type': 'application/pdf',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
        'Cache-Control': 'private, max-age=3600',
      },
      path,
      start,
      end,
    };
  }
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(size),
      'Cache-Control': 'private, max-age=3600',
    },
    path,
    start: 0,
    end: Math.max(size - 1, 0),
  };
}

/** Take a book's bytes off this host. The row goes with them. */
export function forgetBook(dataDir: string | undefined, id: string): void {
  if (!dataDir || !isBookId(id)) return;
  const path = bookPath(dataDir, id);
  if (existsSync(path)) unlinkSync(path);
}

/** A ticketed URL for one book — what the reader points its iframe at. */
export function bookUrl(key: string, id: string): string {
  return `/books/${id}.pdf?t=${encodeURIComponent(mintTicket(key, bookSubject(id), BOOK_MINUTES))}`;
}

export { sweepBooks, HIT_LIMIT };
