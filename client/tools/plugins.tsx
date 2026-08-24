// The 'plugins' tool — everything this table runs that isn't the
// campaign's own data, grouped by TYPE and then by WHERE IT CAME FROM.
//
// It used to be four flat lists: the plugins on the shelf, panels
// awaiting enablement, system/pack code awaiting enablement, and code
// you'd trusted. That is the TRUST TABLE's shape — one row per grant,
// sorted by whether the grant had been made — and it answered the wrong
// question. A DM reading "sheet carries code" wants to know which
// book it arrived in, and that fact appeared nowhere on the screen; the
// same panel could be listed as pending on Monday and trusted on
// Tuesday, in two different cards, with nothing tying either to the
// Guidebook.
//
// So the four lists are gone, subsumed rather than duplicated: four
// TYPE headings (plugins · system · packs · panels, the shelf tab's
// SYSTEMS/PACKS/BOARDS grammar), containers as accordions inside them,
// and every action the old sections offered — enable a pending grant,
// revoke a made one — living inline on the row it belongs to. An
// orphan grant (an enabled id nothing on disk accounts for) gets the
// last word, because a grant you can't see is a grant you can't take
// back.
//
// A PANEL's toggle is its on/off switch (2026-08-19), not a code permit
// — switching one off takes its declaration out of the merge, tab and
// all, and every panel with an id has one, teller's own defaults
// included. A CONTAINER's toggle is still code-only, because that is
// all a `sys_`/`pak_` grant ever decided, so the two buttons are two
// components saying two different words. Switched-off panels keep
// listing, marked off: this screen is the registry of what exists, and
// a switch that vanished with the thing it switched is the one-way door
// this rewrite closed.
//
// Config stays a raw JSON textarea, same posture the vanilla client
// took (`server/public/app.js`'s `prompt('config (JSON)?')`) but inline,
// so a bad parse can say so without an alert().

import { useState, type ReactNode } from 'react';
import { registerTool } from './index.ts';
import { api } from '../lib/api.ts';
import { Export } from './export.tsx';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';

type PluginManifest = {
  id: string;
  name: string;
  version: number;
  /** A point per claim — a bare string in the file, an object for a pane. */
  provides: { point: string }[];
  /** The needs as WRITTEN, which is what a human is being asked to agree to. */
  wants: string[];
};
type Found = { dir: string; manifest: PluginManifest; enabled: boolean };
type Problem = { dir: string; problem: string };
/** Three states, so "no code" is something the console can SAY. */
type CodeState = 'none' | 'pending' | 'enabled';
type PanelRow = {
  id?: string;
  name: string;
  label?: string;
  code: CodeState;
  trusted: boolean;
  /** Switched off: it exists, it is listed here, and it is not in the merge. */
  disabled?: boolean;
};
type Container = {
  kind: 'system' | 'pack' | 'campaign' | 'table' | 'teller';
  id?: string;
  name: string;
  version?: number;
  code: CodeState;
  trusted: boolean;
  cargo: Record<string, number>;
  panels: PanelRow[];
};
type PluginsOut =
  | {
      found: Found[];
      problems: Problem[];
      running: string[];
      containers: Container[];
      unresolved: { id: string }[];
    }
  | { error: string };

const rowClass = 'rounded-md border border-stone-800 bg-stone-900/60';
const chip = 'rounded bg-stone-800 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-stone-400';
const dim = 'font-mono text-[11px] text-stone-600';

/** The whole grant vocabulary, in one place — every toggle is this POST. */
function grant(id: string, enabled: boolean): Promise<unknown> {
  return api(`/api/plugins/${id}`, { method: 'POST', body: { enabled } });
}

/**
 * A CONTAINER's code toggle — a `sys_` or `pak_` id, where the only
 * thing the grant decides is whether the presentations run. Its rules,
 * bestiary and catalogue load either way, which is why this says "code"
 * out loud: the panel switch below reads the same row and means
 * something bigger, and two buttons that spell the same word would be
 * lying about one of them.
 *
 * `code` says what the folder holds; `trusted` says what the shelf row
 * holds, and they are separate on purpose — a grant can outlive the code
 * it was given for, and the button that takes it back has to keep
 * rendering when it does.
 */
