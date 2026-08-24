// "Save this campaign as a .story" — the export dialog.
//
// This is the BACKUP, and the dialog says so: once the campaign lives
// on a host under your table there is no cloud copy, and a dead drive
// is a dead campaign unless you've written one of these (rule 9). So
// the default is everything, and the second preset exists for the
// other job entirely — handing somebody a starting point, which is the
// same file with the history left off.
//
// The per-section switches sit under the presets rather than instead of
// them, because the question a person actually has is "a backup or a
// gift?", and only then "…and not the undo snapshots". Two of them
// carry a weight marker, since those two are the difference between a
// 20 KB file and a 7 MB one.

import { useState } from 'react';
import {
  exportStory,
  storyIdentity,
  type Rights,
  type StorySections,
} from '../../lib/api.ts';
import { useLive } from '../../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, input, sectionLabel } from '../../lib/ui.ts';

const ALL: StorySections = {
  templates: true,
  entities: true,
  turn: true,
  boards: true,
  assets: true,
  events: true,
  undo: true,
};

/** What each switch is, in the words a DM would use for it. */
const SECTIONS: {
  name: keyof StorySections;
  label: string;
  about: string;
  heft?: string;
}[] = [
  { name: 'templates', label: 'what you wrote', about: 'bestiary, encounters, handouts, statuses' },
  { name: 'entities', label: 'what’s in play', about: 'the roster, the foes, their live counters' },
  { name: 'turn', label: 'the fight in progress', about: 'whose turn it is, and the order' },
  { name: 'boards', label: 'the boards', about: 'maps, placements, fog and view' },
  { name: 'assets', label: 'the pictures', about: 'handout art and board images', heft: 'heavy' },
  { name: 'events', label: 'the history', about: 'everything that happened at this table' },
  {
    name: 'undo',
    label: 'the undo snapshots',
    about: 'only means anything on this host — undoing past an import restores a table that isn’t here',
    heft: 'heavy',
  },
];

const BASES: { value: Rights['basis']; label: string; about: string }[] = [
  { value: 'personal', label: 'personal', about: 'yours, built from books you own — goes to nobody' },
  { value: 'homebrew', label: 'homebrew', about: 'all your own writing — yours to hand out freely' },
  { value: 'licensed', label: 'licensed', about: 'a rightsholder’s, or someone they authorized' },
];

export function ExportStory({ onClose }: { onClose: () => void }) {
  const held = useLive(() => storyIdentity(), [], { on: [] });
  const [sections, setSections] = useState<StorySections>({ ...ALL });
  const [basis, setBasis] = useState<Rights['basis'] | ''>('');
  // `null` is UNTOUCHED, and empty string is a deliberate clearing —
  // the two are different answers, and collapsing them would make a
  // remembered holder impossible to remove.
  const [holder, setHolder] = useState<string | null>(null);
  const [terms, setTerms] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ filename: string; skipped: string[] } | null>(null);

  // Prefilled from what the campaign remembers, and only once — a
  // declaration is stated once and then kept (`toRights`), so an
  // untouched dialog re-states the same thing.
  const remembered = held.data?.identity?.rights;
  const heldHolder = holder ?? remembered?.holder ?? '';
  const heldTerms = terms ?? remembered?.terms ?? '';
  const shown: Rights = {
    basis: (basis || remembered?.basis || 'personal') as Rights['basis'],
    ...(heldHolder.trim() ? { holder: heldHolder.trim() } : {}),
    ...(heldTerms.trim() ? { terms: heldTerms.trim() } : {}),
  };

  const preset = (kind: 'everything' | 'starting-point') =>
    setSections(
      kind === 'everything' ? { ...ALL } : { ...ALL, events: false, undo: false },
    );
  const isEverything = SECTIONS.every((s) => sections[s.name]);
  const isStartingPoint = !sections.events && !sections.undo &&
    SECTIONS.filter((s) => s.name !== 'events' && s.name !== 'undo').every((s) => sections[s.name]);

  const save = () => {
    setBusy(true);
    setErr('');
    exportStory({ sections, rights: shown })
      .then((out) => setDone(out))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-950/80 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-stone-800 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-baseline gap-2 border-b border-stone-800 px-5 py-4">
          <h2 className="font-serif text-2xl text-amber-50">
            Save “{held.data?.name ?? 'this campaign'}” as a .story
          </h2>
          {held.data?.identity && (
            <span className="font-mono text-[11px] text-stone-600">
              v{held.data.identity.version} written
            </span>
          )}
          <button className={`${btnGhost} ml-auto`} onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-[11px] text-stone-500">
            this is the backup. packs and books are referenced, not carried — back up
            the data dir’s packs alongside it.
          </p>

          <div className="space-y-2">
            <span className={sectionLabel}>What for</span>
            <div className="flex flex-wrap gap-2">
              <button
                className={isEverything ? btnPrimary : btn}
                onClick={() => preset('everything')}
              >
                everything (a backup)
              </button>
              <button
                className={isStartingPoint ? btnPrimary : btn}
                onClick={() => preset('starting-point')}
              >
                a starting point (no history)
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <span className={sectionLabel}>What goes in</span>
            <ul className="space-y-1">
              {SECTIONS.map((s) => (
                <li key={s.name}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md bg-stone-950/40 px-2 py-1.5">
                    <input
                      type="checkbox"
                      className="mt-1 accent-amber-700"
                      checked={sections[s.name]}
                      onChange={(e) =>
                        setSections((was) => {
                          const next = { ...was, [s.name]: e.target.checked };
                          // The snapshots annotate the log; keeping the
                          // heavy half of a thing you dropped is nonsense.
                          if (!next.events) next.undo = false;
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-sm text-stone-100">{s.label}</span>
                      {s.heft && (
                        <span className="ml-2 rounded bg-stone-800 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-500/80">
                          {s.heft}
                        </span>
                      )}
                      <span className="block text-[11px] text-stone-600">{s.about}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <span className={sectionLabel}>Who may hand this on</span>
            <div className="flex flex-wrap gap-2">
              {BASES.map((b) => (
                <button
                  key={b.value}
                  className={shown.basis === b.value ? btnPrimary : btn}
                  title={b.about}
                  onClick={() => setBasis(b.value)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-stone-600">
              {BASES.find((b) => b.value === shown.basis)?.about}. declared, never
              verified — teller can’t check a claim about rights and never presents one
              as checked.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                className={`${input} min-w-0 flex-1`}
                placeholder="holder (optional)"
                value={heldHolder}
                onChange={(e) => setHolder(e.target.value)}
              />
              <input
                className={`${input} min-w-0 flex-1`}
                placeholder="terms (optional)"
                value={heldTerms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </div>
          </div>

          {err && <p className="text-sm text-red-500">{err}</p>}
          {done && (
            <div className="space-y-1 rounded-md bg-stone-950/60 p-3">
              <p className="text-sm text-stone-200">
                wrote <span className="font-mono text-amber-300">{done.filename}</span>
              </p>
              {done.skipped.map((s, i) => (
                <p key={i} className="text-[11px] text-amber-500/80">
                  left out: {s}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-800 px-5 py-3">
          <button className={btnGhost} onClick={onClose}>
            {done ? 'done' : 'never mind'}
          </button>
          <button className={btnPrimary} disabled={busy} onClick={save}>
            {busy ? 'writing…' : done ? 'write it again' : 'write the file'}
          </button>
        </div>
      </div>
    </div>
  );
}
