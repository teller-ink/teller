// The live wire. ONE EventSource per SCREEN — not per component, and
// not per tab — with a subscriber set behind it.
//
// This is a connection budget, not tidiness. A browser allows six
// HTTP/1.1 connections per origin and an SSE stream never gives one
// back; a host on plain HTTP has no HTTP/2 to hide behind (no
// certificate for a LAN IP), so the seventh thing that wants the
// network waits forever and the room reads as "everything
// disconnected". One stream per component was the first way to spend
// the six; a DM opening six screens as six tabs was the second, and
// that one cost a day.
//
// HOW THE POOLING WORKS — leader election over localStorage:
//
// One tab per screen holds the socket and relays every nudge over a
// BroadcastChannel; the rest listen. Election is a heartbeat: the
// leader stamps a key, every tab checks it on a slow interval, a stale
// stamp gets taken over (write → wait a beat → read back, last writer
// wins). A leader that dies abdicates by silence, or says goodbye on
// pagehide so succession takes one beat instead of the stale timer.
// Every message off the socket re-stamps the heartbeat, because a
// hidden tab's TIMERS are throttled while its network is not, and a
// demonstrably-alive leader shouldn't be deposed for napping.
//
// The obvious alternatives, both ruled out in the old app and not
// worth re-walking: a SharedWorker owning the socket is the textbook
// answer and this family of browsers kills EventSource inside one at
// the network layer; Web Locks is [SecureContext] and therefore absent
// on exactly the LAN origin where any of this matters.
//
// SCOPE — the election key is the display SLOT, which is the screen's
// identity. The display id lives in localStorage under
// `teller.display[.<slot>]` (api.ts), so two tabs at the same address
// ARE the same screen: same id, same handle, same mail, and one socket
// serves both. Two tabs on different `#slots` are different screens
// with different tickets and each keeps its own. Slot is also known
// synchronously at load, which the handle (fetched with the slips) is
// not.

import { useEffect, useRef, useState } from 'react';
import { displaySlot, getSlips } from './api.ts';

type Listener = (what: string) => void;
type Status = (connected: boolean) => void;

const listeners = new Set<Listener>();
const identifyListeners = new Set<() => void>();
/**
 * Who wants to know whether the wire is up.
 *
 * The stream's health is the one thing about the stream a SURFACE has
 * to know: a passive screen quietly showing a five-minute-old number is
 * the worst failure this program has, because nothing about it looks
 * wrong. So the state is published here rather than kept private to the
 * retry loop — the old app's `ConnectionHint` seam, restored.
 */
const statusListeners = new Set<Status>();

const CHECK_MS = 2_500;
/** Longer than the server's 25s ping, so a leader whose socket is
 *  demonstrably alive is never deposed for a throttled timer. */
const STALE_MS = 35_000;
const FIRST_MS = 1_000;
const MAX_MS = 30_000;

/** `direct` = this browser can't pool; every tab holds its own socket. */
type Role = 'direct' | 'leader' | 'follower';

let source: EventSource | null = null;
let opening = false;
let retry: ReturnType<typeof setTimeout> | null = null;
let delay = FIRST_MS;
let wasDown = false;
/** Optimistic at load, exactly as the old app was: a screen that has
 *  not finished opening its socket yet is not a screen in trouble, and
 *  a pill that flashes on every boot is a pill nobody reads. */
let up = true;
let role: Role = 'direct';
let channel: BroadcastChannel | null = null;
let watch: ReturnType<typeof setInterval> | null = null;
let pooling = false;

/** This tab, for as long as it lives. Never rendered, never stored.
 *  `crypto.randomUUID` is absent on a LAN origin (rule 6). */
const TAB = crypto.getRandomValues(new Uint32Array(2)).join('-');

const scope = () => displaySlot() || 'main';
const leaderKey = () => `teller.stream.leader.${scope()}`;

type Relay =
  | { kind: 'nudge'; what: string }
  /** The leader's wire, up or down. A follower has no socket of its own
   *  to judge by, and a follower's screen is just as passive. */
  | { kind: 'status'; connected: boolean }
  /** A tab adopted, so the screen's identity changed under the leader's
   *  feet: whoever holds the socket must go back for fresh slips. */
  | { kind: 'reset' };

