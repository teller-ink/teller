// How a plugin loads. `docs/CORE-NEXT.md` §15.
//
// A plugin is a folder on the shelf — `<dataDir>/plugins/<name>/` —
// manifest beside code: `plugin.json` claims what it is and what it
// wants; `host.mjs` exports implementations keyed by extension point.
//
// The load path is three separate acts, and the separation is the
// security model:
//
//   * DISCOVERY (`discoverPlugins`) reads the folders and reports.
//     It writes nothing, ever — a plugin appearing on disk is a
//     proposal, exactly like a pack arriving in the sweep.
//   * ENABLEMENT is a human act in the console, recorded on the shelf
//     (`shelf.setPluginEnabled`). Content may REQUIRE a plugin by ref;
//     requirement is a claim and cannot grant trust.
//   * LOADING (`loadPlugins`) imports only what a human enabled, keeps
//     only the provides whose points exist in the registry, and reports
//     everything it refused — a provide against a point this build has
//     never heard of is refused OUT LOUD, not dropped.
//
// Since the UI tier landed (§15, 2026-08-20) a plugin may also carry
// SURFACES and DOORS, and both ride the same three acts above:
//
//   * A `pane.*` provision is pure declaration — the word, the label,
//     the subject, and where its code is — compiled here by the same
//     esbuild pass a `.panel` folder gets, into `.build/panes/`. It is
//     compiled only for a plugin somebody ENABLED, because a pane IS
//     its code and there is nothing useful to load for a plugin nobody
//     trusts.
//   * A `door.*` provision is an implementation in `host.mjs`, wired
//     like any other point. What makes it a door is the bridge on the
//     other side (`server/plugin-bridge.ts`), not anything here: this
//     file still only ever wires a name to a function behind a clone
//     boundary.
//
// The call boundary is async and message-shaped from day one:
// serializable snapshots in, serializable proposals out, no live
// objects — enforced here by structuredClone on both sides of every
// call, so moving a plugin out of process later is a transport change,
// not an API break. Stated honestly: in-process code is NOT sandboxed;
// pre-alpha, the enable gate is the security model.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildOne, newerThan, readBuildMeta, stamp, PLUGIN_IMPORTS } from './compile.ts';
import {
  familyOf,
  isPoint,
  suffixOf,
  toAccess,
  toNeed,
  type DoorAccess,
  type Need,
  type PaneProvision,
  type Point,
} from './registry.ts';
import type { Shelf } from './store.ts';

/**
 * ONE CLAIM in a manifest's `provides`.
 *
 * A string is the whole claim for a point whose implementation lives in
 * `host.mjs` (`propose.turn`, `door.shop`) — the module says how, the
 * manifest only says that. A `pane.*` provision has no host half at all
 * and everything about it is declaration, so it arrives as an OBJECT
 * with its word, its label and where its code is. Same list, because it
 * is the same question ("what does this plugin add?") and splitting it
 * into two manifest keys would mean reading two places to answer it.
 */
export type Provision = { point: string } & Record<string, unknown>;

export type PluginManifest = {
  /** `plg_…`, minted at authoring. Identity is the id, never the folder name. */
  id: string;
  name: string;
  version: number;
  /** Extension points it claims to implement. Checked against the registry at load. */
  provides: Provision[];
  /**
   * What it wants from the host — app-permissions style, shown at
   * enable. `[]` is a meaningful, checkable claim, and since the door
   * tier landed it is a checkED one: the snapshot a door receives
   * carries exactly the `read:` needs, and an effect outside the
   * `write:` needs is refused (`server/plugin-bridge.ts`).
   */
  needs: Need[];
  /** The needs as WRITTEN, for a console that shows a human what it's agreeing to. */
  wants: string[];
};

export type Discovered = {
  dir: string;
  manifest: PluginManifest;
  enabled: boolean;
};

/** A folder that didn't parse, a provide that isn't a point — reported, never silently dropped. */
export type PluginProblem = { dir: string; problem: string };

/** A pane provision, with its compiled code resolved to urls the client can fetch. */
export type LoadedPane = PaneProvision & {
  /** Which plugin provided it — how a surface calls its doors back. */
  plugin: string;
  code: {
    takeover: string;
    style?: string;
    /** `system/<name>` exports this pane imports (§M-4a) — checked against the active system. */
    needs?: string[];
  };
};

