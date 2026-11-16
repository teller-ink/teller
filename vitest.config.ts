// Standalone on purpose: vitest would otherwise load vite.config.ts and
// drag the Cloudflare plugin into a test run that owes it nothing. The
// core is headless node code; it tests as exactly that.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `scripts/` too: the pack converter's boundary parse is the one
    // place a printed statblock is read apart, and a grammar nothing
    // tests is a grammar that quietly stops matching the book.
    //
    // …and `examples/`, since the store became plugin №2 (§15). A
    // plugin's law is ordinary JavaScript in this checkout even though
    // it runs from somebody's shelf, and the alternative — a mechanic
    // that only gets exercised by the end-to-end door test — is how the
    // money arithmetic would quietly stop being anybody's job. What a
    // plugin CANNOT test here is its own installation; that stays the
    // server's test, where it belongs.
    include: [
      'core/**/*.test.ts',
      'server/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'examples/**/*.test.mjs',
      // …and the client's PURE helpers, never its wiring (§L): reading
      // "-9" as nine less is arithmetic a person trusts with a number,
      // and the cross-slot stream budget has races no click-through can
      // reliably reproduce. Arithmetic is what a test is for.
      'client/lib/**/*.test.ts',
      'client/panels/**/*.test.ts',
    ],
    environment: 'node',
  },
});
