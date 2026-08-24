// A printing, read-only — the bestiary's own dialog, ported from the
// old app's CreatureSheet/Statblock (src/components/CreatureSheet.tsx,
// Statblock.tsx). The old sheet grouped a printed creature's `fields`
// into pools and prose by key; core-next's `Template` has no fields at
// all — a bestiary entry is `{id, name, type?, lists, notes?}`, the
// same shape an entity resolves through (rule 2 sharpened: `core/kind.ts`).
// So the grouping the old sheet did by hand (short numeric values as a
// pool grid, long prose under its own heading) is done here by KIND
// instead — one card per list, its entries laid out in the pool grid
// the old sheet used (`grid-cols-2 sm:grid-cols-4`) — with `notes` as
// the one free-text block the new template shape still carries.
//
// The prose half caught up second (2026-08-19): the old sheet gave
// Description and Behavior their own headings and set a feature's NAME
// in accent before its words, and this dumped all of it as one grey
// blob because the DATA was one blob. It isn't any more — `about`,
// `features`, `trophies` and frenzy children arrive already read apart
// (`scripts/statblock-text.mjs`), so nothing here parses anything. A
// pack nobody has re-converted still renders, through `TraitsSection`.
//
// It's a DIALOG, same as the old app, for the same reason: looking a
// printing up mid-fight is a detour, and a detour should announce
// itself and end.
//
// The pieces it's built from render at two DENSITIES (`dense`, the old
// app's own prop): roomy in the dialog you opened to read, tight on the
// stage you're deciding a turn from — small tiles, and the prose in two
// columns once the container is wide enough for it. One statblock, one
// renderer, two densities; not two renderers.

import { useEffect } from 'react';
import { findEntry, type Entry } from '../../../core/entity.ts';
import { isAoe } from '../../../core/exchange.ts';
import type { Template } from '../../../core/stamp.ts';
import { btn, btnGhost, sectionLabel } from '../../lib/ui.ts';

