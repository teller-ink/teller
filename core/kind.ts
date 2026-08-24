// The kind declaration — what a system says a list MEANS.
//
// Core stores; the system declares meaning; the panel decides
// presentation (`docs/CORE-NEXT.md` §1). This file is the middle claim
// made concrete: a declaration names a list, says what its values are,
// and — the discriminator that started the whole rebuild — says what
// ZERO means there. On the value that question was a mechanic hiding in
// a field; on the declaration it's the system layer doing its job.
//
// The three old kinds (statuses, marks, ladders) shared one spine — a
// population, a value domain, a label and a note — and this is that
// spine written once. Per-kind extras (a status's relieving skill, a
// mark's effect) are content and ride on the ENTRIES, in the pack.
//
// Drafted by contact in H step 1; question D said it would be. Expect
// amendment when WiW's declarations actually move in.
//
// A declaration matches its list BY NAME — vocabulary coupling, the
// same later-wins-by-name the whole merge runs on. Nothing here is
// required: an undeclared list is still a list, stored and editable
// (the degradation contract). Absence of a declaration means the safe
// defaults below.

import {
  findEntry,
  withoutEntry,
  sameName,
  type Entry,
} from './entity.ts';

export type KindDef = {
  /** Which list this declares. Matched by name, case-insensitive. */
  name: string;
  /** How the heading reads; the name itself if absent. */
  label?: string;
  note?: string;
  /**
   * What the values are. Absent means bare held names — chips.
   *
   * `count` — a number. `zero: 'clears'` says easing it to nothing
   * removes it (a condition); `'stays'` says zero is a fact you read
   * off the sheet (a resource). The DEFAULT is `'stays'`, because
   * deleting a value nobody declared deletable is automation past a
   * human — an undeclared list behaves like the old counters, and a
   * system opts a kind into clearing.
   *
   * `cap` is the per-kind ceiling, presented, never enforced: a panel
   * draws the scale, a human types past it if the table rules so
   * (rule 1). An instance's own `Entry.max` is the other scope.
   *
   * `steps` — an ordered scale of named rungs. An entry standing on
   * `rest` isn't stored at all — nothing is stored until it moves off
   * the default, so a system update that renames the resting rung
   * reaches everyone still standing there.
   *
   * `text` — a freely written value.
   */
  domain?:
    | { kind: 'count'; zero?: 'clears' | 'stays'; cap?: number }
    | { kind: 'steps'; steps: string[]; rest?: string }
    | { kind: 'text' };
};

/**
 * The forgiving read for a declaration arriving in pack JSON — same
 * posture as `toEntity`: keep what parses, drop what doesn't, never
 * throw at content.
 */
export function toKindDef(raw: unknown): KindDef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) return undefined;
  const out: KindDef = { name };
  if (typeof r.label === 'string' && r.label.trim()) out.label = r.label;
  if (typeof r.note === 'string' && r.note.trim()) out.note = r.note;
  const d =
    r.domain && typeof r.domain === 'object'
      ? (r.domain as Record<string, unknown>)
      : undefined;
  if (d?.kind === 'count') {
    out.domain = {
      kind: 'count',
      ...(d.zero === 'clears' || d.zero === 'stays' ? { zero: d.zero } : {}),
      ...(typeof d.cap === 'number' ? { cap: d.cap } : {}),
    };
  } else if (d?.kind === 'steps' && Array.isArray(d.steps) && d.steps.length) {
    out.domain = {
      kind: 'steps',
      steps: d.steps.map(String),
      ...(typeof d.rest === 'string' ? { rest: d.rest } : {}),
    };
  } else if (d?.kind === 'text') {
    out.domain = { kind: 'text' };
  }
  return out;
}

/** The declaration for that list, if the system made one. */
export function kindFor(
  kinds: KindDef[] | undefined,
  list: string,
): KindDef | undefined {
  return kinds?.find((k) => sameName(k.name, list));
}

/**
 * Set an entry, in place if it's already there — the one door for
 * writes, declaration-aware.
 *
 * Without a declaration this is the conservative write: values stick,
 * zero included, and removal is a human act (`withoutEntry`). With one:
 *
 *   * a `count` kind that clears — a Severity eased to nothing comes
 *     off entirely, and every surface that eases one gets the same
 *     answer;
 *   * a `steps` kind — the resting rung is stored as nothing, so
 *     "back to default" and "never mentioned" stay one fact.
 *
 * An existing entry's `max` survives a value write: moving `current`
 * never was permission to forget the ceiling.
 */
export function setEntry(
  entries: Entry[],
  name: string,
  value?: number | string,
  def?: KindDef,
): Entry[] {
  const domain = def?.domain;
  if (
    domain?.kind === 'count' &&
    domain.zero === 'clears' &&
    typeof value === 'number' &&
    value <= 0
  ) {
    return withoutEntry(entries, name);
  }
  if (
    domain?.kind === 'steps' &&
    domain.rest !== undefined &&
    typeof value === 'string' &&
    sameName(value, domain.rest)
  ) {
    return withoutEntry(entries, name);
  }
  const prior = findEntry(entries, name);
  // An existing entry keeps its own spelling: a write that means "change
  // the value" is not permission to re-case the table's word.
  const next: Entry = { name: prior?.name ?? name };
  if (value !== undefined) next.value = value;
  if (prior?.max !== undefined) next.max = prior.max;
  if (!prior) return [...entries, next];
  return entries.map((e) => (sameName(e, name) ? next : e));
}

/**
 * Where this entry stands on a `steps` kind — the stored rung, or the
 * resting one. Reading the default happens here, at the point of use,
 * never by writing it down (§8).
 */
export function stepOf(entry: Entry | undefined, def: KindDef): string | undefined {
  const domain = def.domain;
  if (domain?.kind !== 'steps') return undefined;
  if (typeof entry?.value === 'string') return entry.value;
  return domain.rest;
}
