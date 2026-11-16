// The floor's arithmetic — what a typed-in entry IS, and which entries
// are teller's own. Pure, so it can be read and tested without a page;
// the `floor` block in `blocks.tsx` is the only caller.

import { DRAFT_LIST, DRAFT_MARK, findEntry, type Entry } from '../../core/entity.ts';
import { SIDE_LIST, SIDE_MARK } from '../../core/side.ts';

/**
 * teller's OWN marks, by the list they live in — the side (`core/side.ts`),
 * the half-made draft (`core/entity.ts`) and the deployed-hidden mark
 * (`HIDDEN_MARK` in `server/public.ts`, spelled out here because the
 * client never imports the server). They are bookkeeping about the
 * entity, not entries in its game, and each has a control of its own on
 * the console — the sheet dialog's side switch and its draft and hidden
 * badges — so the floor never draws them as ordinary entries.
 */
/** `server/public.ts`'s deployed-hidden mark, by the same two words. */
export const HIDDEN_LIST = 'meta';
export const HIDDEN_MARK = 'hidden';

const TELLER_MARKS: readonly (readonly [list: string, mark: string])[] = [
  [SIDE_LIST, SIDE_MARK],
  [DRAFT_LIST, DRAFT_MARK],
  [HIDDEN_LIST, HIDDEN_MARK],
];

export function isTellerMark(list: string, entry: Entry | string): boolean {
  const l = list.trim().toLowerCase();
  const name = (typeof entry === 'string' ? entry : entry.name).trim().toLowerCase();
  return TELLER_MARKS.some(([ml, mm]) => ml === l && mm === name);
}

/** A list as the floor draws it — teller's marks taken out. */
export function floorEntries(list: string, entries: Entry[]): Entry[] {
  return entries.filter((entry) => !isTellerMark(list, entry));
}

/**
 * Does this list hold COUNTERS? Every entry already in it carries a
 * number. Read off the entries, never off the list's name (rule 2): a
 * list is what's in it.
 */
export function countsNumbers(entries: Entry[]): boolean {
  return entries.length > 0 && entries.every((entry) => typeof entry.value === 'number');
}

/** The add form, as typed — every field a string. */
export type FloorDraft = { list: string; name: string; value: string; max: string };

export type FloorVerdict =
  | {
      ok: true;
      list: string;
      name: string;
      value?: number | string;
      max?: number;
      /** No value at all — a mark (a tag, a condition), not a number. */
      mark: boolean;
      /** …and it is going into a list of counters, so ask once more. */
      unlikely: boolean;
    }
  | { ok: false; say: string };

/**
 * What a typed-in entry is, or why it isn't one yet.
 *
 * Blank value is a MARK — a legitimate thing (a tag, a held condition)
 * — words are a plain value, a number is a counter, and a number with a
 * ceiling is a bar. A ceiling with the value left blank starts FULL,
 * which is what someone typing "Health / 3" means. The list is matched
 * against the ones the entity already has without regard to case, so
 * "Resources" lands in `resources` rather than starting a twin.
 */
export function readDraft(draft: FloorDraft, lists: Record<string, Entry[]>): FloorVerdict {
  const typedList = draft.list.trim();
  const name = draft.name.trim();
  if (!typedList) return { ok: false, say: 'which list does it go in?' };
  if (!name) return { ok: false, say: 'it needs a name' };
  const list =
    Object.keys(lists).find((k) => k.toLowerCase() === typedList.toLowerCase()) ?? typedList;
  const held = lists[list] ?? [];

  if (isTellerMark(list, name)) {
    return { ok: false, say: `“${name}” in ${list} is teller’s own mark — the sheet’s header sets it` };
  }
  if (findEntry(held, name)) {
    return { ok: false, say: `${list} already has ${name} — change it where it is` };
  }

  const rawMax = draft.max.trim();
  const max = rawMax === '' ? undefined : Number(rawMax);
  if (max !== undefined && !Number.isFinite(max)) {
    return { ok: false, say: `${name}’s ceiling isn’t a number` };
  }

  const rawValue = draft.value.trim();
  let value: number | string | undefined;
  if (rawValue === '') value = max;
  else if (Number.isFinite(Number(rawValue))) value = Number(rawValue);
  else value = rawValue;
  if (max !== undefined && typeof value !== 'number') {
    return { ok: false, say: `a ceiling needs a number beside it — ${name} has words` };
  }

  const mark = value === undefined;
  return {
    ok: true,
    list,
    name,
    ...(value !== undefined ? { value } : {}),
    ...(max !== undefined ? { max } : {}),
    mark,
    unlikely: mark && countsNumbers(floorEntries(list, held)),
  };
}
