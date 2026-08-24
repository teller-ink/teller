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
// deploying puts those tokens on the active board. This panel doesn't
// stage yet (the board editor does the staging), but the type says so —
// it used to declare a narrower recipe than the one on disk, and a
// panel that saved a foe through this shape dropped its position.
//
// Card and section grammar kept verbatim from the old panel: a list of
// encounter cards, one expanded at a time, deploy/delete per card, an
// add-a-foe row with a count stepper. Looking a foe up before adding
// it opens the same kind of dialog the old CreatureSheet did —
// `TemplateSheet`, this port's equivalent now that a "printing" is
// just a `Template`.

import { useState } from 'react';
import { registerTool } from './index.ts';
import type { Template } from '../../core/stamp.ts';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';
import { TemplateSheet } from '../components/encounters/TemplateSheet.tsx';

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
  foes: EncounterFoe[];
  notes?: string;
};

function foeLabel(foe: EncounterFoe, template: Template | undefined): string {
  return foe.name?.trim() || template?.name || 'missing foe';
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

function EncounterCard({
  encounter,
  bestiary,
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
  const use = useLive(() => api<{ costCounter?: string }>('/api/stack/record/use'), [], {
    on: ['plugins'],
  });

  const foes = encounter.foes ?? [];
  const patch = (next: Partial<EncounterTemplate>) => onSave({ ...encounter, ...next });
  const foeCount = foes.reduce((n, f) => n + (f.count ?? 1), 0);

  return (
    <li className="rounded-md border border-stone-800">
      <div className="flex items-center gap-2 p-2">
        <button className="min-w-0 flex-1 truncate text-left" onClick={onToggle}>
          <span className="text-sm text-stone-100">{encounter.name}</span>
          <span className="ml-2 font-mono text-[11px] text-stone-600">
            {foeCount} foe{foeCount === 1 ? '' : 's'}
          </span>
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
  const [open, setOpen] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  if (!encounters || !bestiary) return null;

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
      }>(`/api/encounters/${enc.id}/deploy`, { method: 'POST' });
      // Where they went is half the answer, and the half that goes
      // wrong quietly: a staged fight that placed nothing says why.
      const joined = `${out.deployed?.length ?? 0} joined the order`;
      const onMap = out.unplaced
        ? ` — ${out.unplaced}`
        : out.placed
          ? `, ${out.placed} on the board`
          : '';
      setStatus((s) => ({ ...s, [enc.id]: `${joined}${onMap}` }));
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
