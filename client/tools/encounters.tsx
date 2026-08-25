// The 'encounters' tool — prepared fights (§13), ported from the old
// app's EncountersPanel (src/components/EncountersPanel.tsx).
//
// The recipe shrank with the data model. The old `Placement` carried
// per-foe overrides (a health max, starting tags) because each foe was
// its OWN entity row from the moment it was prepped. Deploying an
// encounter in core-next stamps THIN (`Session.deployEncounter`,
// `core/stamp.ts`) — a foe is a template reference plus a count until
// the table drops it on. Overriding a deployed foe's Health is the
// roster/entity panel's job now, not this one's.
//
// What did NOT shrink is WHERE a foe starts: a fight staged on a map
// writes `u`/`v` per foe and whether it's waiting out of sight, and
// deploying puts those tokens on that board. The STAGING is here now
// (TEL-112) — the card names the fight's map and opens the workshop in
// its arranging mode, which is the old app's grammar carried over
// whole (`SceneEditor`'s `placements`/`arrangingId`, now
// `BoardEditor`'s `staged`).
//
// Card and section grammar kept verbatim from the old panel: a list of
// encounter cards, one expanded at a time, deploy/delete per card, an
// add-a-foe row with a count stepper. Looking a foe up before adding
// it opens the same kind of dialog the old CreatureSheet did —
// `TemplateSheet`, this port's equivalent now that a "printing" is
// just a `Template`.

import { useEffect, useState } from 'react';
import { registerTool } from './index.ts';
import type { Template } from '../../core/stamp.ts';
import {
  api,
  boards as fetchBoards,
  fileUrl,
  patchBoard,
  type Board,
  type DisplayInfo,
} from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';
import { TemplateSheet } from '../components/encounters/TemplateSheet.tsx';
import {
  BoardEditor,
  type RosterRow,
  type StagedFoe,
} from '../components/board/BoardEditor.tsx';
import type { BoardState } from '../components/board/model.ts';

/** One foe as the recipe writes it down — `server/session.ts` is the twin. */
type EncounterFoe = {
  templateId: string;
  name?: string;
  count?: number;
  /** Map space (docs/BATTLEMAP.md), when the fight was staged on a board. */
  u?: number;
  v?: number;
  /** Waiting behind the screen — flows to the token deploy places. */
  hidden?: boolean;
};
type EncounterTemplate = {
  id: string;
  name: string;
  /**
   * The map this fight was staged on. Load-bearing rather than a label:
   * `u`/`v` are THAT picture's coordinates and nobody else's, so
   * deploying aims the table at this board before it places anything
   * (`Session.deployEncounter`). Absent is the mapless fight, which is
   * the ordinary case and not a degraded one.
   */
  boardId?: string | null;
  foes: EncounterFoe[];
  notes?: string;
};

/**
 * The recipe as CHIPS — one per creature that will stand on the map.
 *
 * The recipe compresses (`count: 3`); the map cannot, because three
 * watchers want three squares. So staging expands, and the chip's name
 * is spelled the way `Session.deployEncounter` will spell it, since a
 * ghost labelled differently from the token it becomes is a ghost
 * nobody can match up mid-fight.
 */
function chipsOf(foes: EncounterFoe[], byId: Map<string, Template>): StagedFoe[] {
  const out: StagedFoe[] = [];
  foes.forEach((foe, i) => {
    const n = Math.max(1, Math.floor(foe.count ?? 1));
    const base = foe.name?.trim() || byId.get(foe.templateId)?.name || 'foe';
    for (let k = 1; k <= n; k += 1) {
      out.push({
        key: `${i}:${k}`,
        name: n > 1 ? `${base} ${k}` : base,
        ...(foe.u === undefined ? {} : { u: foe.u }),
        ...(foe.v === undefined ? {} : { v: foe.v }),
        ...(foe.hidden ? { hidden: true } : {}),
      });
    }
  });
  return out;
}

/**
 * And back — chips to recipe.
 *
 * A count-N row survives as one row for as long as its chips agree; the
 * moment they DON'T (one watcher on the ridge, two at the ford) it
 * splits into N rows of one, each carrying the expanded name so deploy
 * still stamps "Bark Watcher 1..3" exactly as before. Splitting only
 * when the map forces it keeps the count stepper meaningful on every
 * fight that never needed spreading out.
 */
