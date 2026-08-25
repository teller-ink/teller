// The host — the first server on the new core, now with the one key.
//
// One runtime (§16): `node server/index.ts --data ~/.teller-next
// --campaign <slug>` and nothing else. No build, no bundler, no
// Cloudflare shape anywhere — routes call the Session, the Session
// calls the store, and the store is a file.
//
// Auth is rule 7, ported (server/auth.ts): the DM key is the root of
// trust, screens pair by code and hold role assignments, the stream
// takes a ticket because an EventSource can't send a header. A route
// never re-derives authority from anything but the key or the role.
//
// The client contract is small on purpose: JSON in, JSON out,
// `/api/stream` nudges and the page refetches. Serializers stay at the
// store boundary, so a route never sees a raw row.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, readFileSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, normalize, resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { toEntity, type Ref } from '../core/entity.ts';
import { toExchangeRecord, toRollRecord } from '../core/exchange.ts';
import {
  createCampaign,
  isDisplayRole,
  listCampaigns,
  openShelf,
  renameCampaign,
  trashCampaign,
  validSlug,
  type EntityDraft,
} from '../core/store.ts';
import {
  actorOf,
  adopted,
  canDm,
  canEditEntity,
  canWatch,
  checkTicket,
  displayHandle,
  loadDmKey,
  mintTicket,
  resolveAuth,
  STREAM_MINUTES,
  type Auth,
} from './auth.ts';
import {
  bookBytes,
  bookSubject,
  bookUrl,
  declaredBooks,
  forgetBook,
  ftsQuery,
  HIT_LIMIT,
  sweepBooks,
  withPresence,
} from './books.ts';
import { isBookId } from '../core/books-shelf.ts';
import {
  discoverPlugins,
  enablePlugin,
  loadPlugins,
  panesOf,
  pluginOf,
  providersOf,
} from '../core/plugins.ts';
import { callDoor, whoOf } from './plugin-bridge.ts';
import { grants, isPoint, POINTS, type Need, type Point } from '../core/registry.ts';
import { bandsIn, fightGeometry, measureMove, type MoveRecord } from './geometry.ts';
import {
  copyPanelToTable,
  defaultPanelDir,
  panelArchive,
  panelDir,
  tablePanelDir,
  usableFolderName,
  type PanelCopy,
} from '../core/panels-shelf.ts';
import {
  packArchive,
  packDir,
  packPanelDir,
  refusalModule,
  sweepPacks,
  systemExportModule,
  systemIndexModule,
} from '../core/packs-shelf.ts';
import {
  defaultSystems,
  sweepSystems,
  systemDir,
  systemPanelDir,
} from '../core/systems-shelf.ts';
import {
  extFor,
  handoutOf,
  handoutsOf,
  MAX_BYTES,
  saveHandoutBytes,
} from './handouts.ts';
import {
  extFor as boardExtFor,
  MAX_BYTES as BOARD_MAX_BYTES,
  saveBoardBytes,
  toGrid,
  toWidthInches,
} from './boards.ts';
import { calibrationFor, setCalibration, toCalibration } from './calibration.ts';
import {
  exportStory,
  importFresh,
  importLayer,
  inspectStory,
  STORY_SLOT,
} from './story.ts';
import { toRights } from '../core/bundle.ts';
import { notesOf, passNote, visibleTo, type NoteHandout } from './notes.ts';
import { setNotice } from './notice.ts';
import {
  publicBoardRow,
  publicBoardState,
  publicEntityList,
  publicSnapshot,
  publicTurnState,
} from './public.ts';
import { toAreas } from '../core/fog.ts';
import { toTerrain } from '../core/terrain.ts';
import { ACTIVE_CAMPAIGN, Host, Session, type EntryEdit } from './session.ts';
import { peekUndo, undo } from './undo.ts';
import type { TurnOp } from './turn.ts';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public');
// The bundled client (client/ → vite → here). Preferred over PUBLIC
// when built, so the vanilla files remain the fallback until they die.
const DIST = join(dirname(fileURLToPath(import.meta.url)), 'dist');

/** The repo root — where `package.json` lives, next to `server/`. */
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What version of teller this is, read off the shipped `package.json`.
 *
 * One reading, because two would drift: `teller version` prints this and
 * `/api/health` answers with it, so a host can never tell a script one
 * number and a human another.
 */
export function tellerVersion(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    return (pkg as { version?: string }).version ?? '0.0.0';
  } catch {
    return 'unknown';
  }
}

/**
 * The fallback that can serve yesterday's client, said OUT LOUD.
 *
 * `server/public` is the vanilla snapshot and it is committed; `dist` is
 * built by `pnpm client:build` and gitignored. With no dist the server
 * quietly falls back — which on 2026-08-24 served a months-stale client
 * to a whole table, and every seat broke with "this build doesn't know
 * the block 'vitals'". The silence was the bug, not the fallback: the
 * brew tarball always carries dist, so refusing would only break the
 * legitimate vanilla path while helping nobody.
 *
 * Takes the dist directory so it can be tested against a real folder
 * rather than the one this process happens to have been installed into.
 */
export function staleClientWarning(dist: string = DIST): string | undefined {
  if (existsSync(join(dist, 'index.html'))) return undefined;
  return [
    '',
    '  ┌───────────────────────────────────────────────────────────┐',
    '  │  NO BUILT CLIENT — serving the vanilla fallback           │',
    '  └───────────────────────────────────────────────────────────┘',
    '',
    `  ${dist} has no index.html, so every screen in the room gets`,
    `  the committed snapshot in ${PUBLIC} instead.`,
    '',
    '  That snapshot can be months old. Seats will break on blocks it',
    '  has never heard of, and the error will name the block, not this.',
    '',
    '  The way through:  pnpm client:build',
    '',
  ].join('\n');
}

/**
 * `body` is JSON, unless `bytes` is set — the one exception, and it
 * exists because an archive is a file and a file is not JSON. Keeping it
 * a Reply rather than a second door in `serve()` is what keeps the
 * export routes testable without a socket, like every other route.
 */
type Reply = {
  status: number;
  body: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
};

/**
 * Everything a route may know. The key rides along only for tickets.
 *
 * The HOST is what's passed, not the session: the active campaign is
 * swappable at runtime, so a route reads through the holder rather
 * than closing over one session for the life of the process. A host
 * with no campaign at all is a real state (a fresh data dir boots into
 * it, and the console lands on the campaign screen) — which is why
 * `host.session` is optional and the table's routes say so.
 */
export type Ctx = { host: Host; auth: Auth; key: string };

function reply(status: number, body: unknown): Reply {
  return { status, body };
}

const denied = () => reply(401, { error: 'DM key required' });

/** An archive, as a download. The filename is the folder's own name. */
function fileReply(bytes: Buffer, filename: string): Reply {
  return {
    status: 200,
    body: null,
    bytes,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  };
}

/**
 * Who may read PREP — the template half: encounter recipes, bestiary
 * numbers, the catalogue. The DM, obviously; and a seat, which shops
 * the catalogue at the table and browses what it may stamp. A passive
 * screen (table, board, badge, art) may not: it is player-facing glass
 * in the middle of the room, and the recipes are what the fight is
 * about to be. Vocabulary and records stay watchable — those aren't
 * secrets, they're what a panel renders with.
 */
const canPrep = (auth: Auth): boolean =>
  canDm(auth) || (adopted(auth.display) && auth.display.role === 'seat');
const notAtTable = () => reply(401, { error: 'not at this table' });

/**
 * One proposer's share of the turn snapshot, cut to what its manifest
 * declared — the `needs` gate, applied to `propose.*` the same way the
 * bridge applies it to a door.
 *
 * A slot a plugin never asked for arrives ABSENT rather than as an
 * error, exactly like `snapshotFor`: the manifest is the reason, and
 * degrading is what a plugin does with anything it wasn't handed. Round,
 * order and the acting sheet are ungated because they are what
 * `propose.turn` IS — a point with no snapshot is not a point.
 */
function forNeeds(full: Record<string, unknown>, needs: Need[]): Record<string, unknown> {
  const out = { ...full };
  if (!grants(needs, 'read', 'board')) delete out.board;
  if (!grants(needs, 'read', 'log')) delete out.history;
  // Per SLOT, the way a door's records are gated: `read:records` whole
  // grants every one, `read:records/bands` grants exactly that rung.
  if (out.records && typeof out.records === 'object') {
    const kept = Object.entries(out.records as Record<string, unknown>).filter(([slot]) =>
      grants(needs, 'read', 'records', slot),
    );
    if (kept.length) out.records = Object.fromEntries(kept);
    else delete out.records;
  }
  if (!grants(needs, 'read', 'entities') && Array.isArray(out.order)) {
    out.order = (out.order as Record<string, unknown>[]).map((entry) => {
      const {
        entityId: _e,
        vitals: _v,
        stats: _t,
        held: _h,
        awayInches: _i,
        awaySquares: _s,
        awayBand: _n,
        onBoard: _b,
        ...rest
      } = entry;
      return rest;
    });
  }
  return out;
}
const noCampaign = () =>
  reply(503, { error: 'no campaign is active — pick one from the campaign screen' });

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The body as BYTES — the one door that takes a file rather than JSON
 * (a handout's picture). Refuses by returning nothing rather than by
 * throwing, and refuses while reading rather than after: a client that
 * sends a hundred megabytes should stop being read at the limit, not
 * be buffered whole and then told no.
 */
async function rawBody(
  req: IncomingMessage,
  limit: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) return undefined;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * How big a `.story` may be on the way IN.
 *
 * Generous on purpose: a backup of a real campaign carries its
 * handouts, its battlemaps and (if you kept them) the undo snapshots,
 * and the whole point of the format is that the file you wrote last
 * month opens again. The limit exists so a wrong POST can't be buffered
 * forever, not to have an opinion about anyone's table.
 */
const STORY_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Content code a human has ENABLED — the systems, packs and panels
 * whose compiled presentations this table is willing to run.
 *
 * Trust is a one-way street until something lists it: `codePending`
 * says "nobody has said yes yet", so the enable buttons disappear the
 * instant you press them and the answer becomes unreachable. This is
 * the other direction. Names come from the shelf and the panel
 * declarations; an id whose folder is gone still lists, by its id —
 * a row you can't see is a row you can't revoke.
 */
function trustedCode(
  session: Session,
): { id: string; name: string; kind: 'system' | 'pack' | 'panel' }[] {
  const panels = new Map(
    session.loaded
      .declarations('panels')
      .map((p) => p as { id?: string; name?: string; label?: string })
      .filter((p) => p.id)
      .map((p) => [p.id!, p.label ?? p.name ?? p.id!]),
  );
  const out: { id: string; name: string; kind: 'system' | 'pack' | 'panel' }[] = [];
  for (const { id, enabled } of session.shelf.pluginTrusts()) {
    if (!enabled) continue;
    if (id.startsWith('sys_')) {
      out.push({ id, name: session.shelf.system(id)?.name ?? id, kind: 'system' });
    } else if (id.startsWith('pak_')) {
      out.push({ id, name: session.shelf.pack(id)?.name ?? id, kind: 'pack' });
    } else if (id.startsWith('pan_')) {
      out.push({ id, name: panels.get(id) ?? id, kind: 'panel' });
    }
  }
  return out;
}

// -- the plugins tool's grouping: everything by WHERE IT CAME FROM ------
//
// The console used to render trust as three flat lists — pending
// panels, pending system/pack code, code you've trusted — which is the
// TRUST TABLE's shape, not the table's. A DM looking at "sheet
// carries code" wants to know which book it came in, and that answer
// existed nowhere on the screen. So the endpoint assembles containers
// instead: one per thing that SHIPS things (the active system, each
// pack in the stack, the campaign's own, this table's `panels/`, and
// teller's floor), each carrying its own code state and the panels it
// contributes.
//
// Nothing here re-derives what boot already worked out. A container's
// code state is `Loaded`'s own `code`/`codePending`; a panel's is the
// same pair on the declaration the sweep attached them to. The only
// thing read fresh is the trust ROW, because a row can outlive the
// folder it named — which is exactly what `unresolved` is for.

/** Three states, and a console that says "no code" instead of nothing. */
type CodeState = 'none' | 'pending' | 'enabled';

type PanelRow = {
  id?: string;
  name: string;
  label?: string;
  code: CodeState;
  /** The shelf row, read straight — what the disable button acts on. */
  trusted: boolean;
  /**
   * An `enabled: 0` row names this panel, so its declaration is OUT of
   * the merge (`core/boot.ts`) — no tab, nothing to assign a seat to.
   * It still LISTS here, marked off, because the accordion is the
   * registry of what exists and the merge is what's on: a panel that
   * vanished from both would be a switch nobody could flip back.
   */
  disabled: boolean;
};

type Container = {
  kind: 'system' | 'pack' | 'campaign' | 'table' | 'teller';
  /** `sys_`/`pak_` — the id the toggle names. Absent for the campaign, the table and teller. */
  id?: string;
  name: string;
  version?: number;
  code: CodeState;
  trusted: boolean;
  /**
   * What this container carries BESIDES code and panels, slot by slot
   * — the quiet one-liner under its name. Empty slots are absent, so a
   * container with nothing but panels gets `{}` and the console says
   * nothing rather than "0 bestiary".
   */
  cargo: Record<string, number>;
  panels: PanelRow[];
};

function codeStateOf(held: { code?: unknown; codePending?: boolean }): CodeState {
  if (held.code) return 'enabled';
  if (held.codePending) return 'pending';
  return 'none';
}

function toPanelRow(raw: unknown, trusts: Map<string, boolean>): PanelRow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as { id?: string; name?: string; label?: string; code?: unknown; codePending?: boolean };
  const name = String(p.name ?? '').trim();
  if (!name) return undefined;
  const row: PanelRow = {
    name,
    code: codeStateOf(p),
    trusted: p.id ? (trusts.get(p.id) ?? false) : false,
    // No row and `enabled: 0` are different answers — `?? false` would
    // have flattened them into one and switched every panel off.
    disabled: p.id ? trusts.get(p.id) === false : false,
  };
  if (p.id) row.id = p.id;
  if (p.label) row.label = p.label;
  return row;
}

