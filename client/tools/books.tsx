// The 'books' tool — the rulebooks on this machine, searched and read.
//
// Ported from the old app's `src/components/BooksPanel.tsx`, minus the
// upload button: the road IN is the sweep now (drop a PDF in
// `<data>/books/`), the same road packs and panels take, so what used
// to be "add a PDF…" is "swept" and a line of instructions.
//
// A book lives on the host and nowhere else. It arrives once and every
// screen in the room can read it — the table TV, a rail panel, a
// player's phone. No per-device import, no copy stranded in one
// browser's storage, no "not on this screen" (rule 9).
//
// The library spans every system you own, and that is deliberate: you
// own the books, campaigns refer to them by id. Which is why the list
// leads with the ones the packs at THIS table were written against and
// keeps the rest one click away — ten rulebooks, seven of them
// two-page class sheets, is noise when the question is "what does this
// adventure need". Nothing is hidden; the shelf is still yours.

import { useState } from 'react';
import { BookReader, type BookTarget } from '../components/BookReader.tsx';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, card, input, sectionLabel } from '../lib/ui.ts';
import { registerTool } from './index.ts';

type Book = {
  id: string;
  name: string;
  pages: number;
  indexed: boolean;
  present?: boolean;
};

type Shelf = { books: Book[]; declared: string[] };

type Hit = { bookId: string; bookName: string; page: number; snippet: string };

/**
 * The server fences matched words in \x02…\x03 so the highlight lands
 * on what FTS5 actually matched, stem and all — "grappled" lights up
 * for "grapple", which re-searching the string could never do.
 */
function Snippet({ text }: { text: string }) {
  const runs = text.split(/\x02([^\x03]*)\x03/).filter(Boolean);
  return (
    <>
      {runs.map((run, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-transparent font-semibold text-stone-100">
            {run}
          </mark>
        ) : (
          <span key={i}>{run}</span>
        ),
      )}
    </>
  );
}

function BooksTool() {
  const { data, reload } = useLive(() => api<Shelf>('/api/books'), [], { on: ['books'] });
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<BookTarget | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  if (!data) return null;
  const books = data.books;
  const declared = new Set(data.declared.filter((id) => books.some((b) => b.id === id)));
  // Declared but absent: a reference you can't resolve yet is still the
  // truth about what this table needs, so it's said out loud rather
  // than quietly dropped (rule 9).
  const absent = data.declared.filter(
    (id) => !books.some((b) => b.id === id && b.present !== false),
  );
  const shown = showAll ? books : books.filter((b) => declared.has(b.id));

  const search = async () => {
    if (query.trim().length < 2) return setHits(null);
    try {
      const found = await api<{ hits: Hit[]; total: number }>(
        `/api/books/search?q=${encodeURIComponent(query.trim())}`,
      );
      setHits(found.hits);
      setTotal(found.total);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  // Reading a rulebook is seconds, not milliseconds, so this says so.
  const sweep = async () => {
    setBusy('reading the books folder…');
    setNote('');
    try {
      const swept = await api<{ onDisk: string[]; indexed: string[] }>('/api/books/sweep', {
        method: 'POST',
      });
      setNote(
        swept.indexed.length
          ? `read ${swept.indexed.length} new book${swept.indexed.length === 1 ? '' : 's'}`
          : `${swept.onDisk.length} book${swept.onDisk.length === 1 ? '' : 's'} here, nothing new`,
      );
      reload();
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
    setBusy('');
  };

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Rulebooks</span>
        <span className="font-mono text-[11px] text-stone-600">
          {books.length ? `${books.length} on this host` : 'the whole shelf'}
        </span>
      </div>

      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="search every book…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
        <button className={btn} onClick={() => void search()}>
          find
        </button>
      </div>

      {hits && (
        <div className="space-y-1">
          {hits.length === 0 && <p className="text-sm text-stone-600">nothing found</p>}
          {total > hits.length && (
            <p className="font-mono text-[11px] text-stone-600">
              best {hits.length} of {total} pages
            </p>
          )}
          {hits.map((hit) => (
            <button
              key={`${hit.bookId}-${hit.page}`}
              className="block w-full rounded-md bg-stone-900 px-2 py-1.5 text-left transition-colors hover:bg-stone-800"
              onClick={() =>
                setOpen({ bookId: hit.bookId, page: hit.page, name: hit.bookName })
              }
            >
              <span className="font-mono text-[11px] text-amber-400">
                {hit.bookName} · p.{hit.page}
              </span>
              <span className="block text-xs leading-snug text-stone-400">
                <Snippet text={hit.snippet} />
              </span>
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-1">
        {shown.map((book) => (
          <li key={book.id} className="flex items-center gap-2">
            <button
              className="min-w-0 flex-1 truncate text-left text-sm text-stone-200 hover:text-stone-50 disabled:text-stone-600"
              disabled={book.present === false}
              onClick={() => setOpen({ bookId: book.id, page: 1, name: book.name })}
              title={book.id}
            >
              {book.name}
            </button>
            <span className="font-mono text-[11px] text-stone-600">
              {book.present === false
                ? 'not here'
                : book.indexed
                  ? `${book.pages}p`
                  : 'reading…'}
            </span>
            <button
              className={`${btnGhost} hover:text-red-300`}
              title="take this book off the host"
              aria-label={`remove ${book.name}`}
              onClick={async () => {
                if (!window.confirm(`Remove “${book.name}” from this host?`)) return;
                await api(`/api/books/${book.id}`, { method: 'DELETE' }).catch(() => {});
                reload();
              }}
            >
              ✕
            </button>
          </li>
        ))}
        {books.length === 0 && (
          <li className="text-sm text-stone-600">
            no books yet — drop a PDF in the host's <code>books/</code> folder
          </li>
        )}
        {books.length > 0 && !showAll && declared.size === 0 && (
          <li className="text-sm text-stone-600">
            none of your books belong to the packs this table runs on
          </li>
        )}
      </ul>

      {books.length > declared.size && (
        <button className={btnGhost} onClick={() => setShowAll(!showAll)}>
          {showAll
            ? 'just this table’s books'
            : `the rest of the shelf (${books.length - declared.size})`}
        </button>
      )}

      {absent.length > 0 && (
        <p className="text-sm text-amber-500/80">
          {absent.length} book{absent.length === 1 ? '' : 's'} the packs here expect
          {absent.length === 1 ? " isn't" : " aren't"} on this host — drop the PDF in{' '}
          <code>books/</code> and it links up by itself.
        </p>
      )}

      <div className="flex items-center gap-2">
        <button className={btn} disabled={!!busy} onClick={() => void sweep()}>
          sweep the folder
        </button>
        {busy && <span className="font-mono text-xs text-amber-400">{busy}</span>}
        {!busy && note && <span className="font-mono text-xs text-stone-500">{note}</span>}
      </div>

      {open && <BookReader target={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

registerTool('books', () => <BooksTool />);