function foesOf(chips: StagedFoe[], foes: EncounterFoe[]): EncounterFoe[] {
  const out: EncounterFoe[] = [];
  foes.forEach((foe, i) => {
    const mine = chips.filter((c) => c.key.startsWith(`${i}:`));
    if (!mine.length) return void out.push(foe);
    const spot = (c: StagedFoe) => JSON.stringify([c.u ?? null, c.v ?? null, c.hidden ?? false]);
    const agreed = mine.every((c) => spot(c) === spot(mine[0]));
    if (agreed) {
      const { u, v, hidden } = mine[0];
      out.push({
        ...foe,
        ...(u === undefined ? { u: undefined } : { u }),
        ...(v === undefined ? { v: undefined } : { v }),
        hidden: hidden || undefined,
      });
      return;
    }
    for (const c of mine) {
      out.push({
        templateId: foe.templateId,
        name: c.name,
        count: 1,
        ...(c.u === undefined ? {} : { u: c.u }),
        ...(c.v === undefined ? {} : { v: c.v }),
        ...(c.hidden ? { hidden: true } : {}),
      });
    }
  });
  return out;
}

/** Has this fight been arranged at all — the question the board picker asks. */
function anyStaged(foes: EncounterFoe[]): boolean {
  return foes.some((f) => f.u !== undefined || f.v !== undefined);
}

/** Everything a fight wrote down about WHERE, taken back off it. */
function unstaged(foes: EncounterFoe[]): EncounterFoe[] {
  return foes.map(({ u: _u, v: _v, hidden: _h, ...rest }) => rest);
}

function foeLabel(foe: EncounterFoe, template: Template | undefined): string {
  return foe.name?.trim() || template?.name || 'missing foe';
}

/** What a foe this host can't stamp is called — the recipe's own word, else its id. */
function nameOf(missing: { templateId: string; name?: string }): string {
  return missing.name?.trim() || missing.templateId;
}

