// The book library, ported — and what these pin is COMPATIBILITY.
//
// The old world's `~/.teller/books/` is a folder of PDFs named
// `bok_<12 hex>.pdf`, and the whole point of this port is that a DM
// copies that folder into `~/.teller-next/books/` and every book is
// simply there: recognised by name, not re-hashed, not renamed, not
// re-read. The first test is that acceptance flow, in miniature.
//
// Real files and a real (tiny) PDF, same reasoning as
// `panels-copy.test.ts`: a sweep is a thing the FILESYSTEM does, and a
// test that stubbed the disk would pin a shape the running host never
// produces. The PDF is built here rather than committed — teller's repo
// carries nobody's book (rule 4), including a fixture of one.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShelf, type Shelf } from '../core/store.ts';
import { sweepBooks } from '../core/books-shelf.ts';
import { ftsQuery } from './books.ts';
import { serve } from './index.ts';
import { Host } from './session.ts';

let dir: string;
let shelf: Shelf;
let host: Host;
let server: Server;
let base: string;

const KEY = 'test-key-0123456789abcdef';

async function api(
  method: string,
  path: string,
  body?: unknown,
  key: string | null = KEY,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(key ? { 'x-teller-key': key } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** The smallest thing pdfjs will call a book: one page, one line of text. */
function tinyPdf(line: string): Buffer {
  const objs = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]' +
      '/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj',
    '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ];
  const stream = `BT /F1 12 Tf 20 100 Td (${line}) Tj ET`;
  objs.push(`5 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`);
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objs) {
    offsets.push(pdf.length);
    pdf += `${obj}\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** The id the old world would have given these bytes — the whole contract. */
function idOf(bytes: Buffer): string {
  return `bok_${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`;
}

function drop(name: string, bytes: Buffer): void {
  mkdirSync(join(dir, 'books'), { recursive: true });
  writeFileSync(join(dir, 'books', name), bytes);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-books-'));
  mkdirSync(join(dir, 'systems', 'wiw'), { recursive: true });
  writeFileSync(
    join(dir, 'systems', 'wiw', 'system.json'),
    JSON.stringify({ id: 'sys_wiw', name: 'The System', version: 1 }),
  );
  shelf = openShelf(dir);
  host = new Host(shelf, dir);
  server = serve(host, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  await api('POST', '/api/campaigns', { name: 'The Unlikely Duo', system: 'sys_wiw' });
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  host.session?.campaign.close();
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the old books folder, copied across', () => {
  it('takes an already-hashed file at its word and reads it', async () => {
    const bytes = tinyPdf('heavy cover grants a bonus');
    const id = idOf(bytes);
    drop(`${id}.pdf`, bytes);

    const swept = await sweepBooks(dir, shelf);
    expect(swept.problems).toEqual([]);
    expect(swept.onDisk).toEqual([id]);
    expect(swept.indexed).toEqual([id]);
    // Not renamed, not moved — the file a DM copied across is untouched.
    expect(readdirSync(join(dir, 'books'))).toEqual([`${id}.pdf`]);

    const book = shelf.book(id);
    expect(book).toMatchObject({ id, indexed: true, pages: 1 });
  });

  it('gives a hand-dropped file its real name, once', async () => {
    const bytes = tinyPdf('a wagon has some cover');
    drop('The Guidebook.pdf', bytes);

    await sweepBooks(dir, shelf);
    const id = idOf(bytes);
    expect(existsSync(join(dir, 'books', `${id}.pdf`))).toBe(true);
    expect(existsSync(join(dir, 'books', 'The Guidebook.pdf'))).toBe(false);
    // The filename was the only name it had, so it became the shelf's.
    expect(shelf.book(id)?.name).toBe('The Guidebook');
  });

  it('drops a second copy of a book you already have', async () => {
    const bytes = tinyPdf('the same words exactly');
    const id = idOf(bytes);
    drop(`${id}.pdf`, bytes);
    await sweepBooks(dir, shelf);

    drop('Another Copy.pdf', bytes);
    const swept = await sweepBooks(dir, shelf);
    expect(swept.problems).toEqual([]);
    expect(readdirSync(join(dir, 'books'))).toEqual([`${id}.pdf`]);
    expect(shelf.books()).toHaveLength(1);
    // And it was not re-read: indexed once is indexed forever, because
    // a book's bytes cannot change without changing its name.
    expect(swept.indexed).toEqual([]);
  });

  it('reports a book whose file has gone, and never forgets the row', async () => {
    const bytes = tinyPdf('a page of rules');
    const id = idOf(bytes);
    drop(`${id}.pdf`, bytes);
    await sweepBooks(dir, shelf);

    rmSync(join(dir, 'books', `${id}.pdf`));
    const swept = await sweepBooks(dir, shelf);
    expect(swept.missing).toEqual([id]);
    expect(shelf.book(id)).toBeDefined();

    const { body } = await api('GET', '/api/books');
    expect(body.books[0]).toMatchObject({ id, present: false });
  });

  it('reports a file it cannot read without losing the book', async () => {
    drop('Scan.pdf', Buffer.from('not a pdf at all'));
    const swept = await sweepBooks(dir, shelf);
    expect(swept.problems).toHaveLength(1);
    expect(swept.problems[0].problem).toMatch(/did not read/);
    // The row survives: you can still open it, only search can't reach
    // inside it.
    expect(shelf.books()).toHaveLength(1);
    expect(shelf.books()[0].indexed).toBe(false);
  });
});

describe('search', () => {
  it('quotes every term and requires all of them', () => {
    expect(ftsQuery('cover')).toBe('"cover"');
    expect(ftsQuery('heavy cover')).toBe('("heavy cover") OR ("heavy" AND "cover")');
    // Operators and punctuation are words, never syntax.
    expect(ftsQuery('NOT "AC')).toBe('("not ac") OR ("not" AND "ac")');
    expect(ftsQuery('  ?! ')).toBeNull();
  });

  it('answers with the page, the book and a fenced snippet', async () => {
    const bytes = tinyPdf('heavy cover grants a bonus');
    drop(`${idOf(bytes)}.pdf`, bytes);
    await sweepBooks(dir, shelf);

    const { status, body } = await api('GET', '/api/books/search?q=cover');
    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.hits[0]).toMatchObject({ page: 1, bookId: idOf(bytes) });
    // \x02…\x03 fence what FTS5 matched, so the client highlights the
    // stem it actually hit rather than re-searching the string.
    expect(body.hits[0].snippet).toContain('\x02cover\x03');
  });

  it('matches whole words and stems them, which is the reason for FTS', async () => {
    const bytes = tinyPdf('a grappled outlaw is uncovered');
    drop(`${idOf(bytes)}.pdf`, bytes);
    await sweepBooks(dir, shelf);

    // The porter stemmer: you type what you meant, not what's printed.
    expect((await api('GET', '/api/books/search?q=grapple')).body.total).toBe(1);
    // And a word is a WORD — "cover" is not found inside "uncovered",
    // which is exactly the bug LIKE '%cover%' had.
    expect((await api('GET', '/api/books/search?q=cover')).body.total).toBe(0);
  });

  it('says nothing to a one-letter question rather than everything', async () => {
    const { body } = await api('GET', '/api/books/search?q=a');
    expect(body).toEqual({ hits: [], total: 0 });
  });
});

describe('reading one', () => {
  it('mints a ticket that opens that book and no other', async () => {
    const bytes = tinyPdf('page one');
    const id = idOf(bytes);
    drop(`${id}.pdf`, bytes);
    const other = tinyPdf('a different book entirely');
    drop(`${idOf(other)}.pdf`, other);
    await sweepBooks(dir, shelf);

    const slip = await api('POST', `/api/books/${id}/ticket`);
    expect(slip.status).toBe(200);
    expect(slip.body.url).toMatch(new RegExp(`^/books/${id}\\.pdf\\?t=`));

    // The ticket is the whole authority — no key, no display.
    const res = await fetch(`${base}${slip.body.url}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);

    // …and it is worthless against the book beside it.
    const ticket = new URL(`${base}${slip.body.url}`).searchParams.get('t');
    const wrong = await fetch(`${base}/books/${idOf(other)}.pdf?t=${ticket}`);
    expect(wrong.status).toBe(401);
  });

  it('refuses bytes with no ticket at all', async () => {
    const bytes = tinyPdf('page one');
    drop(`${idOf(bytes)}.pdf`, bytes);
    await sweepBooks(dir, shelf);
    expect((await fetch(`${base}/books/${idOf(bytes)}.pdf`)).status).toBe(401);
  });

  it('serves ranges, which is what makes page 184 instant', async () => {
    const bytes = tinyPdf('page one');
    const id = idOf(bytes);
    drop(`${id}.pdf`, bytes);
    await sweepBooks(dir, shelf);
    const { body } = await api('POST', `/api/books/${id}/ticket`);

    const res = await fetch(`${base}${body.url}`, { headers: { Range: 'bytes=0-99' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-99/${bytes.length}`);
    expect(res.headers.get('content-length')).toBe('100');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes.subarray(0, 100));

    // An open-ended range is the rest of the file.
    const tail = await fetch(`${base}${body.url}`, { headers: { Range: 'bytes=10-' } });
    expect(tail.status).toBe(206);
    expect(tail.headers.get('content-range')).toBe(`bytes 10-${bytes.length - 1}/${bytes.length}`);

    // And one past the end is refused, with the size, rather than
    // answered with nothing.
    const past = await fetch(`${base}${body.url}`, {
      headers: { Range: `bytes=${bytes.length + 10}-` },
    });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
  });
});

describe('who may', () => {
  it('refuses the shelf, the search and a ticket to a caller with no key', async () => {
    const bytes = tinyPdf('page one');
    drop(`${idOf(bytes)}.pdf`, bytes);
    await sweepBooks(dir, shelf);

    expect((await api('GET', '/api/books', undefined, null)).status).toBe(401);
    expect((await api('GET', '/api/books/search?q=page', undefined, null)).status).toBe(401);
    expect(
      (await api('POST', `/api/books/${idOf(bytes)}/ticket`, undefined, null)).status,
    ).toBe(401);
  });
});

describe('the campaign says which books it is written against', () => {
  it('reads the declaration off the pack manifests', async () => {
    const bytes = tinyPdf('the rules themselves');
    const id = idOf(bytes);
    drop(`${id}.pdf`, bytes);
    const pack = join(dir, 'packs', 'guidebook');
    mkdirSync(pack, { recursive: true });
    writeFileSync(
      join(pack, 'pack.json'),
      JSON.stringify({
        id: 'pak_000000000001',
        system: 'sys_wiw',
        name: 'The Guidebook',
        books: [id],
      }),
    );
    await api('POST', '/api/shelf/sweep');
    await sweepBooks(dir, shelf);

    const { body } = await api('GET', '/api/books');
    expect(body.declared).toEqual([id]);
  });
});

describe('the name is for a human', () => {
  it('can be typed over, because a hashed filename is nobody’s name', async () => {
    const bytes = tinyPdf('page one');
    const id = idOf(bytes);
    drop(`${id}.pdf`, bytes);
    await sweepBooks(dir, shelf);
    expect(shelf.book(id)?.name).toBe(id);

    const { status, body } = await api('PUT', `/api/books/${id}`, { name: 'The Guidebook' });
    expect(status).toBe(200);
    expect(body.name).toBe('The Guidebook');
    // And the sweep does not take it back on the next boot.
    await sweepBooks(dir, shelf);
    expect(shelf.book(id)?.name).toBe('The Guidebook');
  });

  it('takes a book off the host, bytes and row together', async () => {
    const bytes = tinyPdf('page one');
    const id = idOf(bytes);
    drop(`${id}.pdf`, bytes);
    await sweepBooks(dir, shelf);

    expect((await api('DELETE', `/api/books/${id}`)).status).toBe(200);
    expect(shelf.book(id)).toBeUndefined();
    expect(existsSync(join(dir, 'books', `${id}.pdf`))).toBe(false);
    // The text went with it — a search must not answer with a page of
    // a book that is no longer here.
    expect((await api('GET', '/api/books/search?q=page')).body.total).toBe(0);
  });
});
