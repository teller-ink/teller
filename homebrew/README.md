# Shipping `teller` through Homebrew

The install anyone else gets:

```sh
brew install teller-ink/tap/teller
teller host
```

That needs a **tap** — a second GitHub repo named `homebrew-tap` — and
a release tarball for the formula to point at. Both exist
(`teller-ink/homebrew-tap`, and the releases on `teller-ink/teller`);
this is the recipe that keeps them current.

## One-time: create the tap

A tap is just a repo with a `Formula/` directory. The name matters:
Homebrew maps `teller-ink/tap` to `github.com/teller-ink/homebrew-tap`.

```sh
gh repo create teller-ink/homebrew-tap --public \
  --description "Homebrew formula for teller"
git clone git@github.com:teller-ink/homebrew-tap.git
mkdir -p homebrew-tap/Formula
cp homebrew/teller.rb homebrew-tap/Formula/teller.rb
```

It can live in this repo instead, but a separate tap keeps release churn
out of the project's history — the formula changes on every version, and
nothing else does.

## Every release

```sh
pnpm run pack
```

(`pnpm run pack`, not `pnpm pack` — the bare form is pnpm's own packer
and writes a tarball of the whole repo.)

Builds the client and writes `build/teller-<version>.tar.gz`, then prints
the `url` and `sha256` lines to paste into the formula. What's inside is
the server and core as source, the built client, `defaults/`, a stripped
`package.json` — and a production `node_modules` holding the two packages
the server reaches for (`esbuild`, `pdfjs-dist`). Those bring native
binaries, so **the tarball runs on the platform it was packed on**. The
formula says so with `depends_on arch:` / `depends_on :macos`; widening
that means one tarball per platform, or a formula that installs at the
far end (`scripts/pack.mjs` has the argument).

Then:

```sh
gh release create v0.2.0 build/teller-0.2.0.tar.gz --title "teller 0.2.0"
# paste the printed url + sha256 into Formula/teller.rb, commit, push
```

## Check it before anyone else does

```sh
brew install --build-from-source ./homebrew/teller.rb
brew test teller
brew audit --strict --new teller
teller host
```

`brew audit --new` is the one that catches what a first-time formula gets
wrong. Run it before publishing, not after.

## Notes

- **Node 24 is the floor.** teller keeps its database in node's own
  SQLite (`node:sqlite`) and runs its TypeScript unbundled. The CLI
  checks at startup and says so in a sentence rather than a stack trace.
- **The shim runs Homebrew's node explicitly**, not whatever `node` is
  first on `PATH`. On a developer's machine that's frequently an nvm
  shim pointing at something ancient.
- **Homebrew core is not the goal yet.** Core requires notability, and a
  tap is the normal home for a project this age. `brew install
  teller-ink/tap/teller` is one line either way.
- Linux and Intel Macs run teller from a checkout today. Nothing in the
  code is macOS-specific; the tarball is.