function alive(): boolean {
  return listeners.size + identifyListeners.size + statusListeners.size > 0;
}

/** Publish the wire's health to this tab, and — from the leader — to the rest. */
function tellStatus(connected: boolean, relay = true): void {
  if (relay && role === 'leader') {
    channel?.postMessage({ kind: 'status', connected } satisfies Relay);
  }
  if (up === connected) return;
  up = connected;
  for (const fn of statusListeners) fn(connected);
}

/** Can this browser pool at all? Old engines get a socket per tab. */
function canPool(): boolean {
  try {
    return typeof BroadcastChannel !== 'undefined' && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function stamp(): void {
  try {
    localStorage.setItem(leaderKey(), JSON.stringify({ id: TAB, at: Date.now() }));
  } catch {
    // Quota or a privacy mode: election degrades to every tab leading,
    // which is just the old one-socket-per-tab arithmetic.
  }
}

function abdicate(): void {
  try {
    localStorage.removeItem(leaderKey());
  } catch {
    // Best effort; the stale timer is the backstop.
  }
}

function readLeader(): { id: string; at: number } | null {
  try {
    const raw = localStorage.getItem(leaderKey());
    return raw ? (JSON.parse(raw) as { id: string; at: number }) : null;
  } catch {
    return null;
  }
}

/** Hand one nudge to this tab's subscribers. */
function deliver(what: string): void {
  if (what === 'identify') {
    for (const fn of identifyListeners) fn();
    return;
  }
  for (const fn of listeners) fn(what);
}

function schedule(): void {
  if (!alive() || role === 'follower') return;
  if (retry) clearTimeout(retry);
  retry = setTimeout(() => {
    retry = null;
    open();
  }, delay);
  delay = Math.min(delay * 2, MAX_MS);
}

function open(): void {
  if (source || opening || role === 'follower') return;
  opening = true;
  // Listening needs a ticket: EventSource can't send headers, so the
  // proof rides in the URL. It expires, and the browser's own retry
  // would hammer a 401 forever — so reconnection is ours.
  getSlips()
    .then((slips) => {
      opening = false;
      // An election can depose this tab while the slips are in flight,
      // and a socket opened after losing would be an orphan holding one
      // of the six until the tab closes — the exact failure this file
      // exists to prevent.
      if (role === 'follower' || !alive()) return;
      source?.close();
      const es = new EventSource(
        `/api/stream?handle=${encodeURIComponent(slips.handle)}&ticket=${encodeURIComponent(slips.ticket)}`,
      );
      source = es;
      es.onopen = () => {
        delay = FIRST_MS;
        tellStatus(true);
        // Coming back from a drop, nobody knows what was missed while
        // the wire was down — so say "everything" once, to this tab and
        // to anyone listening to it.
        if (wasDown) {
          wasDown = false;
          if (role === 'leader') {
            channel?.postMessage({ kind: 'nudge', what: 'sync' } satisfies Relay);
          }
          deliver('sync');
        }
      };
      es.onmessage = (ev) => {
        const what = String(ev.data ?? '');
        if (role === 'leader') {
          // Every message proves the socket lives — worth a heartbeat.
          stamp();
          channel?.postMessage({ kind: 'nudge', what } satisfies Relay);
        }
        deliver(what);
      };
      es.onerror = () => {
        wasDown = true;
        tellStatus(false);
        es.close();
        if (source === es) source = null;
        opening = false;
        schedule();
      };
    })
    .catch(() => {
      opening = false;
      wasDown = true;
      tellStatus(false);
      schedule();
    });
}

function hangUp(): void {
  if (retry) clearTimeout(retry);
  retry = null;
  source?.close();
  source = null;
  opening = false;
}

function lead(): void {
  const was = role;
  role = 'leader';
  stamp();
  // Said on every election beat, not only on a change: a tab that
  // becomes a follower has no socket to judge by and no idea what it
  // missed, so the standing answer converges in one beat rather than
  // waiting for the wire to next do something.
  channel?.postMessage({ kind: 'status', connected: up } satisfies Relay);
  if (was !== 'leader') open();
}

function follow(): void {
  role = 'follower';
  // A deposed leader hands its socket back — one per screen is the deal.
  hangUp();
}

/**
 * One election round: stamp if already leading, take over if the throne
 * is stale. Takeover is write → wait a beat → read back, so when
 * several tabs notice a dead leader at once, last-writer-wins settles
 * it with nobody coordinating.
 */
function elect(): void {
  const current = readLeader();
  if (current && current.id === TAB) {
    lead();
    return;
  }
  if (current && Date.now() - current.at < STALE_MS) {
    follow();
    return;
  }
  stamp();
  setTimeout(
    () => {
      if (!alive()) return;
      if (readLeader()?.id === TAB) lead();
      else follow();
    },
    100 + Math.random() * 200,
  );
}

function ensureStream(): void {
  if (pooling || role === 'leader' || source || opening || retry) return;
  if (!canPool()) {
    role = 'direct';
    open();
    return;
  }
  pooling = true;
  channel = new BroadcastChannel(`teller.stream.${scope()}`);
  channel.onmessage = (message: MessageEvent<Relay>) => {
    const relay = message.data;
    if (relay.kind === 'reset') {
      // Whoever holds the socket re-opens it; the asker is a follower
      // and has nothing of its own to tear down.
      if (role !== 'follower') {
        hangUp();
        open();
      }
      return;
    }
    if (relay.kind === 'status') {
      if (role === 'follower') tellStatus(relay.connected, false);
      return;
    }
    if (role === 'follower') deliver(relay.what);
  };
  watch = setInterval(elect, CHECK_MS);
  elect();
}

function teardown(): void {
  if (alive()) return;
  if (watch) clearInterval(watch);
  watch = null;
  if (role === 'leader') abdicate();
  channel?.close();
  channel = null;
  pooling = false;
  role = 'direct';
  up = true;
  hangUp();
}

// A closing tab abdicates on the way out, so succession takes one
// election beat instead of waiting out the stale timer.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (role === 'leader') abdicate();
  });
}