export type LoadedPlugin = {
  manifest: PluginManifest;
  /** Where it lives, for the code route to serve `.build/` out of. */
  dir: string;
  provides: Partial<Record<Point, (payload: unknown) => Promise<unknown>>>;
  /** Its declared surfaces, compiled and ready to hand to a screen. */
  panes: LoadedPane[];
  /** Door name → which of teller's gates the server puts in front of it. */
  doors: Record<string, DoorAccess>;
};

function toProvision(raw: unknown): Provision | undefined {
  if (typeof raw === 'string') {
    const point = raw.trim();
    return point ? { point } : undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const point = String(o.point ?? '').trim();
  return point ? { ...o, point } : undefined;
}

/**
 * A pane provision, read defensively. `entry` is the one thing it
 * cannot do without — a pane with no code is a tab that renders
 * nothing, which is worse than a pane that never appeared.
 */
export function toPane(provision: Provision): PaneProvision | undefined {
  const entry = String(provision.entry ?? '').trim();
  if (!entry) return undefined;
  const suffix = suffixOf(provision.point) ?? '';
  const name = String(provision.name ?? suffix).trim() || suffix;
  if (!name) return undefined;
  const out: PaneProvision = { point: provision.point, name, entry };
  const text = (key: string) => {
    const v = provision[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const label = text('label');
  const blurb = text('blurb');
  const icon = text('icon');
  const when = text('when');
  const style = text('style');
  if (label) out.label = label;
  if (blurb) out.blurb = blurb;
  if (icon) out.icon = icon;
  if (when) out.when = when;
  if (style) out.style = style;
  if (provision.subject === 'entity' || provision.subject === 'none') {
    out.subject = provision.subject;
  }
  if (typeof provision.order === 'number' && Number.isFinite(provision.order)) {
    out.order = provision.order;
  }
  return out;
}

function toManifest(raw: unknown): PluginManifest | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '').trim();
  const name = String(o.name ?? '').trim();
  if (!id.startsWith('plg_') || !name) return undefined;
  const wants = Array.isArray(o.needs)
    ? o.needs.map((s) => String(s).trim()).filter(Boolean)
    : [];
  return {
    id,
    name,
    version: typeof o.version === 'number' ? o.version : 1,
    provides: Array.isArray(o.provides)
      ? o.provides.map(toProvision).filter((p): p is Provision => p !== undefined)
      : [],
    // A need that doesn't parse grants nothing and is kept in `wants`,
    // where a human still reads it: an author's typo must never widen
    // what a plugin may touch, and must never silently narrow the
    // sentence they wrote either.
    needs: wants.map(toNeed).filter((n): n is Need => n !== undefined),
    wants,
  };
}

/**
 * What's on the shelf, and what a human has said about it. Reads disk
 * and the trust table; writes neither.
 */
export function discoverPlugins(
  dataDir: string,
  shelf: Shelf,
): { found: Discovered[]; problems: PluginProblem[] } {
  const found: Discovered[] = [];
  const problems: PluginProblem[] = [];
  const root = join(dataDir, 'plugins');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return { found, problems };
  }
  for (const name of names.sort()) {
    const dir = join(root, name);
    const manifestPath = join(dir, 'plugin.json');
    if (!existsSync(manifestPath)) continue;
    let manifest: PluginManifest | undefined;
    try {
      manifest = toManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
    } catch {
      manifest = undefined;
    }
    if (!manifest) {
      problems.push({
        dir,
        problem: 'plugin.json is not a manifest (needs plg_ id and a name)',
      });
      continue;
    }
    found.push({
      dir,
      manifest,
      enabled: shelf.pluginTrust(manifest.id)?.enabled ?? false,
    });
  }
  return { found, problems };
}

/**
 * The message-shaped boundary, applied to one function: both the
 * snapshot going in and the proposal coming out must survive
 * structuredClone, which is the cheapest honest way to say "no live
 * objects cross". A plugin that returns something unclonable fails
 * HERE, today, in process — not the day the transport changes.
 */
function messageShaped(
  fn: (payload: unknown, config: unknown) => unknown,
  config: unknown,
): (payload: unknown) => Promise<unknown> {
  return async (payload) => {
    const sent = structuredClone(payload);
    const result = await fn(sent, structuredClone(config ?? null));
    return result === undefined ? undefined : structuredClone(result);
  };
}

/**
 * Compile one pane's source into `<dir>/.build/panes/<name>.js` and say
 * where the client may fetch it. The panel precedent whole
 * (`compilePanelCode`): esbuild, mtime-gated, a failure REPORTED rather
 * than thrown, and the same four bare specifiers left external for the
 * client's import map to answer (`PLUGIN_IMPORTS`).
 *
 * Unlike a panel's, this runs only for a plugin a human ENABLED —
 * `loadPlugins` skips the rest before it ever gets here. That is not a
 * different rule, it's the same one arriving earlier: a panel's
 * declaration is useful without its code, and a pane IS its code, so
 * there is nothing to compile for a plugin nobody trusts.
 */
