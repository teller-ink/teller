// Where a carried thing IS — on you, in your hands, put away — as one
// small control per thing, and the sentence the system says when a
// table carries more than the book allows.
//
// The old app had no equip UI at all: a weapon you owned was a weapon
// you were holding, and armour did nothing until somebody remembered
// it. So this is new, and the shape it took is deliberately quiet — a
// select on the tile beside the chamber select it already had, not a
// mode, not a doll with slots. Choosing where a thing is should cost
// exactly one tap and no navigation.
//
// THREE RULES, and teller holds none of them (rule 1):
//
//   * The states, their limits and their sentences arrive as the
//     system's `carry` record. teller knows "a budget, a count, a
//     price, a sentence" and nothing else — `core/carry.ts`.
//   * Going past a limit is ALLOWED and SAID. The select never refuses
//     and the option is never disabled; the tile grows a line quoting
//     the system's own rule instead. A table that rules otherwise has
//     already ruled otherwise.
//   * The swap price is a PROPOSAL. Moving a thing from where it was
//     into your hands mid-fight costs what the system says it costs —
//     offered as one tap, on the tile, after the move; never taken
//     automatically, and gone if nobody takes it.

import { useState } from 'react';
import {
  loadIn,
  stateIn,
  stateOf,
  swapIn,
  type CarryDecl,
  type CarryLoad,
} from '../../../core/carry.ts';
import type { Entity, Ref } from '../../../core/entity.ts';
import type { Price } from '../../../core/spend.ts';
import { writeOwnRefs } from '../../lib/refs.ts';

/** What a state is called on the glass — its label, or its own slot word. */
export function sayState(decl: CarryDecl | undefined, name: string): string {
  return stateIn(decl, name)?.label ?? name;
}

/**
 * The whole move, as ONE write: out of wherever it was, into wherever
 * it's going. A slot holding one thing is written as a single ref and a
 * slot holding several as a list, which is the shape `refs` already
 * takes everywhere else — a state whose declared limit is one is still
 * written as a list if the table put two things in it, because
 * reporting the bend is the job and silently dropping one is not.
 */
export function moveCarry(
  person: Entity,
  child: Entity,
  decl: CarryDecl | undefined,
  to: string | undefined,
): Promise<Entity> {
  const ref: Ref = { id: child.id, name: child.name };
  const edits: Record<string, Ref | Ref[] | null> = {};
  for (const state of decl?.states ?? []) {
    const held = person.refs?.[state.name];
    const refs = (Array.isArray(held) ? held : held ? [held] : []).filter((r) => r.id !== child.id);
    if (state.name === to) refs.push(ref);
    edits[state.name] = refs.length === 0 ? null : refs.length === 1 ? refs[0] : refs;
  }
  return writeOwnRefs(person.id, edits);
}

/** The states carrying more than the system said they carry. */
export function carryOver(
  person: Entity | undefined,
  items: Entity[],
  decl: CarryDecl | undefined,
): CarryLoad[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (decl?.states ?? [])
    .map((state) => loadIn(person, state, byId, decl))
    .filter((load) => load.over);
}

/**
 * One thing's carry state, and the two things that can follow from
 * changing it: a price to accept, and a rule being bent.
 */
export function CarryControl({
  person,
  child,
  decl,
  over,
  onSpend,
}: {
  person: Entity;
  child: Entity;
  decl: CarryDecl | undefined;
  /** The states this person is overloading — this thing wears the ones it's in. */
  over: CarryLoad[];
  /** Take the swap price out of its own counter, through the ordinary door. */
  onSpend?: (ledger: Price[]) => void;
}) {
  const [owed, setOwed] = useState<{ counter: string; amount: number; as?: string } | undefined>(
    undefined,
  );
  if (!decl) return null;
  const here = stateOf(person, child.id, decl);
  // The bent rules this thing is part of — a knife in a full pair of
  // hands says the hands are full; a knife in a pocket says nothing.
  const bent = over.filter((load) => load.ids.includes(child.id));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <select
          className="h-8 min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-900 px-2 text-[0.7rem] uppercase tracking-wider text-stone-300 focus:border-stone-500 focus:outline-none"
          value={here ?? ''}
          onChange={(e) => {
            const to = e.target.value || undefined;
            const price = swapIn(decl, here, to);
            moveCarry(person, child, decl, to);
            setOwed(price && onSpend ? price : undefined);
          }}
          aria-label={`where ${child.name} is carried`}
        >
          <option value="">stowed</option>
          {decl.states.map((state) => (
            <option key={state.name} value={state.name}>
              {state.label ?? state.name}
            </option>
          ))}
        </select>
      </div>

      {/* The price of having just done that — offered, never taken. */}
      {owed && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex-1 rounded-md border px-2 py-1 text-[0.65rem] uppercase tracking-wider"
            style={{
              borderColor: 'var(--sheet-accent, #f59e0b)',
              color: 'var(--sheet-accent, #f59e0b)',
            }}
            onClick={() => {
              onSpend?.([{ counter: owed.counter, amount: owed.amount }]);
              setOwed(undefined);
            }}
          >
            {owed.as ? `${owed.as}: ` : ''}
            pay {owed.amount} {owed.counter}
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[0.65rem] text-stone-500 hover:text-stone-300"
            onClick={() => setOwed(undefined)}
            aria-label="not this time"
          >
            ✕
          </button>
        </div>
      )}

      {/* The book, quoted, on the tile that's arguing with it. */}
      {bent.map((load) => (
        <p key={load.state.name} className="text-[0.6rem] leading-snug text-amber-400/90">
          {load.state.hands !== undefined
            ? `${load.hands} of ${load.state.hands} hands · `
            : `${load.ids.length} of ${load.state.limit} · `}
          {load.rule ?? `more than one thing is ${load.state.label ?? load.state.name}`}
        </p>
      ))}
    </div>
  );
}
