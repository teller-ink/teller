// The 'boards' tool — the shelf of battlemaps, and the way onto one.
//
// Two halves, and the seam between them is §4. The LIST is the asset
// half: shelf rows carrying a picture, a physical width and a grid
// style, reusable across campaigns, added here and taken away here.
// Opening one drops into `BoardEditor`, which is the WORKSHOP — the
// fullscreen canvas where the fight is arranged, the ground is painted
// and the fog is shaped, all of it board STATE belonging to the
// campaign rather than to the board.
//
// It also carries the one control that aims the table: `show` writes
// `refs.board`, and the table TV picks the swap up over the stream.
// That control lives HERE and not on the table, because a passive
// surface never grows a button (rule 6) — everything the ground shows
// is decided from the console.

import { useState } from 'react';
import { registerTool } from './index.ts';
import {
  api,
  boards as fetchBoards,
  createBoard,
  deleteBoard,
  fileUrl,
  patchBoard,
  showBoard,
  uploadBoardImage,
  type Board,
  type DisplayInfo,
} from '../lib/api.ts';
import { PUBLIC, useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';
import { BoardEditor, type RosterRow } from '../components/board/BoardEditor.tsx';
import type { BoardState } from '../components/board/model.ts';

/** Only the half of the snapshot this tool asks about: which board the
 *  table is showing. Read live rather than off the loaded manifest — a
 *  board swap doesn't re-resolve the stack, so the manifest the console
 *  holds would answer with yesterday's scene. */
type ActiveBoard = { board: { board: { id: string } } | null };

function BoardsTool() {
  const { data: boards, reload: reloadBoards } = useLive(fetchBoards, [], {
    on: ['boards', 'board'],
  });
  const { data: roster } = useLive(() => api<RosterRow[]>('/api/entities'), [], {
    on: ['entities'],
  });
  const { data: displays } = useLive(() => api<DisplayInfo[]>('/api/displays'), [], {
    on: ['displays', 'assign'],
  });
  const { data: active, reload: reloadActive } = useLive(
    () => api<ActiveBoard>('/api/public'),
    [],
    { on: PUBLIC },
  );
  const { data: turn } = useLive(() => api<{ turn: number | null }>('/api/turn'), [], {
    on: ['turn'],
  });

  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const { data: state, reload: reloadState } = useLive(
    () => (openId ? api<BoardState | null>(`/api/board-state/${openId}`) : Promise.resolve(null)),
    [openId],
    { on: ['boards', 'board'] },
  );
  const [mapUrl, setMapUrl] = useState<string | null>(null);

  if (!boards || !roster) return null;

  const activeId = active?.board?.board.id ?? null;
  const open = boards.find((b) => b.id === openId) ?? null;

  // Whichever screen is the table — its calibration is what makes the
  // frame box in the editor mean anything, and without one the editor
  // simply doesn't draw one rather than drawing a guess.
  const table = (displays ?? []).find((d) => d.role === 'table');

  const show = async (id: string | null) => {
    await showBoard(id);
    reloadActive();
  };

  /**
   * Bytes first, row second. Two calls rather than one multipart door:
   * the picture is content-hashed on the way in, so a second board over
   * the same map — a lit version and a dark one — costs no second copy
   * and no second upload.
   */
  const addBoard = async (file: File) => {
    setError('');
    setBusy(`reading ${file.name}…`);
    try {
      const { key } = await uploadBoardImage(file);
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      const board = await createBoard({ key, name: name || 'new board' });
      reloadBoards();
      openBoard(board);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const openBoard = (board: Board) => {
    setOpenId(board.id);
    setMapUrl(null);
    fileUrl(board.key)
      .then(setMapUrl)
      .catch(() => setMapUrl(null));
  };

  const remove = async (board: Board) => {
    if (
      !window.confirm(
        `Delete "${board.name}"? Everything placed on it goes too${
          activeId === board.id ? ', and the table lets go of it' : ''
        }.`,
      )
    )
      return;
    await deleteBoard(board.id);
    if (openId === board.id) setOpenId(null);
    reloadBoards();
    reloadActive();
  };

  return (
    <div className="space-y-3">
      {open && (
        <BoardEditor
          board={open}
          state={state ?? {}}
          roster={roster}
          mapUrl={mapUrl}
          live={activeId === open.id}
          ppi={table?.ppi}
          ppiY={table?.ppiY}
          tableViewport={table?.viewport}
          combatRunning={turn?.turn !== null && turn?.turn !== undefined}
          onState={(next) => {
            api(`/api/board-state/${open.id}`, { method: 'PUT', body: { data: next } })
              .then(reloadState)
              .catch(() => reloadState());
          }}
          onBoard={(patch) => {
            patchBoard(open.id, patch).then(reloadBoards).catch(reloadBoards);
          }}
          onClose={() => setOpenId(null)}
        />
      )}

      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Boards</span>
          <span className="font-mono text-[11px] text-stone-600">{boards.length}</span>
        </div>
        {boards.length === 0 && <p className="text-sm text-stone-600">no boards on the shelf</p>}
        <ul className="space-y-1">
          {boards.map((b) => (
            <li key={b.id} className="flex items-center gap-2">
              <button
                className="min-w-0 flex-1 rounded-md bg-stone-900 px-2 py-1.5 text-left text-sm text-stone-200 transition-colors hover:bg-stone-800"
                onClick={() => openBoard(b)}
                title="open the workshop"
              >
                {b.name}
                {b.widthInches ? (
                  <span className="ml-2 font-mono text-[11px] text-stone-600">
                    {b.widthInches}"
                  </span>
                ) : (
                  <span className="ml-2 font-mono text-[11px] text-stone-700">no width</span>
                )}
                {activeId === b.id && (
                  <span className="ml-2 font-mono text-[11px] text-amber-500">on the table</span>
                )}
              </button>
              <button
                className={activeId === b.id ? btnGhost : btn}
                onClick={() => show(activeId === b.id ? null : b.id)}
              >
                {activeId === b.id ? 'clear' : 'show'}
              </button>
              <button
                className={`${btnGhost} hover:text-red-300`}
                onClick={() => remove(b)}
                aria-label={`delete ${b.name}`}
                title="take it off the shelf"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label className={`${btnPrimary} cursor-pointer`}>
            add a map
            <input
              className="hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) addBoard(file);
              }}
            />
          </label>
          {busy && <span className="text-xs text-stone-500">{busy}</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
        <p className="text-[11px] text-stone-600">
          Tell it how many inches wide the map really is, inside the workshop — that one
          number is what makes a drawn square a real inch on a calibrated table.
        </p>
      </section>
    </div>
  );
}

registerTool('boards', () => <BoardsTool />);
