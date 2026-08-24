#!/usr/bin/env node
//
// Build the tarball Homebrew installs.
//
// What goes in is the new world and nothing else: `bin/`, the server and
// the core it calls (TypeScript, unbundled — Node strips the types as it
// loads, so there is no build step at the far end), `defaults/` for the
// panels teller ships, the built client in `server/dist`, and a
// package.json that exists so `teller version` has something to read.
//
// **node_modules is no longer empty, and that's the honest part.** The
// old host imported nothing but node builtins, so the formula could
// unpack a folder and stop. The new server imports `esbuild` (a `.panel`
// and a pack's presentations are compiled on the host) and, when a
// rulebook is swept, `pdfjs-dist`. Neither can be wished away, so the
// tarball carries them — installed into the staged tree, production
// only, so `brew install` still unpacks a folder and stops.
//
// The cost, said out loud: both of those pull NATIVE binaries
// (`@esbuild/<platform>`, `@napi-rs/canvas`), so this tarball is built
// for the platform it was packed on. Cross-platform releases mean one
// tarball per platform (or a formula that installs deps at the far end),
// and that is a release-engineering decision the fold has to make — not
// something to discover from a Linux user's bug report.

import { execFile } from 'node:child_process';
import { mkdir, cp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `server` carries its own `dist` (the built client) and `public` (the
// vanilla fallback) along with it.
const INCLUDE = ['bin', 'core', 'server', 'defaults'];

// Tests are source, not product. Nothing in the installed copy runs them
// and vitest isn't there to try.
const skipTests = (src) => !src.endsWith('.test.ts');

// The two packages the server actually reaches for. Everything else in
// `dependencies` is the client's, and the client arrives built.
const DEPS = ['esbuild', 'pdfjs-dist'];

async function main() {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const name = `teller-${version}`;
  const out = join(ROOT, 'build');
  const stage = join(out, name);

  if (!(await stat(join(ROOT, 'server', 'dist', 'index.html')).catch(() => null))) {
    throw new Error('no client build — run `pnpm client:build` first');
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  for (const dir of INCLUDE) {
    await cp(join(ROOT, dir), join(stage, dir), { recursive: true, filter: skipTests });
  }

  // A stripped package.json: the installed copy is not a project anyone
  // builds from, and shipping devDependencies would invite Homebrew to
  // think otherwise. `type: module` and the dependency names stay,
  // because Node reads both when it resolves what's beside them.
  await writeFile(
    join(stage, 'package.json'),
    `${JSON.stringify(
      {
        name: 'teller',
        version,
        license: pkg.license,
        type: 'module',
        bin: { teller: 'bin/teller' },
        dependencies: Object.fromEntries(
          DEPS.map((dep) => [dep, pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep] ?? '*']),
        ),
        private: true,
      },
      null,
      2,
    )}\n`,
  );
  for (const file of ['LICENSE', 'README.md']) {
    await cp(join(ROOT, file), join(stage, file)).catch(() => {});
  }

  // The dependencies, installed rather than copied. Copying two folders
  // out of pnpm's store looks tidier and is wrong twice over: esbuild's
  // compiler is a native binary in a sibling `@esbuild/<platform>`
  // package, and pdfjs reaches for `@napi-rs/canvas` (native again) the
  // moment it loads. Both live in the store beside their parent, not
  // under it, and chasing them by hand is reimplementing a package
  // manager. So: a real, production-only install into the staged tree.
  // It needs the network at PACK time — never at install time, which is
  // the property the formula actually depends on.
  await run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--silent'], {
    cwd: stage,
  });
  await rm(join(stage, 'package-lock.json'), { force: true });

  const tarball = join(out, `${name}.tar.gz`);
  // Plain, portable tar. macOS ships bsdtar, which has neither --sort nor
  // --mtime, and gzip stamps a time of its own regardless — so chasing a
  // byte-identical archive would mean bundling a tar implementation to
  // win an argument nobody is having. The sha256 below is taken from the
  // artifact that actually gets uploaded, which is what the formula needs.
  await run('tar', ['-czf', tarball, '-C', out, name]);

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(tarball)) hash.update(chunk);
  const sha = hash.digest('hex');
  const size = (await stat(tarball)).size;

  await rm(stage, { recursive: true, force: true });

  console.log(`\n  ${tarball}`);
  console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB  (${process.platform}-${process.arch})`);
  console.log(`  sha256 ${sha}\n`);
  console.log('  formula fields:');
  console.log(
    `    url "https://github.com/teller-ink/teller/releases/download/v${version}/${name}.tar.gz"`,
  );
  console.log(`    sha256 "${sha}"\n`);

  await writeFile(join(out, 'sha256.txt'), `${sha}\n`);
}

main().catch((e) => {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
});