function CodeToggle({
  id,
  code,
  trusted,
  off = 'stop code',
  onChanged,
}: {
  id?: string;
  code: CodeState;
  trusted: boolean;
  off?: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!id || (code === 'none' && !trusted)) {
    return <span className={dim}>{code === 'none' ? 'data only' : ''}</span>;
  }

  const set = async (enabled: boolean) => {
    if (
      !enabled &&
      !window.confirm(
        'Stop running this code? Its rules and bestiary stay; only the presentations go.',
      )
    )
      return;
    setBusy(true);
    try {
      await grant(id, enabled);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (code === 'pending') {
    return (
      <button className={btnPrimary} disabled={busy} onClick={() => set(true)}>
        run code
      </button>
    );
  }
  return (
    <button className={btnGhost} disabled={busy} onClick={() => set(false)}>
      {off}
    </button>
  );
}

/**
 * A PANEL's on/off switch — the trust row read as what it now is: the
 * answer to "is this panel on?". Off means the declaration leaves the
 * merge: no tab, and a seat pointed at it gets the ordinary
 * missing-panel refusal. On (or no row at all) means it's in, with its
 * code following the same row fail-closed.
 *
 * Every panel with an id gets one, teller's own defaults included — that is
 * the sanctioned way to reject a default, and it is why disabling one
 * has to stay reversible from this screen.
 */
function PanelSwitch({
  id,
  disabled,
  onChanged,
}: {
  id?: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!id) return <span className={dim}>no id — nothing to switch</span>;

  const set = async (enabled: boolean) => {
    if (
      !enabled &&
      !window.confirm('Switch this panel off? Its tab goes and seats stop reaching it. Nothing is deleted.')
    )
      return;
    setBusy(true);
    try {
      await grant(id, enabled);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return disabled ? (
    <button className={btnPrimary} disabled={busy} onClick={() => set(true)}>
      enable
    </button>
  ) : (
    <button className={btnGhost} disabled={busy} onClick={() => set(false)}>
      disable
    </button>
  );
}

/**
 * Duplicate a panel into `<data>/panels/<name>/` — §M-6's owed
 * concession, so customizing something teller (or a system, or a pack)
 * ships never means finding the install directory by hand.
 *
 * Offered only on rows the table hasn't already restated: the table's
 * own layer is the top of the merge, so copying onto it would be
 * copying a thing onto itself, and the campaign's stored declarations
 * are not folders at all.
 */
function CopyToTable({ name, onChanged }: { name: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const copy = async () => {
    setBusy(true);
    setErr('');
    try {
      await api(`/api/panels/${encodeURIComponent(name)}/copy-to-table`, { method: 'POST' });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className={btnGhost}
        disabled={busy}
        title="duplicate into this table's panels folder, where your edit wins"
        onClick={copy}
      >
        copy to this table
      </button>
      {err && <span className="w-full text-[11px] text-amber-500/80">{err}</span>}
    </>
  );
}

/** One panel a container ships. Its provenance, when it needs one, is the caller's to pass. */
function PanelLine({
  panel,
  from,
  layer,
  onChanged,
}: {
  panel: PanelRow;
  from?: string;
  /** Which layer shipped it — the copy affordance is for the ones below the table's. */
  layer: Container['kind'];
  onChanged: () => void;
}) {
  const off = panel.disabled === true;
  const copyable = layer !== 'table' && layer !== 'campaign';
  return (
    <li className={`flex flex-wrap items-center gap-2 px-3 py-1.5 ${rowClass} ${off ? 'opacity-50' : ''}`}>
      <span className={`text-sm ${off ? 'text-stone-400 line-through' : 'text-stone-200'}`}>
        {panel.label ?? panel.name}
      </span>
      <span className={dim}>{panel.name}</span>
      {from && <span className={chip}>{from}</span>}
      {off && (
        <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-stone-400">
          off
        </span>
      )}
      {!off && panel.code === 'pending' && (
        <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
          code pending
        </span>
      )}
      {!off && panel.code === 'none' && <span className={dim}>data only</span>}
      <span className="ml-auto flex items-center gap-2">
        {panel.id && (
          <Export
            path={`/api/panels/${encodeURIComponent(panel.id)}/export`}
            filename={`${panel.name}.panel`}
          />
        )}
        {copyable && <CopyToTable name={panel.name} onChanged={onChanged} />}
        <PanelSwitch id={panel.id} disabled={off} onChanged={onChanged} />
      </span>
    </li>
  );
}

/**
 * `{ bestiary: 59, catalog: 301 }` → `301 catalog · 59 bestiary`.
 * Biggest first, because a WiW system layer carries twenty-one slots
 * and the line is only scannable if what's substantial reads first.
 * Nothing is dropped — a summary that hid the tail would be the same
 * omission this whole rewrite is about.
 */
function cargoLine(cargo: Record<string, number>): string {
  return Object.entries(cargo)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([slot, n]) => `${n} ${slot}`)
    .join(' · ');
}

/**
 * One container — a system or a pack — as an accordion: its own
 * presentation-code trust on the header, its non-code cargo summarised
 * in a quiet line under it, and the panels it ships as the only
 * expandable children. Open by default, because a table with two packs
 * and six panels fits on a screen and a closed accordion is a thing to
 * click before you can read anything.
 */
function ContainerCard({ container, onChanged }: { container: Container; onChanged: () => void }) {
  const [open, setOpen] = useState(true);
  const cargo = cargoLine(container.cargo);

  return (
    <div className={`${rowClass} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          className="text-sm text-stone-100 transition-colors hover:text-amber-400"
          onClick={() => setOpen(!open)}
        >
          <span className="mr-2 inline-block w-3 text-stone-600">{open ? '▾' : '▸'}</span>
          {container.name}
        </button>
        <span className={chip}>{container.kind}</span>
        {container.version !== undefined && <span className={dim}>v{container.version}</span>}
        {container.id && <span className={dim}>{container.id}</span>}
        <span className="ml-auto flex items-center gap-2">
          <span className={dim}>{container.panels.length || 'no'} panels</span>
          <CodeToggle
            id={container.id}
            code={container.code}
            trusted={container.trusted}
            onChanged={onChanged}
          />
        </span>
      </div>
      {cargo && <div className={`px-3 pb-2 ${dim}`}>{cargo}</div>}
      {open && (
        <div className="border-t border-stone-800 px-3 py-2">
          {container.panels.length === 0 ? (
            <p className="text-sm text-stone-600">ships no panels</p>
          ) : (
            <ul className="space-y-1">
              {container.panels.map((p) => (
                <PanelLine
                  key={p.id ?? p.name}
                  panel={p}
                  layer={container.kind}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function PluginRow({
  found,
  running,
  onChanged,
}: {
  found: Found;
  running: boolean;
  onChanged: () => void;
}) {
  const [configuring, setConfiguring] = useState(false);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = async () => {
    setBusy(true);
    try {
      await grant(found.manifest.id, !found.enabled);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    setErr('');
    let config: unknown = null;
    try {
      config = raw.trim() ? JSON.parse(raw) : null;
    } catch (e) {
      setErr(`not JSON: ${e instanceof Error ? e.message : e}`);
      return;
    }
    await api(`/api/plugins/${found.manifest.id}/config`, { method: 'PUT', body: { config } });
    setConfiguring(false);
    onChanged();
  };

  return (
    <li className={rowClass}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-sm text-stone-100" title={found.manifest.id}>
          {found.manifest.name}
        </span>
        <span className={dim}>v{found.manifest.version}</span>
        {running && (
          <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
            running
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button className={btnGhost} onClick={() => setConfiguring(!configuring)}>
            configure
          </button>
          <button className={found.enabled ? btnGhost : btnPrimary} disabled={busy} onClick={toggle}>
            {found.enabled ? 'disable' : 'enable'}
          </button>
        </span>
      </div>
      {/* The app-permissions moment (§15). `provides` is what it ADDS —
          the panes it puts on screen, the doors it answers — and `wants`
          is what it TOUCHES, in the author's own words, one line each.
          Both are claims until a human says yes; `wants` is the half
          that is then ENFORCED (`server/plugin-bridge.ts`), so it gets
          the room to be read. */}
      <div className={`space-y-1 px-3 pb-2 ${dim}`}>
        <p>provides {found.manifest.provides.map((p) => p.point).join(', ') || '(nothing)'}</p>
        {found.manifest.wants.length ? (
          <ul className="space-y-0.5">
            {found.manifest.wants.map((want) => (
              <li key={want} className="font-mono text-[11px]">
                · {want}
              </li>
            ))}
          </ul>
        ) : (
          <p>needs nothing</p>
        )}
      </div>
      {configuring && (
        <div className="space-y-2 border-t border-stone-800 px-3 py-2">
          <textarea
            className={`${input} min-h-20 w-full resize-y font-mono text-xs`}
            placeholder="{ }"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          {err && <p className="text-xs text-amber-500/80">{err}</p>}
          <div className="flex justify-end gap-2">
            <button className={btnGhost} onClick={() => setConfiguring(false)}>
              cancel
            </button>
            <button className={btn} onClick={saveConfig}>
              save
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** A type heading with its own count — the shelf tab's card grammar. */
function TypeSection({
  label,
  count,
  children,
  note,
}: {
  label: string;
  count?: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>{label}</span>
        {count && <span className={dim}>{count}</span>}
      </div>
      {children}
      {note && <p className="text-[11px] text-stone-600">{note}</p>}
    </section>
  );
}

function PluginsTool() {
  const { data, reload } = useLive(() => api<PluginsOut>('/api/plugins'), [], {
    on: ['plugins'],
  });
  if (!data) return null;

  if ('error' in data) {
    return (
      <section className={card}>
        <span className={sectionLabel}>Plugins</span>
        <p className="mt-2 text-sm text-amber-500/80">{data.error}</p>
      </section>
    );
  }

  const running = new Set(data.running);
  const containers = data.containers ?? [];
  const system = containers.find((c) => c.kind === 'system');
  const packs = containers.filter((c) => c.kind === 'pack');
  // The PANELS heading holds what doesn't ride a system or a pack: the
  // campaign's own, the table's `panels/` folder, teller's shipped
  // floor. Flattened into one list with provenance on the row, because
  // three accordions of two rows each is furniture in front of content.
  const standalone = containers.filter(
    (c) => c.kind === 'table' || c.kind === 'teller' || c.kind === 'campaign',
  );
  const label = (c: Container) => (c.kind === 'teller' ? 'teller' : c.kind === 'table' ? 'this table' : c.name);

  return (
    <div className="space-y-4">
      <TypeSection
        label="Plugins"
        count={`${data.found.length} on the shelf`}
        note="the sweep only discovers; enabling is yours alone."
      >
        {data.found.length === 0 && (
          <p className="text-sm text-stone-600">
            nothing on the shelf — drop a plugin folder in &lt;data&gt;/plugins/
          </p>
        )}
        <ul className="space-y-2">
          {data.found.map((f) => (
            <PluginRow
              key={f.manifest.id}
              found={f}
              running={running.has(f.manifest.id)}
              onChanged={reload}
            />
          ))}
        </ul>
        {data.problems.length > 0 && (
          <div className="space-y-1">
            {data.problems.map((p, i) => (
              <p key={i} className="font-mono text-[11px] text-amber-500/80">
                {p.dir}: {p.problem}
              </p>
            ))}
          </div>
        )}
      </TypeSection>

      <TypeSection
        label="System"
        note="its rules and kinds load regardless — only the presentations wait on a human."
      >
        {system ? (
          <ContainerCard container={system} onChanged={reload} />
        ) : (
          <p className="text-sm text-stone-600">this campaign runs on no system</p>
        )}
      </TypeSection>

      <TypeSection
        label="Packs"
        count={`${packs.length} in the stack`}
        note="a pack's own toggle is its code and nothing else — its panels switch one at a time, below their name."
      >
        {packs.length === 0 ? (
          <p className="text-sm text-stone-600">no packs in this campaign's stack</p>
        ) : (
          <div className="space-y-2">
            {packs.map((p) => (
              <ContainerCard key={p.id} container={p} onChanged={reload} />
            ))}
          </div>
        )}
      </TypeSection>

      <TypeSection
        label="Panels"
        count={`${standalone.reduce((n, c) => n + c.panels.length, 0)} standalone`}
        note="teller's defaults are the floor — copy one to this table to edit it in <data>/panels/, or switch it off here."
      >
        {standalone.every((c) => c.panels.length === 0) ? (
          <p className="text-sm text-stone-600">nothing of your own yet</p>
        ) : (
          <ul className="space-y-1">
            {standalone.flatMap((c) =>
              c.panels.map((p) => (
                <PanelLine
                  key={`${c.kind}:${p.id ?? p.name}`}
                  panel={p}
                  from={label(c)}
                  layer={c.kind}
                  onChanged={reload}
                />
              )),
            )}
          </ul>
        )}
      </TypeSection>

      {(data.unresolved ?? []).length > 0 && (
        <TypeSection
          label="Unresolved"
          count={`${data.unresolved.length}`}
          note="an enabled grant naming something nothing on this host accounts for — a deleted folder, or a pack this campaign no longer runs on."
        >
          <ul className="space-y-1">
            {data.unresolved.map(({ id }) => (
              <li key={id} className={`flex flex-wrap items-center gap-2 px-3 py-1.5 ${rowClass}`}>
                <span className={dim}>{id}</span>
                <span className="ml-auto">
                  <CodeToggle id={id} code="none" trusted off="revoke" onChanged={reload} />
                </span>
              </li>
            ))}
          </ul>
        </TypeSection>
      )}
    </div>
  );
}

registerTool('plugins', () => <PluginsTool />);
