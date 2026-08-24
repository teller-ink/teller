// Id minting, the same convention as ever: a short prefix that says what
// kind of row this is, then twelve hex characters of nothing.
//
// `ent_` entities · `brd_` boards · `sys_` systems · `pak_` packs ·
// `bok_` books (those are content hashes, not minted here).
//
// Identity is the id, never the name — the lesson blueprints taught.

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