/**
 * Tear the stream down and come back with fresh slips. The moment that
 * needs this is ADOPTION on a key-holding machine: before adoption the
 * slips bind the stream to the DM handle, and an identify aimed at the
 * screen's own handle would land nowhere until a reload.
 *
 * The identity that changed is the whole screen's, so a follower can't
 * just fix itself — it asks the leader, whose socket carries the stale
 * handle.
 */
export function resetStream(): void {
  if (role === 'follower') {
    channel?.postMessage({ kind: 'reset' } satisfies Relay);
    return;
  }
  hangUp();
  if (alive()) open();
}

/**
 * Subscribe to nudges. Returns an unsubscribe.
 *
 * `on` is the same honest interest `useLive` takes, for the handful of
 * places that hold their own fetches rather than a hook's.
 */
export function onNudge(fn: Listener, on?: string[]): () => void {
  const listener: Listener = on
    ? (what) => {
        if (ALWAYS.includes(what) || wanted(on, what)) fn(what);
      }
    : fn;
  listeners.add(listener);
  ensureStream();
  return () => {
    listeners.delete(listener);
    teardown();
  };
}

/**
 * Is the wire up? — the one fact a surface may render about the stream.
 *
 * Optimistic until proven otherwise (see `up`), and a FOLLOWER reports
 * its leader's answer, because a follower's screen is exactly as stale
 * as the socket it isn't holding.
 */
export function useConnection(): boolean {
  const [connected, setConnected] = useState(up);
  useEffect(() => {
    setConnected(up);
    statusListeners.add(setConnected);
    ensureStream();
    return () => {
      statusListeners.delete(setConnected);
      teardown();
    };
  }, []);
  return connected;
}

/** Subscribe to the identify flash. */
export function onIdentify(fn: () => void): () => void {
  identifyListeners.add(fn);
  ensureStream();
  return () => {
    identifyListeners.delete(fn);
    teardown();
  };
}