/** "a", "a and b", "a, b and c" — a sentence, because the status line is one. */
function listed(names: string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function FoeRow({
  foe,
  template,
  onChange,
  onRemove,
  onView,
}: {
  foe: EncounterFoe;
  template: Template | undefined;
  onChange: (patch: Partial<EncounterFoe>) => void;
  onRemove: () => void;
  onView: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
      <button
        className="min-w-0 flex-1 truncate text-left text-sm text-stone-100 disabled:cursor-default"
        onClick={onView}
        disabled={!template}
        title={template ? 'see the whole printing' : undefined}
      >
        {foeLabel(foe, template)}
        {!template && (
          <span className="ml-2 font-mono text-[11px] text-amber-500/80">not on this host</span>
        )}
      </button>
      <input
        className={`${input} w-16 text-right font-mono text-xs`}
        type="number"
        min={1}
        value={foe.count ?? 1}
        onChange={(e) => onChange({ count: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
        aria-label={`how many ${foeLabel(foe, template)}`}
      />
      <input
        className={`${input} w-32 text-xs`}
        placeholder={template?.name ?? 'name override'}
        defaultValue={foe.name ?? ''}
        onBlur={(e) => onChange({ name: e.target.value.trim() || undefined })}
        aria-label="name override"
      />
      <button className={`${btnGhost} hover:text-red-300`} onClick={onRemove} aria-label="remove">
        ✕
      </button>
    </li>
  );
}

/**
 * The workshop, opened FROM a fight.
 *
 * The old app reached this the other way round — you opened a map and
 * turned on "arrange", picking the fight from a list of the ones that
 * named this map. Current grammar reverses it, because the fight is now
 * the thing you were already looking at and the board is one of its
 * facts: the card opens the editor already scoped to this encounter,
 * and the rail's ♟ turns the ghosts OFF rather than on. Everything past
 * that door is the old grammar unchanged — chips for the unplaced, drag
 * to move, an inspector that hides one or takes it off the map.
 *
 * It mounts its own copy of what the boards tool feeds the editor
 * rather than reaching across for one: a fight arranged from here is a
 * whole trip, and borrowing another tool's fetches would make the two
 * cards a pair that has to be open together.
 */
function StageOnBoard({
  fight,
  boardId,
  byId,
  onSave,
  onClose,
}: {
  fight: EncounterTemplate;
  boardId: string;
  byId: Map<string, Template>;
  onSave: (next: EncounterTemplate) => void;
  onClose: () => void;
}) {
  const { data: boards, reload: reloadBoards } = useLive(fetchBoards, [], {
    on: ['boards', 'board'],
  });
  const { data: roster } = useLive(() => api<RosterRow[]>('/api/entities'), [], {
    on: ['entities'],
  });
  const { data: displays } = useLive(() => api<DisplayInfo[]>('/api/displays'), [], {
    on: ['displays', 'assign'],
  });
  const { data: state, reload: reloadState } = useLive(
    () => api<BoardState | null>(`/api/board-state/${boardId}`),
    [boardId],
    { on: ['boards', 'board'] },
  );
  const { data: turn } = useLive(() => api<{ turn: number | null }>('/api/turn'), [], {
    on: ['turn'],
  });
  const [mapUrl, setMapUrl] = useState<string | null>(null);

  const board = (boards ?? []).find((b) => b.id === boardId) ?? null;
  useEffect(() => {
    if (!board) return;
    let live = true;
    fileUrl(board.key)
      .then((u) => live && setMapUrl(u))
      .catch(() => live && setMapUrl(null));
    return () => void (live = false);
  }, [board?.key]);

  if (!boards || !roster) return null;
  // The board went off the shelf while the card was open. Say so and
  // get out — an editor with no map underneath is a blank canvas that
  // silently eats placements.
  if (!board) {
    onClose();
    return null;
  }

  const table = (displays ?? []).find((d) => d.role === 'table');
  const foes = fight.foes ?? [];

  return (
    <BoardEditor
      board={board as Board}
      state={state ?? {}}
      roster={roster}
      mapUrl={mapUrl}
      live={false}
      ppi={table?.ppi}
      ppiY={table?.ppiY}
      tableViewport={table?.viewport}
      combatRunning={turn?.turn !== null && turn?.turn !== undefined}
      staged={chipsOf(foes, byId)}
      stagedFight={fight.name}
      onStaged={(chips) => onSave({ ...fight, foes: foesOf(chips, foes) })}
      onState={(next) => {
        api(`/api/board-state/${board.id}`, { method: 'PUT', body: { data: next } })
          .then(reloadState)
          .catch(() => reloadState());
      }}
      onBoard={(patch) => {
        patchBoard(board.id, patch).then(reloadBoards).catch(reloadBoards);
      }}
      onClose={onClose}
    />
  );
}

function EncounterCard({
  encounter,
  bestiary,
  boards,
  byId,
  expanded,
  onToggle,
  onSave,
  onDeploy,
  onDelete,
  busy,
  status,
}: {
  encounter: EncounterTemplate;
  bestiary: Template[];
  boards: Board[];
  byId: Map<string, Template>;
  expanded: boolean;
  onToggle: () => void;
  onSave: (next: EncounterTemplate) => void;
  onDeploy: () => void;
  onDelete: () => void;
  busy: boolean;
  status?: string;
}) {
  const [adding, setAdding] = useState('');
  const [count, setCount] = useState(1);
  const [viewing, setViewing] = useState<Template | null>(null);
  const [staging, setStaging] = useState(false);
  const use = useLive(() => api<{ costCounter?: string }>('/api/stack/record/use'), [], {
    on: ['plugins'],
  });

  const foes = encounter.foes ?? [];
  const patch = (next: Partial<EncounterTemplate>) => onSave({ ...encounter, ...next });
  const foeCount = foes.reduce((n, f) => n + (f.count ?? 1), 0);
  const board = boards.find((b) => b.id === encounter.boardId) ?? null;
  // A named board this host hasn't got is the deploy's loud refusal,
  // said a week earlier and where it can still be fixed.
  const lostBoard = Boolean(encounter.boardId && !board);

  /**
   * Change the map under a fight that was already arranged on the old
   * one. The coordinates are picture-relative, so they mean something
   * on the new map only if it is the same art — a re-export at a higher
   * resolution, which is a real and ordinary thing. So it ASKS instead
   * of guessing, and either answer is legitimate (rule 1: the DM's
   * answer beats whatever teller would have worked out).
   */
  const pickBoard = (next: string) => {
    const boardId = next || null;
    if (!anyStaged(foes) || boardId === (encounter.boardId ?? null)) {
      patch({ boardId });
      return;
    }
    const keep = window.confirm(
      `"${encounter.name}" was arranged on ${board?.name ?? 'another map'}, and those positions ` +
        `are that picture's coordinates.\n\nOK — keep them (right if the new map is the same ` +
        `art).\nCancel — clear them and arrange the fight again.`,
    );
    patch({ boardId, ...(keep ? {} : { foes: unstaged(foes) }) });
  };

  return (
    <li className="rounded-md border border-stone-800">
      <div className="flex items-center gap-2 p-2">
        <button className="min-w-0 flex-1 truncate text-left" onClick={onToggle}>
          <span className="text-sm text-stone-100">{encounter.name}</span>
          <span className="ml-2 font-mono text-[11px] text-stone-600">
            {foeCount} foe{foeCount === 1 ? '' : 's'}
          </span>
          {/* WHICH MAP, by name — an id here would be a fact nobody at
              the table can read, and this one decides where the fight
              lands. */}
          {board && <span className="ml-2 font-mono text-[11px] text-stone-500">on {board.name}</span>}
          {lostBoard && (
            <span className="ml-2 font-mono text-[11px] text-amber-500/80">
              its map isn't on this host
            </span>
          )}
        </button>
        <button className={btnPrimary} disabled={busy || !foes.length} onClick={onDeploy}>
          deploy
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-stone-800 p-2">
          <input
            className={`${input} w-full`}
            defaultValue={encounter.name}
            onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value.trim() })}
            aria-label="encounter name"
          />

          {/* The map, and the way onto it. Mapless stays one click away
              and costs nothing: most fights happen on a mat or in
              description, and this row must never read as a step you
              have to complete. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">
              map
            </span>
            <select
              className={`${input} min-w-0 flex-1 text-xs`}
              value={encounter.boardId ?? ''}
              onChange={(e) => pickBoard(e.target.value)}
              aria-label="which map this fight is on"
            >
              <option value="">no map — just bring me the foes</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              {lostBoard && (
                <option value={encounter.boardId ?? ''}>
                  {encounter.boardId} — not on this host
                </option>
              )}
            </select>
            <button
              className={btn}
              disabled={!board || !foes.length}
              onClick={() => setStaging(true)}
              title={
                board
                  ? `arrange this fight on ${board.name}`
                  : 'give the fight a map first'
              }
            >
              stage on map
            </button>
          </div>

          <ul className="space-y-1">
            {foes.map((foe, i) => (
              <FoeRow
                key={i}
                foe={foe}
                template={byId.get(foe.templateId)}
                onChange={(p) => patch({ foes: foes.map((f, j) => (j === i ? { ...f, ...p } : f)) })}
                onRemove={() => patch({ foes: foes.filter((_, j) => j !== i) })}
                onView={() => {
                  const t = byId.get(foe.templateId);
                  if (t) setViewing(t);
                }}
              />
            ))}
            {foes.length === 0 && (
              <li className="text-sm text-stone-600">no foes yet — add one below</li>
            )}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${input} min-w-0 flex-1 text-xs`}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            >
              <option value="">add a foe…</option>
              {bestiary.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="flex items-center gap-1 rounded-md bg-stone-900 px-1">
              <button className={btnGhost} onClick={() => setCount((n) => Math.max(1, n - 1))} aria-label="fewer">
                −
              </button>
              <span className="w-7 text-center font-mono text-sm text-stone-300">×{count}</span>
              <button className={btnGhost} onClick={() => setCount((n) => Math.min(20, n + 1))} aria-label="more">
                +
              </button>
            </span>
            <button
              className={btn}
              disabled={!adding}
              onClick={() => {
                patch({ foes: [...foes, { templateId: adding, count }] });
                setAdding('');
                setCount(1);
              }}
            >
              add
            </button>
          </div>

          <textarea
            className={`${input} min-h-16 w-full resize-y text-xs`}
            placeholder="notes — how it starts, what they want, when they flee"
            defaultValue={encounter.notes ?? ''}
            onBlur={(e) => patch({ notes: e.target.value || undefined })}
          />

          <div className="flex items-center gap-2">
            {status && <p className="font-mono text-xs text-amber-400">{status}</p>}
            <button className={`${btnGhost} ml-auto text-[11px] hover:text-red-300`} onClick={onDelete}>
              delete this encounter
            </button>
          </div>
        </div>
      )}

      {staging && board && (
        <StageOnBoard
          fight={encounter}
          boardId={board.id}
          byId={byId}
          onSave={onSave}
          onClose={() => setStaging(false)}
        />
      )}

      {viewing && (
        <TemplateSheet
          template={viewing}
          costCounter={use.data?.costCounter}
          onClose={() => setViewing(null)}
          actions={
            <button
              className={btn}
              onClick={() => {
                patch({ foes: [...foes, { templateId: viewing.id, count: 1 }] });
                setViewing(null);
              }}
            >
              add to this encounter
            </button>
          }
        />
      )}
    </li>
  );
}

function EncountersTool() {
  const { data: encounters, reload: reloadEncounters } = useLive(
    () => api<EncounterTemplate[]>('/api/templates/encounters'),
    [],
    { on: ['templates'] },
  );
  const { data: bestiary } = useLive(() => api<Template[]>('/api/stack/templates/bestiary'), [], {
    on: ['templates'],
  });
  // The same shelf list the boards tool reads, for the same reason: a
  // fight names its map by id and a person picks it by name.
  const { data: boards } = useLive(fetchBoards, [], { on: ['boards', 'board'] });
  const [open, setOpen] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  if (!encounters || !bestiary || !boards) return null;

  const byId = new Map(bestiary.map((t) => [t.id, t]));

  const save = async (next: EncounterTemplate) => {
    await api('/api/templates/encounters', { method: 'POST', body: { template: next } });
    reloadEncounters();
  };

  const create = async () => {
    const made = await api<{ id: string }>('/api/templates/encounters', {
      method: 'POST',
      body: { template: { name: `Encounter ${encounters.length + 1}`, foes: [] } },
    });
    reloadEncounters();
    setOpen(made.id);
  };

  const deploy = async (enc: EncounterTemplate) => {
    setBusyId(enc.id);
    try {
      const out = await api<{
        deployed?: { id: string; name: string }[];
        placed?: number;
        unplaced?: string;
        cleared?: number;
        missing?: { templateId: string; name?: string }[];
      }>(`/api/encounters/${enc.id}/deploy`, { method: 'POST' });
      // Where they went is half the answer, and the half that goes
      // wrong quietly: a staged fight that placed nothing says why.
      const joined = `${out.deployed?.length ?? 0} joined the order`;
      const onMap = out.unplaced
        ? ` — ${out.unplaced}`
        : out.placed
          ? `, ${out.placed} on the board`
          : '';
      // Deploying again is a reset, so say what it took away — a roster
      // that silently doubled is what this line exists to make visible.
      const again = out.cleared ? `, the last ${out.cleared} cleared` : '';
      // And a foe this host can't stamp is NAMED. Silence here read as
      // "the fight is fine" and the Warden found out mid-combat.
      const absent = out.missing ?? [];
      const gone = absent.length
        ? absent.length > 1
          ? ` — ${listed(absent.map(nameOf))} aren't on this host: their packs aren't installed`
          : ` — ${nameOf(absent[0])} isn't on this host: its pack isn't installed`
        : '';
      setStatus((s) => ({ ...s, [enc.id]: `${joined}${again}${onMap}${gone}` }));
    } catch (e) {
      setStatus((s) => ({ ...s, [enc.id]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (enc: EncounterTemplate) => {
    if (!window.confirm(`Delete "${enc.name}"?`)) return;
    await api(`/api/templates/encounters/${enc.id}`, { method: 'DELETE' });
    if (open === enc.id) setOpen(null);
    reloadEncounters();
  };

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Prepared fights</span>
        <button className={btnGhost} onClick={create}>
          new encounter
        </button>
      </div>

      {encounters.length === 0 && (
        <p className="text-sm text-stone-600">
          nothing prepared — an encounter is who's in a fight, ready to drop on the table
        </p>
      )}

      <ul className="space-y-2">
        {encounters.map((enc) => (
          <EncounterCard
            key={enc.id}
            encounter={enc}
            bestiary={bestiary}
            boards={boards}
            byId={byId}
            expanded={open === enc.id}
            onToggle={() => setOpen(open === enc.id ? null : enc.id)}
            onSave={save}
            onDeploy={() => deploy(enc)}
            onDelete={() => remove(enc)}
            busy={busyId === enc.id}
            status={status[enc.id]}
          />
        ))}
      </ul>
    </section>
  );
}

registerTool('encounters', () => <EncountersTool />);