function EntryCell({ entry, dense = false }: { entry: Entry; dense?: boolean }) {
  return (
    <div className={`rounded-lg bg-stone-950/60 ${dense ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
      {entry.value !== undefined && (
        <div className={`font-mono text-amber-200 ${dense ? 'text-[13px]' : 'text-sm'}`}>
          {entry.value}
          {typeof entry.max === 'number' && <span className="text-stone-600">/{entry.max}</span>}
        </div>
      )}
      <div className="text-[10px] uppercase tracking-wide text-stone-600">{entry.name}</div>
    </div>
  );
}

/**
 * One attack's printed line, read semantically — the numbers, not the
 * prose. Exported because the runner's stage draws the same attack as a
 * CHIP rather than a line, and both must read the same profile: one
 * statblock, rendered the same everywhere, means one reading of it too.
 */
export function attackProfile(attack: Template): {
  band?: string;
  cost?: Entry;
  damage?: Entry;
  aoe: boolean;
  piercing?: Entry;
  inflicts: Entry[];
} {
  const profile = attack.lists?.profile ?? [];
  const band = findEntry(profile, 'Band')?.value;
  return {
    ...(typeof band === 'string' ? { band } : {}),
    cost: findEntry(profile, 'Cost'),
    damage: findEntry(profile, 'Damage'),
    aoe: isAoe(profile),
    piercing: findEntry(profile, 'Piercing'),
    inflicts: attack.lists?.inflicts ?? [],
  };
}

/** A status chip — an inflicted or tolerated condition, severity riding the name. */
export function StatusChip({ entry }: { entry: Entry }) {
  return (
    <span className="rounded bg-sky-950 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
      {entry.name}
      {entry.value !== undefined ? ` ${entry.value}` : ''}
    </span>
  );
}

/**
 * One attack, read semantically off its `profile`/`inflicts` lists —
 * zero parsing (§I). A band heading groups these; this renders the
 * line the old app's `AttackLines` drew from parsed prose.
 */
function AttackLine({ attack, costCounter }: { attack: Template; costCounter?: string }) {
  const profile = attack.lists?.profile ?? [];
  const inflicts = attack.lists?.inflicts ?? [];
  const cost = findEntry(profile, 'Cost');
  const damage = findEntry(profile, 'Damage');
  const aoe = isAoe(profile);
  const piercing = findEntry(profile, 'Piercing');
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-stone-950/60 px-3 py-1.5">
      <span className="text-sm text-stone-100">{attack.name}</span>
      {aoe && (
        <span className="rounded bg-stone-800 px-1.5 font-mono text-[10px] text-stone-400">
          AOE
        </span>
      )}
      {damage && <span className="font-mono text-sm text-amber-300">{damage.value}</span>}
      {piercing && (
        <span className="font-mono text-[10px] text-stone-500">
          piercing {piercing.value ?? ''}
        </span>
      )}
      {cost && (
        <span className="font-mono text-[10px] text-stone-500">
          {cost.value} {(costCounter ?? cost.name).toLowerCase()}
        </span>
      )}
      {inflicts.map((s) => (
        <StatusChip key={s.name} entry={s} />
      ))}
    </div>
  );
}

/** Attack children, band by band, in declared order — Melee, Short, Long. */
const BAND_ORDER = ['Melee', 'Short', 'Long'];

export function AttacksSection({
  template,
  costCounter,
}: {
  template: Template;
  costCounter?: string;
}) {
  const attacks = (template.children ?? []).filter((c) => c.type === 'attack');
  if (!attacks.length) return null;
  const bandOf = (a: Template) => String(findEntry(a.lists?.profile ?? [], 'Band')?.value ?? '');
  const seen = [...new Set(attacks.map(bandOf))];
  const bands = [...BAND_ORDER.filter((b) => seen.includes(b)), ...seen.filter((b) => !BAND_ORDER.includes(b))];
  return (
    <div>
      <span className={sectionLabel}>Attacks</span>
      <div className="mt-2 space-y-2">
        {bands.map((band) => (
          <div key={band}>
            {band && (
              <div className="font-mono text-[10px] uppercase tracking-wide text-stone-600">
                {band}
              </div>
            )}
            <div className="mt-1 space-y-1">
              {attacks
                .filter((a) => bandOf(a) === band)
                .map((a) => (
                  <AttackLine key={a.id} attack={a} costCounter={costCounter} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A section of the printed prose, at one of two densities: roomy in the
 * dialog you opened to read, tight on the stage you're deciding a turn
 * from. `break-inside-avoid` is what keeps a section whole when the
 * stage runs it in two columns — half a trait at the foot of a column
 * is worse than a longer column (the old app's own call).
 */
function Section({
  label,
  dense,
  children,
}: {
  label: string;
  dense: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={dense ? 'mb-3 break-inside-avoid' : undefined}>
      <span className={sectionLabel}>{label}</span>
      <div className={dense ? 'mt-1 space-y-1' : 'mt-2 space-y-2'}>{children}</div>
    </div>
  );
}

/** One paragraph of printed prose, at the density the caller asked for. */
const proseLine = (dense: boolean) =>
  dense
    ? 'text-[11px] leading-snug text-stone-400'
    : 'text-[13px] leading-relaxed text-stone-300';

/** `tolerances` — a plain list on the foe itself (§I) — as status chips. */
function TolerancesSection({ entries, dense }: { entries: Entry[]; dense: boolean }) {
  if (!entries.length) return null;
  return (
    <Section label="Tolerances" dense={dense}>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((e) => (
          <StatusChip key={e.name} entry={e} />
        ))}
      </div>
    </Section>
  );
}

/**
 * `about` — Description, Behavior: plain prose, one section per entry,
 * under the heading the book gave it. No lead-in, because there is no
 * name to lead in with: the entry's name IS the heading.
 */
function AboutSections({ entries, dense }: { entries: Entry[]; dense: boolean }) {
  if (!entries.length) return null;
  return (
    <>
      {entries.map((e) => (
        <Section key={e.name} label={e.name} dense={dense}>
          <p className={proseLine(dense)}>{e.value}</p>
        </Section>
      ))}
    </>
  );
}

/**
 * A list of NAMED things — features, trophies — the old app's shape:
 * the name in accent, a full stop, then its words. That lead-in is the
 * whole reason this isn't one grey wall (`src/components/Statblock.tsx`).
 */
function NamedSection({
  label,
  entries,
  dense,
}: {
  label: string;
  entries: Entry[];
  dense: boolean;
}) {
  if (!entries.length) return null;
  return (
    <Section label={label} dense={dense}>
      {entries.map((e) => (
        <p key={e.name} className={proseLine(dense)}>
          <span className="text-amber-200">{e.name}. </span>
          {e.value}
        </p>
      ))}
    </Section>
  );
}

/**
 * Frenzy children — the same lead-in, with the printed threshold back
 * in it: "Guillotine (30 Health)." Both halves come off the `gate`
 * entry, so the counter is the pack's word and not a game concept
 * spelled here (rule 2).
 */
function FrenzySection({ frenzies, dense }: { frenzies: Template[]; dense: boolean }) {
  if (!frenzies.length) return null;
  return (
    <Section label="Frenzy" dense={dense}>
      {frenzies.map((f) => {
        const gate = (f.lists?.gate ?? [])[0];
        return (
          <p key={f.id} className={proseLine(dense)}>
            <span className="text-amber-200">
              {f.name}
              {gate && ` (${gate.value} ${gate.name})`}.{' '}
            </span>
            {f.notes}
          </p>
        );
      })}
    </Section>
  );
}

/**
 * `traits` — the OLD shape, a whole printed field as one blob.
 *
 * A pack nobody has re-converted still arrives this way and still
 * renders: the sections above are what a migrated pack draws, this is
 * the floor under an unmigrated one. It splits on newlines and leaves
 * the names inside the prose, exactly as it always did.
 */
function TraitsSection({ entries, dense }: { entries: Entry[]; dense: boolean }) {
  if (!entries.length) return null;
  return (
    <>
      {entries.map((e) => (
        <Section key={e.name} label={e.name} dense={dense}>
          {String(e.value ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, i) => (
              <p key={i} className={proseLine(dense)}>
                {line}
              </p>
            ))}
        </Section>
      ))}
    </>
  );
}

/**
 * The lists with no rendering of their own — the pool grid that's the
 * bare-panel floor for anything teller doesn't recognise (§7).
 *
 * ORDER is presentation, not knowledge, and it's the old app's order
 * (`PROSE_ORDER` in `src/components/Statblock.tsx`): the pools first,
 * then what it does, then what it is, then what it becomes.
 *
 * `skip` is the caller's: the runner's stage draws `resources` as bars
 * with steppers above this grid, so it says so rather than printing
 * Health twice.
 */
export function StatPools({
  template,
  skip = [],
  dense = false,
}: {
  template: Template;
  skip?: string[];
  /**
   * The stage's density: a row of small tiles rather than a grid of
   * roomy ones. Mid-fight the pools are a thing you GLANCE at, and a
   * tile twice as tall as it needs to be is a scroll between the chips
   * you tap and the prose you read (the old app's `dense`, kept).
   */
  dense?: boolean;
}) {
  const hidden = new Set([...SPOKEN, ...skip.map((s) => s.toLowerCase())]);
  const lists = Object.entries(template.lists ?? {}).filter(
    ([key, entries]) => entries.length && !hidden.has(key.toLowerCase()),
  );
  if (!lists.length) return null;
  return (
    <>
      {lists.map(([key, entries]) => (
        <div key={key}>
          <span className={sectionLabel}>{key}</span>
          <div
            className={`mt-2 grid gap-1.5 ${
              dense
                ? 'grid-cols-3 @lg:grid-cols-4 @2xl:grid-cols-7'
                : 'grid-cols-2 gap-2 sm:grid-cols-4'
            }`}
          >
            {entries.map((e) => (
              <EntryCell key={e.name} entry={e} dense={dense} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Everything the book SAYS about a creature — Description, Behavior,
 * Features, Trophies, Tolerances, Frenzy, and the unmigrated blob.
 *
 * The whole reason it's one exported component: the dialog and the
 * runner's stage are two places you read the same statblock, and the
 * day they diverge is the day one of them starts lying. Deciding a turn
 * you have to open a dialog to make is a turn you make worse (Brian,
 * 2026-08-15), so the stage inlines exactly this.
 */
export function StatblockProse({
  template,
  dense = false,
}: {
  template: Template;
  /**
   * The stage's density — and, once the stage is wide enough for it,
   * TWO COLUMNS: Description/Behavior/Features fall down the left and
   * Trophies/Tolerances/Frenzy up the right, which is the split the old
   * app drew and the shape a printed statblock has. It's the container's
   * width that decides, so held glass and the dialog keep stacking
   * without either of them being asked which device they are.
   */
  dense?: boolean;
}) {
  const frenzies = (template.children ?? []).filter((c) => c.type === 'frenzy');
  return (
    <div className={dense ? 'gap-x-6 @2xl:columns-2' : 'space-y-5'}>
      <AboutSections entries={template.lists?.about ?? []} dense={dense} />
      <NamedSection label="Features" entries={template.lists?.features ?? []} dense={dense} />
      <NamedSection label="Trophies" entries={template.lists?.trophies ?? []} dense={dense} />
      <TolerancesSection entries={template.lists?.tolerances ?? []} dense={dense} />
      <FrenzySection frenzies={frenzies} dense={dense} />
      <TraitsSection entries={template.lists?.traits ?? []} dense={dense} />
    </div>
  );
}

// The lists that have a rendering of their own above — status chips,
// named prose, plain prose. Everything else falls through to the grid.
// Attack and frenzy children never rode in `lists`.
const SPOKEN = ['about', 'features', 'trophies', 'tolerances', 'traits'];

export function TemplateSheet({
  template,
  onClose,
  actions,
  costCounter,
}: {
  template: Template;
  onClose: () => void;
  /** Row actions handed in by the caller — "add to the fight", etc. */
  actions?: React.ReactNode;
  /** The system's cost counter name (`use.costCounter`) — falls back to the entry's own word. */
  costCounter?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lists = Object.entries(template.lists ?? {}).filter(
    ([key, entries]) => entries.length && !SPOKEN.includes(key),
  );
  const about = template.lists?.about ?? [];
  const features = template.lists?.features ?? [];
  const trophies = template.lists?.trophies ?? [];
  const tolerances = template.lists?.tolerances ?? [];
  const traits = template.lists?.traits ?? [];
  const attacks = (template.children ?? []).filter((c) => c.type === 'attack');
  const frenzies = (template.children ?? []).filter((c) => c.type === 'frenzy');

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-950/80 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-stone-800 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-baseline gap-2 border-b border-stone-800 px-5 py-4">
          <h2 className="font-serif text-2xl text-amber-50">{template.name}</h2>
          {template.type && (
            <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-400">
              {template.type}
            </span>
          )}
          <button className={`${btnGhost} ml-auto`} onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {lists.length === 0 &&
            attacks.length === 0 &&
            frenzies.length === 0 &&
            about.length === 0 &&
            features.length === 0 &&
            trophies.length === 0 &&
            tolerances.length === 0 &&
            traits.length === 0 && (
              <p className="text-sm text-stone-600">nothing printed for this foe</p>
            )}
          <StatPools template={template} />
          <AttacksSection template={template} costCounter={costCounter} />
          <StatblockProse template={template} />

          {template.notes && (
            <div>
              <span className={sectionLabel}>Notes</span>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-300">
                {template.notes}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-stone-800 px-5 py-3">
          {actions}
          <button className={btn} onClick={onClose}>
            done
          </button>
        </div>
      </div>
    </div>
  );
}
