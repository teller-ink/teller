// Ported verbatim from the old app (src/lib/tags.ts) — pure, no data-shape
// changes needed. The new Entry model keeps name and severity SEPARATE
// (`Entry.value`), so nothing in the new client needs the string-encoding
// this file exists to parse — kept anyway per the port instructions, and
// because a stray legacy-shaped tag string is still worth reading kindly.

export type ParsedTag = { name: string; value: number | null };

/** `"Afraid 3"` or `"Afraid [3]"` → `{ name: 'Afraid', value: 3 }`. */
export function parseTag(tag: string): ParsedTag {
  const m = tag.match(/^(.*?)\s+\[?(\d+)\]?$/);
  return m ? { name: m[1].trim(), value: Number(m[2]) } : { name: tag, value: null };
}

/** The canonical form. Zero or less means the tag shouldn't exist at all. */
export function formatTag(name: string, value: number | null): string {
  return value === null ? name : `${name} ${value}`;
}

/** Do these two tags name the same thing, whatever their numbers are? */
export function sameTag(a: string, b: string): boolean {
  return (
    parseTag(a).name.trim().toLowerCase() === parseTag(b).name.trim().toLowerCase()
  );
}
