// The token palette — one copy, because both ends colour tokens now.
//
// The editor colours a token you drop by hand (`client/components/board/
// model.ts` re-exports this) and deploying a prepared fight colours one
// per foe (`Session.deployEncounter`). The old world learned this the
// hard way and wrote it down in `worker/tokens.ts`: two copies drift,
// and a foe whose colour changed between prep and deploy is a foe you
// can't find on the table mid-fight.
//
// It lives in core because core is the only floor both a browser and a
// server stand on. Colours are vocabulary, not semantics — nothing here
// decides anything about a fight.

/** Token colours — the deployment palette, sides rather than species. */
export const TOKEN_COLORS = [
  '#d6d3d1',
  '#38bdf8',
  '#65a30d',
  '#dc2626',
  '#d97706',
  '#a855f7',
  '#f472b6',
  '#0f766e',
];

/** The nth token's colour, wrapping — stable for a given index. */
export function tokenColor(index: number): string {
  return TOKEN_COLORS[((index % TOKEN_COLORS.length) + TOKEN_COLORS.length) % TOKEN_COLORS.length];
}
