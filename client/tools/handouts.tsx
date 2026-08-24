// The 'handouts' tool — the gallery of pictures, and the desk you pass
// notes from. It sits between the screens and the boards (order 91),
// with the rest of the furniture about this host's own glass: what the
// frame is showing is a fact about the ROOM, and the pictures are files
// on this machine.
//
// Two halves, one screen, because they are one act at the table: the
// Warden holds up a WANTED poster for everyone, or slides the same
// poster to one player with a line of text on it. The verbs say which:
//
//   * SHOW THE TABLE writes `refs.handout` — one manifest ref, written
//     exactly the way the boards tool writes `refs.board`, and picked
//     up by the art frame over the stream. That control lives here and
//     not on the frame, because a passive surface never grows a button
//     (rule 6). Clearing it is its own affordance and not a second
//     press of the same one: "put the frame away" is a different
//     intention from "show this", and a toggle that turns showing into
//     hiding depending on state is how you blank the table by accident.
//   * PUT UP A NOTICE writes one line for the WHOLE ROOM, which is the
//     third act and the one the port had lost. It sits here because it
//     is the same desk: show everyone a picture, tell everyone a line,
//     or slide one person a scrap. Passive glass renders it and can
//     never take it down (rule 6) — clearing is a press on this screen.
//   * PASS TO… posts a note, which is delivered per-screen and reaches
//     nobody it wasn't addressed to (`server/notes.ts`). Passing to
//     NOBODY IN PARTICULAR is passing to the whole table — the same
//     act, wider — and that is what the button says.
//
// The recipients are the party: a note is passed to a person, and the
// foes on the roster are the DM's own props. Nothing stops the server
// taking any entity id; this list just doesn't offer the ones that
// would be strange.

import { useState } from 'react';
import { registerTool } from './index.ts';
import {
  api,
  deleteHandout,
  handouts,
  passedNotes,
  passNote,
  publicSnapshot,
  saveHandout,
  setNotice,
  showHandout,
  uploadHandout,
  type Handout,
  type PassedNote,
  type PublicSnapshot,
} from '../lib/api.ts';
import { useArtMap } from '../lib/art.ts';
import { PUBLIC, useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';

type RosterRow = { id: string; name: string; type?: string | null };

/**
 * The lines this table puts up often, as the merged stack declares
 * them — `notices`, a system-or-pack slot like any other.
 *
 * teller ships NONE, and that is the whole reason this is a
 * declaration and not an array in this file. The old app hardcoded four
 * buttons whose words belonged to one game; the kernel owns no
 * vocabulary (§M-2), so the chips arrive from the layer that has words
 * and a host with none simply gets the box you type in.
 */
function noticePresets(): Promise<string[]> {
  return api<unknown[]>('/api/stack/declarations/notices').then((raw) =>
    raw.flatMap((item) => {
      if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
      const text = (item as { text?: unknown; name?: unknown })?.text ??
        (item as { name?: unknown })?.name;
      return typeof text === 'string' && text.trim() ? [text.trim()] : [];
    }),
  );
}

/** A name for a file nobody bothered to name — 'wanted-poster.png' → 'wanted poster'. */
function nameFor(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'handout';
}

function when(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at;
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ms).toLocaleTimeString();
}

