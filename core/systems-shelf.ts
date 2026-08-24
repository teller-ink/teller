// The fourth shelf dir — `~/.teller-next/systems/<name>/` (§M·4).
//
// §M drew the line the migration hadn't yet: a SYSTEM is pure function
// (kinds, dice, effects, mechanics code, unbranded panels — freely
// distributable because mechanics aren't protectable expression) and a
// PACK is the book's stuff (monsters, prose, art, branded panels, rights
// following the content). Phase 1 put `system.json` INSIDE the pack
// folder because one converter run produced both halves; that was
// right-for-the-migration and known-temporary. This module is the
// separation: a system is its own folder, on its own shelf, with its own
// trust row and its own code.
//
//   systems/wiw/
//     system.json          sys_ id, name, version, and the record slots
//                          inline — the same file, the same reserved
//                          keys, read by the same `systemFrom`
//     trades.json          every other *.json is a SLOT named by its
//                          file, exactly as in a pack folder — for the
//                          lists that don't want to be in the one
//                          hand-edited buffer. `system.json` wins on a
//                          name collision.
//     presentations/*.tsx  the system's own components, compiled by the
//                          shared esbuild pass, `PACK_IMPORTS` (no
//                          `system` self-import — these ARE the system)
//     panels/<name>/       ordinary `.panel` folders, swept by
//                          `sweepPanelsIn` — the system's furniture,
//                          merging above teller's floor and below the
//                          packs
//     art/                 assets function demands, installed under
//                          `art/<sys_id>/…` exactly as a pack's are
//
// NOTHING about the loaded model changed: a folder here yields the same
// `ShelfSystem` a `system.json` inside a pack yields, and the same one a
// `shelf.db` row yields. What changed is WHERE the authoring copy lives
// and, therefore, who may hand it on.
//
// **Precedence, per id: this folder > a pack-folder-embedded
// `system.json` > a `shelf.db` row.** Same law as everywhere else and
// for the same reason (`boot.ts` applies it): the more authored, more
// specific copy wins, and the ones it shadows stay readable so nothing
// breaks on the way through. An old export whose system rides inside its
// pack keeps working forever — that is the compatibility contract, and
// it has a test.
//
// …and BELOW all three, teller's own: `defaults/systems/` in the
// INSTALL, read where it lies by the same sweep (`defaultSystems`,
// 2026-08-21). A virgin host offered no system at all and first-run
// dead-ended at the campaign screen; the fix is §M-6's, verbatim from
// what `defaults/panels/` already does — defaults ship WITH teller,
// nothing is ever written into the data dir, so nothing goes stale and
// nothing resurrects. It is the BOTTOM of the fallback and never the
// top: a shelf system restating a shipped id wins outright, because a
// system a person put there and a system that shipped are the same kind
// of thing (rule 4) and the person's is the one they edited.
//
// Trust is the pack machinery verbatim: one `pluginTrust` row, keyed by
// the `sys_` id, gating CODE and never data. A system's declarations,
// kinds and dice load for anyone; its presentations wait for a human.
// Brian's own shelf is his own files, so the row is minted enabled by
// the hand that put the folder there (see the §M note in CORE-NEXT).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFolder, readBuildMeta, stamp, NEUTRAL_IMPORTS } from './compile.ts';
import {
  compilePackCode,
  copyNewer,
  systemFrom,
  withInstalledArt,
  type PackProblem,
  type SystemExport,
  type ShelfSystem,
} from './packs-shelf.ts';
import { panelDirIn, sweepPanelsIn } from './panels-shelf.ts';
import type { PanelDef } from './panels.ts';
import type { Shelf } from './store.ts';

// `SystemExport` is declared in `packs-shelf.ts`, beside the shim that
// re-exports one and the index module it is a sibling of; re-exported
// here because a system folder is what produces them.
export type { SystemExport } from './packs-shelf.ts';

/** A system as its own folder holds one — the shelf shape, plus what only a folder can carry. */
export type ShelfSystemFolder = ShelfSystem & {
  /** Compiled presentations, attached only once a human trusted the `sys_` id. */
  code?: {
    presentations: Record<string, string>;
    /** `exports/<name>` → where it is and what it exports. */
    exports?: Record<string, SystemExport>;
    /** `system/<name>` specifiers the system's OWN code imports. */
    needs?: string[];
  };
  /** A folder that compiled code nobody has enabled yet. Its DATA loaded regardless. */
  codePending?: boolean;
};

export type SystemSweep = { systems: ShelfSystemFolder[]; problems: PackProblem[] };

/**
 * Every system folder on the shelf, in folder-name order. A folder with
 * no `system.json` is not a system and is skipped in silence
 * (`sweepPacks`'s posture for a folder with no `pack.json`); one whose
 * `system.json` doesn't parse is a problem in the report and contributes
 * nothing.
 */