/**
 * The campaign's content stack, grouped by container, in PRECEDENCE
 * order — system, then packs as declared, then the campaign's own, then
 * the table's `panels/`, then teller's floor last.
 *
 * That's the merge order READ BACKWARDS on purpose: the merge stacks
 * teller's furniture at the bottom because everything may override it,
 * and a human reading the console wants the specific thing first and
 * the floor last.
 */
function containersOf(session: Session): Container[] {
  const trusts = new Map(session.shelf.pluginTrusts().map((t) => [t.id, t.enabled]));
  const { loaded } = session;
  const bySource = new Map(
    loaded.sourced('panels').map(({ source, items }) => [
      source,
      items.map((raw) => toPanelRow(raw, trusts)).filter((r): r is PanelRow => r !== undefined),
    ]),
  );
  const panelsFrom = (source: string): PanelRow[] => bySource.get(source) ?? [];

  const out: Container[] = [];
  if (loaded.system) {
    const { id, name, version } = loaded.system;
    out.push({
      kind: 'system',
      id,
      name,
      version,
      code: codeStateOf(loaded.system),
      trusted: trusts.get(id) ?? false,
      cargo: loaded.cargo(`system:${id}`),
      panels: panelsFrom(`system:${id}`),
    });
  }
  for (const pack of loaded.packs) {
    out.push({
      kind: 'pack',
      id: pack.id,
      name: pack.name,
      version: pack.version,
      code: codeStateOf(pack),
      trusted: trusts.get(pack.id) ?? false,
      cargo: loaded.cargo(`pack:${pack.id}`),
      panels: panelsFrom(`pack:${pack.id}`),
    });
  }
  // The campaign's own stored panels — listed only when it has some.
  // It ships no code (there is no folder to compile), so it is a group
  // of rows and nothing else; an empty one would be a heading about
  // nothing.
  const campaignPanels = panelsFrom('campaign');
  if (campaignPanels.length) {
    out.push({
      kind: 'campaign',
      name: loaded.manifest.name,
      code: 'none',
      trusted: false,
      cargo: {},
      panels: campaignPanels,
    });
  }
  // This table's own `panels/` folder — ALWAYS listed, empty or not.
  // "Nothing of your own yet" is the useful answer: it says the folder
  // is a place you may write, which an absent heading never says.
  out.push({
    kind: 'table',
    name: 'This table',
    code: 'none',
    trusted: false,
    cargo: {},
    panels: panelsFrom('table'),
  });
  out.push({
    kind: 'teller',
    name: 'teller',
    code: 'none',
    trusted: false,
    cargo: loaded.cargo('teller'),
    panels: panelsFrom('teller'),
  });
  return out;
}

/**
 * An enabled trust row naming a `sys_`/`pak_`/`pan_` id that no
 * container accounts for — a folder someone deleted, a pack this
 * campaign no longer declares. Surfaced with nothing but a disable
 * button, because a grant you can't see is a grant you can't take back
 * (the same reasoning that produced `trusted` in the first place).
 */
function unresolvedTrusts(session: Session, containers: Container[]): { id: string }[] {
  const known = new Set<string>();
  for (const c of containers) {
    if (c.id) known.add(c.id);
    for (const p of c.panels) if (p.id) known.add(p.id);
  }
  return session.shelf
    .pluginTrusts()
    .filter(
      ({ id, enabled }) =>
        enabled &&
        (id.startsWith('sys_') || id.startsWith('pak_') || id.startsWith('pan_')) &&
        !known.has(id),
    )
    .map(({ id }) => ({ id }));
}

/**
 * What this machine holds, resolved the way the LOADER resolves it:
 * **a folder beats a row**, per id (`loadCampaign` in `core/boot.ts`).
 * A `shelf.db` row that a `systems/<name>/` or `packs/<name>/` folder
 * shadows lends only its place in the order; the folder's name and
 * version are what the table actually runs, so they are what the
 * console is told. A folder with no row at all still lists — it loads,
 * so it exists.
 *
 * For a SYSTEM the order is §M's three places: its own folder, then a
 * `system.json` embedded in a pack folder, then the row.
 *
 * This SWEEPS per request rather than reading what boot already found.
 * The session's `loaded` only knows the campaign's OWN system and its
 * declared packs — it isn't a shelf listing, and reusing it would leave
 * every other folder unlisted. The sweep is cheap enough for a
 * console-only read: JSON reads, `copyNewer` art installs and an
 * mtime-gated compile that no-ops when nothing changed.
 */
function shelfListing(host: Host): {
  systems: { id: string; name: string; version: number }[];
  packs: { id: string; system?: string; name: string; version: number }[];
} {
  const rows = { systems: host.shelf.systems(), packs: host.shelf.packs() };
  const dataDir = host.dataDir;
  if (!dataDir) return rows;

  const sweptPacks = sweepPacks(dataDir, host.shelf);
  const sweptSystems = sweepSystems(dataDir, host.shelf);
  const systemFolders = new Map(
    [...sweptPacks.systems, ...sweptSystems.systems].map((s) => [s.id, s]),
  );
  const packFolders = new Map(sweptPacks.packs.map((p) => [p.id, p]));

  // Rows first, in their own order (a shadowed row keeps its place —
  // only its name and version come from the folder), then whatever only
  // a folder knows about.
  const systems = rows.systems.map((row) => {
    const folder = systemFolders.get(row.id);
    return folder ? { id: folder.id, name: folder.name, version: folder.version } : row;
  });
  for (const folder of systemFolders.values()) {
    if (!rows.systems.some((row) => row.id === folder.id)) {
      systems.push({ id: folder.id, name: folder.name, version: folder.version });
    }
  }
  // …and last, the systems teller SHIPS (§M-6): read from the install,
  // never written to the data dir, and only where nothing on the shelf
  // already answers to the id — the same fallback order `loadCampaign`
  // resolves by, so what creation offers is what will load. Without it
  // a virgin host offered zero systems and first-run dead-ended on the
  // one screen it has.
  for (const shipped of defaultSystems()) {
    const known =
      systems.some((s) => s.id === shipped.id) || packFolders.has(shipped.id);
    if (!known) {
      systems.push({ id: shipped.id, name: shipped.name, version: shipped.version });
    }
  }

  const asPack = (p: { id: string; system?: string; name: string; version: number }) => {
    const out: { id: string; system?: string; name: string; version: number } = {
      id: p.id,
      name: p.name,
      version: p.version,
    };
    if (p.system) out.system = p.system;
    return out;
  };
  const packs = rows.packs.map((row) => {
    const folder = packFolders.get(row.id);
    return folder ? asPack(folder) : row;
  });
  for (const folder of packFolders.values()) {
    if (!rows.packs.some((row) => row.id === folder.id)) packs.push(asPack(folder));
  }

  return { systems, packs };
}

/**
 * The system a DM just picked, resolved the way it will be LOADED.
 *
 * Validating against `shelf.system()` alone refused a system that only
 * exists as a `systems/<name>/` folder — the normal case in the §M
 * world, and the one the dropdown was already offering, since the
 * dropdown reads `/api/shelf` and that lists folder-first. The console
 * could see a system it was then told it didn't have.
 *
 * So the answer comes from the same listing: what creation accepts is
 * exactly what the shelf says this machine holds, which is exactly what
 * `loadCampaign` will resolve. One reading, three places it can come
 * from, and none of them re-implemented here.
 */
function shelfSystem(host: Host, id: string): Ref | undefined {
  const found = shelfListing(host).systems.find((s) => s.id === id);
  return found ? { id: found.id, name: found.name } : undefined;
}

/**
 * The API, as one function — testable without a socket, servable with
 * one. Returns undefined for paths that aren't the API's.
 */
