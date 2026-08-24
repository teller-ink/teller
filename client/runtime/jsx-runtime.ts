// The rung-4 import map's 'react/jsx-runtime' target — see react.ts for
// why this rides in the SAME rollup build as the app (one shared React,
// and here, one shared jsx-runtime module riding the same chunk graph).
// esbuild compiles panel `.tsx` with `jsx: 'automatic'` (`panels-shelf.ts`),
// which emits `import { jsx, jsxs } from "react/jsx-runtime"` — this is
// what that bare specifier resolves to.
//
// Named, not `export *`: Vite marks this package `needsInterop` (it's
// CJS, `.vite/deps/_metadata.json`), and in DEV `export * from
// 'react/jsx-runtime'` silently degrades to re-exporting only
// `default` — the interop rewrite Vite applies to a plain import site
// doesn't reach through a re-export. Naming the two members it
// actually carries sidesteps that rather than fighting it.
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

export { Fragment, jsx, jsxs };