function HandoutsTool() {
  const { data: list, reload } = useLive(handouts, [], { on: ['templates'] });
  const { data: snapshot, reload: reloadActive } = useLive<PublicSnapshot>(publicSnapshot, [], {
    on: PUBLIC,
  });
  const { data: roster } = useLive(() => api<RosterRow[]>('/api/entities'), [], {
    on: ['entities'],
  });
  const { data: recent, reload: reloadNotes } = useLive(passedNotes, [], { on: ['notes'] });
  const { data: presets } = useLive(noticePresets, [], { on: ['plugins'] });

  // Every thumbnail's ticketed url in one pass — one hook however many
  // pictures the gallery grew (`client/lib/art.ts`).
  const thumbs = useArtMap(
    Object.fromEntries((list ?? []).map((h) => [h.id, h.key])),
  );

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  // The note being written. `attached` is a handout id or nothing — a
  // note may be words, a picture, or both, and never neither.
  const [text, setText] = useState('');
  const [attached, setAttached] = useState<string | null>(null);
  const [to, setTo] = useState<string[]>([]);

  /** The line being typed for the room. The one that's UP lives on the
   *  snapshot, so this box never has to be told what it already said. */
  const [notice, setNoticeDraft] = useState('');

  if (!list) return null;

  const activeId = snapshot?.handout?.id ?? null;
  const party = (roster ?? []).filter((r) => r.type !== 'foe');
  const names = new Map((roster ?? []).map((r) => [r.id, r.name]));

  const guard = (work: Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setProblem(undefined);
    work
      .then(() => after?.())
      .catch((err: Error) => setProblem(err.message))
      .finally(() => setBusy(false));
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    guard(
      uploadHandout(file).then(({ key }) => saveHandout({ name: nameFor(file.name), key })),
      reload,
    );
  };

  const rename = (handout: Handout) => {
    const name = draftName.trim();
    setRenaming(null);
    if (!name || name === handout.name) return;
    guard(saveHandout({ ...handout, name }), () => {
      reload();
      reloadActive();
    });
  };

  const pass = () => {
    guard(
      passNote({
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(attached ? { handoutId: attached } : {}),
        to,
      }),
      () => {
        setText('');
        setAttached(null);
        setTo([]);
        reloadNotes();
      },
    );
  };

  const showing = snapshot?.notice ?? null;
  const post = (words: string) => {
    setNoticeDraft(words);
    guard(setNotice(words), reloadActive);
  };

  const attachedName = list.find((h) => h.id === attached)?.name;
  const canPass = Boolean(text.trim() || attached);

  return (
    <div className="space-y-3">
      {problem && (
        <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {problem}
        </p>
      )}

      {/* THE ROOM'S LINE. First on the screen because it is the
          loudest thing here and the fastest to reach for — 'everybody
          take five' is typed mid-sentence, not hunted for. */}
      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between gap-3">
          <span className={sectionLabel}>Table notice</span>
          {showing && (
            <button className={btn} disabled={busy} onClick={() => post('')}>
              take it down
            </button>
          )}
        </div>

        {showing && (
          <p className="rounded-md bg-amber-800/80 px-3 py-2 text-center font-serif text-2xl text-stone-950">
            {showing.text}
          </p>
        )}

        {(presets ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(presets ?? []).map((preset) => (
              <button
                key={preset}
                className="rounded-full bg-stone-800 px-2.5 py-1 text-xs text-stone-300 transition-colors hover:bg-amber-800 hover:text-stone-50"
                disabled={busy}
                onClick={() => post(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            className={`${input} min-w-0 flex-1`}
            placeholder="a line for the whole room…"
            value={notice}
            onChange={(e) => setNoticeDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && notice.trim() && post(notice)}
          />
          <button className={btn} disabled={busy || !notice.trim()} onClick={() => post(notice)}>
            put it up
          </button>
        </div>
      </section>

      <section className={`${card} space-y-3`}>
        <div className="flex items-center justify-between gap-3">
          <span className={sectionLabel}>Handouts</span>
          <div className="flex items-center gap-2">
            {activeId && (
              <button className={btn} disabled={busy} onClick={() => guard(showHandout(null), reloadActive)}>
                clear the frame
              </button>
            )}
            <label className={`${btnPrimary} cursor-pointer`}>
              add a picture
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        {list.length === 0 && (
          <p className="text-sm text-stone-600">
            nothing in the gallery yet — a photograph of the map you drew counts
          </p>
        )}

        <ul className="space-y-2">
          {list.map((h) => (
            <li
              key={h.id}
              className={`flex items-center gap-3 rounded-md border px-2 py-2 ${
                activeId === h.id ? 'border-amber-700/70 bg-stone-800/60' : 'border-stone-800'
              }`}
            >
              <div className="h-14 w-20 shrink-0 overflow-hidden rounded bg-stone-950">
                {thumbs[h.id] && (
                  <img src={thumbs[h.id]} alt={h.name} className="h-full w-full object-cover" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                {renaming === h.id ? (
                  <input
                    autoFocus
                    className={`${input} w-full`}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => rename(h)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(h);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    className="block max-w-full truncate text-left text-sm text-stone-200 hover:text-stone-50"
                    onClick={() => {
                      setRenaming(h.id);
                      setDraftName(h.name);
                    }}
                  >
                    {h.name}
                  </button>
                )}
                {activeId === h.id && (
                  <span className="font-mono text-[11px] text-amber-500">on the frame</span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  className={btn}
                  disabled={busy || activeId === h.id}
                  onClick={() => guard(showHandout(h.id), reloadActive)}
                >
                  show the table
                </button>
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() => setAttached(attached === h.id ? null : h.id)}
                >
                  {attached === h.id ? 'attached' : 'pass to…'}
                </button>
                <button
                  className={btnGhost}
                  disabled={busy}
                  onClick={() => guard(deleteHandout(h.id), () => {
                    reload();
                    reloadActive();
                  })}
                >
                  remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${card} space-y-3`}>
        <span className={sectionLabel}>Pass a note</span>

        <textarea
          className={`${input} h-20 w-full resize-none`}
          placeholder="the barkeep leans in and says…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {attachedName && (
          <p className="flex items-center gap-2 text-sm text-stone-400">
            <span className="text-stone-500">with</span>
            <span className="text-stone-200">{attachedName}</span>
            <button className={btnGhost} onClick={() => setAttached(null)}>
              take it off
            </button>
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {party.map((p) => (
            <button
              key={p.id}
              onClick={() =>
                setTo((cur) =>
                  cur.includes(p.id) ? cur.filter((id) => id !== p.id) : [...cur, p.id],
                )
              }
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                to.includes(p.id)
                  ? 'bg-amber-700 text-stone-50'
                  : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-stone-500">
            {to.length === 0
              ? 'nobody picked — this goes to the whole table'
              : `to ${to.map((id) => names.get(id) ?? id).join(', ')}, and nobody else`}
          </span>
          <button className={btnPrimary} disabled={busy || !canPass} onClick={pass}>
            {to.length === 0 ? 'tell the table' : 'pass it'}
          </button>
        </div>
      </section>

      {recent && recent.length > 0 && (
        <section className={`${card} space-y-2`}>
          <span className={sectionLabel}>Passed</span>
          <ul className="space-y-1.5">
            {recent.map((n: PassedNote) => (
              <li key={n.id} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 text-stone-500">
                  {n.to.length ? n.to.map((id) => names.get(id) ?? id).join(', ') : 'the table'}
                </span>
                <span className="min-w-0 flex-1 truncate text-stone-300">
                  {n.text}
                  {n.handout && (
                    <span className="text-stone-500">
                      {n.text ? ' · ' : ''}
                      {n.handout.name}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-stone-600">{when(n.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

registerTool('handouts', () => <HandoutsTool />);