export function sweepSystems(dataDir: string, shelf?: Shelf): SystemSweep {
  return sweepSystemsIn(join(dataDir, 'systems'), {
    shelf,
    artInto: join(dataDir, 'art'),
    code: true,
  });
}

/**
 * The sweep itself, over any `systems/` root — the shelf's, or the
 * INSTALL's (`defaultSystems`). Split out for the same reason
 * `sweepPanelsIn` was: two roots, one reader, and the floor is read
 * exactly the way a shelf folder is or it isn't the same kind of thing.
 *
 * `artInto` and `code` are what only a SHELF folder gets. teller's own
 * install may be read-only (a brew cellar, a tarball unpacked beside
 * the binary), and both of those write — art copies into the data dir,
 * code compiles into `<dir>/.build/`. So the install floor is DATA, and
 * a default that wants pictures or components wants to be a folder on
 * somebody's shelf; better to learn that in the open than to have teller
 * quietly try to write into its own installation.
 */
export function sweepSystemsIn(
  root: string,
  opts: { shelf?: Shelf; artInto?: string; code?: boolean } = {},
): SystemSweep {
  const { shelf, artInto, code = false } = opts;
  const systems: ShelfSystemFolder[] = [];
  const problems: PackProblem[] = [];
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return { systems, problems };
  }

  for (const name of names.sort()) {
    const dir = join(root, name);
    const path = join(dir, 'system.json');
    if (!existsSync(path)) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      problems.push({ dir, problem: `system.json did not parse: ${String((err as Error).message ?? err)}` });
      continue;
    }
    const record =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined;
    if (!record) {
      problems.push({ dir, problem: 'system.json is not a system (needs an object)' });
      continue;
    }

    // The id has to be known before the art install, because a system's
    // pictures are keyed by it — same order `sweepPacks` uses.
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const artDir = join(dir, 'art');
    if (id && artInto && existsSync(artDir)) {
      try {
        copyNewer(artDir, join(artInto, id));
      } catch (err) {
        problems.push({ dir, problem: `art/ did not install: ${String(err)}` });
      }
    }

    const { system, problem } = systemFrom(record, id);
    if (problem) problems.push({ dir, problem });
    if (!system) continue;

    // …and every OTHER `*.json` beside it is a slot named by its file,
    // exactly as a pack folder's are. The file split is a serialization,
    // not a data model (rule 4a): a system's twenty small records still
    // want one editor buffer, but a list — seven trades, each with a
    // skill spread — is a file, the same way sixty-five foes are.
    // `system.json` WINS on a collision: it is the file a person edits
    // by hand, and the reserved three (`id`, `name`, `version`) are
    // never slots wherever they're written.
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.json') || file === 'system.json') continue;
      const slot = file.slice(0, -'.json'.length);
      if (slot in system.data) continue;
      let held: unknown;
      try {
        held = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      } catch (err) {
        problems.push({ dir, problem: `${file} did not parse: ${String((err as Error).message ?? err)}` });
        continue;
      }
      system.data[slot] = withInstalledArt(held, id);
    }

    // The system's own panels ride in its data blob, as the `panels`
    // slot every layer merges by name — so a system panel overrides
    // teller's floor and a pack's overrides the system's, with no new
    // resolution rule anywhere.
    const panels = sweepPanelsIn(join(dir, 'panels'), shelf);
    for (const p of panels.problems) problems.push(p);
    if (panels.panels.length) {
      const floor = Array.isArray(system.data.panels)
        ? (system.data.panels as PanelDef[])
        : [];
      system.data.panels = [...floor, ...panels.panels];
    }

    const entry: ShelfSystemFolder = system;
    if (code) {
      const { presentations, needs, problems: codeProblems } = compilePackCode(dir, system.id);
      for (const problem of codeProblems) problems.push({ dir, problem });
      // …and the system's declared function beside its faces (§M-4a).
      // Both halves take the SAME trust row, because they are the same
      // system's code arriving through the same door.
      const { exports, problems: exportProblems } = compileSystemExports(dir, system.id);
      for (const problem of exportProblems) problems.push({ dir, problem });
      if (presentations || exports) {
        if (shelf?.pluginTrust(system.id)?.enabled) {
          entry.code = {
            presentations: presentations ?? {},
            ...(exports ? { exports } : {}),
            ...(needs?.length ? { needs } : {}),
          };
        } else entry.codePending = true;
      }
    }
    systems.push(entry);
  }

  return { systems, problems };
}

