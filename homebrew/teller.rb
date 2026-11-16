# teller — Homebrew formula.
#
# The copy that ships lives in teller-ink/homebrew-tap as
# Formula/teller.rb; update `url` and `sha256` from `pnpm run pack` on
# each release. See homebrew/README.md.
#
# It's short because nothing is built at the far end: the tarball carries
# the server as source, the client already built, and the two packages
# the server reaches for (esbuild, pdfjs-dist) already installed. Those
# two bring native binaries, so a tarball runs on the platform it was
# packed on. The two platform lines below say that out loud, so every
# other machine gets a clear refusal instead of a broken install.
class Teller < Formula
  desc "In-person TTRPG companion — the table plays, teller keeps the books"
  homepage "https://teller.ink"
  url "https://github.com/teller-ink/teller/releases/download/v0.2.1/teller-0.2.1.tar.gz"
  sha256 "3b0907dcf838724b4fc7cc977d488037dcd1b8312d40ea9c1dd6c64a5dcc38dd"
  license "AGPL-3.0-only"

  # Packed on, and so far only for, Apple silicon (scripts/pack.mjs).
  depends_on arch: :arm64
  depends_on :macos
  # Node 24 is the floor: teller keeps its database in node's own SQLite
  # (`node:sqlite`) and runs its TypeScript unbundled.
  depends_on "node"

  def install
    libexec.install Dir["*"]
    # An explicit shim rather than a symlink, so the command always runs
    # under Homebrew's node — not whatever `node` happens to be first on
    # a user's PATH, which on a developer's machine is anyone's guess.
    # The opt path is spelled out rather than asked of a formula object:
    # it is the same stable path, and it reads the same on a Homebrew
    # too old to know the newer helper the audit would prefer.
    (bin/"teller").write <<~SH
      #!/bin/bash
      exec "#{HOMEBREW_PREFIX}/opt/node/bin/node" "#{libexec}/bin/teller" "$@"
    SH
    chmod 0755, bin/"teller"
  end

  def caveats
    <<~EOS
      Start your table with:
        teller host

      Campaigns live in ~/.teller — or point it somewhere you can carry:
        teller host /Volumes/YOUR-CARD

      The DM key is generated on first run and printed at startup.
      Show it again with: teller key
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/teller version")
    assert_match "teller keeps the books", shell_output("#{bin}/teller help")
    # `where` must answer without creating anything — it's the one command
    # safe to run before you've decided where your campaigns should live.
    assert_match ".teller", shell_output("#{bin}/teller where")
  end
end
