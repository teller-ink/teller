// Opening a .story — pick the file, LOOK IN THE BOX, then choose a door.
//
// The inspect step is not politeness: "you don't have the Guidebook" is
// something you want while deciding whether to import, not after an
// encounter deploys half-empty at the table. Nothing is applied until
// one of the two buttons is pressed.
//
// The two doors are genuinely different operations (TEL-87), so they
// are two buttons and never a mode switch:
//
//   start it fresh — a NEW campaign, stamped whole, history and all.
//   add it to this table — a merge, where the stored value wins every
//     collision (rule 1) and the report says what was left alone.
//
// `canLayer` is what a caller says about itself: the campaign screen
// exists BEFORE a campaign resolves, so it offers only the first door.

import { useState } from 'react';
import {
  campaignFromStory,
  importStory,
  inspectStory,
  type ImportReport,
  type StorySummary,
} from '../../lib/api.ts';
import { btn, btnGhost, btnPrimary, input, sectionLabel } from '../../lib/ui.ts';

export function ImportStory({
  canLayer,
  onClose,
  onImported,
}: {
  /** Whether there is a table to layer ONTO — a bare host has none. */
  canLayer: boolean;
  onClose: () => void;
  /** Something changed: reload whatever the caller is showing. */
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [looked, setLooked] = useState<StorySummary | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [report, setReport] = useState<(ImportReport & { what: string }) | null>(null);

  const pick = (chosen: File | null) => {
    setFile(chosen);
    setLooked(null);
    setReport(null);
    setErr('');
    if (!chosen) return;
    setBusy(true);
    inspectStory(chosen)
      .then((out) => {
        setLooked(out);
        setName(out.manifest.name);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const run = (what: 'fresh' | 'layer') => {
    if (!file) return;
    setBusy(true);
    setErr('');
    const call =
      what === 'fresh'
        ? campaignFromStory(file, name)
        : importStory(file);
    call
      .then((out) => {
        setReport({ ...out, what: what === 'fresh' ? 'started it fresh' : 'added it to this table' });
        onImported();
      })
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
          <h2 className="font-serif text-2xl text-amber-50">Open a .story</h2>
          <button className={`${btnGhost} ml-auto`} onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="flex flex-wrap items-center gap-2">
            <span className={sectionLabel}>the file</span>
            <input
              type="file"
              accept=".story,.tell,application/zip"
              className="min-w-0 flex-1 text-sm text-stone-400 file:mr-3 file:rounded-md file:border-0 file:bg-stone-800 file:px-3 file:py-1.5 file:text-sm file:text-stone-200"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
          </label>

          {busy && !looked && <p className="text-sm text-stone-500">looking inside…</p>}
          {err && <p className="text-sm text-red-500">{err}</p>}

          {looked && !report && (
            <div className="space-y-3 rounded-md bg-stone-950/60 p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-serif text-xl text-stone-100">{looked.manifest.name}</span>
                <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-stone-400">
                  {looked.kind}
                </span>
                <span className="font-mono text-[11px] text-stone-600">
                  v{looked.manifest.version} · {looked.manifest.rights.basis}
                </span>
              </div>
              <ul className="space-y-0.5">
                {looked.sections.map((s) => (
                  <li key={s.name} className="text-sm text-stone-300">
                    <span className="font-mono text-amber-300">{s.count}</span> {s.label}
                  </li>
                ))}
                {looked.sections.length === 0 && (
                  <li className="text-sm text-stone-600">nothing in it</li>
                )}
              </ul>
              {looked.missing.length > 0 && (
                <div className="space-y-0.5">
                  <p className="text-[11px] text-amber-500/80">
                    you don’t have these — they’ll be reported, never dropped:
                  </p>
                  {looked.missing.map((m, i) => (
                    <p key={i} className="font-mono text-[11px] text-amber-500/80">
                      {m.slot}: {m.ref.name} ({m.ref.id})
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {looked && !report && (
            <div className="space-y-2">
              <span className={sectionLabel}>Start it fresh</span>
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${input} min-w-0 flex-1`}
                  placeholder="what’s it called?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className={btnPrimary} disabled={busy} onClick={() => run('fresh')}>
                  start it fresh
                </button>
              </div>
              <p className="text-[11px] text-stone-600">
                a new campaign, stamped whole — history and all — and this host plays it.
                what you call your table is yours to decide.
              </p>
              {canLayer && (
                <>
                  <div className="pt-2">
                    <span className={sectionLabel}>Or add it to what’s running</span>
                  </div>
                  <button className={btn} disabled={busy} onClick={() => run('layer')}>
                    add it to this table
                  </button>
                  <p className="text-[11px] text-stone-600">
                    a merge, not a replacement: anything you already have wins, and the
                    report says what was left alone. history stays with the table that
                    lived it.
                  </p>
                </>
              )}
            </div>
          )}

          {report && (
            <div className="space-y-1 rounded-md bg-stone-950/60 p-3">
              <p className="text-sm text-stone-200">{report.what}.</p>
              {report.applied.map((s, i) => (
                <p key={`a${i}`} className="text-[11px] text-stone-400">
                  brought in: {s}
                </p>
              ))}
              {report.skipped.map((s, i) => (
                <p key={`s${i}`} className="text-[11px] text-stone-500">
                  left alone: {s}
                </p>
              ))}
              {report.missing.map((m, i) => (
                <p key={`m${i}`} className="font-mono text-[11px] text-amber-500/80">
                  missing {m.slot}: {m.ref.name} ({m.ref.id})
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-800 px-5 py-3">
          <button className={btnGhost} onClick={onClose}>
            {report ? 'done' : 'never mind'}
          </button>
        </div>
      </div>
    </div>
  );
}
