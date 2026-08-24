import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The core-next client — React, bundled (§E extended: the ladder).
// Separate config from the old world's vite.config.ts on purpose: that
// one carries the cloudflare plugin and serves the OLD app on 4525 as
// the visual reference. This builds client/ into server/dist, which
// the node server prefers over server/public when it exists.

const runtimeEntries = {
  'runtime-react': fileURLToPath(new URL('client/runtime/react.ts', import.meta.url)),
  'runtime-jsx-runtime': fileURLToPath(
    new URL('client/runtime/jsx-runtime.ts', import.meta.url),
  ),
  'runtime-teller': fileURLToPath(new URL('client/runtime/teller.ts', import.meta.url)),
};

// The rung-4 import map (§E UN-DEFERRED) lives as a literal
// <script type="importmap"> in client/index.html, mapping 'react',
// 'react/jsx-runtime' and 'teller' to `/runtime-react.js` etc — the
// same urls in BOTH dev and prod, so the html file needs no forking:
//
// PROD: the three runtime-*.ts entries above ride the SAME rollup
// build as the app itself (see build.rollupOptions.input below) —
// that's what makes "one React instance" true: Rollup dedupes the
// 'react' module into a chunk both `main` and `runtime-react` share,
// rather than each entry bundling its own copy. `entryFileNames` keeps
// their OUTPUT names stable (unhashed) so index.html's import map
// never has to change between builds.
//
// DEV: `pnpm client:dev` never runs the bundler, so there's no built
// `/runtime-react.js` file to serve statically. This plugin's dev
// middleware answers those same urls anyway: it maps each to its
// `client/runtime/*.ts` source and calls Vite's own
// `server.transformRequest()` — the identical TS-module transform
// Vite would apply if a `<script type="module">` requested that file
// directly (module-graph resolution, HMR wiring and all). One url,
// one meaning, either way the client is served — no separate dev-mode
// import map to keep in sync.
const DEV_SOURCE: Record<string, string> = {
  '/runtime-react.js': '/runtime/react.ts',
  '/runtime-jsx-runtime.js': '/runtime/jsx-runtime.ts',
  '/runtime-teller.js': '/runtime/teller.ts',
};

function panelRuntimeDevPlugin(): Plugin {
  return {
    name: 'teller-panel-runtime-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];
        const source = url ? DEV_SOURCE[url] : undefined;
        if (!source) return next();
        try {
          const result = await server.transformRequest(source);
          if (!result) return next();
          res.setHeader('Content-Type', 'text/javascript');
          res.end(result.code);
        } catch (err) {
          next(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
  };
}

// `system` (§L phase 3) is the fourth bare specifier, and the odd one
// out: the other three are FILES in this checkout, while `system` is a
// module the host GENERATES per request (`/pack-code/system.js`) out of
// whatever packs the campaign trusts right now. There is nothing here to
// bundle, and bundling it would be wrong even if there were — the whole
// point is that a different shelf answers differently.
//
// So it stays a bare specifier in the browser, in both modes, and the
// import map in `client/index.html` is what resolves it:
//
// PROD: `build.rollupOptions.external` below. Rollup leaves
// `import … from "system"` in the output untouched.
//
// DEV: Vite's import analysis rewrites bare specifiers to something it
// pre-bundled, and 'system' is in no node_modules, so left alone it
// fails to resolve at scan time. This plugin answers `resolveId` for
// it — with the URL, not the bare word, and that difference is the
// honest part: an id left bare AND external is rewritten by the dev
// server to `/@id/system`, an internal address nothing serves (it 404s,
// and the app never mounts). So dev names the destination directly and
// the `/pack-code` proxy below carries it to the node server.
//
// The asymmetry is real and worth stating plainly: the built client
// imports `"system"` and the browser's import map resolves it; the dev
// client imports `"/pack-code/system.js"` and skips the map. Same file,
// same server, same bytes — and the map is still exercised in dev
// anyway, because panel and pack code (compiled by esbuild, fetched
// raw) imports the bare specifiers and nothing rewrites those.
//
// `enforce: 'pre'` so it beats resolution, `apply: 'serve'` so prod
// keeps using the externals list rather than two mechanisms racing to
// say the same thing.
//
// Known cosmetic noise: on startup the dev server's module crawler
// prints one `Pre-transform error: Failed to load url
// /pack-code/system.js` — it walks the graph eagerly and doesn't know
// this edge leaves the graph on purpose. The browser is served the
// external import correctly; nothing is broken, and the line is a
// warning, not a failure.
const SYSTEM_URL = '/pack-code/system.js';

function systemSpecifierDevPlugin(): Plugin {
  return {
    name: 'teller-system-specifier-dev',
    enforce: 'pre',
    apply: 'serve',
    resolveId(id) {
      return id === 'system' ? { id: SYSTEM_URL, external: true } : null;
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss(), panelRuntimeDevPlugin(), systemSpecifierDevPlugin()],
  build: {
    outDir: '../server/dist',
    emptyOutDir: true,
    rollupOptions: {
      external: ['system'],
      // The three runtime entries exist to be imported BY NAME from
      // outside the bundle (`import { SheetPanel } from 'teller'`), and
      // Vite's app default — `preserveEntrySignatures: false` — is the
      // exact opposite assumption: it treats every entry as a script
      // nobody imports and is free to rename or drop its exports. It
      // did both. The built `runtime-teller.js` was emitting
      // `export{lt as G, Ct as P, k as a, …}` — mangled chunk-internal
      // names — so every panel and pack module failed to link in
      // PRODUCTION with "does not provide an export named 'SheetPanel'",
      // while dev (which serves the transformed source, exports intact)
      // looked perfect. 'strict' says what's actually true: these
      // entries are a public API and their signature is load-bearing.
      preserveEntrySignatures: 'strict',
      input: {
        main: fileURLToPath(new URL('client/index.html', import.meta.url)),
        ...runtimeEntries,
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name.startsWith('runtime-') ? '[name].js' : 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    port: 4527,
    host: true, // LAN-exposed so seat cards can be tested from phones
    proxy: {
      // The node server owns /api, /files and the SSE stream; the
      // proxy streams SSE fine (http-proxy does not buffer).
      '/api': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
      '/files': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
      '/panel-code': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
      // …and a plugin's compiled panes (§15's UI tier), which are panel
      // code by every property that matters to a dev server.
      '/plugin-code': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
      // …and the pack's, including the generated `/pack-code/system.js`
      // the import map points `system` at (§L phase 2).
      '/pack-code': { target: process.env.TELLER_DEV ?? 'http://localhost:4526' },
    },
  },
});
