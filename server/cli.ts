// The `teller` command — the new world's front door.
//
// Subcommands rather than flags-on-a-bare-command, because this will
// grow, and retrofitting a verb onto a program whose bare form already
// did something is how CLIs end up with `--no-serve`. Bare `teller`
// prints help: starting a service that binds a port and serves your
// campaign to the room is not something a typo should do.
//
// This file is the friendly surface and NOTHING else. Every path ends
// in `boot()` (server/index.ts), which is the same code a bare `node
// server/index.ts` runs — a CLI that reimplements the boot is a CLI
// that drifts from it.

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { HOST_LOCK } from '../core/store.ts';
import { installDefaultsDir } from '../core/systems-shelf.ts';
import { loadDmKey } from './auth.ts';
import { boot, tellerVersion } from './index.ts';

// THE FOLD FLIPPED THIS (2026-08-24). The rebuild lived in
// `~/.teller-next` while the old world still held `~/.teller`; with
// `worker/` and `host/` gone there is only one thing that could have
// written this folder, and it gets the honest name back. A pre-fold
// `~/.teller` written by the OLD app is a different database shape —
// boot refuses a strange db loudly rather than guessing; move it aside
// and bring your `~/.teller-next` here.
const DEFAULT_DATA = join(homedir(), '.teller');

// The port survives the fold unchanged: every screen at a table
// bookmarks this address (rule 6 — one url per table), and a fold that
// silently moved the table would strand every bookmark and kiosk.
const DEFAULT_PORT = 4526;

const HELP = `
  teller — the table plays, teller keeps the books

  usage
    teller host [path]        serve this table; everything runs here
    teller key                print the DM key — the one the console asks for
    teller where              print the data folder, and where this install's
                              own defaults live (copy a starter system from there)
    teller plugins            list the plugins in the data folder's plugins/,
                              each with what it needs and whether it's on
    teller version

  options
    --port <n>                default ${DEFAULT_PORT}
    --data <path>             the data folder (default ${DEFAULT_DATA})
    --campaign <slug>         open this one instead of the remembered one
    --reset                   with 'key': mint a new one
    --defaults                with 'where': print only the defaults folder
    --enable/--disable <id>   with 'plugins': a human turns one on or off;
                              a running host picks it up when it restarts
    --configure <id> --config <json>
                              with 'plugins': store that plugin's settings

  a path given to any command is the same as --data, so a campaign can
  live on a stick you carry:

    teller host /Volumes/CARD

  with no campaign named and none remembered, the host boots anyway and
  the console lands on the picker. once it's up, every other screen in
  the room just opens the address it prints. nothing is installed on any
  of them.
`;

/** Long flags with values, plus bare positionals. No cleverness wanted. */
function parse(argv: string[]) {
  const opts: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reset') opts.reset = true;
    else if (arg === '--defaults') opts.defaults = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=');
      opts[name] = inline ?? argv[++i] ?? '';
    } else rest.push(arg);
  }
  return { opts, rest };
}

function flag(opts: Record<string, string | true>, name: string): string | undefined {
  const value = opts[name];
  return typeof value === 'string' ? value : value === true ? '' : undefined;
}

// `teller version` and `/api/health` say the same number because they
// read it in the same place (`tellerVersion`, server/index.ts) — two
// readings of one package.json is two readings that can disagree.
const version = tellerVersion;

/**
 * The pre-fold guard, one check for every command that touches the data
 * folder. A `teller.db` with no `shelf.db` beside it is the OLD app's
 * data dir — a different database shape. Opening it reads as an empty
 * shelf over a folder full of somebody's campaigns, and worse, opening
 * it WRITES a `shelf.db` — after which the guard can no longer tell, and
 * `teller host` boots empty over the old data instead of refusing. So
 * `plugins` and `key` (which create shelf state) and `where` (which is
 * where a confused person looks next) all refuse exactly as `host` does,
 * before anything is written.
 */
function refuseOldShape(data: string): void {
  if (existsSync(join(data, 'teller.db')) && !existsSync(join(data, 'shelf.db'))) {
    throw new Error(
      `${data} holds a pre-fold teller database (teller.db). ` +
        `This version keeps a different shape (shelf.db + campaigns/). ` +
        `Move the old folder aside (e.g. ${data}-legacy), or point --data somewhere else.`,
    );
  }
}

/**
 * A host serving this folder right now, if there is one — read off the
 * claim `teller host` keeps in it (`claimDataDir`, core/store.ts). A
 * claim whose process has gone is no host at all.
 */
function runningHost(data: string): { pid: number; port: number } | undefined {
  try {
    const held = JSON.parse(readFileSync(join(data, HOST_LOCK), 'utf8')) as {
      pid?: unknown;
      port?: unknown;
    };
    if (!Number.isInteger(held.pid)) return undefined;
    try {
      process.kill(held.pid as number, 0);
    } catch (err) {
      if ((err as { code?: string }).code !== 'EPERM') return undefined;
    }
    return { pid: held.pid as number, port: Number(held.port) };
  } catch {
    return undefined;
  }
}

