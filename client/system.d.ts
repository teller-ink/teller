// The `system` specifier, for TypeScript's benefit (§L phase 3).
//
// `system` is not a package and never will be: it is a module the HOST
// generates per request (`/pack-code/system.js` — `systemIndexModule` in
// `core/packs-shelf.ts`), re-exporting one component per
// `presentations/*.tsx` the campaign's trusted packs supplied. Which
// names exist is a fact about the shelf at runtime, not about this
// checkout, so there is no honest static type to write here — the
// shorthand ambient declaration says exactly that, and every lookup goes
// through `presentationOf` (client/lib/presentations.ts), which is where
// the "and if it isn't there?" answer lives.
//
// The specifier itself resolves in three places, all pointing at the
// same url: the browser import map (client/index.html), Rollup's
// externals and the dev-server plugin (both vite.client.config.ts).
declare module 'system';

// The same module by its URL — how the APP loads it (dynamic import,
// no import-map dependency; see client/lib/presentations.ts).
declare module '/pack-code/system.js';