function compilePane(
  dir: string,
  pluginId: string,
  pane: PaneProvision,
): { code?: LoadedPane['code']; problem?: string } {
  const src = join(dir, pane.entry);
  if (!existsSync(src)) return { problem: `pane '${pane.name}' names ${pane.entry}, which isn't there` };
  // The compiled artifact is named by the POINT's suffix, never by the
  // pane's `name`. The suffix is registry-checked (`USABLE_SUFFIX` —
  // lower-case, no slash) and the name is a free word a human chose,
  // and this is the one place either becomes a PATH. Same reasoning as
  // `usableFolderName` for a panel folder, and the same answer.
  const file = suffixOf(pane.point) ?? pane.name;
  const out = join(dir, '.build', 'panes', `${file}.js`);
  if (newerThan(src, out)) {
    const err = buildOne(src, out, PLUGIN_IMPORTS);
    if (err) return { problem: `pane '${pane.name}' (${pane.entry}): ${err}` };
  }
  if (!existsSync(out)) return { problem: `pane '${pane.name}' compiled to nothing` };
  const needs = readBuildMeta(out).needs;
  const code: LoadedPane['code'] = {
    takeover: `/plugin-code/${pluginId}/panes/${file}.js${stamp(out)}`,
    ...(needs.length ? { needs } : {}),
  };
  if (pane.style) {
    const styleSrc = join(dir, pane.style);
    const styleOut = join(dir, '.build', 'panes', `${file}.css`);
    if (existsSync(styleSrc)) {
      if (newerThan(styleSrc, styleOut)) {
        try {
          mkdirSync(join(dir, '.build', 'panes'), { recursive: true });
          writeFileSync(styleOut, readFileSync(styleSrc));
        } catch {
          // A style that won't copy is a pane without a stylesheet, not
          // a pane that fails to exist. The declaration still loads.
        }
      }
      if (existsSync(styleOut)) {
        code.style = `/plugin-code/${pluginId}/panes/${file}.css${stamp(styleOut)}`;
      }
    }
  }
  return { code };
}

/**
 * Say yes to a plugin — the one door enablement goes through.
 *
 * It exists so that ENABLING and RECORDING WHAT WAS AGREED TO cannot
 * drift apart: the console, the CLI and anything later all say yes the
 * same way, and the needs written down are the ones that were on
 * screen. Disabling clears the record; the next yes is a new agreement
 * about whatever the manifest says by then.
 */
export function enablePlugin(
  dataDir: string,
  shelf: Shelf,
  id: string,
  enabled: boolean,
): { wants: string[] } {
  const wants =
    discoverPlugins(dataDir, shelf).found.find((f) => f.manifest.id === id)?.manifest
      .wants ?? [];
  shelf.setPluginEnabled(id, enabled, wants);
  return { wants };
}

/**
 * Import every ENABLED plugin and wire its provides to the registry.
 * Missing entry file, a throw on import, a provide against no point —
 * each is a problem in the report and never a crash: a broken plugin
 * degrades like a missing pack, and the table plays on.
 */