/** Every address a screen in this room could reach us on. */
function addresses() {
  const found: { name: string; address: string }[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      found.push({ name, address: addr.address });
    }
  }
  return found;
}

export async function main(argv: string[]) {
  const { opts, rest } = parse(argv);
  const command = rest[0] ?? (opts.version ? 'version' : 'help');

  if (opts.help && command !== 'help') {
    console.log(HELP);
    return;
  }

  // A bare path means the same as --data — that's the stick you carry.
  const data = resolve((flag(opts, 'data') || rest[1] || DEFAULT_DATA).replace(/^~/, homedir()));

  switch (command) {
    case 'host':
    case 'serve': {
      const port = Number(flag(opts, 'port') || process.env.TELLER_PORT || DEFAULT_PORT);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${flag(opts, 'port')} is not a port`);
      }
      // The pre-fold guard the comment on DEFAULT_DATA promises.
      refuseOldShape(data);
      mkdirSync(data, { recursive: true });
      const campaign = flag(opts, 'campaign');
      // The heading waits until the port is really ours: a host that
      // can't bind, or whose folder another host holds, says one
      // sentence and nothing that looks like it started.
      const { port: bound } = await boot(
        {
          data,
          port: String(port),
          ...(campaign ? { campaign } : {}),
        },
        () => {
          console.log('\n  teller\n');
          console.log(`  data      ${data}`);
          console.log(`  key file  ${join(data, 'dm.key')}\n`);
        },
      );
      console.log('');
      console.log('  open on this machine:');
      console.log(`    http://localhost:${bound}`);
      const nics = addresses();
      if (nics.length) {
        console.log('  other screens in the room:');
        for (const { name, address } of nics) {
          console.log(`    http://${address}:${bound}   (${name})`);
        }
      }
      console.log('\n  ctrl-c to stop\n');
      return;
    }

    case 'key': {
      // Reset is destructive in a quiet way: every screen already paired
      // stays paired, but the DM's own device has to be told the new key.
      refuseOldShape(data);
      const file = join(data, 'dm.key');
      if (opts.reset && existsSync(file)) {
        // A running host read its key once, at boot, and keeps it: the
        // new one is refused there until a restart, and the GM is locked
        // out with nothing on screen saying why. Said first, to stderr,
        // so stdout stays the key and nothing else. Then done anyway —
        // it's what was asked.
        const live = runningHost(data);
        if (live) {
          console.error(
            `a host is serving this folder right now (pid ${live.pid}, port ${live.port}) — ` +
              `it keeps the old key until it is restarted, so restart it to use this one.`,
          );
        }
        rmSync(file);
      }
      mkdirSync(data, { recursive: true });
      console.log(loadDmKey(data));
      return;
    }

    case 'plugins': {
      // §15: the CLI is where a HUMAN enables. `boot` already knows how
      // — these are commands that act on the shelf and exit.
      refuseOldShape(data);
      mkdirSync(data, { recursive: true });
      const enable = flag(opts, 'enable');
      const disable = flag(opts, 'disable');
      const configure = flag(opts, 'configure');
      // A host already running loaded its plugins at boot; the grant
      // recorded here reaches it on restart. Said BEFORE the boot call,
      // because managing exits from inside it.
      const live = enable || disable || configure ? runningHost(data) : undefined;
      if (live) {
        console.log(
          `the host serving this folder (pid ${live.pid}, port ${live.port}) picks this up when it restarts — ` +
            `or use the console's Plugins tab, which takes effect at once.`,
        );
      }
      await boot({
        data,
        ...(enable ? { enable } : {}),
        ...(disable ? { disable } : {}),
        ...(configure ? { configure, config: flag(opts, 'config') ?? 'null' } : {}),
        ...(enable || disable || configure ? {} : { plugins: '' }),
      });
      return;
    }

    case 'where':
      // Two answers, labelled: where YOUR things live, and where teller's
      // own shipped defaults live — the second exists after `brew
      // install` as well as in a checkout, which is what lets a guide
      // say `cp -R "$(teller where --defaults)/systems/starter" …` and
      // mean it everywhere.
      refuseOldShape(data);
      if (opts.defaults) {
        console.log(installDefaultsDir());
        return;
      }
      console.log(`data      ${data}`);
      console.log(`defaults  ${installDefaultsDir()}`);
      return;

    case 'version':
      console.log(version());
      return;

    case 'help':
      console.log(HELP);
      return;

    default:
      console.error(`\n  no such command: ${command}\n${HELP}`);
      process.exitCode = 1;
  }
}
