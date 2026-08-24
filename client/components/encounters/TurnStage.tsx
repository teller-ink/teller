// THE STAGE — whoever's turn it is, at full size.
//
// Ported from the old app (src/components/TurnStage.tsx, and its header
// grammar verbatim): the roster answers "who's up and who's hurt", this
// answers "what do they do", and it only ever shows ONE combatant — the
// one acting. That is the whole reason it can afford to be generous.
// Anything you do to somebody ELSE happens over in the order, so there
// is no selection to get lost in and no way to be looking at the wrong
// sheet.
//
// The old ✦ card is one card again, and it is NOT here: it sits under
// the stage, composed by the runner out of `ProviderSlot` (the box, and
// the ask nobody may assume exists) holding `Exchange` (the roll /
// target / defense / resolve flow, which is teller's own and renders
// with no plugin installed). This file's job in that arrangement is
// ARMING — the step the old app didn't need and this one does: it read
// an attack's dice out of prose, and here you tap the attack.
//
// Everything printed is drawn by the SHARED statblock (`TemplateSheet`):
// one statblock, rendered the same in both places, which is the law this
// tool would otherwise be the third violation of. What's added here is
// only what a TURN needs and a printing doesn't — the bars you push, the
// statuses you hang, and the gate that has opened.

import { numberOf, type Entity, type Entry } from '../../../core/entity.ts';
import {
  FRENZY,
  SPENT,
  costOf,
  durationOf,
  effectiveList,
  grantsOf,
  isActive,
  isEvent,
  isSpent,
  modificationsFor,
  modifiedAttack,
} from '../../../core/frenzy.ts';
import { readGate } from '../../../core/gate.ts';
import type { Template } from '../../../core/stamp.ts';
import { sectionLabel } from '../../lib/ui.ts';
import { CounterStepper } from '../Vitals.tsx';
import type { Armed, EntryWrite, StatusDecl } from './Exchange.tsx';
import { StatPools, StatblockProse, StatusChip, attackProfile } from './TemplateSheet.tsx';

/** Clamp a bump the way every stepper in teller does: floor at 0, ceiling if declared. */
function bumped(entry: Entry, delta: number): number {
  const value = numberOf(entry) ?? 0;
  const next = value + delta;
  return Math.max(0, typeof entry.max === 'number' ? Math.min(entry.max, next) : next);
}

/**
 * What it can do, as chips — the pool and what it inflicts one glance
 * away rather than one dialog away (Brian, 2026-08-15: "I don't wanna
 * have to click into the info popup every time I have a question").
 *
 * A FRENZY is the same chip wearing its gate. An unmet gate DIMS and
 * never disables: teller shows the Warden where the line is and lets
 * them cross it (rule 1). Reaching one is the interesting moment of a
 * fight, and it lights up on its own.
 */