export async function loadPlugins(
  dataDir: string,
  shelf: Shelf,
): Promise<{ loaded: LoadedPlugin[]; problems: PluginProblem[] }> {
  const { found, problems } = discoverPlugins(dataDir, shelf);
  const loaded: LoadedPlugin[] = [];
  for (const { dir, manifest, enabled } of found) {
    if (!enabled) continue;

    // ENABLEMENT IS CONSENT TO A LIST, not to a folder name. A plugin
    // on the shelf is an ordinary file its author edits, so the needs
    // it declares can widen after somebody agreed to the old ones — and
    // a wider claim honoured under an older yes is the enable gate
    // failing quietly, which is the one way this gate can fail. So it
    // fails LOUDLY instead: the trust row records what was on screen,
    // and a plugin that now wants more than that does not load until a
    // human agrees again.
    //
    // A row from before teller recorded anything is grandfathered — it
    // predates the question and refusing it would take the table's
    // plugins away over a bookkeeping change — but it says so, every
    // boot, until somebody enables it again and the list is written
    // down.
    const agreed = shelf.pluginTrust(manifest.id)?.wants;
    if (agreed) {
      const widened = manifest.wants.filter((want) => !agreed.includes(want));
      if (widened.length) {
        problems.push({
          dir,
          problem: `wants more than it was enabled for — ${widened.join('; ')} — so it is not running; enable it again to agree`,
        });
        continue;
      }
    } else if (manifest.wants.length) {
      problems.push({
        dir,
        problem: `was enabled before teller recorded what it wants; it currently wants ${manifest.wants.join('; ')} — enable it again to record your agreement`,
      });
    }

    // The DECLARED half first, and separately: a plugin may be all
    // panes and no host module (a surface over teller's own doors is a
    // whole plugin), so "no host.mjs" only ends the loop for one that
    // claimed a point needing one.
    const panes: LoadedPane[] = [];
    for (const provision of manifest.provides) {
      if (familyOf(provision.point) !== 'pane.') continue;
      if (!isPoint(provision.point)) {
        problems.push({
          dir,
          problem: `provides '${provision.point}', which is not a point in the registry`,
        });
        continue;
      }
      const pane = toPane(provision);
      if (!pane) {
        problems.push({ dir, problem: `'${provision.point}' declares no entry file` });
        continue;
      }
      const { code, problem } = compilePane(dir, manifest.id, pane);
      if (problem || !code) {
        problems.push({ dir, problem: problem ?? `pane '${pane.name}' has no code` });
        continue;
      }
      panes.push({ ...pane, plugin: manifest.id, code });
    }

    // Which gate each door sits behind, read off the manifest and
    // enforced by the server — never by the plugin (see `DoorAccess`).
    const doors: Record<string, DoorAccess> = {};
    for (const provision of manifest.provides) {
      if (familyOf(provision.point) !== 'door.') continue;
      const name = suffixOf(provision.point);
      if (name) doors[name] = toAccess(provision.role);
    }

    const hostPoints = manifest.provides.filter((p) => familyOf(p.point) !== 'pane.');
    const entry = join(dir, 'host.mjs');
    if (!existsSync(entry)) {
      if (hostPoints.length) {
        problems.push({ dir, problem: 'enabled but has no host.mjs' });
        continue;
      }
      loaded.push({ manifest, dir, provides: {}, panes, doors: {} });
      continue;
    }
    let module: Record<string, unknown>;
    try {
      module = (await import(pathToFileURL(entry).href)) as Record<
        string,
        unknown
      >;
    } catch (err) {
      problems.push({ dir, problem: `failed to import: ${String(err)}` });
      continue;
    }
    const provides = module.provides;
    if (!provides || typeof provides !== 'object') {
      problems.push({ dir, problem: 'host.mjs exports no `provides`' });
      continue;
    }
    const wired: LoadedPlugin['provides'] = {};
    for (const [point, fn] of Object.entries(
      provides as Record<string, unknown>,
    )) {
      if (typeof fn !== 'function') continue;
      if (!isPoint(point)) {
        problems.push({
          dir,
          problem: `provides '${point}', which is not a point in the registry`,
        });
        continue;
      }
      // Config rides into every call as a cloned second argument — the
      // plugin never reads the shelf, and the same clone boundary that
      // guards payloads guards what a human configured.
      wired[point] = messageShaped(
        fn as (payload: unknown, config: unknown) => unknown,
        shelf.pluginTrust(manifest.id)?.config,
      );
    }
    loaded.push({ manifest, dir, provides: wired, panes, doors });
  }
  return { loaded, problems };
}

/**
 * Every pane every running plugin declares, in load order.
 *
 * The list a surface reads BESIDE the merged `panels` slot — never
 * merged into it (§M-2). Ordering across the two is `byPanelOrder`'s
 * job at the consumer, which is where the two sources become one bar.
 */
export function panesOf(loaded: LoadedPlugin[]): LoadedPane[] {
  return loaded.flatMap((p) => p.panes);
}

/** The one plugin a `plg_` id names, among those running. */
export function pluginOf(loaded: LoadedPlugin[], id: string): LoadedPlugin | undefined {
  return loaded.find((p) => p.manifest.id === id);
}

/**
 * Every implementation of one point, in discovery order — the shape a
 * caller fans a snapshot out to. Proposals come back; a human picks or
 * ignores (rule 1 is the whole API).
 */
export function providersOf(
  loaded: LoadedPlugin[],
  point: Point,
): { id: string; call: (payload: unknown) => Promise<unknown> }[] {
  const out: { id: string; call: (payload: unknown) => Promise<unknown> }[] =
    [];
  for (const plugin of loaded) {
    const fn = plugin.provides[point];
    if (fn) out.push({ id: plugin.manifest.id, call: fn });
  }
  return out;
}
