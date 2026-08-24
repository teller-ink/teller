// Conditions, statuses, trophies — any list of bare-or-numbered names on
// an entity.
//
// Ported from the old app (src/components/TagSection.tsx); classNames
// kept verbatim. The seam: the old component stored severity BAKED INTO
// the string ("Afraid 3") and had to parse it back out with
// `lib/tags.ts`. The new `Entry` model keeps name and severity as
// separate fields from the start (`core/entity.ts`), so this port drops
// the string encoding entirely and reads `entry.value` directly — one
// fewer place a mechanic could hide in a text field (CLAUDE.md rule 4).
//
// Numbered entries: an entry with a numeric `value` ("Afraid": 3) is a
// stacked status — tapping it decrements the number (WIW-style Severity
// relief), reaching 0 removes it. The ✕ removes outright. A bare entry
// (no value) keeps tap-to-remove.
//
// When a `lookup` is provided (rules packs / system declarations), an
// entry with a matching entry grows an ⓘ — tapping it opens the rule
// card inline.

import { useState } from 'react';
import type { Entry } from '../../core/entity.ts';
import { input, sectionLabel } from '../lib/ui.ts';

export type LookupEntry = { meta?: string; text?: string; section: string };

export function TagSection({
  entries,
  onWrite,
  label = 'Tags',
  lookup,
}: {
  entries: Entry[];
  /** A sparse edit against this list: a new/changed value, or a removal. */
  onWrite: (edit: { name: string; value?: number; remove?: boolean }) => void;
  label?: string;
  lookup?: (name: string) => LookupEntry | undefined;
}) {
  const [draft, setDraft] = useState('');
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  const add = () => {
    const name = draft.trim();
    if (!name || entries.some((e) => e.name.toLowerCase() === name.toLowerCase())) return;
    onWrite({ name });
    setDraft('');
  };

  const remove = (name: string) => onWrite({ name, remove: true });

  const decrement = (entry: Entry) => {
    const value = typeof entry.value === 'number' ? entry.value : null;
    if (value === null || value <= 1) return remove(entry.name);
    onWrite({ name: entry.name, value: value - 1 });
  };

  const info = openInfo ? lookup?.(openInfo) : undefined;

  return (
    <section className="space-y-2">
      <span className={sectionLabel}>{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map((entry) => {
          const value = typeof entry.value === 'number' ? entry.value : null;
          const entryLookup = lookup?.(entry.name);
          return (
            <span
              key={entry.name}
              className="flex items-center overflow-hidden rounded-full bg-amber-950/60 text-xs text-amber-200"
            >
              <button
                className="flex items-center gap-1.5 py-1 pl-2.5 pr-1.5 transition-colors hover:bg-amber-900/60"
                onClick={() => decrement(entry)}
                title={value !== null ? 'tap to reduce severity' : 'tap to remove'}
              >
                {entry.name}
                {value !== null && (
                  <span className="rounded-full bg-amber-800 px-1.5 font-mono text-amber-100">
                    {value}
                  </span>
                )}
              </button>
              {entryLookup && (
                <button
                  className="py-1 px-1 text-amber-500/70 transition-colors hover:bg-amber-900 hover:text-amber-100"
                  onClick={() => setOpenInfo(openInfo === entry.name ? null : entry.name)}
                  title="rule"
                >
                  ⓘ
                </button>
              )}
              <button
                className="py-1 pl-0.5 pr-2 text-amber-500/60 transition-colors hover:bg-red-950 hover:text-red-300"
                onClick={() => remove(entry.name)}
                title="remove"
              >
                ✕
              </button>
            </span>
          );
        })}
        <input
          className={`${input} w-28 py-1 text-xs`}
          placeholder="+ add"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          onBlur={() => draft.trim() && add()}
        />
      </div>

      {info && (
        <div className="rounded-lg border border-amber-900/60 bg-stone-900 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-amber-200">{openInfo}</span>
            {info.meta && (
              <span className="font-mono text-xs text-amber-400">{info.meta}</span>
            )}
            <span className="ml-auto text-[10px] uppercase tracking-wider text-stone-600">
              {info.section}
            </span>
          </div>
          {info.text && (
            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-300">
              {info.text}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
