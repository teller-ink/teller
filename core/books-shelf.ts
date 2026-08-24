// How a rulebook reaches the shelf — rule 4a's "swept in on boot
// exactly like a book", which is the sentence the pack sweep was
// written to imitate. This is the thing it was imitating, ported.
//
//   ~/.teller-next/books/bok_a23d630c48f7.pdf
//
// Same folder, same naming, same law as the old world
// (`host/library.mjs`), and deliberately so: a DM copies
// `~/.teller/books/` straight across and the new host recognises every
// file without renaming, re-hashing or re-reading a single one.
//
// A book is named by the sha-256 of its own bytes (rule 4a). Two people
// who own the same rulebook derive the same id without coordinating, so
// a `.story` that says "this needs bok_a23d…" resolves on any host that
// has it — no registry, no ids handed out by anyone, and no way for one
// reference to mean two different books.
//
// It mirrors `packs-shelf.ts`'s posture: nearly read-only, a file that
// fails is a problem in the report and never a crash, and a missing
// `books/` directory is simply an empty shelf. The two writes it does
// make are the rename (a hand-dropped `Guidebook.pdf` becomes its id,
// once) and the text index — both idempotent, both mtime-free because
// a book's bytes can't change without changing its name.
//
// **Reading the text happens HERE, not in a route.** It happens once
// for the table instead of once per screen: a phone never parses a
// 300-page rulebook, and a rail panel with no storage of its own still
// gets to search. pdfjs is the extractor the old world used and the
// dependency is already in the tree — no external binary, nothing to
// install, nothing that only one runtime has.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Shelf } from './store.ts';

export type BookProblem = { file: string; problem: string };

export type BookSweep = {
  /** Ids whose file is on disk right now. */
  onDisk: string[];
  /** Rows whose file has gone — reported, never deleted (rule 9). */
  missing: string[];
  /** Ids read this pass. */
  indexed: string[];
  problems: BookProblem[];
};

export const booksDir = (dataDir: string): string => join(dataDir, 'books');

/** Where a book's bytes are. A function of the id — never a stored column. */
export function bookPath(dataDir: string, id: string): string {
  return join(booksDir(dataDir), `${id}.pdf`);
}

/** A file already carrying its true name. */
export function isBookId(value: string): boolean {
  return /^bok_[a-f0-9]{12}$/.test(value);
}

/** A book's id is what's inside it. Streamed — a rulebook can be 100MB. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `bok_${hash.digest('hex').slice(0, 12)}`;
}

/**
 * Read a PDF's text, a page at a time.
 *
 * A page with no text is skipped rather than stored empty: a scanned
 * book yields nothing, and "0 pages with text" is a truthful answer
 * that the console can say out loud instead of a search that silently
 * never matches.
 */
export async function extract(
  path: string,
): Promise<{ pages: { page: number; text: string }[]; total: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(path)),
    useSystemFonts: false,
  }).promise;
  const pages: { page: number; text: string }[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) pages.push({ page, text });
  }
  return { pages, total: doc.numPages };
}

/**
 * Reconcile the folder with the shelf, then read anything unread.
 *
 * Two directions, both wanted. A PDF dropped into the folder by hand
 * becomes a book — that is the primary road in, the same one packs
 * take. And a book whose row exists but whose file has gone is
 * REPORTED rather than deleted: the campaign still refers to it, and
 * "you don't have this" beats forgetting it existed (rule 9).
 *
 * Reading is the slow half — a 300-page book is seconds, not
 * milliseconds — so it is skipped for anything already indexed. A
 * book's bytes cannot change without changing its name, so "indexed
 * once" is "indexed forever" and there is nothing to invalidate.
 */
export async function sweepBooks(dataDir: string, shelf: Shelf): Promise<BookSweep> {
  const dir = booksDir(dataDir);
  const problems: BookProblem[] = [];
  const indexed: string[] = [];
  mkdirSync(dir, { recursive: true });

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  } catch {
    return { onDisk: [], missing: [], indexed, problems };
  }

  const onDisk = new Map<string, string>();
  for (const file of files.sort()) {
    const stem = file.slice(0, -'.pdf'.length);
    // A file already named for its hash is taken at its word — which is
    // what makes copying an existing `books/` folder across instant
    // instead of a hundred megabytes of re-hashing.
    if (isBookId(stem)) {
      onDisk.set(stem, join(dir, file));
      shelf.putBook({ id: stem, name: shelf.book(stem)?.name ?? stem });
      continue;
    }
    const path = join(dir, file);
    let id: string;
    try {
      id = await hashFile(path);
    } catch (err) {
      problems.push({ file, problem: `could not read: ${String(err)}` });
      continue;
    }
    const renamed = join(dir, `${id}.pdf`);
    if (existsSync(renamed)) {
      // Same bytes, so the same book. There is no argument to have
      // about it, and two copies of a rulebook help nobody.
      try {
        unlinkSync(path);
      } catch (err) {
        problems.push({ file, problem: `a copy of ${id}, and did not tidy: ${String(err)}` });
      }
    } else {
      try {
        renameSync(path, renamed);
      } catch (err) {
        problems.push({ file, problem: `did not install: ${String(err)}` });
        continue;
      }
      // The FILENAME is the only name a dropped book has, so it becomes
      // the shelf's — the id is identity, the name is for a human.
      shelf.putBook({ id, name: stem });
    }
    onDisk.set(id, renamed);
  }

  const rows = shelf.books();
  const missing = rows.filter((row) => !onDisk.has(row.id)).map((row) => row.id);

  for (const row of rows) {
    const path = onDisk.get(row.id);
    if (!path || row.indexed) continue;
    try {
      const { pages } = await extract(path);
      shelf.indexBook(row.id, pages);
      indexed.push(row.id);
    } catch (err) {
      // A book that won't parse is still a book you can open and read —
      // only search can't reach inside it. Never a crash, never a
      // reason to drop the row.
      problems.push({ file: `${row.id}.pdf`, problem: `did not read: ${String(err)}` });
    }
  }

  return { onDisk: [...onDisk.keys()], missing, indexed, problems };
}
