// Mid-game rule lookups off the merged SECTIONS declaration
// (`/api/stack/declarations/sections`, §E) — ported search from the old
// app's `useRuleLookup` (src/lib/rules.ts). The merge already happened
// server-side (`Loaded.declarations`, name-keyed, later pack wins), so
// this file only has to flatten and search what it's handed.

import { useMemo } from 'react';
import { api } from './api.ts';
import { DECLARED, useLive } from './use-session.ts';

export type RuleEntry = {
  name: string;
  meta?: string;
  text: string;
  page?: number;
  book?: string;
};

export type RuleSection = { name: string; entries: RuleEntry[] };

export type RuleHit = RuleEntry & { section: string };

/** The declared sections, live — empty on a host with no pack. */
export function useRuleSections(): RuleSection[] {
  const { data } = useLive(() => api<RuleSection[]>('/api/stack/declarations/sections'), [], {
    on: DECLARED,
  });
  return data ?? [];
}

/** Case-insensitive rule-entry lookup by exact name, across every section. */
export function useRuleLookup(): (name: string) => RuleHit | undefined {
  const sections = useRuleSections();
  return useMemo(() => {
    const map = new Map<string, RuleHit>();
    for (const section of sections) {
      for (const entry of section.entries) {
        map.set(entry.name.trim().toLowerCase(), { ...entry, section: section.name });
      }
    }
    return (name: string) => map.get(name.trim().toLowerCase());
  }, [sections]);
}

/**
 * The caption a pack sets under a panel heading — "practice & master
 * with Prestige" — ported from the old app's `usePanelNote`
 * (`src/lib/rules.ts`), which read `pack.notes[title]`. The merge
 * already happened server-side, the same way `sections` does: the
 * merged system+pack `notes` record (`/api/stack/record/notes`) is
 * title → caption, later layer wins. Publisher prose (rule 4), so this
 * never invents a caption — a title with none renders none.
 */
export function usePanelNote(): (title: string) => string | undefined {
  const { data } = useLive(
    () => api<Record<string, string>>('/api/stack/record/notes'),
    [],
    { on: DECLARED },
  );
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const [title, note] of Object.entries(data ?? {})) {
      map.set(title.trim().toLowerCase(), note);
    }
    return (title: string) => map.get(title.trim().toLowerCase());
  }, [data]);
}