function DoesRow({
  acting,
  armed,
  onArm,
  costCounter,
  onWrite,
}: {
  acting: Template;
  armed?: Armed;
  /** The system's word for what an action is paid out of. */
  costCounter?: string;
  /** Tap to arm, tap the armed one to put it back. */
  onArm: (armed: Armed | undefined) => void;
  /** How the running mark is stored — an ordinary entry, like everything. */
  onWrite: (edit: EntryWrite) => void;
}) {
  const sheet = acting as Entity;
  const printed = (acting.children ?? []).filter((c) => c.type === 'attack');
  const frenzies = (acting.children ?? []).filter((c) => c.type === FRENZY);
  // What a RUNNING frenzy hands the creature: an attack it didn't have.
  // A grant is an ordinary attack child, so it draws as an ordinary chip
  // and nothing below needs to know where it came from.
  const granted = frenzies
    .filter((f) => isActive(sheet, f))
    .flatMap((f) => grantsOf(f as Entity));
  const attacks = [...printed, ...granted];
  if (!attacks.length && !frenzies.length) return null;

  /** One chip's worth of action, armable. */
  const chip = (
    action: Template,
    p: ReturnType<typeof attackProfile>,
    { on, changed, tone }: { on: boolean; changed?: boolean; tone?: string },
  ) => (
    <button
      key={action.id}
      className={`rounded-md px-2 py-1 text-left font-mono text-[11px] transition-colors ${
        on
          ? 'bg-amber-900/60 text-amber-100 ring-1 ring-amber-600'
          : changed
            ? 'bg-stone-800 text-stone-300 ring-1 ring-rose-800/70 hover:bg-stone-700'
            : (tone ?? 'bg-stone-800 text-stone-300 hover:bg-stone-700')
      }`}
      title={changed ? 'a frenzy is rewriting this one' : undefined}
      onClick={() =>
        onArm(
          on
            ? undefined
            : {
                id: action.id,
                name: action.name,
                ...(p.band ? { band: p.band } : {}),
                ...(p.aoe ? { aoe: true } : {}),
                ...(typeof p.damage?.value === 'string' ? { damage: p.damage.value } : {}),
                ...(typeof p.cost?.value === 'number' ? { cost: p.cost.value } : {}),
                inflicts: p.inflicts,
                ...(p.band ? { note: p.band } : {}),
              },
        )
      }
    >
      {/* A chip a frenzy is rewriting says so before it says anything
          else: the numbers to its right are not the ones on the page. */}
      {changed && <span className="mr-1 text-rose-400">✦</span>}
      {action.name}
      {/* The band, because one weapon prints a pool per reach and
          two identical chips are otherwise indistinguishable. */}
      {p.band && <span className="ml-1.5 text-[10px] text-stone-500">{p.band}</span>}
      {p.aoe && <span className="ml-1.5 text-[10px] text-stone-500">AOE</span>}
      {p.damage && (
        <span className={`ml-1.5 ${changed ? 'text-rose-300' : 'text-amber-300'}`}>
          {p.damage.value}
        </span>
      )}
      {/* Spelled out, because "4G" beside a "2G" pool reads as
          four gold dice and it is four of the counter the system
          says actions are paid out of — whose NAME is the
          system's, never a word spelled here. */}
      {p.cost !== undefined && (
        <span className="ml-1.5 text-[10px] text-stone-500">
          {p.cost.value} {(costCounter ?? 'cost').toLowerCase()}
        </span>
      )}
      {p.piercing && (
        <span className="ml-1.5 text-[10px] text-stone-500">
          piercing {p.piercing.value ?? ''}
        </span>
      )}
      {p.inflicts.map((s) => (
        <span key={s.name} className="ml-1.5">
          <StatusChip entry={s} />
        </span>
      ))}
    </button>
  );

  return (
    <div className="mt-3 border-t border-stone-800 pt-2.5">
      <span className="text-[10px] uppercase tracking-widest text-stone-600">What it does</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {attacks.map((attack) => {
          // The chip is drawn from the attack AS THE RUNNING FRENZIES
          // LEAVE IT — same lists, rewritten in place, so arming it arms
          // the modified numbers and nothing downstream branches.
          const mods = modificationsFor(sheet, attack as Entity);
          const { profile, inflicts, changed } = modifiedAttack(attack as Entity, mods);
          const p = attackProfile({ ...attack, lists: { ...attack.lists, profile, inflicts } });
          return chip(attack, p, { on: armed?.id === attack.id, changed });
        })}

        {frenzies.map((frenzy) => {
          const gate = readGate(frenzy, acting.lists);
          const open = gate?.met ?? false;
          const running = isActive(sheet, frenzy);
          // The two lifecycles, told apart once, here. A one-shot says
          // so in its own name; everything below only asks this file.
          const event = isEvent(frenzy);
          const spent = event && isSpent(sheet, frenzy);
          const on = armed?.id === frenzy.id;
          /** What the chip says it is: a switch that runs, or a thing that happens once. */
          const state = spent
            ? 'spent'
            : running
              ? 'running'
              : event
                ? open
                  ? 'now — once'
                  : gate
                    ? `once, at ${gate.at} ${gate.counter.toLowerCase()}`
                    : 'once'
                : open
                  ? 'ready — its next turn'
                  : gate
                    ? `at ${gate.at} ${gate.counter.toLowerCase()}`
                    : '';
          // A frenzy IS an action when the book gave it numbers of its
          // own — a pool, a reach, a status on everyone in it. Read off
          // the same profile an attack keeps, so the chip is the chip.
          const p = attackProfile(frenzy);
          const cost = costOf(frenzy);
          const duration = durationOf(frenzy);
          return (
            <span
              key={frenzy.id}
              className={`inline-flex items-stretch overflow-hidden rounded-md ${
                running ? 'ring-1 ring-rose-600' : ''
              }`}
            >
              {/* The MARK — stored, toggleable, and proposed the moment
                  the gate opens. teller never crosses the line itself:
                  it lights the switch up and waits (rule 1), and the
                  Warden may throw it early, or back off.

                  A one-shot's mark is the same entry wearing a value, so
                  the same tap spends it by hand and un-spends it again —
                  there is no state here nobody can change. */}
              <button
                className={`px-1.5 font-mono text-[11px] transition-colors ${
                  spent
                    ? 'bg-stone-900 text-stone-700 line-through hover:bg-stone-800'
                    : running
                      ? 'bg-rose-800 text-rose-50'
                      : open
                        ? 'animate-pulse bg-rose-950 text-rose-300 hover:bg-rose-900'
                        : 'bg-stone-900 text-stone-700 hover:bg-stone-800'
                }`}
                title={
                  spent
                    ? `${frenzy.name} has already happened — tap to put it back`
                    : event
                      ? open
                        ? `${frenzy.name} happens now, once — tap to mark it spent`
                        : `mark ${frenzy.name} spent`
                      : running
                        ? `${frenzy.name} is running — tap to stop it`
                        : open
                          ? `${frenzy.name} can start on its next turn — tap to start it`
                          : `start ${frenzy.name} early`
                }
                aria-pressed={spent || running}
                onClick={() =>
                  onWrite(
                    event
                      ? spent
                        ? { list: FRENZY, name: frenzy.name, remove: true }
                        : { list: FRENZY, name: frenzy.name, value: SPENT }
                      : { list: FRENZY, name: frenzy.name, ...(running ? { remove: true } : {}) },
                  )
                }
              >
                {event ? '◈' : running ? '◆' : '◇'}
              </button>
              <button
                className={`px-2 py-1 text-left font-mono text-[11px] transition-colors ${
                  spent
                    ? 'bg-stone-900 text-stone-700 line-through'
                    : on
                      ? 'bg-amber-900/60 text-amber-100 ring-1 ring-amber-600'
                      : open || running
                        ? 'bg-rose-950/70 text-rose-200 hover:bg-rose-900/70'
                        : 'bg-stone-900 text-stone-600 hover:bg-stone-800'
                }`}
                title={spent ? `${frenzy.name} has already happened` : (frenzy.notes ?? undefined)}
                // An unmet gate still arms. teller shows the Warden where
                // the line is and lets them cross it (rule 1) — a chip that
                // dims is a warning, never a lock. A SPENT one-shot is the
                // one exception, and it isn't teller's ruling: the book
                // says it can't be used again, and the mark beside it puts
                // it back the moment the table disagrees.
                disabled={spent}
                onClick={() =>
                  onArm(
                    on
                      ? undefined
                      : {
                          id: frenzy.id,
                          name: frenzy.name,
                          frenzy: true,
                          // A one-shot spends itself where it resolves,
                          // so the exchange has to know which kind it is.
                          ...(event ? { event: true } : {}),
                          ...(p.band ? { band: p.band } : {}),
                          ...(p.aoe ? { aoe: true } : {}),
                          ...(typeof p.damage?.value === 'string' ? { damage: p.damage.value } : {}),
                          ...(typeof cost?.value === 'number' ? { cost: cost.value } : {}),
                          inflicts: p.inflicts,
                          ...(frenzy.notes ? { note: frenzy.notes } : {}),
                        },
                  )
                }
              >
                {frenzy.name}
                {state && (
                  <span
                    className={`ml-1.5 text-[10px] ${
                      spent ? 'text-stone-700' : open || running ? 'text-rose-300' : 'text-stone-600'
                    }`}
                  >
                    {state}
                  </span>
                )}
                {p.band && <span className="ml-1.5 text-[10px] text-stone-500">{p.band}</span>}
                {p.aoe && <span className="ml-1.5 text-[10px] text-stone-500">AOE</span>}
                {p.damage && <span className="ml-1.5 text-amber-300">{p.damage.value}</span>}
                {cost?.value !== undefined && (
                  <span className="ml-1.5 text-[10px] text-stone-500">
                    {cost.value} {(costCounter ?? cost.name).toLowerCase()}
                  </span>
                )}
                {p.inflicts.map((s) => (
                  <span key={s.name} className="ml-1.5">
                    <StatusChip entry={s} />
                  </span>
                ))}
                {duration && (
                  <span className="ml-1.5 text-[10px] italic text-stone-600">{duration}</span>
                )}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function TurnStage({
  acting,
  index,
  total,
  round,
  statuses,
  accent,
  onWrite,
  armed,
  onArm,
  costCounter,
}: {
  /** The acting entity, RESOLVED — a thin stamp's template values are facts. */
  acting: Template;
  index: number;
  total: number;
  round: number;
  statuses: StatusDecl[];
  /** The party accent for this trade, if the system declared one. Foes get red. */
  accent?: string;
  onWrite: (edit: EntryWrite) => void;
  /** What's armed, held by the caller so it survives this component. */
  armed?: Armed;
  onArm: (armed: Armed | undefined) => void;
  costCounter?: string;
}) {
  const foe = acting.type === 'foe';
  const conditions = acting.lists?.conditions ?? [];
  // Bounded first: mid-fight you want Health and Grit, not a running
  // Prestige total that has no ceiling to draw.
  const resources = [...(acting.lists?.resources ?? [])].sort(
    (a, b) => Number(b.max !== undefined) - Number(a.max !== undefined),
  );
  const held = (name: string) =>
    conditions.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  // Conditions the system never declared — someone typed them, so they
  // stay visible and stay removable rather than vanishing off the stage.
  const loose = conditions.filter(
    (c) => !statuses.some((s) => s.name.trim().toLowerCase() === c.name.trim().toLowerCase()),
  );

  /**
   * The printed lists as a RUNNING frenzy leaves them — what the grid
   * below reads. Only the read moves: what's STORED stays the printed
   * value, so turning a frenzy off restores the page without an undo,
   * and the bars above stay on the stored numbers because those are the
   * ones a stepper writes.
   */
  const reading: Template = {
    ...acting,
    lists: Object.fromEntries(
      Object.keys(acting.lists ?? {}).map((key) => [key, effectiveList(acting as Entity, key)]),
    ),
  };

  return (
    <div className="@container space-y-2.5">
      <div className="rounded-xl border border-stone-800 bg-stone-900/70 p-3.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-serif text-xl text-amber-50">{acting.name}</h2>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              foe ? 'bg-red-950 text-red-300' : 'bg-stone-800 text-stone-400'
            }`}
            style={!foe && accent ? { color: accent } : undefined}
          >
            {acting.type ?? 'unlisted'}
          </span>
          <span className="ml-auto font-mono text-[10px] text-stone-600">
            {index + 1} of {total} · round {round}
          </span>
        </div>

        {resources.length > 0 && (
          <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
            {resources.slice(0, 4).map((entry) => (
              <CounterStepper
                key={entry.name}
                entry={entry}
                big
                onBump={(delta) =>
                  onWrite({ list: 'resources', name: entry.name, value: bumped(entry, delta) })
                }
              />
            ))}
          </div>
        )}

        {/* The statuses, as toggles. Tap hangs one, tap takes it off —
            the severity rides the lit chip, which is the only place a
            number for it is visible on the stage. */}
        {(statuses.length > 0 || loose.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1">
            {statuses.map((status) => {
              const on = held(status.name);
              return (
                <button
                  key={status.name}
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors ${
                    on
                      ? 'bg-amber-700 text-stone-950'
                      : 'bg-stone-900 text-stone-500 hover:bg-stone-800'
                  }`}
                  title={status.relief ? `relieved by ${status.relief}` : status.name}
                  onClick={() =>
                    onWrite(
                      on
                        ? { list: 'conditions', name: status.name, remove: true }
                        : { list: 'conditions', name: status.name },
                    )
                  }
                >
                  {status.name}
                  {on?.value !== undefined && ` ${on.value}`}
                </button>
              );
            })}
            {loose.map((entry) => (
              <button
                key={entry.name}
                className="rounded-full bg-sky-950 px-2 py-0.5 font-mono text-[11px] text-sky-300 transition-colors hover:bg-red-950 hover:text-red-300"
                title="remove"
                onClick={() => onWrite({ list: 'conditions', name: entry.name, remove: true })}
              >
                {entry.name}
                {entry.value !== undefined && ` ${entry.value}`} ✕
              </button>
            ))}
          </div>
        )}

        <DoesRow
          acting={acting}
          armed={armed}
          onArm={onArm}
          costCounter={costCounter}
          onWrite={onWrite}
        />

        {/* And what it IS, right here. Same renderer the bestiary dialog
            uses — one statblock, two places, no chance of them drifting
            apart, at the stage's own density: small tiles, and the prose
            two-up once the stage is wide enough for it. `resources` is
            skipped: it's the bars above. */}
        <div className="mt-3 space-y-3 border-t border-stone-800 pt-3">
          <StatPools template={reading} skip={['resources', 'conditions', FRENZY]} dense />
          {/* The prose half reads the same way — a tolerance a frenzy
              moved has to move HERE too, or the sheet and the exchange's
              arithmetic say different numbers about the same creature.
              The words themselves are untouched: they're `notes` on the
              children, which no override can reach. */}
          <StatblockProse template={reading} dense />
        </div>

        {acting.notes && (
          <div className="mt-4">
            <span className={sectionLabel}>Notes</span>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-300">
              {acting.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