/**
 * Where teller's own systems live: `defaults/systems/`, in the INSTALL,
 * resolved against this module's location — never relative to cwd, and
 * never inside anyone's data dir. `defaultsRoot`'s twin, and the same
 * walk, because a built layout may nest the code a level or two deeper.
 */
export function defaultSystemsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let up = 0; up < 5; up += 1) {
    const candidate = join(dir, 'defaults', 'systems');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(here, '..', 'defaults', 'systems');
}

/**
 * The systems teller SHIPS — read where they lie, cached like the
 * default panels, and the bottom of the per-id fallback rather than a
 * layer of their own (§M-6, 2026-08-21).
 *
 * Systems don't stack the way panels do — a campaign names ONE, by id —
 * so "the floor layer of systems" is a FALLBACK: `boot.ts` looks for the
 * id on the shelf first (folder, then pack-embedded, then row) and only
 * then here. A shelf system restating a shipped id therefore wins
 * outright, which is the property rule 4 asks for — a system a person
 * put on the shelf and a system that shipped with teller are the same
 * kind of thing, and the shipped one never outranks the edit.
 *
 * And it never resurrects, because teller writes nothing: seeding a copy
 * into `~/.teller/systems/` is exactly the wrinkle §M-6 killed for
 * panels. Deleting a shipped system's shelf copy falls back to the
 * install's; upgrading teller upgrades it.
 */
let cachedDefaults: ShelfSystemFolder[] | undefined;
export function defaultSystems(): ShelfSystemFolder[] {
  if (!cachedDefaults) cachedDefaults = sweepSystemsIn(defaultSystemsRoot()).systems;
  return cachedDefaults;
}

/**
 * A system's DECLARED FUNCTION (§M-4a): `exports/*.ts(x)`, compiled by
 * the same pass as everything else, into the same `.build` folder, served
 * through the same `/pack-code/<sys_id>/…` door. The FILENAME is the
 * export name — `exports/creation.ts` is `system/creation`, and a pack
 * importing that specifier is asking for this file.
 *
 * The neutral externals only: an export is the bottom of the merge, so
 * it may not import the merged index (`system`) — that is the cycle bare
 * `system` is closed to packs to prevent, and it would be the same cycle
 * here — and it may not import a sibling through `system/…` either. A
 * helper beside it is an ordinary relative import and gets bundled.
 *
 * Trust is the caller's business, as ever: this compiles and reports
 * regardless, and only the folder sweep decides who gets the urls.
 */
export function compileSystemExports(
  dir: string,
  systemId: string,
): { exports?: Record<string, SystemExport>; problems: string[] } {
  const srcDir = join(dir, 'exports');
  if (!existsSync(srcDir)) return { problems: [] };

  const problems: string[] = [];
  const outDir = join(dir, '.build', 'exports');
  const { built, problems: compileProblems } = compileFolder(srcDir, outDir, NEUTRAL_IMPORTS, [
    '.tsx',
    '.ts',
  ]);
  for (const { file, problem } of compileProblems) problems.push(`exports/${file}: ${problem}`);

  const exports: Record<string, SystemExport> = {};
  for (const name of built) {
    const out = join(outDir, `${name}.js`);
    exports[name] = {
      url: `/pack-code/${systemId}/exports/${name}.js${stamp(out)}`,
      names: readBuildMeta(out).exports,
    };
  }
  return { exports: Object.keys(exports).length ? exports : undefined, problems };
}

/**
 * Which folder holds a system's compiled output, for the server's
 * `/pack-code/<id>/…` route — `packDir`'s twin. The route prefix stays
 * `pack-code` on purpose: it is the CONTENT SHELF's code door, one
 * route serving whatever carries presentations, and renaming it would
 * break every url already baked into a `.build` output and the client's
 * import map for no gain.
 */
export function systemDir(dataDir: string, systemId: string): string | undefined {
  const root = join(dataDir, 'systems');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return undefined;
  }
  for (const name of names) {
    const dir = join(root, name);
    const path = join(dir, 'system.json');
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { id?: unknown };
      if (raw && typeof raw === 'object' && raw.id === systemId) return dir;
    } catch {
      // a broken system.json is sweepSystems's problem to report, not this lookup's
    }
  }
  return undefined;
}

/**
 * Which system folder holds a code-carrying PANEL's build, for
 * `/panel-code/<pan_id>/…` to resolve after the table's own `panels/`
 * came up empty. A system's panels are ordinary panels — same id
 * scheme, same trust row — so the only thing the route needs is a
 * second place to look.
 */
export function systemPanelDir(dataDir: string, panelId: string): string | undefined {
  const root = join(dataDir, 'systems');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return undefined;
  }
  for (const name of names.sort()) {
    const hit = panelDirIn(join(root, name, 'panels'), panelId);
    if (hit) return hit;
  }
  return undefined;
}