export async function handleApi(
  ctx: Ctx,
  method: string,
  url: URL,
  req: IncomingMessage,
): Promise<Reply | undefined> {
  const { host, auth, key } = ctx;
  const shelf = host.shelf;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', …]
  if (parts[0] !== 'api') return undefined;
  const [, head, a, b] = parts;

  // -- is anybody home? -------------------------------------------------
  //
  // Unauthenticated, and BORING BY DESIGN. Knowing the host is up grants
  // nothing (rule 7): authority comes from the key or from a role the DM
  // assigned, and neither is reachable from here. So this answers with
  // the three facts a kiosk's watchdog or a `curl` in a shell script
  // actually needs — that it's teller, which version, and which campaign
  // is loaded — and NOTHING else. No key material, no displays, no
  // paths: every one of those is a fact about the table, and a fact
  // about the table belongs behind an assignment.
  //
  // Zero headers on purpose. The dumbest client in the room curls this
  // bare, so it must not want a key, a display id, or a ticket.
  if (method === 'GET' && head === 'health' && !a) {
    return reply(200, {
      app: 'teller',
      version: tellerVersion(),
      campaign: host.session?.campaign.slug ?? null,
    });
  }

  // -- screens ----------------------------------------------------------

  if (head === 'displays') {
    // A screen announcing itself. Unauthenticated on purpose: this is
    // how a screen comes into existence, and it confers nothing — a
    // brand new display is 'blank' and belongs to nobody until the DM
    // adopts it by the code it shows.
    if (method === 'POST' && a === 'hello' && !b) {
      const body = await bodyOf(req);
      let display =
        typeof body.id === 'string' ? shelf.display(body.id) : undefined;
      if (display) {
        shelf.touchDisplay(display.id);
        display = shelf.refreshCodeIfExpired(display);
      } else {
        display = shelf.createDisplay();
      }
      // The handle is told, not derived: a LAN origin is not a secure
      // context, so the client couldn't compute its own sha-256.
      return reply(200, { display, handle: displayHandle(display.id) });
    }

    // A screen reporting its own viewport — telemetry about the caller
    // itself, clamped hard, only ever writes the caller's own row.
    if (method === 'POST' && a === 'viewport' && !b) {
      const self = auth.display;
      if (!self) return reply(401, { error: 'display required' });
      const body = await bodyOf(req);
      const clamp = (n: unknown) =>
        typeof n === 'number' && Number.isFinite(n)
          ? Math.min(20000, Math.max(1, Math.round(n)))
          : null;
      const w = clamp(body.w);
      const h = clamp(body.h);
      if (!w || !h) return reply(400, { error: 'w and h required' });
      if (self.viewport?.w !== w || self.viewport?.h !== h) {
        shelf.setDisplayViewport(self.id, w, h);
      }
      return reply(200, { ok: true });
    }

    // What THIS screen is being asked to draw while it's calibrated,
    // answered from its own identity — the third door a screen may use
    // about itself, beside hello and viewport. Null is the normal
    // answer and the overwhelmingly common one. There is deliberately no
    // way to ask about ANOTHER screen (the notes doors' asymmetry).
    if (method === 'GET' && a === 'calibration' && !b) {
      if (!adopted(auth.display)) return reply(200, null);
      return reply(200, calibrationFor(auth.display.id));
    }

    // Everything below is the DM arranging the room.
    if (!canDm(auth)) return denied();

    if (method === 'GET' && !a) {
      // Listing is the moment truth matters — sweep the ghosts first.
      shelf.expireUnclaimedDisplays();
      return reply(200, shelf.displays());
    }

    // Adopt a waiting screen by the code it's showing.
    if (method === 'POST' && a === 'claim' && !b) {
      const body = await bodyOf(req);
      const code = String(body.code ?? '').trim();
      if (!code) return reply(400, { error: 'pairing code required' });
      const found = shelf.displayByCode(code);
      if (!found) return reply(404, { error: 'no screen is showing that code' });
      const claimed = shelf.displays().filter((d) => !d.code).length;
      const name =
        (typeof body.name === 'string' && body.name.trim()) ||
        `Screen ${claimed + 1}`;
      const display = shelf.claimDisplay(found.id, name);
      host.room.changed('displays');
      return reply(200, display);
    }

    // -- calibration: the console draws a ruler on somebody else's glass
    //
    // Two doors, and the asymmetry IS the design (the notes doors'
    // shape): the DM AIMS a pattern at one screen by naming it, and
    // every other screen asks what IT should be drawing and is answered
    // from its own identity. There is no way to phrase "what is that
    // screen showing", and a passive surface grows no control — it draws
    // what arrived and nothing else (rule 6).
    //
    // The RESULT is not written here. It goes through the ordinary
    // display PATCH as `ppi`/`ppiY`, because that is where the durable
    // fact about a piece of glass already lives; this is only the ruler.
    if (method === 'POST' && a && b === 'calibrate') {
      if (!canDm(auth)) return denied();
      const display = shelf.display(a);
      if (!adopted(display)) return reply(404, { error: 'display not found' });
      const body = await bodyOf(req);
      // An explicit null puts the screen back to being itself — and the
      // wizard sends one on its way out, however it left.
      if (body.pattern === null) {
        setCalibration(display.id, null);
      } else {
        const pattern = toCalibration(body.pattern);
        if (!pattern) return reply(400, { error: 'not a calibration pattern' });
        setCalibration(display.id, pattern);
      }
      host.room.notify(displayHandle(display.id), 'calibration');
      return reply(200, { ok: true });
    }

    // "Which one of you is Screen 3?"
    if (method === 'POST' && a && b === 'identify') {
      const display = shelf.display(a);
      if (!adopted(display)) return reply(404, { error: 'display not found' });
      host.room.notify(displayHandle(display.id), 'identify');
      return reply(200, { ok: true });
    }

    if (a && !b && (method === 'PATCH' || method === 'DELETE')) {
      const display = shelf.display(a);
      if (!display) return reply(404, { error: 'display not found' });

      if (method === 'DELETE') {
        shelf.removeDisplay(a);
        // It's still connected: tell it to go look at itself and
        // discover it's a stranger again.
        host.room.notify(displayHandle(a), 'assign');
        host.room.changed('displays');
        return reply(200, { ok: true });
      }

      const body = await bodyOf(req);
      const patch: Parameters<typeof shelf.updateDisplay>[1] = {};
      if (typeof body.name === 'string') patch.name = body.name;
      if (typeof body.color === 'string') patch.color = body.color;
      if (body.role !== undefined) {
        if (!isDisplayRole(body.role)) {
          return reply(400, { error: `not a role: ${String(body.role)}` });
        }
        patch.role = body.role;
      }
      if (body.params && typeof body.params === 'object') {
        patch.params = body.params as Record<string, unknown>;
      }
      if (body.ppi === null || typeof body.ppi === 'number') patch.ppi = body.ppi;
      if (body.ppiY === null || typeof body.ppiY === 'number') patch.ppiY = body.ppiY;
      if (typeof body.position === 'number') patch.position = body.position;
      const updated = shelf.updateDisplay(a, patch);
      host.room.notify(displayHandle(a), 'assign');
      host.room.changed('displays');
      return reply(200, updated);
    }
  }

  // The stream's permission slip. The DM's own device rides as 'dm';
  // an adopted screen gets a ticket for its own handle and nothing else.
  if (method === 'GET' && head === 'ticket' && !a) {
    const slips = (handle: string) => ({
      handle,
      ticket: mintTicket(key, `stream:${handle}`, STREAM_MINUTES),
      // Art and maps ride in <img> tags, which can't send headers
      // either — same law, second subject.
      files: mintTicket(key, `files:${handle}`, STREAM_MINUTES),
    });
    if (adopted(auth.display)) {
      return reply(200, slips(displayHandle(auth.display.id)));
    }
    if (auth.key) return reply(200, slips('dm'));
    return notAtTable();
  }

  // -- which campaign this table is running (rule 9: ONE per host) ------
  //
  // The DM's door, and app chrome rather than a panel — it has to exist
  // BEFORE a campaign resolves, which is exactly when the panel merge
  // has nothing to say. Activating swaps the session under every screen
  // in the room; the displays are on the shelf, so they follow without
  // being touched.
  if (head === 'campaigns') {
    if (!canDm(auth)) return denied();
    if (!host.dataDir) return reply(501, { error: 'this host has no data dir' });

    if (method === 'GET' && !a) {
      // One reading of the shelf for the whole list — folder-first, so
      // a system that only ever existed as a folder reads as installed
      // rather than as a campaign whose system went missing.
      const held = new Map(shelfListing(host).systems.map((s) => [s.id, s]));
      return reply(200, {
        active: host.session?.campaign.slug ?? null,
        campaigns: host.list().map((c) => ({
          slug: c.slug,
          name: c.name,
          active: c.active,
          // The manifest's ref cached a name; the shelf may know a
          // better one. A system nobody has still lists — "you don't
          // have this" beats a blank column.
          system: c.system
            ? {
                id: c.system.id,
                name: held.get(c.system.id)?.name ?? c.system.name,
                installed: held.has(c.system.id),
              }
            : null,
        })),
      });
    }

    if (method === 'POST' && !a) {
      const body = await bodyOf(req);
      const name = String(body.name ?? '').trim();
      if (!name) return reply(400, { error: 'a campaign needs a name' });
      let system: Ref | undefined;
      if (typeof body.system === 'string' && body.system.trim()) {
        system = shelfSystem(host, body.system.trim());
        if (!system) return reply(400, { error: `no system ${body.system} on this shelf` });
      }
      try {
        const started = host.start(name, system);
        return reply(201, { slug: started.campaign.slug, name, active: true });
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }

    // Door (a): start a story fresh — the third way in, beside "start a
    // new one" and "play this". Bytes as the body and the name in the
    // query, because a name is not a secret and multipart for one
    // string is ceremony. It CREATES rather than merges, and then plays
    // it: you imported it to run it, exactly as creating does.
    if (method === 'POST' && a === 'from-story' && !b) {
      const bytes = await rawBody(req, STORY_MAX_BYTES);
      if (!bytes) return reply(413, { error: `a story may be ${STORY_MAX_BYTES} bytes at most` });
      try {
        const out = importFresh(shelf, host.dataDir, bytes, {
          name: url.searchParams.get('name') ?? undefined,
          slug: url.searchParams.get('slug') ?? undefined,
          actor: 'dm',
        });
        host.activate(out.slug);
        return reply(201, { ...out, name: host.session?.campaign.root().name, active: true });
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }

    // Doors (b) and (c): get rid of one, and call one something else.
    //
    // Both refuse the campaign THIS TABLE IS RUNNING, loudly. You
    // cannot delete the floor you're standing on: the file is open, the
    // room is watching it, and the sane order of operations — switch,
    // then delete — is a sentence the error can just say. The same
    // refusal covers rename for the same reason, since renaming the
    // file underneath an open handle is the identical trick with a
    // quieter failure.
    //
    // There is no shelf-level event log to append to (rule 3 lives in
    // the campaign file, and the campaign file is the thing being
    // moved), so the response IS the record: it says where the bytes
    // went, and the console repeats it.
    if (a && !b && (method === 'DELETE' || method === 'PATCH')) {
      if (!validSlug(a) || !listCampaigns(host.dataDir).includes(a)) {
        return reply(404, { error: `no campaign ${a} on this host` });
      }
      if (host.session?.campaign.slug === a) {
        return reply(409, {
          error: `${a} is the campaign at the table — play another one first, then come back`,
        });
      }

      if (method === 'DELETE') {
        try {
          const trashed = trashCampaign(host.dataDir, a);
          if (shelf.setting(ACTIVE_CAMPAIGN) === a) shelf.setSetting(ACTIVE_CAMPAIGN, null);
          host.room.changed('campaign');
          return reply(200, { ok: true, slug: a, trashed: trashed.path });
        } catch (err) {
          return reply(400, { error: String(err) });
        }
      }

      // Rename means the SLUG, because the slug is the filename and
      // the file is the identity (§11). The manifest's display name is
      // a different fact with its own door — this one is not it.
      const body = await bodyOf(req);
      const slug = String(body.slug ?? '').trim();
      if (!slug) return reply(400, { error: 'a rename needs a slug' });
      if (!validSlug(slug)) {
        return reply(400, {
          error: `not a campaign slug: ${slug} (lowercase letters, digits and dashes)`,
        });
      }
      try {
        renameCampaign(host.dataDir, a, slug);
        if (shelf.setting(ACTIVE_CAMPAIGN) === a) shelf.setSetting(ACTIVE_CAMPAIGN, slug);
        host.room.changed('campaign');
        return reply(200, { ok: true, slug, was: a });
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }

    if (method === 'POST' && a && b === 'activate') {
      if (!validSlug(a) || !listCampaigns(host.dataDir).includes(a)) {
        return reply(404, { error: `no campaign ${a} on this host` });
      }
      try {
        host.activate(a);
        return reply(200, { ok: true, slug: a });
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
  }

  // -- the shelf, read whole — what this machine holds (DM's business).
  //
  // HOST-level inventory: `shelf.db` plus the folder sweeps, and not one
  // word of it comes from a session. So it sits ABOVE the campaign gate,
  // with the campaigns routes it serves — a virgin host has nothing
  // running by definition, and the system dropdown on the screen where
  // you make your FIRST campaign was reading a 503. The key gate is
  // unchanged: this is still the DM's business and nobody else's.
  //
  // Folder-first, because the LOAD path is: a swept `systems/<name>/`
  // or `packs/<name>/` folder is used INSTEAD of the `shelf.db` row of
  // the same id (`loadCampaign`, "a folder beats a row"). A listing
  // that read only the rows told a different story than the loader
  // lived — the console said "Wild Imaginary West v21" while the folder
  // it was actually running said 22.
  if (method === 'GET' && head === 'shelf' && !a) {
    if (!canDm(auth)) return denied();
    return reply(200, {
      ...shelfListing(host),
      boards: shelf.boards().map(({ id, name }) => ({ id, name })),
    });
  }

  // -- the rulebooks (server/books.ts holds the law and the reasoning).
  //
  // Beside the shelf and above the campaign gate, for the same reason:
  // a book is a fact about the MACHINE (rule 9), it is not scoped to a
  // campaign or a system, and a host with nothing running still has a
  // shelf of books on it. The gate is `canPrep` rather than `canDm`,
  // because a seat looking a rule up mid-fight is the whole point of
  // the books living on the host at all.
  if (head === 'books') {
    // Search first: the point of the feature, and a bare
    // `/api/books/:id` match would otherwise swallow it.
    if (method === 'GET' && a === 'search' && !b) {
      if (!canPrep(auth)) return denied();
      const q = (url.searchParams.get('q') ?? '').trim();
      const match = q.length < 2 ? null : ftsQuery(q);
      if (!match) return reply(200, { hits: [], total: 0 });
      return reply(200, shelf.searchBooks(match, HIT_LIMIT));
    }

    if (method === 'GET' && !a) {
      if (!canPrep(auth)) return denied();
      return reply(200, {
        books: withPresence(host.dataDir, shelf.books()),
        // What the packs this table runs on were written against —
        // which is what makes a rule entry's bare "p.26" openable.
        declared: declaredBooks(
          host.dataDir,
          (host.session?.loaded.packs ?? []).map((p) => p.id),
        ),
      });
    }

    // "I just dropped one in." The sweep is the road IN (there is
    // deliberately no upload route — see server/books.ts), and it is
    // its own door rather than a limb of `/api/shelf/sweep` because
    // reading a 300-page rulebook is seconds, and the panel sweep is
    // pressed constantly and must stay instant.
    if (method === 'POST' && a === 'sweep' && !b) {
      if (!canDm(auth)) return denied();
      if (!host.dataDir) return reply(501, { error: 'this host has no data dir' });
      const swept = await sweepBooks(host.dataDir, shelf);
      host.room.changed('books');
      return reply(200, { ok: true, ...swept });
    }

    // Permission to read ONE book, so the viewer can be a plain iframe
    // with a URL in it (rule 7 — an iframe sends no headers). The
    // ticket is minted late, on the click: a short-lived slip fetched
    // early is just a slip that has already expired.
    if (method === 'POST' && a && b === 'ticket') {
      if (!canPrep(auth)) return denied();
      if (!isBookId(a)) return reply(404, { error: 'no such book' });
      if (!shelf.book(a)) return reply(404, { error: 'no such book' });
      return reply(200, { url: bookUrl(key, a) });
    }

    // The name is for a human and only ever was — a book dropped in
    // already carrying its hash has no other name to take, and rule 1
    // says a human can always type over what teller worked out.
    if (method === 'PUT' && a && !b) {
      if (!canDm(auth)) return denied();
      if (!shelf.book(a)) return reply(404, { error: 'no such book' });
      const body = await bodyOf(req);
      const name = String(body.name ?? '').trim();
      if (!name) return reply(400, { error: 'a book needs a name' });
      shelf.renameBook(a, name);
      host.room.changed('books');
      return reply(200, shelf.book(a));
    }

    if (method === 'DELETE' && a && !b) {
      if (!canDm(auth)) return denied();
      forgetBook(host.dataDir, a);
      shelf.removeBook(a);
      host.room.changed('books');
      return reply(200, { ok: true });
    }
  }

  // -- zip it up and hand it over (rule 4a: "zipped it's a `.pack` you
  // hand someone"). The way IN is the sweep, which needs no route at all
  // — drop the file in the folder — so these two are the whole export
  // surface, and there is deliberately no upload to match them.
  //
  // DM only, and not because an archive is secret: a pack is the shelf's
  // content and the shelf is the DM's business, the same gate
  // `/api/shelf` sits behind. What the file may then be handed to is the
  // `rights` question, which travels inside it and which teller neither
  // verifies nor enforces (rule 4).
  //
  // NOT a `.system` export. Doors 2 and 3 hold system serialization
  // until it's decided (§M's "nothing yet exports a `.system` archive"),
  // and a `systems/<name>/` folder stays the only serialization there is.
  if (method === 'GET' && head === 'packs' && a && b === 'export') {
    if (!canDm(auth)) return denied();
    const dataDir = host.dataDir;
    if (!dataDir) return reply(501, { error: 'this host has no data dir' });
    const packId = decodeURIComponent(a);
    const dir = packDir(dataDir, packId);
    if (!dir) return reply(404, { error: `no pack folder for ${packId} on this host` });
    try {
      return fileReply(packArchive(dir, packId), `${basename(dir)}.pack`);
    } catch (err) {
      return reply(500, { error: `did not archive: ${String(err)}` });
    }
  }

  // The panel twin. One lookup order, the same four places
  // `/panel-code/` looks — the table's own, a system's, a pack's, then
  // teller's shipped floor — so exporting teller's `log` to start your
  // own from is one click rather than a hunt for the install directory.
  if (method === 'GET' && head === 'panels' && a && b === 'export') {
    if (!canDm(auth)) return denied();
    const dataDir = host.dataDir;
    const panelId = decodeURIComponent(a);
    const dir =
      (dataDir
        ? (panelDir(dataDir, panelId) ??
          systemPanelDir(dataDir, panelId) ??
          packPanelDir(dataDir, panelId))
        : undefined) ?? defaultPanelDir(panelId);
    if (!dir) return reply(404, { error: `no panel folder for ${panelId} on this host` });
    try {
      return fileReply(panelArchive(dir), `${basename(dir)}.panel`);
    } catch (err) {
      return reply(500, { error: `did not archive: ${String(err)}` });
    }
  }

  // -- `.story` — the campaign as a file, and the door back in (TEL-87).
  //
  // Above the campaign gate with the shelf routes, because two of the
  // four are meaningful on a host with nothing running: you can look
  // inside a file, and you can start a campaign from one. The two that
  // touch the table (export, layer) say so themselves with `noCampaign`
  // rather than by living below a gate the other two can't pass.
  //
  // DM only, all four. An export is the whole campaign — notes, NPC
  // numbers, the lot — and an import writes to it.
  if (head === 'story') {
    if (!canDm(auth)) return denied();

    // What the export dialog prefills from: the identity this campaign
    // remembers, which is a templates row (`STORY_SLOT`) and is
    // therefore just read, not recomputed. Null until the first export
    // mints one — the dialog reads that as "personal", the default.
    if (method === 'GET' && !a) {
      const session = host.session;
      if (!session) return noCampaign();
      const held = session.campaign.templatesIn(STORY_SLOT)[0] as
        | Record<string, unknown>
        | undefined;
      return reply(200, {
        name: session.campaign.root().name,
        identity:
          held && typeof held.id === 'string'
            ? {
                id: held.id,
                version: typeof held.version === 'number' ? held.version : 1,
                rights: toRights(held.rights),
              }
            : null,
      });
    }

    // POST rather than GET, and with a JSON body: the switches are a
    // seven-way section object plus a rights declaration, and
    // query-encoding that would be a worse version of the thing JSON
    // already is. The bytes come back the way a `.pack` does.
    if (method === 'POST' && a === 'export' && !b) {
      const session = host.session;
      if (!session) return noCampaign();
      const body = await bodyOf(req);
      const out = exportStory(session, {
        sections: body.sections,
        rights: body.rights,
        actor: 'dm',
      });
      const file = fileReply(out.bytes, out.filename);
      return {
        ...file,
        headers: {
          ...file.headers,
          // A header, because the body is a file. Percent-encoded: these
          // are sentences with em dashes in them and a header is latin-1.
          'x-story-skipped': encodeURIComponent(JSON.stringify(out.skipped)),
          'x-story-version': String(out.manifest.version),
        },
      };
    }

    // Look in the box before opening it. Needs no campaign and changes
    // nothing — the step both import doors start from.
    if (method === 'POST' && a === 'inspect' && !b) {
      const bytes = await rawBody(req, STORY_MAX_BYTES);
      if (!bytes) return reply(413, { error: `a story may be ${STORY_MAX_BYTES} bytes at most` });
      try {
        return reply(200, inspectStory(bytes, shelf));
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }

    // Door (b): layer onto the table already being played. The stored
    // value wins on every collision (rule 1) and the report says what
    // was left alone.
    if (method === 'POST' && a === 'import' && !b) {
      const session = host.session;
      if (!session) return noCampaign();
      const bytes = await rawBody(req, STORY_MAX_BYTES);
      if (!bytes) return reply(413, { error: `a story may be ${STORY_MAX_BYTES} bytes at most` });
      let sections: unknown;
      const raw = url.searchParams.get('sections');
      if (raw) {
        try {
          sections = JSON.parse(raw);
        } catch {
          return reply(400, { error: 'sections is not JSON' });
        }
      }
      try {
        const report = importLayer(session, bytes, { sections, actor: 'dm' });
        // A layer can touch any of them, and which it touched is the
        // report's business rather than the stream's — say everything
        // moved and let each screen refetch what it renders.
        for (const what of ['entities', 'templates', 'board', 'turn']) {
          host.room.changed(what);
        }
        return reply(200, report);
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
  }

  // -- the table itself. Watching requires being adopted (or the key). --

  if (!canWatch(auth)) return notAtTable();

  const session = host.session;

  if (method === 'GET' && head === 'campaign' && !a) {
    // A host with no campaign answers this one anyway, with nothing in
    // it — the key gate calls this to prove a key, and the console
    // reads `slug: null` as "land on the campaign screen". A 503 here
    // would read to the client as a bad key.
    if (!session) {
      return reply(200, {
        slug: null,
        manifest: null,
        system: null,
        packs: [],
        missing: [],
        watching: host.room.size,
      });
    }
    const { manifest, system, packs, missing } = session.loaded;
    // `loaded.manifest` is a boot-time snapshot, and a refs edit that
    // changes nothing loaded (the active board) deliberately skips
    // reload() — so refs are read off the LIVE root, the same call
    // `server/public.ts` makes, or a board swap serves yesterday's
    // scene to anyone reading this route.
    const live = session.campaign.root();
    // The root is an ENTITY, and an entity can carry notes and lists —
    // a DM who writes a secret on the campaign itself must not have it
    // handed to every adopted badge. A mere watcher gets the manifest's
    // identity and refs; the full root is the DM's own reading. Nothing
    // leaks today (the live root carries neither), but that's luck, and
    // this route should be law.
    const full = { ...manifest, refs: live.refs ?? {} };
    const redacted = { id: full.id, name: full.name, refs: full.refs };
    return reply(200, {
      slug: session.campaign.slug,
      manifest: canDm(auth) ? full : redacted,
      system: system ?? null,
      packs,
      missing,
      watching: session.watching,
    });
  }

  if (!session) return noCampaign();

  // The player-safe snapshot — one payload every passive surface (table,
  // board, badge, art) renders whole. The redaction law lives in
  // `server/public.ts`; the gate is `canWatch`, above.
  if (method === 'GET' && head === 'public' && !a) {
    return reply(200, publicSnapshot(session));
  }

  // -- how far away everything is ---------------------------------------
  //
  // The board, MEASURED (`server/geometry.ts`) — the same facts the
  // proposer bridge hands a plugin, through a door the DM's own screens
  // can knock on. It exists because the runner needed the one thing
  // only the host could answer: the target is three inches away, which
  // is Short, and the thing you armed reaches Melee.
  //
  // DM-GATED, and that is not a formality. It reports hidden tokens as
  // hidden and keeps them (the file says so out loud), which is exactly
  // the ambush the public snapshot strips — so this is the DM's screen
  // and nowhere else. `from` is whose turn it is; without one every
  // distance is simply absent, said in words.
  if (method === 'GET' && head === 'geometry' && !a) {
    if (!canDm(auth)) return denied();
    const from = url.searchParams.get('from')?.trim();
    return reply(200, fightGeometry(session, from || undefined));
  }

  // Which system and packs this campaign runs on — the manifest's refs,
  // rewritten. An ABSENT (or emptied) pack list is not "no packs": it
  // restores the default, every pack for the system in arrival order,
  // because a host with one pack must never make anyone tick a box.
  if (method === 'PUT' && head === 'campaign' && a === 'refs' && !b) {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const manifest = session.campaign.root();
    const refs: Record<string, Ref | Ref[]> = { ...(manifest.refs ?? {}) };

    if ('system' in body) {
      if (body.system === null || body.system === '') delete refs.system;
      else if (typeof body.system === 'string') {
        // Same reading as creation's — a folder-only system is pickable
        // here too, or the refs screen would refuse what the campaign
        // screen just allowed.
        const found = shelfSystem(host, body.system);
        if (!found) return reply(400, { error: `no system ${body.system} on this shelf` });
        refs.system = found;
      } else {
        return reply(400, { error: 'system must be a sys_ id or null' });
      }
    }

    if ('packs' in body) {
      if (body.packs === null || (Array.isArray(body.packs) && !body.packs.length)) {
        delete refs.packs;
      } else if (Array.isArray(body.packs)) {
        const declared: Ref[] = [];
        for (const raw of body.packs) {
          const id = String(raw ?? '').trim();
          if (!id) continue;
          const row = shelf.pack(id);
          // A pack that isn't on the shelf may still be declared — it
          // reports as missing at load rather than being refused here,
          // which is what lets a `.story` name packs you haven't got.
          declared.push({ id, name: row?.name ?? id });
        }
        if (declared.length) refs.packs = declared;
        else delete refs.packs;
      } else {
        return reply(400, { error: 'packs must be a list of pak_ ids, or null' });
      }
    }

    // Which board the table is showing — one ref beside the other two,
    // because "the active scene" is a fact about this campaign and the
    // manifest is where a campaign's facts live. Absent means no active
    // board, which means the table sits idle.
    if ('board' in body) {
      if (body.board === null || body.board === '') delete refs.board;
      else if (typeof body.board === 'string') {
        const board = shelf.board(body.board);
        if (!board) return reply(400, { error: `no board ${body.board} on this shelf` });
        refs.board = { id: board.id, name: board.name };
      } else {
        return reply(400, { error: 'board must be a brd_ id or null' });
      }
    }

    // Which handout the art frame is showing — the same shape as the
    // board, one ordinary manifest ref, because "the picture the table
    // is looking at" is a fact about this campaign in exactly the way
    // "the active scene" is. Absent means the frame rests.
    //
    // The REVEAL is its own event row rather than being left implicit
    // in the manifest's `entity.updated` (rule 3): "what has the table
    // been shown, and when" is a question about the session, and it
    // should read as one line in the log instead of a diff of a refs
    // object nobody can scan.
    const actor = actorOf(auth, String(body.actor ?? ''));
    let revealed: { kind: string; payload?: unknown } | undefined;
    if ('handout' in body) {
      if (body.handout === null || body.handout === '') {
        if (refs.handout) revealed = { kind: 'handout.cleared' };
        delete refs.handout;
      } else if (typeof body.handout === 'string') {
        const handout = handoutOf(session, body.handout);
        if (!handout) return reply(400, { error: `no handout ${body.handout}` });
        refs.handout = { id: handout.id, name: handout.name };
        revealed = {
          kind: 'handout.shown',
          payload: { id: handout.id, name: handout.name },
        };
      } else {
        return reply(400, { error: 'handout must be a template id or null' });
      }
    }

    session.save({ ...manifest, refs }, actor);
    if (revealed) {
      session.campaign.append(null, actor, revealed.kind, revealed.payload);
    }
    // A board or handout swap changes nothing about what's LOADED, so
    // it nudges the room instead of re-resolving the content stack.
    if ('system' in body || 'packs' in body) session.reload();
    else session.changed('handout' in body ? 'handout' : 'board');
    const { system, packs, missing } = session.loaded;
    return reply(200, {
      ok: true,
      system: system ?? null,
      packs,
      missing,
      board: refs.board ?? null,
      handout: refs.handout ?? null,
    });
  }

  if (head === 'entities' && !a) {
    if (method === 'GET') {
      const parent =
        url.searchParams.get('parent') ?? session.loaded.manifest.id;
      // A screen that may only WATCH gets the roster the room may see
      // and not the one the console keeps (the audit, 2026-08-24): this
      // door handed out the ambush and the half-made character by name,
      // a corridor around the snapshot's whole law. It answers from the
      // same redactor now — one law, two doors, so they cannot drift.
      // Someone else's children never travel publicly at all, which is
      // the header's own rule about `children`, so a watcher asking
      // after any other parent is answered with nothing rather than
      // with the roster it didn't ask for.
      if (!canPrep(auth)) {
        return reply(
          200,
          parent === session.loaded.manifest.id ? publicEntityList(session) : [],
        );
      }
      return reply(
        200,
        session.campaign
          .children(parent)
          .map(({ id, name, type }) => ({ id, name, type: type ?? null })),
      );
    }
    if (method === 'POST') {
      if (!canDm(auth)) return denied();
      const body = await bodyOf(req);
      try {
        const entity = session.create(
          (body.draft ?? {}) as EntityDraft,
          actorOf(auth, String(body.actor ?? '')),
          typeof body.parentId === 'string' ? body.parentId : undefined,
        );
        return reply(201, entity);
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
  }

  if (method === 'POST' && head === 'stamp' && !a) {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const slot = String(body.slot ?? 'bestiary');
    const templateId = String(body.templateId ?? '');
    const entity = session.stampFrom(
      slot,
      templateId,
      actorOf(auth, String(body.actor ?? '')),
      {
        name: typeof body.name === 'string' ? body.name : undefined,
        thick: body.thick === true,
        parentId: typeof body.parentId === 'string' ? body.parentId : undefined,
      },
    );
    if (!entity)
      return reply(404, {
        error: `no template ${templateId} in ${slot} — missing pack?`,
      });
    return reply(201, entity);
  }

  if (head === 'entities' && a && !b) {
    if (method === 'GET') {
      // Reading a whole entity is the seat's privilege for its own, and
      // the DM's for anyone — a passive surface gets the roster list.
      if (!canEditEntity(auth, a)) return denied();
      const entity = session.campaign.get(a);
      if (!entity) return reply(404, { error: `no entity ${a}` });
      if (url.searchParams.get('resolved') === '1') {
        return reply(200, session.reading(entity));
      }
      return reply(200, entity);
    }
    if (method === 'PUT') {
      if (!canEditEntity(auth, a)) return denied();
      const body = await bodyOf(req);
      const entity = toEntity({ ...((body.entity as object) ?? {}), id: a });
      if (!entity) return reply(400, { error: 'not an entity' });
      try {
        return reply(200, session.save(entity, actorOf(auth, String(body.actor ?? ''))));
      } catch (err) {
        return reply(404, { error: String(err) });
      }
    }
    if (method === 'DELETE') {
      if (!canDm(auth)) return denied();
      session.remove(a, actorOf(auth, url.searchParams.get('actor') ?? ''));
      return reply(200, { ok: true });
    }
  }

  // The seat's one door: edit the reading, store only the touch.
  if (method === 'POST' && head === 'entities' && a && b === 'entry') {
    if (!canEditEntity(auth, a)) return denied();
    const body = await bodyOf(req);
    const list = String(body.list ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!list || !name) return reply(400, { error: 'entry needs a list and a name' });
    const edit: EntryEdit = { list, name };
    if (typeof body.value === 'number' || typeof body.value === 'string') {
      edit.value = body.value;
    }
    if (body.max === null || typeof body.max === 'number') edit.max = body.max;
    if (body.remove === true) edit.remove = true;
    const saved = session.writeEntry(a, edit, actorOf(auth, String(body.actor ?? '')));
    if (!saved) return reply(404, { error: `no entity ${a}` });
    return reply(200, { stored: saved, reads: session.reading(saved) });
  }

  if (method === 'POST' && head === 'entities' && a && b === 'move') {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const parentId = String(body.parentId ?? '');
    if (!parentId) return reply(400, { error: 'move needs a parentId' });
    try {
      session.move(a, parentId, actorOf(auth, String(body.actor ?? '')));
      return reply(200, { ok: true });
    } catch (err) {
      return reply(404, { error: String(err) });
    }
  }

  // -- the sweep door (§L phase 1). "Edit the folder, sweep, live" needs
  // somewhere to say sweep, and until this existed the panel work was
  // saying it through the plugin-enable POST — which was doing double
  // duty as a rebuild and lying about what it meant. This re-runs the
  // resolution law over whatever is on disk now and answers with the
  // load report, so a folder that didn't parse says so out loud instead
  // of quietly not being there.
  if (method === 'POST' && head === 'shelf' && a === 'sweep' && !b) {
    if (!canDm(auth)) return denied();
    session.reload();
    const { loaded } = session;
    return reply(200, {
      ok: true,
      system: loaded.system ?? null,
      packs: loaded.packs,
      missing: loaded.missing,
      packProblems: loaded.packProblems,
      panelProblems: loaded.panelProblems,
    });
  }

  // -- copy a panel UP to the table's layer (§M-6's owed concession).
  //
  // The merge is `teller < system < packs < campaign < table`, so
  // customizing anything below the top means restating its name in
  // `<data>/panels/` — which until now meant finding the install
  // directory by hand and knowing which of four places the winning
  // version came from. This is that walk, done by the server, which is
  // the only party that already knows the answer.
  //
  // The SOURCE is the merge's own answer (`sourceOf`), not a guess: the
  // folder copied is the one whose declaration this table is actually
  // rendering, so what you get to edit is what you were looking at.
  //
  // Trust: a table's own files are its own (rule 7), and §M-6 is
  // explicit that the gate is consent for code arriving from OUTSIDE —
  // so a copy of teller's shipped furniture, or of code this table had
  // already said yes to, arrives already on. A copy of code nobody has
  // enabled yet does NOT: pressing copy is a decision about where a
  // file lives, and letting it double as the answer to "may this code
  // run" would launder an unanswered question through a button that
  // never asked it.
  if (method === 'POST' && head === 'panels' && a && b === 'copy-to-table') {
    if (!canDm(auth)) return denied();
    const dataDir = session.dataDir;
    if (!dataDir) return reply(501, { error: 'this host has no data dir' });
    const name = decodeURIComponent(a);
    if (!usableFolderName(name)) return reply(400, { error: `'${name}' is not a folder name` });

    const from = session.loaded.sourceOf('panels', name);
    if (!from) return reply(404, { error: `no panel called ${name}` });
    if (from === 'table') {
      return reply(409, { error: `'${name}' is already this table's own` });
    }
    if (from === 'campaign') {
      return reply(409, {
        error: `'${name}' is the campaign's own stored declaration — there is no folder to copy`,
      });
    }
    const declared = session.loaded
      .sourced('panels')
      .find((layer) => layer.source === from)
      ?.items.map((item) => item as { id?: string; name?: string })
      .find((item) => String(item.name ?? '').trim().toLowerCase() === name.trim().toLowerCase());
    const panelId = declared?.id;
    // A panel with no id has no folder to find it by — and no identity
    // to copy, which is the same problem wearing a different hat.
    if (!panelId) return reply(409, { error: `'${name}' carries no pan_ id to copy from` });
    const dir = from.startsWith('system:')
      ? systemPanelDir(dataDir, panelId)
      : from.startsWith('pack:')
        ? packPanelDir(dataDir, panelId)
        : defaultPanelDir(panelId);
    if (!dir) return reply(404, { error: `'${name}' has no folder on this host to copy` });
    if (existsSync(tablePanelDir(dataDir, name))) {
      return reply(409, { error: `panels/${name}/ already exists — nothing was touched` });
    }

    let copied: PanelCopy;
    try {
      copied = copyPanelToTable(dataDir, dir, name);
    } catch (err) {
      return reply(409, { error: String(err) });
    }
    let code: 'none' | 'pending' | 'enabled' = 'none';
    if (copied.carriesCode) {
      const inherited = from === 'teller' || shelf.pluginTrust(panelId)?.enabled === true;
      if (inherited) shelf.setPluginEnabled(copied.id, true);
      code = inherited ? 'enabled' : 'pending';
    }

    const body = await bodyOf(req);
    session.campaign.append(null, actorOf(auth, String(body.actor ?? '')), 'panel.copied', {
      name,
      from,
      id: copied.id,
      copiedFrom: panelId,
    });
    session.reload();
    return reply(200, { ok: true, name, from, id: copied.id, dir: copied.dir, code });
  }

  // -- plugins over HTTP: §15's "enablement is a human act in the
  // console", finally in the console. Toggle and config reload the
  // load path live, so the enable gate and the running set never drift.
  //
  // The trust table this reads and writes is the same one a code-
  // carrying `.panel` rides (§E: "trust rides the plugins table") — and
  // a code-carrying PACK too (§L phase 2) — so this route doubles as the
  // code enablement endpoint for both. A `pan_` or `pak_` id reloads the
  // CONTENT stack (that's where their code is attached, at sweep);
  // anything else reloads the PLUGIN load path, as before.
  if (head === 'plugins') {
    if (!canDm(auth)) return denied();
    const dataDir = session.dataDir;
    if (!dataDir) return reply(501, { error: 'this host has no data dir' });
    if (method === 'GET' && !a) {
      const { found, problems } = discoverPlugins(dataDir, session.shelf);
      const containers = containersOf(session);
      return reply(200, {
        found,
        problems: [...problems, ...session.pluginProblems],
        running: session.plugins.map((p) => p.manifest.id),
        // Trust that a human granted to CONTENT code, listed so it can
        // be taken back. Granting already had a door (the POST below);
        // revoking had none, because the only surfaces that offered the
        // toggle rendered while `codePending` — which is false the
        // moment you say yes, so the button vanished with the answer.
        //
        // The containers below subsume this for the console — every
        // grant is reachable inline, next to the thing it names. It
        // stays because it is the flat truth of the trust table and
        // costs one query; nothing on screen renders from it now.
        trusted: trustedCode(session),
        containers,
        unresolved: unresolvedTrusts(session, containers),
      });
    }
    const reloadPlugins = async () => {
      const result = await loadPlugins(dataDir, session.shelf);
      host.setPlugins(result.loaded, result.problems);
      session.changed('plugins');
    };
    if (method === 'POST' && a && !b) {
      const body = await bodyOf(req);
      if (typeof body.enabled !== 'boolean') {
        return reply(400, { error: 'enabled must be true or false' });
      }
      // Record WHAT was agreed to, not just that something was — the
      // needs list is what the console put on screen, and consent to it
      // is what `loadPlugins` checks the manifest against later.
      enablePlugin(dataDir, shelf, a, body.enabled);
      if (a.startsWith('pan_') || a.startsWith('pak_') || a.startsWith('sys_')) {
        // Panel, pack and system code aren't a plugin's `provides` —
        // all three are attached to their declaration by the sweep, so
        // what needs re-running is the content stack, not the plugin
        // load path.
        session.reload();
      } else {
        await reloadPlugins();
      }
      return reply(200, { ok: true, running: session.plugins.map((p) => p.manifest.id) });
    }
    if (method === 'PUT' && a && b === 'config') {
      const body = await bodyOf(req);
      shelf.setPluginConfig(a, body.config);
      await reloadPlugins();
      return reply(200, { ok: true });
    }
  }

  // -- what the running plugins PUT ON SCREEN (§15's pane tier) --------
  //
  // Read BESIDE the merged `panels` slot, never merged into it (§M-2: a
  // plugin never touches the merge). Two sources, one bar — the console
  // concatenates this list with the declarations and sorts the lot with
  // the one comparator (`byPanelOrder`), and the Screens picker offers
  // both for assignment. A plugin nobody enabled provides nothing, so
  // this answers `[]` and every surface reading it is simply shorter:
  // the degradation contract, and the whole point of the tier.
  //
  // Gated like the declarations it sits beside — which is to say barely.
  // A pane is furniture: it names a word, a label and a url whose bytes
  // are gated by the trust row at `/plugin-code/`. Nothing here is a
  // secret, and a seat needs it to draw its own tab bar.
  if (method === 'GET' && head === 'panes' && !a) {
    if (!canWatch(auth)) return notAtTable();
    return reply(200, panesOf(session.plugins));
  }

  // -- a plugin's own doors (§15). One route for every plugin that ever
  // ships, because the path IS the addressing: `/api/plugin/<plg_id>/
  // <door>/<anything else>` finds the plugin by id, the door by name,
  // and hands the rest to the handler as path segments.
  //
  // Everything that matters happens in `server/plugin-bridge.ts`; what
  // lives here is what must live in a ROUTE and nowhere else — resolving
  // who is asking against teller's own gates (rule 7: the server
  // decides, and a plugin is never given a header to re-decide from),
  // and refusing at the same three doors teller refuses at.
  //
  // A disabled plugin isn't in `session.plugins`, so its doors 404 by
  // the ordinary path rather than by a special case. That is the
  // degradation being the feature: switch the plugin off and the tab is
  // gone, the doors are gone, and nothing crashes.
  if (head === 'plugin' && a && b) {
    const plugin = pluginOf(session.plugins, a);
    if (!plugin) return reply(404, { error: `no plugin ${a} is running` });
    const access = plugin.doors[b];
    if (!access) return reply(404, { error: `${plugin.manifest.name} has no door '${b}'` });
    const allowed =
      access === 'dm' ? canDm(auth) : access === 'prep' ? canPrep(auth) : canWatch(auth);
    if (!allowed) return access === 'table' ? notAtTable() : denied();
    const body = method === 'GET' || method === 'DELETE' ? {} : await bodyOf(req);
    const who = whoOf(auth, actorOf(auth, String(body.actor ?? '')));
    const out = await callDoor(session, plugin, b, {
      method,
      path: parts.slice(4),
      body,
      who,
    });
    return reply(out.status, out.body);
  }

  // -- what this build can be ASKED for, and whether anybody answers.
  //
  // The registry is the list of points; the running plugins are who
  // implements them. A surface asks THIS, never "is the assistant
  // installed": a tool that renders a proposal box wants to know a point
  // is provided, and must never learn the name of what provides it. No
  // provider, no box — the same shape as `panes.ts` (a pane nobody can
  // be assigned to is a pane that doesn't exist).
  if (method === 'GET' && head === 'points' && !a) {
    if (!canDm(auth)) return denied();
    // The FIXED points only, and deliberately: a family's members are a
    // plugin's own words, and this endpoint exists so a surface can ask
    // "does anybody answer this?" without learning who. Panes are
    // listed where a surface can actually use them (`/api/panes`), and
    // doors are addressed by name or not at all.
    return reply(
      200,
      Object.entries(POINTS).map(([point, blurb]) => ({
        point,
        blurb,
        providers: providersOf(session.plugins, point as Point).length,
      })),
    );
  }

  // -- proposals (§15). The host assembles the snapshot, fans it out to
  // every enabled provider, and returns words. Playing any of it is the
  // DM's act — a proposal lands nowhere a human didn't put it (rule 1).
  //
  // One door for the whole `propose.*` family: the path segment IS the
  // point's second half, checked against the registry. A point added
  // there is callable here the same day, and a name that isn't one 404s
  // by its own name rather than by a missing branch of an if.
  if (method === 'POST' && head === 'propose' && a && !b) {
    if (!canDm(auth)) return denied();
    const named = `propose.${a}`;
    const point = isPoint(named) ? named : undefined;
    if (!point) return reply(404, { error: `no such point: ${named}` });
    const body = await bodyOf(req);
    let payload: unknown = body.payload ?? {};
    // What the WIDEST-declared provider could see. Each one is then
    // handed only the part its own `needs` granted, just below — the
    // snapshot is assembled once because measuring the board twice for
    // two proposers would be work nobody asked for, never because the
    // gate is optional.
    let widest: Record<string, unknown> | undefined;
    // BOTH halves of a turn get the same table. `propose.narrate` used
    // to be handed only the sentence the console typed, which is how a
    // narrator ends up inventing the shot that rang off the plate
    // nobody told it about — the ground, the order and the sheets are
    // as load-bearing after the dice as before them.
    if (point === 'propose.turn' || point === 'propose.narrate') {
      // Assemble the snapshot server-side: a fact the host holds and
      // doesn't pass on is a fact the model invents. That sentence was
      // the whole design, and it was only half kept — the turn order
      // and the acting sheet went, and the GROUND everybody was
      // standing on did not, so a proposer answered "the snapshot gives
      // no map, no positions and no ranges" about a fight teller had
      // measured coordinates for. `board` is that half (§4, rule 1: it
      // still only ever proposes).
      const turn = session.turnState();
      const acting = turn.turn === null ? undefined : turn.order[turn.turn];
      const actingEntity = acting?.entityId
        ? session.campaign.get(acting.entityId)
        : undefined;
      const names = new Map(
        session.campaign
          .children(session.loaded.manifest.id)
          .map((e) => [e.id, e.name]),
      );
      const board = fightGeometry(session, acting?.entityId);
      const placed = new Map(
        board.present
          ? board.tokens.flatMap((t) => (t.entityId ? [[t.entityId, t] as const] : []))
          : [],
      );
      // THE SYSTEM'S OWN LAW, in the system's own words. Every one of
      // these was already on the shelf and none of it was passed on,
      // which is the oldest failure here wearing a fourth hat: handed
      // band NAMES with no inches behind them, a reader said so out
      // loud in the middle of a fight ("I am assuming"), and handed no
      // menu of actions it never once considered moving.
      //
      // Slot names are the system's, not teller's — `bands` is a list
      // of rungs, `space` is a paragraph, `use` is the record the
      // console already prices actions from. Nothing here learns what
      // any of them say.
      const space = session.loaded.prose('space');
      const records: Record<string, unknown> = {
        bands: session.loaded.declarations('bands'),
        use: session.loaded.record('use'),
        statuses: session.loaded.declarations('statuses'),
        defenses: session.loaded.record('defenses'),
        ...(space ? { space } : {}),
      };
      // WHAT ALREADY HAPPENED, oldest last. Rule 3's payoff read
      // forwards: the log is the only place a condition's CAUSE is
      // written down, and a reader handed a held creature and no reason
      // for it makes one up and plays the turn off the invention.
      // Records only — the two kinds `server/undo.ts` also treats as
      // records, because they changed no state and say what the table
      // saw.
      //
      // WHO MOVED rides in the same list, in the same order, and
      // arrives MEASURED (`server/geometry.ts`). It is here rather than
      // in its own section because a step and a swing are the same kind
      // of fact — a thing that happened on somebody's turn — and the
      // one question a reader has about a step is what it did to the
      // distance, which is a number teller already has and must never
      // ask anybody else to work out.
      const bands = bandsIn(session.loaded.declarations('bands'));
      const history = session.campaign
        .events({ limit: 120 })
        .filter(
          (e) =>
            e.kind === 'turn.resolved' || e.kind === 'dice.rolled' || e.kind === 'token.moved',
        )
        .slice(0, 18)
        .reverse()
        .map((e) => {
          const payload =
            e.payload && typeof e.payload === 'object' ? (e.payload as object) : {};
          if (e.kind !== 'token.moved') return { kind: e.kind, ...payload };
          return { kind: e.kind, ...measureMove(payload as MoveRecord, board, bands) };
        });
      widest = {
        round: turn.round,
        order: turn.order.map((e, i) => {
          const entity = e.entityId ? session.campaign.get(e.entityId) : undefined;
          const read = entity ? session.reading(entity) : undefined;
          const entries = Object.values(read?.lists ?? {}).flat();
          const token = e.entityId ? placed.get(e.entityId) : undefined;
          return {
            name: e.label ?? (e.entityId ? (names.get(e.entityId) ?? 'unknown') : '?'),
            score: e.score ?? null,
            acting: i === turn.turn,
            ...(e.entityId ? { entityId: e.entityId } : {}),
            // LABELLED, both of them: a ceiling'd entry is something
            // being spent down, a value-less one is something held
            // (`core/entity.ts` — Prone, Ally, Dazed). Core's own
            // distinction, passed on rather than re-guessed per system.
            vitals: entries
              .filter((x) => typeof x.max === 'number')
              .map((x) => ({ name: x.name, value: x.value ?? 0, max: x.max })),
            held: entries.filter((x) => x.value === undefined).map((x) => x.name),
            // The THIRD kind of entry, and the one a turn is priced in:
            // a value with no ceiling is a STAT — a speed, a printed
            // band, a pool. `vitals` and `held` between them dropped
            // every one of them on the floor, so a reader asked what a
            // step costs had nothing to work it out from.
            stats: entries
              .filter((x) => typeof x.max !== 'number' && x.value !== undefined)
              .map((x) => ({ name: x.name, value: x.value })),
            ...(token?.awayInches !== undefined
              ? {
                  awayInches: token.awayInches,
                  awaySquares: token.awaySquares,
                  ...(token.awayBand ? { awayBand: token.awayBand } : {}),
                }
              : {}),
            onBoard: Boolean(token),
          };
        }),
        acting: actingEntity ? session.reading(actingEntity) : null,
        board,
        records,
        history,
        ...(typeof body.payload === 'object' && body.payload !== null
          ? (body.payload as object)
          : {}),
      };
      payload = widest;
    }
    const providers = providersOf(session.plugins, point);
    const proposals: { plugin: string; proposal?: unknown; error?: string }[] = [];
    for (const provider of providers) {
      try {
        const proposal = await provider.call(
          widest ? forNeeds(widest, pluginOf(session.plugins, provider.id)?.manifest.needs ?? []) : payload,
        );
        proposals.push({ plugin: provider.id, proposal });
      } catch (err) {
        proposals.push({ plugin: provider.id, error: String(err) });
      }
    }
    return reply(200, { point, providers: providers.length, proposals });
  }

  // -- the turn order (rule 5). Everyone reads; the DM drives; a seat
  // may submit exactly one thing — a score for its own entity's row.
  if (head === 'turn' && !a) {
    // …and everyone reads a DIFFERENT list: the console and a seat get
    // the order as it stands, a screen that may only watch gets the
    // order the room may see — the ambush out of it and the pointer
    // re-aimed (`publicTurn`). Same reason as the roster door above,
    // found in the same audit: a hidden combatant was announcing itself
    // through the one endpoint nobody thought of as player-facing.
    if (method === 'GET') {
      return reply(200, canPrep(auth) ? session.turnState() : publicTurnState(session));
    }
    if (method === 'POST') {
      const body = await bodyOf(req);
      const op = body as unknown as TurnOp;
      if (typeof op.op !== 'string') return reply(400, { error: 'an op needs an op' });
      if (!canDm(auth)) {
        const seat = auth.display;
        const owns =
          op.op === 'score' &&
          adopted(seat) &&
          seat.role === 'seat' &&
          session
            .turnState()
            .order.some(
              (e) => e.id === op.entryId && e.entityId === seat.params.entityId,
            );
        if (!owns) return denied();
      }
      return reply(200, session.turnOp(op, actorOf(auth, String(body.actor ?? ''))));
    }
  }

  // -- the campaign's own template half — prep (§13), DM's business.
  //
  // Reading is gated too: encounter recipes and bestiary numbers are
  // the Warden's prep, and an adopted table TV is player-facing glass.
  // A SEAT reads it legitimately (the catalogue it shops from), so the
  // gate is DM-or-seat rather than DM alone.
  if (head === 'templates' && a) {
    if (method === 'GET' && !b) {
      if (!canPrep(auth)) return denied();
      return reply(200, session.campaign.templatesIn(a));
    }
    if (!canDm(auth)) return denied();
    if (method === 'POST' && !b) {
      const body = await bodyOf(req);
      try {
        const made = session.campaign.putTemplate(
          a,
          body.template,
          actorOf(auth, String(body.actor ?? '')),
        );
        session.changed('templates');
        return reply(201, made);
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
    if (method === 'DELETE' && b) {
      session.campaign.removeTemplate(b, actorOf(auth, url.searchParams.get('actor') ?? ''));
      session.changed('templates');
      return reply(200, { ok: true });
    }
  }

  // -- handouts: the gallery, and the door bytes come in through ------
  //
  // The ROWS are ordinary templates and go through the ordinary
  // templates doors (`POST /api/templates/handouts` to author or
  // rename) — there is no second CRUD here, only the two things the
  // slot cannot do for itself: take a file, and take one away
  // completely. Reading has its own door because a list of rows with a
  // dead `data` wrapper is not what a gallery wants to render.
  //
  // The read gate is `canPrep`, matching the templates door it shadows
  // — a seat already reads this slot legitimately through that one, and
  // a gate here that disagreed would be a difference without a reason.
  if (head === 'handouts') {
    if (method === 'GET' && !a) {
      if (!canPrep(auth)) return denied();
      return reply(200, handoutsOf(session));
    }

    // Bytes in, key out. Raw body rather than JSON: a photograph
    // base64'd into a JSON string is a third bigger for nothing, and
    // the client has to hand-roll the fetch either way (the shared
    // `api()` helper is JSON-only, by design).
    if (method === 'POST' && a === 'upload' && !b) {
      if (!canDm(auth)) return denied();
      if (!host.dataDir) return reply(501, { error: 'this host has no data dir' });
      const ext = extFor(String(req.headers['content-type'] ?? ''));
      if (!ext) return reply(415, { error: 'a handout is a picture — png, jpg, webp, gif or avif' });
      const bytes = await rawBody(req, MAX_BYTES);
      if (!bytes) return reply(413, { error: `a handout may be ${MAX_BYTES} bytes at most` });
      if (!bytes.length) return reply(400, { error: 'no bytes' });
      return reply(201, { key: saveHandoutBytes(host.dataDir, bytes, ext) });
    }

    // Take one away for good. Its own door rather than the templates
    // DELETE because two things have to happen beside the row going:
    // the frame must stop showing a picture that no longer exists, and
    // the bytes must go — but only when nothing else names them, since
    // the key is a content hash and two rows may honestly share one.
    if (method === 'DELETE' && a && !b) {
      if (!canDm(auth)) return denied();
      const handout = handoutOf(session, a);
      if (!handout) return reply(404, { error: `no handout ${a}` });
      const actor = actorOf(auth, url.searchParams.get('actor') ?? '');
      const manifest = session.campaign.root();
      const ref = manifest.refs?.handout;
      const showing = (Array.isArray(ref) ? ref[0]?.id : ref?.id) === handout.id;
      session.campaign.removeTemplate(handout.id, actor);
      if (showing) {
        const refs = { ...(manifest.refs ?? {}) };
        delete refs.handout;
        session.save({ ...manifest, refs }, actor);
        session.campaign.append(null, actor, 'handout.cleared');
      }
      const stillUsed = handoutsOf(session).some((h) => h.key === handout.key);
      if (!stillUsed && host.dataDir) {
        const path = normalize(join(host.dataDir, handout.key));
        if (path.startsWith(join(host.dataDir, 'art') + '/') && existsSync(path)) {
          rmSync(path, { force: true });
        }
      }
      session.changed('templates');
      return reply(200, { ok: true });
    }
  }

  // THE COUNTER used to be here — `/api/shop`, `/api/shop/open`,
  // `/api/shop/cart/<id>`, `/api/shop/sell` and `/api/vendors`, against
  // the law in `server/store-flow.ts`. Both are GONE (§15, 2026-08-20).
  // The store is plugin №2, extracted whole, and its doors are its own:
  // `/api/plugin/<plg_store>/shop`, `/cart`, `/sell`, `/vendors`,
  // bridged by the one route above. teller ships with no store again,
  // and this comment is the only trace of one — kept because a reader
  // looking for the counter deserves to be told where it went rather
  // than to find nothing and conclude it was never built.
  // -- passing a note ---------------------------------------------------
  //
  // The law of who sees what is `server/notes.ts`; these are its three
  // doors. Note the asymmetry, which is the whole design: the DM WRITES
  // through one door and READS the lot through another, while every
  // other screen has exactly one door that answers about ITSELF —
  // `mine` is resolved from the asking screen's assignment, so a seat
  // cannot ask for somebody else's mail by asking differently.
  if (head === 'notes') {
    if (method === 'GET' && a === 'mine' && !b) {
      if (!canWatch(auth)) return notAtTable();
      return reply(200, visibleTo(notesOf(session), auth));
    }
    if (method === 'GET' && !a) {
      if (!canDm(auth)) return denied();
      return reply(200, notesOf(session));
    }
    if (method === 'POST' && !a) {
      if (!canDm(auth)) return denied();
      const body = await bodyOf(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';

      let handout: NoteHandout | undefined;
      if (typeof body.handoutId === 'string' && body.handoutId.trim()) {
        const found = handoutOf(session, body.handoutId.trim());
        if (!found) return reply(400, { error: `no handout ${body.handoutId}` });
        handout = { id: found.id, name: found.name, key: found.key };
      }
      if (!text && !handout) return reply(400, { error: 'a note needs words or a handout' });

      // An empty list is the whole table, deliberately — that is the
      // DM notice, and it is the same act as passing one scrap round.
      // A named recipient must EXIST, though: a note addressed to a
      // typo would be delivered to nobody and reported as sent.
      const to: string[] = [];
      for (const raw of Array.isArray(body.to) ? body.to : []) {
        const id = String(raw ?? '').trim();
        if (!id || to.includes(id)) continue;
        if (!session.campaign.get(id)) return reply(400, { error: `no one here is ${id}` });
        to.push(id);
      }

      const note = passNote(session, {
        to,
        ...(text ? { text } : {}),
        ...(handout ? { handout } : {}),
      });
      // Rule 3: the pending copy is ephemeral, the record is not. The
      // log is the DM's own reading, so the words go in whole.
      session.campaign.append(null, actorOf(auth, String(body.actor ?? '')), 'note.passed', {
        to,
        ...(text ? { text } : {}),
        ...(handout ? { handoutId: handout.id, handoutName: handout.name } : {}),
      });
      session.changed('notes');
      return reply(201, note);
    }
  }

  // -- the table notice -------------------------------------------------
  //
  // ONE door, both directions: words put a line up on the shared glass,
  // empty takes it down. There is no GET, deliberately — a notice is
  // part of the public snapshot every passive surface already renders
  // whole (`server/notice.ts`), and a second way to read it would be a
  // second answer to drift from the first. The console reads it from
  // the same snapshot everyone else does.
  if (method === 'POST' && head === 'notice' && !a) {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const raw = typeof body.text === 'string' ? body.text : '';
    const notice = setNotice(session, raw);
    // Rule 3, both ways round: taking a notice down is a change to what
    // the room can see, and a log that only recorded the putting-up
    // would say the table has been on BREAK since Tuesday.
    session.campaign.append(
      null,
      actorOf(auth, String(body.actor ?? '')),
      notice ? 'notice.posted' : 'notice.cleared',
      notice ? { text: notice.text } : {},
    );
    session.changed('notice');
    return reply(200, { notice });
  }

  // The fight is over — one press, and the table is clear (TEL-111).
  //
  // Deploy's opposite number and its neighbour on purpose: one door
  // puts a generation on the table, this one takes it off. It answers
  // with what it took, because a sweep that reported nothing reads the
  // same as a sweep that did nothing, and the console says the numbers
  // out loud. Confirmation is the console's job (rule 1 — this is a big
  // proposal), and `/undo` is the floor under it either way.
  if (method === 'POST' && head === 'table' && a === 'clear' && !b) {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    return reply(200, session.clearTable(actorOf(auth, String(body.actor ?? ''))));
  }

  // Deploy a prepared fight: stamp the foes, seed the order.
  if (method === 'POST' && head === 'encounters' && a && b === 'deploy') {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const result = session.deployEncounter(a, actorOf(auth, String(body.actor ?? '')));
    if (!result) return reply(404, { error: `no encounter ${a}` });
    return reply(200, result);
  }

  if (method === 'GET' && head === 'stack' && a && b) {
    // Declarations and records are the table's vocabulary — panels,
    // statuses, what the dice are called — and every passive surface
    // renders from them. Templates are prep, so they take the same
    // gate the campaign's own template half does.
    if (a === 'declarations') return reply(200, session.loaded.declarations(b));
    if (a === 'templates') {
      if (!canPrep(auth)) return denied();
      return reply(200, session.loaded.templates(b));
    }
    if (a === 'record') return reply(200, session.loaded.record(b));
  }

  // -- boards: the shelf of battlemaps, and the door pictures come in --
  //
  // The asset half of §4. A board is a shelf row like a book — reusable
  // across campaigns, referenced by id — so these are shelf doors and
  // not campaign ones, and only the fight ON it (`board-state`, below)
  // belongs to the campaign.
  //
  // The upload door is the handouts door's twin and is here for the same
  // reason: a pack is authored on the shelf and swept in, but a map is a
  // file the DM just bought, and requiring them to find `~/.teller/map/`
  // first is requiring them not to bother. Bigger cap (`server/boards.ts`),
  // because a battlemap is print artwork.
  //
  // Every one of these appends (rule 3). The log is the campaign's — it
  // is the only log there is, and a board arriving is a thing that
  // happened at this table even though the row outlives it.
  if (head === 'boards') {
    // The shelf, listed. Anyone at the table may see WHICH boards exist
    // — the gate up top is `canWatch` — but only the DM sees what the
    // places on them are called: an area is a named secret, and it is
    // stripped from the row for everyone else exactly as it is in the
    // snapshot (`publicBoardRow`).
    if (method === 'GET' && !a) {
      const boards = session.shelf.boards();
      return reply(200, canDm(auth) ? boards : boards.map(publicBoardRow));
    }

    if (method === 'POST' && a === 'upload' && !b) {
      if (!canDm(auth)) return denied();
      if (!host.dataDir) return reply(501, { error: 'this host has no data dir' });
      const ext = boardExtFor(String(req.headers['content-type'] ?? ''));
      if (!ext) return reply(415, { error: 'a board is a picture — png, jpg, webp, gif or avif' });
      const bytes = await rawBody(req, BOARD_MAX_BYTES);
      if (!bytes) return reply(413, { error: `a board may be ${BOARD_MAX_BYTES} bytes at most` });
      if (!bytes.length) return reply(400, { error: 'no bytes' });
      return reply(201, { key: saveBoardBytes(host.dataDir, bytes, ext) });
    }

    // Mint the row over an already-uploaded key. Two calls rather than
    // one multipart door: the bytes are content-hashed, so a second
    // board over the same picture (a lit version and a dark one) costs
    // nothing and needs no re-upload.
    if (method === 'POST' && !a) {
      if (!canDm(auth)) return denied();
      const body = await bodyOf(req);
      const key = typeof body.key === 'string' ? body.key.trim() : '';
      if (!key.startsWith('map/')) return reply(400, { error: 'a board needs its picture' });
      if (host.dataDir) {
        const path = normalize(join(host.dataDir, key));
        if (!path.startsWith(join(host.dataDir, 'map') + '/') || !existsSync(path)) {
          return reply(400, { error: `no picture at ${key}` });
        }
      }
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'new board';
      const width = toWidthInches(body.widthInches);
      const grid = toGrid(body.grid);
      const board = session.shelf.putBoard({
        key,
        name,
        ...(typeof width === 'number' ? { widthInches: width } : {}),
        ...(grid ? { grid } : {}),
      });
      session.campaign.append(null, actorOf(auth), 'board.added', {
        id: board.id,
        name: board.name,
      });
      session.changed('boards');
      return reply(201, board);
    }

    // What a board IS, edited after the fact — the calibration a DM only
    // works out once the map is on the table, and rule 1's floor: every
    // one of these is a stored value a human types over.
    if (method === 'PATCH' && a && !b) {
      if (!canDm(auth)) return denied();
      const board = session.shelf.board(a);
      if (!board) return reply(404, { error: `no board ${a}` });
      const body = await bodyOf(req);
      const next = { ...board };
      if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim();
      if ('widthInches' in body) {
        const width = toWidthInches(body.widthInches);
        if (width === null) delete next.widthInches;
        else if (typeof width === 'number') next.widthInches = width;
      }
      if ('grid' in body) {
        const grid = toGrid(body.grid);
        if (grid) next.grid = grid;
        else delete next.grid;
      }
      // The named layer (`core/fog.ts`). It comes in through the BOARD
      // door and not the fight's, because that is the whole claim: an
      // area is geography the campaign borrows, not something tonight
      // did. Ids are minted here for anything that arrives without
      // one, so a client that forgets can't author two nameless rows
      // that later collide.
      if ('areas' in body) {
        const areas = toAreas(body.areas);
        if (areas.length) next.areas = areas;
        else delete next.areas;
      }
      // The ground, through the same door and for the same reason
      // (`core/terrain.ts`): a cliff is not something tonight did. Ids
      // are minted here too, so the brush can author a patch without
      // knowing how to name one.
      if ('terrain' in body) {
        const terrain = toTerrain(body.terrain);
        if (terrain.length) next.terrain = terrain;
        else delete next.terrain;
      }
      const saved = session.shelf.putBoard(next);
      session.campaign.append(null, actorOf(auth), 'board.edited', {
        id: saved.id,
        name: saved.name,
      });
      session.changed('boards');
      return reply(200, saved);
    }

    // Taking one off the shelf takes the fight on it too, and the table
    // stops showing a board that no longer exists — the handout door's
    // own reasoning, applied to the other ref. Deleting the ACTIVE board
    // is allowed and CLEARS it rather than being refused: a refusal
    // would mean the way to delete a board is to go and find the control
    // that un-shows it first, which is a puzzle, not a safeguard.
    if (method === 'DELETE' && a && !b) {
      if (!canDm(auth)) return denied();
      const board = session.shelf.board(a);
      if (!board) return reply(404, { error: `no board ${a}` });
      const actor = actorOf(auth, url.searchParams.get('actor') ?? '');
      const manifest = session.campaign.root();
      const ref = manifest.refs?.board;
      const showing = (Array.isArray(ref) ? ref[0]?.id : ref?.id) === board.id;
      session.campaign.clearBoardState(board.id, actor);
      session.shelf.removeBoard(board.id);
      if (showing) {
        const refs = { ...(manifest.refs ?? {}) };
        delete refs.board;
        session.save({ ...manifest, refs }, actor);
      }
      session.campaign.append(null, actor, 'board.removed', {
        id: board.id,
        name: board.name,
      });
      // The key is a content hash, so two boards may honestly share one
      // picture; the bytes only go when nothing else names them.
      const stillUsed = session.shelf.boards().some((b) => b.key === board.key);
      if (!stillUsed && host.dataDir) {
        const path = normalize(join(host.dataDir, board.key));
        if (path.startsWith(join(host.dataDir, 'map') + '/') && existsSync(path)) {
          rmSync(path, { force: true });
        }
      }
      session.changed(showing ? 'board' : 'boards');
      return reply(200, { ok: true });
    }
  }

  if (head === 'board-state' && a && !b) {
    if (method === 'GET') {
      const state = session.campaign.boardState(a) ?? null;
      // The DM sees the board as it is; anyone else at the table sees
      // it as the table may — hidden placements gone, fog reduced to
      // its bare set of dark cells.
      // Same function the snapshot uses, because two strippings would
      // eventually disagree and one of them would be the leak.
      return reply(
        200,
        canDm(auth) ? state : publicBoardState(state),
      );
    }
    if (method === 'PUT') {
      if (!canDm(auth)) return denied();
      const body = await bodyOf(req);
      session.putBoardState(a, body.data ?? null, actorOf(auth, String(body.actor ?? '')));
      return reply(200, { ok: true });
    }
  }

  // -- the record doors (rule 3, and the runner's half of it) ----------
  //
  // Both of these RECORD and nothing else. The values a turn moves are
  // moved through the ordinary entry door, one at a time, so every one
  // of them is a number a stepper can move back and the log already
  // carries each write. What the log could NOT say is what the dice
  // showed and what the arithmetic was, and a fight nobody can replay is
  // a fight the log only half kept. Same posture as the old world's
  // `/moved`: records only — if one of these is lost, the table is still
  // exactly where the Warden put it and only the history is thinner.

  if (method === 'POST' && head === 'rolls' && !a) {
    const bodyRaw = await bodyOf(req);
    // A SEAT files its OWN rolls, and only its own — the same shape the
    // turn door already takes for a score (`op.op === 'score'`, above):
    // the DM may file anything, and a seat may say what its one
    // character's dice showed. Firing a weapon is the first thing a
    // player does that the log should keep, and a record nobody but the
    // Warden may write is a record of half the table (rule 3, rule 7 —
    // authority is role-derived, and a seat's role covers its entity).
    if (!canDm(auth)) {
      const seat = auth.display;
      const own =
        adopted(seat) && seat.role === 'seat' && String(bodyRaw.by ?? '') === seat.params.entityId;
      if (!own) return denied();
    }
    const record = toRollRecord(bodyRaw);
    if (!record) return reply(400, { error: 'a roll needs its pool' });
    session.campaign.append(record.by ?? null, actorOf(auth), 'dice.rolled', record);
    session.changed('events');
    return reply(200, { ok: true });
  }

  if (method === 'POST' && head === 'exchange' && !a) {
    if (!canDm(auth)) return denied();
    const record = toExchangeRecord(await bodyOf(req));
    if (!record) return reply(400, { error: 'an exchange needs its actor' });
    // Filed against the one it happened TO — which for a turn aimed at
    // nobody is the one who took it, so a creature's own turns can never
    // age out from under it.
    session.campaign.append(record.target ?? record.by, actorOf(auth), 'turn.resolved', record);
    session.changed('events');
    return reply(200, { ok: true });
  }

  // -- stepping back (rule 3's payoff — see server/undo.ts) ------------
  //
  // The log is already the whole mechanism, so these two doors are a
  // walk and one inversion. Nothing to undo is a 200 with nothing in
  // it: a fresh table has nothing behind it and pressing the button is
  // not an error.
  if (head === 'undo' && !a) {
    if (!canDm(auth)) return denied();
    if (method === 'POST') {
      const body = await bodyOf(req);
      return reply(200, { undone: undo(session, actorOf(auth, String(body.actor ?? ''))) });
    }
  }

  if (method === 'GET' && head === 'undo' && a === 'peek' && !b) {
    if (!canDm(auth)) return denied();
    return reply(200, { undoable: peekUndo(session) });
  }

  if (method === 'GET' && head === 'events' && !a) {
    if (!canDm(auth)) return denied();
    return reply(
      200,
      session.campaign.events({
        entityId: url.searchParams.get('entity') ?? undefined,
        limit: Number(url.searchParams.get('limit') ?? 100) || 100,
      }),
    );
  }

  return reply(404, { error: `no route ${method} ${url.pathname}` });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const root = existsSync(join(DIST, 'index.html')) ? DIST : PUBLIC;
  const path = normalize(join(root, rel));
  if (!path.startsWith(root) || !existsSync(path)) return false;
  try {
    const body = readFileSync(path);
    res.writeHead(200, {
      'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/**
 * How long a browser may keep a piece of served code, and the answer
 * comes off the url rather than off the route. A url stamped `?v=` was
 * built from its artifact's mtime (`stamp` in `core/panels-shelf.ts`),
 * so it is immutable BY CONSTRUCTION — a rebuild mints a different url
 * and the old one is never asked for again, which is the one condition
 * under which a year-long `immutable` is honest. An unstamped url makes
 * no such promise, so it revalidates every time: `no-cache` doesn't
 * mean "don't store", it means "ask first", and a 304 on unchanged
 * bytes is cheap on a machine in the same room.
 *
 * The pair is deliberate. Stale panel code behind a fresh-looking url
 * cost an afternoon of confusion, and the fix has to be the DEFAULT
 * that a url without a stamp falls into — not something a caller
 * remembers to opt into.
 */
function codeCache(url: URL): string {
  return url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/** The whole server, session + key in, listener out. Tests call this on port 0. */
export function serve(what: Session | Host, port: number, key: string) {
  // A Session is accepted for the callers that build one directly (the
  // tests, mostly) — it gets wrapped in a host whose room is the one it
  // already handed out, so nothing reconnects.
  const host = what instanceof Host ? what : Host.around(what);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // A `.panel`'s compiled code (§E UN-DEFERRED) — served PLAIN, no
    // ticket: "panel code is app code, not player-secret content." Only
    // `.build` outputs are reachable, and only for a panel the sweep
    // actually found — AND only once a human enabled it (2026-08-20,
    // closing the adversarial audit's one refutation): §M sanctions a
    // pack carrying the book's content, and a branded panel's code is a
    // content container — its strings can be the book's prose. Serving
    // those bytes before anyone enabled the pack would distribute what
    // the table never accepted, so the route checks the same trust row
    // the sweep checks. teller's own shipped defaults are trusted by
    // install (§M-6) and carry no row.
    if (url.pathname.startsWith('/panel-code/')) {
      const dataDir = host.dataDir;
      const rel = decodeURIComponent(url.pathname.slice('/panel-code/'.length));
      const [panelId, ...fileParts] = rel.split('/').filter(Boolean);
      // The table's own panels first, then the systems', then the packs',
      // then teller's own shipped defaults
      // (§M — a system ships unbranded panels and a pack ships the
      // book's branded ones; both are ordinary `.panel` folders with
      // ordinary `pan_` ids, so this is one more place to look, never a
      // second scheme). Order here is only lookup order — precedence at
      // the table is the merge's business, not this route's.
      const shelfDir = panelId && dataDir
        ? (panelDir(dataDir, panelId) ??
          systemPanelDir(dataDir, panelId) ??
          packPanelDir(dataDir, panelId))
        : undefined;
      // A shelf panel's bytes wait on its trust row; an install default
      // is teller's own and needs none.
      const trusted = shelfDir
        ? host.shelf.pluginTrust(panelId)?.enabled === true
        : true;
      const dir = shelfDir ?? (panelId ? defaultPanelDir(panelId) : undefined);
      const buildRoot = dir && trusted ? join(dir, '.build') : undefined;
      const path = buildRoot && fileParts.length
        ? normalize(join(buildRoot, ...fileParts))
        : undefined;
      if (!path || !buildRoot || !path.startsWith(buildRoot) || !existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': codeCache(url),
      });
      res.end(readFileSync(path));
      return;
    }

    // A plugin's compiled panes (§15's UI tier) — the third code door,
    // on exactly the terms of the other two. The trust gate is the
    // strictest of the three and needs no special reasoning: a plugin
    // that isn't RUNNING isn't in `host.plugins` at all, so its bytes
    // are unreachable by the same fact that makes its doors 404 and its
    // tab vanish. One switch, everything it added, gone together.
    if (url.pathname.startsWith('/plugin-code/')) {
      const rel = decodeURIComponent(url.pathname.slice('/plugin-code/'.length));
      const [pluginId, ...fileParts] = rel.split('/').filter(Boolean);
      const plugin = pluginId ? pluginOf(host.plugins, pluginId) : undefined;
      const buildRoot = plugin ? join(plugin.dir, '.build') : undefined;
      const path =
        buildRoot && fileParts.length ? normalize(join(buildRoot, ...fileParts)) : undefined;
      if (!path || !buildRoot || !path.startsWith(buildRoot) || !existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': codeCache(url),
      });
      res.end(readFileSync(path));
      return;
    }

    // A pack's compiled presentations (§L phase 2) — served plain, on
    // the same terms as `/panel-code/`, including the trust gate: no
    // byte leaves for a pack or system nobody enabled.
    //
    // `/pack-code/system.js` is the `system` specifier's body: generated,
    // not stored, from whatever the campaign's content stack resolves to
    // right now — so a sweep regenerates it by definition and it can
    // never drift from the packs actually loaded. Empty stack, empty
    // module: importing `system` must never 404 a panel.
    if (url.pathname.startsWith('/pack-code/')) {
      const dataDir = host.dataDir;
      const rel = decodeURIComponent(url.pathname.slice('/pack-code/'.length));
      if (rel === 'system.js') {
        res.writeHead(200, {
          'Content-Type': 'text/javascript',
          'Cache-Control': 'no-store',
        });
        res.end(systemIndexModule(host.session?.loaded.presentations() ?? {}));
        return;
      }
      const [packId, ...fileParts] = rel.split('/').filter(Boolean);
      // One code door for the whole content shelf: a `pak_` id resolves
      // to a pack folder, a `sys_` id to a system folder (§M).
      const dir =
        dataDir && packId
          ? (packDir(dataDir, packId) ?? systemDir(dataDir, packId))
          : undefined;
      const trusted = packId ? host.shelf.pluginTrust(packId)?.enabled === true : false;
      const buildRoot = dir && trusted ? join(dir, '.build') : undefined;
      const path = buildRoot && fileParts.length
        ? normalize(join(buildRoot, ...fileParts))
        : undefined;
      if (!path || !buildRoot || !path.startsWith(buildRoot) || !existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': codeCache(url),
      });
      res.end(readFileSync(path));
      return;
    }

    // The `system/<name>` specifier's body (§M-4a) — one shim per
    // export, generated per request against whatever system is ACTIVE
    // right now, re-exporting the stamped immutable module by its exact
    // names. No-store for the same reason `/pack-code/system.js` is: the
    // active system can change under a running table and the shim is
    // what absorbs it.
    //
    // Every refusal — no system, no such export, a system whose code
    // nobody enabled — is a 200 whose body THROWS, labeled. A 404 would
    // reject the dynamic import with a message naming nothing; this one
    // says exactly what's missing, at the render site, out loud (rule 1).
    if (url.pathname.startsWith('/system-export/')) {
      const name = decodeURIComponent(url.pathname.slice('/system-export/'.length)).replace(
        /\.js$/,
        '',
      );
      const loaded = host.session?.loaded;
      const entry = name ? loaded?.exports()[name] : undefined;
      const body = entry
        ? systemExportModule(name, entry)
        : refusalModule(
            !loaded?.system
              ? `\`${name}\` was imported, and this table has no active system`
              : `${loaded.system.name} doesn't export \`${name}\`` +
                (loaded.system.codePending
                  ? " — its code is on the shelf awaiting enablement"
                  : ''),
          );
      res.writeHead(200, {
        'Content-Type': 'text/javascript',
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }

    // A rulebook's bytes. Its own door rather than a limb of `/files/`
    // for two reasons: it answers RANGES, which is what makes opening
    // page 184 of a hundred-megabyte Guidebook instant instead of a
    // download; and its ticket names ONE BOOK (`book:<id>`) rather than
    // the whole data dir, so a slip that leaks out of a devtools panel
    // opens exactly the book it was minted for and nothing else.
    const verb = req.method ?? 'GET';
    if (url.pathname.startsWith('/books/') && (verb === 'GET' || verb === 'HEAD')) {
      const id = url.pathname.slice('/books/'.length).replace(/\.pdf$/i, '');
      const dataDir = host.dataDir;
      const ticketed = checkTicket(key, bookSubject(id), url.searchParams.get('t'));
      if (!ticketed || !dataDir) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('ticket required');
        return;
      }
      const found = bookBytes(dataDir, id, req.headers.range);
      if (found.status === 404) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      if (found.status === 416) {
        res.writeHead(416, found.headers);
        res.end();
        return;
      }
      res.writeHead(found.status, found.headers);
      if (verb === 'HEAD') {
        res.end();
        return;
      }
      // Streamed, never buffered: a rulebook is a hundred megabytes and
      // a table has several screens.
      createReadStream(found.path, { start: found.start, end: found.end }).pipe(res);
      return;
    }

    // Bytes from the data dir — pack art and board images — behind the
    // same ticket law as the stream (an <img> can't send headers).
    // Only art/ and map/ are reachable, and only inside the data dir.
    if (url.pathname.startsWith('/files/')) {
      const handle = url.searchParams.get('handle') ?? '';
      const ticket = url.searchParams.get('ticket');
      let valid = Boolean(handle) && checkTicket(key, `files:${handle}`, ticket);
      if (valid && handle !== 'dm') {
        const display = host.shelf
          .displays()
          .find((d) => displayHandle(d.id) === handle);
        valid = adopted(display);
      }
      const dataDir = host.dataDir;
      if (!valid || !dataDir) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('ticket required');
        return;
      }
      const rel = decodeURIComponent(url.pathname.slice('/files/'.length));
      const path = normalize(join(dataDir, rel));
      const allowed = ['art', 'map'].some((root) =>
        path.startsWith(join(dataDir, root) + '/'),
      );
      if (!allowed || !existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      });
      res.end(readFileSync(path));
      return;
    }

    // The stream can't send headers, so it presents a ticket instead —
    // signed by the one key over exactly this handle, and worthless for
    // anything else. A display's handle must still belong to an adopted
    // screen: a ticket identifies, it never grants a power the
    // assignment didn't already have (rule 7).
    if (url.pathname === '/api/stream') {
      const handle = url.searchParams.get('handle') ?? '';
      const ticket = url.searchParams.get('ticket');
      let valid = Boolean(handle) && checkTicket(key, `stream:${handle}`, ticket);
      if (valid && handle !== 'dm') {
        const display = host.shelf
          .displays()
          .find((d) => displayHandle(d.id) === handle);
        valid = adopted(display);
      }
      if (!valid) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('ticket required');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      const unsubscribe = host.room.subscribe(
        (what) => {
          res.write(`data: ${what}\n\n`);
        },
        handle === 'dm' ? undefined : handle,
      );
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
      return;
    }

    const auth = resolveAuth(host.shelf, key, {
      key: req.headers['x-teller-key'] as string | undefined,
      display: req.headers['x-teller-display'] as string | undefined,
    });

    const handled = await handleApi(
      { host, auth, key },
      req.method ?? 'GET',
      url,
      req,
    );
    if (handled) {
      if (handled.bytes) {
        res.writeHead(handled.status, handled.headers ?? {});
        res.end(handled.bytes);
        return;
      }
      res.writeHead(handled.status, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(handled.body));
      return;
    }

    if ((req.method ?? 'GET') === 'GET' && serveStatic(url.pathname, res)) {
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not here');
  });
  server.listen(port);
  return server;
}

// ---------------------------------------------------------------------
// `node server/index.ts --data ~/.teller-next --campaign <slug>`
//
// Booting is a function so `teller host` and a bare `node
// server/index.ts` are the SAME code path (`server/cli.ts` parses the
// friendlier surface and calls this). A CLI that reimplements the boot
// is a CLI that drifts from it.

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) out[arg.slice(2)] = argv[i + 1] ?? '';
  }
  return out;
}

export async function boot(args: Record<string, string>) {
  const dataDir = resolvePath(
    (args.data ?? join(homedir(), '.teller-next')).replace(/^~/, homedir()),
  );
  const port = Number(args.port ?? 4526);
  const slug = args.campaign;

  // Opened once, up front — seeding a default's trust row (below) and
  // every mode after it shares this one connection.
  const shelf = openShelf(dataDir);

  // Nothing seeds panels any more (2026-08-19): teller's five ship in
  // the install's `defaults/panels/` and are read where they lie, so
  // `<dataDir>/panels/` is the TABLE's own folder — empty unless a
  // human puts something in it, and never written to by teller.

  // Plugin management — the CLI is where a HUMAN enables (§15). These
  // are commands, not server modes: they act on the shelf and exit,
  // campaign or no campaign.
  if ('plugins' in args || args.enable || args.disable || args.configure) {
    if ('plugins' in args) {
      const { found, problems } = discoverPlugins(dataDir, shelf);
      if (!found.length && !problems.length) {
        console.log(`no plugins in ${join(dataDir, 'plugins')}`);
      }
      for (const p of found) {
        console.log(
          `${p.enabled ? '[on] ' : '[off]'} ${p.manifest.id} · ${p.manifest.name}` +
            ` v${p.manifest.version} · provides ${p.manifest.provides.map((x) => x.point).join(', ') || '(nothing)'}`,
        );
        // The needs, one per line and in the author's own words: this is
        // the app-permissions moment on a terminal, and a list of nine
        // sentences run together with commas is not one.
        for (const want of p.manifest.wants) console.log(`         needs ${want}`);
        if (!p.manifest.wants.length) console.log('         needs nothing',
        );
      }
      for (const p of problems) console.log(`  PROBLEM ${p.dir}: ${p.problem}`);
    } else if (args.enable || args.disable) {
      const id = args.enable || args.disable;
      // Enabling here is the same act the console performs, through the
      // same door, so it records the same thing: the needs as written,
      // which is what the agreement is ABOUT. Saying yes prints them back.
      const { wants } = enablePlugin(dataDir, shelf, id, Boolean(args.enable));
      console.log(`${id} ${args.enable ? 'enabled' : 'disabled'}`);
      if (args.enable) for (const want of wants) console.log(`  agreed: ${want}`);
    } else if (args.configure) {
      try {
        shelf.setPluginConfig(args.configure, JSON.parse(args.config ?? 'null'));
        console.log(`${args.configure} configured`);
      } catch (err) {
        console.error(`--config must be JSON: ${String(err)}`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  const key = loadDmKey(dataDir);
  const host = new Host(shelf, dataDir);
  const plugins = await loadPlugins(dataDir, shelf);
  host.setPlugins(plugins.loaded, plugins.problems);

  // `--campaign` is an explicit override that also becomes the
  // remembered choice; with no flag the host resumes whatever it was
  // running. A host with NEITHER boots anyway, into the no-campaign
  // state — the console lands on the campaign screen and the DM picks
  // one there. Exiting at this point was the old shape, and it made a
  // fresh install a dead end with no way out but the command line.
  const remembered = shelf.setting(ACTIVE_CAMPAIGN);
  const wanted = slug || remembered;
  if (slug && args.new) {
    const campaign = createCampaign(dataDir, slug, args.new);
    host.session = new Session(shelf, campaign, dataDir, host.room);
    host.session.plugins = plugins.loaded;
    host.session.pluginProblems = plugins.problems;
    shelf.setSetting(ACTIVE_CAMPAIGN, slug);
  } else if (wanted) {
    try {
      host.activate(wanted);
    } catch (err) {
      // A remembered campaign whose file went away is a note, never a
      // refusal to boot: the room's screens are still on the shelf.
      console.log(`  could not open '${wanted}': ${String(err)}`);
      if (wanted === remembered) shelf.setSetting(ACTIVE_CAMPAIGN, null);
    }
  }

  serve(host, port, key);

  // The books folder, swept exactly like the packs one — drop a PDF in
  // and it is installed (rule 4a). NOT awaited: reading a rulebook that
  // arrived since last boot takes seconds, and the table must not wait
  // on it. A book is openable the moment its row exists; searchable
  // shortly after.
  void sweepBooks(dataDir, shelf)
    .then(({ onDisk, missing, indexed, problems }) => {
      if (onDisk.length) {
        console.log(
          `  books: ${onDisk.length} on this host` +
            (indexed.length ? ` · read ${indexed.length} just now` : ''),
        );
      }
      // A row whose file has gone is SAID, never dropped — the campaign
      // still refers to it (rule 9).
      if (missing.length) {
        console.log(`  ${missing.length} book(s) referenced but not here: ${missing.join(', ')}`);
      }
      for (const p of problems) console.log(`  BOOK PROBLEM ${p.file}: ${p.problem}`);
      host.room.changed('books');
    })
    .catch((err: unknown) => console.log(`  books: did not sweep — ${String(err)}`));

  const session = host.session;
  console.log(
    `teller-next · ${session?.campaign.slug ?? '(no campaign)'} · http://localhost:${port}`,
  );
  if (!session) {
    const have = listCampaigns(dataDir);
    console.log(
      have.length
        ? `  campaigns here: ${have.join(', ')} — pick one from the console`
        : `  no campaigns in ${dataDir} yet — start one from the console`,
    );
  }
  const { system, packs, missing, panelProblems } = session?.loaded ?? {
    system: undefined,
    packs: [],
    missing: [],
    panelProblems: [],
  };
  if (session) {
    console.log(
      `  system: ${system ? `${system.name} v${system.version}` : '(none)'}` +
        ` · packs: ${packs.length ? packs.map((p) => p.name).join(', ') : '(none)'}`,
    );
  }
  for (const miss of missing) {
    console.log(`  MISSING ${miss.slot}: ${miss.ref.name} (${miss.ref.id})`);
  }
  for (const p of panelProblems) console.log(`  PANEL PROBLEM ${p.dir}: ${p.problem}`);
  if (plugins.loaded.length) {
    console.log(
      `  plugins: ${plugins.loaded.map((p) => p.manifest.name).join(', ')}`,
    );
  }
  for (const p of plugins.problems) console.log(`  PLUGIN PROBLEM ${p.dir}: ${p.problem}`);
  // The host's own terminal is the DM's device — this is `teller key`.
  console.log(`  DM key: ${key}  (open /?console and paste it)`);
  // Last, so it's the thing still on screen when the addresses print.
  const stale = staleClientWarning();
  if (stale) console.log(stale);
}

if (import.meta.main) await boot(parseArgs(process.argv.slice(2)));
