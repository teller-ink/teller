// The floor under a declared standing scale (§L: shape-derived,
// neutral) — what a table gets when the system declares `ladders` and
// supplies no `LadderPanel` presentation of its own.
//
// A ladder is two declarations doing two jobs, and keeping them apart
// is the point:
//
//   * the MECHANIC is an ordinary `steps` kind (`core/kind.ts`) — an
//     ordered scale, a resting rung, and "an entry standing on the rest
//     isn't stored at all". Tapping the default rung therefore removes
//     the row, because "everyone starts here" is the UNSTORED state and
//     a sheet full of stored defaults is noise in every bundle. That
//     law is enforced on the write door, so it holds whoever writes;
//     this file just sends the rung.
//   * the LADDER declaration is presentation: what the scale is called,
//     which list it stands over, which section names the parties, and
//     what modifier each rung is worth. **Mods are shown, never
//     applied** — the dice they modify are in a person's hand.
//
// Nothing here knows what any of it means. The scale's name, its rungs,
// their modifiers and the whole roster all arrive at runtime.

import type { Entity, Entry } from '../../core/entity.ts';
import { card, sectionLabel } from '../lib/ui.ts';
import { Refusal } from '../panels/render.tsx';

/** One rung. `mod` is a printed modifier — a string, because it is read, never computed with. */
export type LadderStep = { label: string; mod?: string };

/** `/api/stack/declarations/ladders` — a declared standing scale. */
export type LadderDecl = {
  name: string;
  label?: string;
  /** The list the standings live in — a `steps` kind of the same name. */
  list?: string;
  /** The declared section whose entry names are the roster. */
  section?: string;
  /** The book's own caption. Pack content; shown, never parsed. */
  text?: string;
  steps: LadderStep[];
  defaultStep?: string;
};

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** The forgiving read — keep what parses, drop what doesn't, never throw at content. */
export function toLadder(raw: unknown): LadderDecl | undefined {
  const r = asRecord(raw);
  // A ladder without rungs is not a scale; a ladder without a name has
  // nothing to be overridden by (the merge is by name, like everything).
  const name = String(r.name ?? r.label ?? '').trim();
  if (!name || !Array.isArray(r.steps)) return undefined;
  const steps = r.steps
    .map((s) => {
      const sr = asRecord(s);
      const label = String(sr.label ?? sr.name ?? '').trim();
      if (!label) return undefined;
      const mod = String(sr.mod ?? '').trim();
      return mod ? { label, mod } : { label };
    })
    .filter((s): s is LadderStep => s !== undefined);
  if (!steps.length) return undefined;
  const out: LadderDecl = { name, steps };
  for (const key of ['label', 'list', 'section', 'text', 'defaultStep'] as const) {
    const value = String(r[key] ?? '').trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Which list this ladder's standings live in — its own name unless it says otherwise. */
export function ladderList(ladder: LadderDecl): string {
  return ladder.list ?? ladder.name.toLowerCase();
}

/** What any `LadderPanel` face receives — teller's floor and a pack's alike. */
export type LadderPanelProps = {
  ladder: LadderDecl;
  entity?: Entity;
  /** The parties, in the order the declared section names them. */
  roster: string[];
  /** Writes the rung; the `steps` kind takes care of the resting one. Absent on a look-but-don't-touch surface. */
  onSet?: (name: string, step: string) => void;
  /** Opens a party's own entry, when the declaration has one to open. */
  onOpen?: (name: string) => void;
  /** Which names have something to open — so the rest aren't offered as buttons. */
  hasEntry?: (name: string) => boolean;
  note?: string;
  accent?: string;
};

export function LadderFloor({
  ladder,
  entity,
  roster,
  onSet,
  onOpen,
  hasEntry,
  note,
  accent,
}: LadderPanelProps) {
  const list = ladderList(ladder);
  const key = Object.keys(entity?.lists ?? {}).find(
    (k) => k.toLowerCase() === list.toLowerCase(),
  );
  const stored: Entry[] = key ? (entity?.lists[key] ?? []) : [];
  const at = (name: string) =>
    stored.find((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase());

  // Standings held with parties the roster doesn't name. Strays surface
  // — never disappear, the degradation contract applied to a roster
  // that moved on without this character.
  const known = new Set(roster.map((n) => n.trim().toLowerCase()));
  const rows = [
    ...roster,
    ...stored.filter((e) => !known.has(e.name.trim().toLowerCase())).map((e) => e.name),
  ];

  return (
    <section className={`${card} flex flex-col gap-2`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={sectionLabel}>{ladder.label ?? ladder.name}</p>
        {(note ?? ladder.text) && (
          <p className="text-xs text-stone-500">{note ?? ladder.text}</p>
        )}
      </div>

      {rows.length === 0 ? (
        <Refusal>nobody to stand with yet</Refusal>
      ) : (
        <div className="divide-y divide-stone-800/80">
          {rows.map((name) => {
            const current = at(name)?.value?.toString() ?? ladder.defaultStep ?? '';
            const active = ladder.steps.find((s) => s.label === current);
            const openable = Boolean(onOpen && (hasEntry?.(name) ?? false));
            return (
              <div key={name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                <button
                  type="button"
                  disabled={!openable}
                  onClick={() => onOpen?.(name)}
                  aria-label={openable ? `about ${name}` : name}
                  className="min-w-[9rem] flex-1 rounded px-1 py-0.5 text-left text-[0.8rem] leading-tight text-stone-200 transition-colors enabled:hover:bg-stone-800/60 disabled:cursor-default"
                >
                  {name}
                </button>
                <div className="flex items-center gap-1">
                  {ladder.steps.map((step) => {
                    const lit = step.label === current;
                    return (
                      <button
                        key={step.label}
                        type="button"
                        disabled={!onSet}
                        onClick={() => onSet?.(name, step.label)}
                        aria-pressed={lit}
                        aria-label={`${name}: ${step.label}${step.mod ? ` (${step.mod})` : ''}`}
                        title={`${step.label}${step.mod ? ` ${step.mod}` : ''}`}
                        className="flex h-[1.15rem] w-[1.15rem] shrink-0 items-center justify-center rounded-[2px] border"
                        style={
                          lit
                            ? {
                                background: accent ?? 'var(--sheet-accent, #f59e0b)',
                                borderColor: accent ?? 'var(--sheet-accent, #f59e0b)',
                              }
                            : { borderColor: '#57534e' }
                        }
                      />
                    );
                  })}
                </div>
                <span className="w-[7.5rem] font-mono text-[0.75rem] text-stone-400">
                  {active ? (
                    <>
                      {active.label}
                      {active.mod && <span className="ml-1 text-stone-500">{active.mod}</span>}
                    </>
                  ) : (
                    current
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