/**
 * Words every hook refetches on, whatever it declared an interest in.
 *
 * - `sync` is the post-drop catch-up: the wire was down, nobody knows
 *   what was missed, so everything is suspect.
 * - `campaign` is a different table underneath the same screens.
 * - `reload` is the content stack re-resolving — a pack sweep changes
 *   declarations, records, templates AND what a `?resolved=1` entity
 *   reads as, so there is no honest hook that can sit it out.
 */
const ALWAYS = ['sync', 'campaign', 'reload'];

/**
 * Every word teller itself says (`session.changed` / `room.notify`),
 * which makes it also the way to recognise a word it DOESN'T say.
 *
 * A plugin nudges whatever it likes (`changed: ['shop']`), and no hook
 * in this repo can enumerate those — so a hook that reads a plugin's
 * door declares the pseudo-word `plugin`, which matches any word
 * outside this list. That keeps the seat's conditional tabs honest
 * about a shop opening without teaching teller the word "shop".
 */
const VOCABULARY = [
  'assign',
  'board',
  'boards',
  'books',
  'calibration',
  'campaign',
  'displays',
  'entities',
  'events',
  'handout',
  'identify',
  'notes',
  'notice',
  'plugins',
  'reload',
  'sync',
  'templates',
  'turn',
];

/** The interest that means "any word a plugin said". */
export const PLUGIN_WORD = 'plugin';

/**
 * The three interests that come up often enough to be spelled once.
 *
 * `DECLARED` covers the merged content stack — declarations, records,
 * the vocabulary a table renders from. None of it moves during play:
 * it re-resolves on a sweep (`reload`, always) and it grows when a
 * plugin is enabled. A tap on a counter cannot change it, which is the
 * whole of why a tap used to cost thirty-eight requests.
 *
 * `PROVIDED` is the pane list — the same, plus the plugins' own.
 *
 * `PUBLIC` is the player-safe snapshot, which is a view over almost
 * everything the table can see and is therefore deliberately wide.
 */
export const DECLARED = ['plugins'];
export const PROVIDED = ['plugins'];
export const PUBLIC = [
  'board',
  'boards',
  'handout',
  'notice',
  'templates',
  'entities',
  'turn',
];

function wanted(want: string[], what: string): boolean {
  if (want.includes(what)) return true;
  return want.includes(PLUGIN_WORD) && !VOCABULARY.includes(what);
}

/**
 * A burst of nudges is one refetch. The server nudges per MUTATION, so
 * an import or a resolved exchange says four words in a millisecond;
 * without this each one costs every listening hook a request, on a link
 * with six connections to spend.
 */
const COALESCE_MS = 50;

/**
 * Fetch + refetch on a nudge. The server tells us WHAT changed as a
 * string; `on` is this hook's honest interest in those words, and
 * without one the hook refetches on everything (the original
 * behaviour — an omitted interest is never a silent narrowing).
 *
 * A too-wide interest is merely slow; a too-narrow one is WRONG, and
 * shows up as a number that stopped moving. When in doubt, widen — or
 * declare nothing, which is the honest way to say "anything could
 * change this" (the undo peek and the event log both mean it).
 */
export function useLive<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts?: { on?: string[] },
): { data: T | undefined; error: Error | undefined; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  // Held in a ref because callers write the list inline: a fresh array
  // every render must not re-run the effect, and `deps` is what decides
  // that, exactly as before.
  const wantRef = useRef(opts?.on);
  wantRef.current = opts?.on;

  const load = () => {
    fetchRef
      .current()
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => setError(e));
  };

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      load();
    };
    const off = onNudge((what) => {
      const want = wantRef.current;
      if (want && !ALWAYS.includes(what) && !wanted(want, what)) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      )
        return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, COALESCE_MS);
    });
    // A hidden tab's TIMERS are throttled while its socket is not (the
    // same asymmetry the leader heartbeat above is built around), so a
    // coalescing window can outlast the tab being hidden. Whatever is
    // still owed is paid the moment somebody looks at the screen.
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      if (timer) clearTimeout(timer);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, reload: load };
}
