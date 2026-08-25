// The client's one door to the server. Adds the auth headers (rule 7:
// the key or the display id — never both required), memoizes the
// permission slips, and keeps localStorage keys identical to the
// vanilla client's so already-paired screens survive the swap.

import type { BoardFacts } from '../../core/registry.ts';

export type { BoardFacts };

const KEY = 'teller.key';
const DISPLAY = 'teller.display';

/**
 * The hash can NAME a screen — `#warden_left` — so one browser hosts
 * several independent screens, each with its own identity, pairing
 * code and assignment (the old app's `displaySlot`, ported; same
 * grammar, `console` reserved). Captured once at load: identity,
 * slips and the stream are all slot-scoped, so landing on a
 * DIFFERENT slot reloads rather than half-switching.
 */
function slotOf(hash: string): string {
  const s = hash.replace(/^#/, '').trim();
  return /^[A-Za-z0-9_-]{1,16}$/.test(s) && s !== 'console' ? s : '';
}

const SLOT = slotOf(window.location.hash);

export function displaySlot(): string {
  return SLOT;
}

window.addEventListener('hashchange', () => {
  if (slotOf(window.location.hash) !== SLOT) window.location.reload();
});

const displayKey = () => (SLOT ? `${DISPLAY}.${SLOT}` : DISPLAY);

export const stored = {
  get key(): string | null {
    return localStorage.getItem(KEY);
  },
  set key(v: string | null) {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  },
  get display(): string | null {
    return localStorage.getItem(displayKey());
  },
  set display(v: string | null) {
    if (v) localStorage.setItem(displayKey(), v);
    else localStorage.removeItem(displayKey());
  },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof (body as { error?: string }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText,
    );
  }
  return body as T;
}

// ---- displays / pairing ------------------------------------------------

export type DisplayInfo = {
  id: string;
  code?: string | null;
  role?: string | null;
  name?: string;
  color?: string;
  params?: Record<string, unknown>;
  /** This screen's own calibration — px per true inch, per axis. */
  ppi?: number;
  ppiY?: number;
  /** What the screen last reported about itself, for the frame box. */
  viewport?: { w: number; h: number };
};

export async function hello(): Promise<{ display: DisplayInfo; handle: string }> {
  const out = await api<{ display: DisplayInfo; handle: string }>(
    '/api/displays/hello',
    { body: stored.display ? { id: stored.display } : {} },
  );
  stored.display = out.display.id;
  return out;
}

// ---- boards (the battlemap's asset half, §4) ---------------------------
//
// A board is a SHELF row — picture, physical width, grid style —
// reusable across campaigns and referenced by id. What's on it right
// now goes through `/api/board-state`, which is the campaign's, and the
// split is the whole point of §4: exporting a `.story` mid-fight must
// not ship token positions.

export type Board = {
  id: string;
  key: string;
  name: string;
  widthInches?: number;
  grid?: { on?: boolean; color?: string; opacity?: number };
};

export function boards(): Promise<Board[]> {
  return api<Board[]>('/api/boards');
}

/**
 * The second place the client sends bytes instead of JSON, and
 * hand-rolled for the same reason as the handout door — with a bigger
 * appetite, because a battlemap is print artwork rather than a
 * photograph of a napkin.
 */
export async function uploadBoardImage(file: File): Promise<{ key: string }> {
  const headers: Record<string, string> = { 'Content-Type': file.type };
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  const res = await fetch('/api/boards/upload', { method: 'POST', headers, body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof (body as { error?: string }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText,
    );
  }
  return body as { key: string };
}

/** Mint the row over an already-uploaded picture. */
export function createBoard(board: {
  key: string;
  name: string;
  widthInches?: number | null;
  grid?: unknown;
}): Promise<Board> {
  return api<Board>('/api/boards', { body: board });
}

/** What a board IS, corrected after the fact (rule 1 — every stat is typed over). */
export function patchBoard(
  id: string,
  patch: { name?: string; widthInches?: number | null; grid?: unknown },
): Promise<Board> {
  return api<Board>(`/api/boards/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

/** Off the shelf for good — the fight on it goes too, and the table lets go. */
export function deleteBoard(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/boards/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Aim the table — one manifest ref, written like the handout's. Null clears it. */
export function showBoard(id: string | null): Promise<unknown> {
  return api('/api/campaign/refs', { method: 'PUT', body: { board: id } });
}

// ---- calibration -------------------------------------------------------
//
// The pattern a screen draws while it's being measured against something
// physical. The console AIMS one at a named screen; every other screen
// asks what IT should be drawing and is answered from its own identity
// — there is no way to phrase the question about somebody else's glass.
// The RESULT is written through the ordinary display PATCH, because
// `ppi`/`ppiY` is where the durable fact already lives.

export type CalibrationStep = 'corners' | 'across' | 'down' | 'verify';

export type Calibration = {
  step: CalibrationStep;
  ppi: number;
  ppiY: number;
  inches: number;
};

/** Draw this on that screen — or (null) give it back to itself. */
export function aimCalibration(
  displayId: string,
  pattern: Calibration | null,
): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/displays/${encodeURIComponent(displayId)}/calibrate`, {
    body: { pattern },
  });
}

/** What THIS screen is being asked to draw. Null is the normal answer. */
export function myCalibration(): Promise<Calibration | null> {
  return api<Calibration | null>('/api/displays/calibration');
}

/**
 * A screen telling the host how big it is.
 *
 * Telemetry about the caller itself and nothing else — the server
 * clamps it and only ever writes the asking screen's own row. It is
 * load-bearing for exactly two things, both of which were dead without
 * it: the amber frame box in the board editor (what the table can
 * actually SHOW, at true scale, needs the table's pixel count), and the
 * wizard's warning that a drawn strip is longer than the glass. The
 * vanilla client reported this and the new one never did, so both
 * features looked implemented and drew nothing.
 */
export function reportViewport(): Promise<unknown> {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // A browser that isn't drawing this tab answers with something absurd
  // (1×1 in a background tab, found live). No real screen is 200px, and
  // a stored 1×1 would silently shrink the console's frame box to
  // nothing — so a nonsense measurement is not reported at all, and the
  // last honest one stands.
  if (w < 200 || h < 200) return Promise.resolve(undefined);
  return api('/api/displays/viewport', { body: { w, h } }).catch(() => undefined);
}

// ---- permission slips (tickets) ---------------------------------------

export type Slips = { handle: string; ticket: string; files: string };

let slipsPromise: Promise<Slips> | null = null;

/** Memoized: one ticket fetch per session; forget on auth change. */
export function getSlips(): Promise<Slips> {
  slipsPromise ??= api<Slips>('/api/ticket').catch((err) => {
    slipsPromise = null;
    throw err;
  });
  return slipsPromise;
}

export function forgetSlips(): void {
  slipsPromise = null;
}

/**
 * Fetch a file route and hand the browser the download.
 *
 * A plain `<a download>` would be simpler and can't work: the auth
 * headers are rule 7's whole mechanism and a link sends none, so the
 * bytes are fetched like everything else here and handed on as a blob.
 * The NAME comes off the server's `Content-Disposition` when it sent
 * one — the folder on the shelf is the file's real name and only the
 * host knows it — with the caller's guess as the fallback.
 */
export async function download(path: string, fallback: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      typeof (body as { error?: string }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText,
    );
  }
  const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = named?.[1] ?? fallback;
  link.click();
  URL.revokeObjectURL(url);
}

/** A ticketed URL for bytes in the data dir (pack art, board images). */
export async function fileUrl(path: string): Promise<string> {
  const slips = await getSlips();
  return `/files/${path}?handle=${encodeURIComponent(slips.handle)}&ticket=${encodeURIComponent(slips.files)}`;
}

// ---- the player-safe snapshot -----------------------------------------
//
// One payload, and the ONLY thing a passive surface is allowed to read
// (rule 6). The redaction law lives on the server (`server/public.ts`);
// these are the shapes it hands back, mirrored here rather than
// imported — same reasoning as `screens.tsx`'s local `DisplayRole` and
// `runner.tsx`'s local `TurnState`: the server module is not part of
// the client's graph.
//
// What the views may therefore assume, and must never work around: a
// foe carries no numbers at all, only tag-like lists and a qualitative
// `vitality`. If a passive view ever wants a number the snapshot didn't
// bring, the answer is that the number is not for that screen.

export type PublicEntry = { name: string; value?: number | string; max?: number };

export type Vitality = 'healthy' | 'bloodied' | 'critical' | 'down';

export type PublicEntity = {
  id: string;
  name: string;
  type?: string;
  side: 'foe' | 'party';
  lists: Record<string, PublicEntry[]>;
  vitality?: Vitality;
};

export type PublicTurnEntry = {
  id: string;
  entityId?: string;
  label?: string;
  score?: number | null;
};

export type PublicTurn = {
  order: PublicTurnEntry[];
  turn: number | null;
  round: number;
  rolling?: boolean;
};

// ---- the turn order ----------------------------------------------------
//
// The live order, not the public snapshot's copy of it — a seat holds an
// assignment and may read the real thing. Mirrored from `server/turn.ts`
// rather than imported, for the same reason everything else here is: the
// server module is not part of the client's graph.

export type TurnEntry = {
  id: string;
  entityId?: string;
  label?: string;
  score?: number | null;
};

export type TurnState = {
  order: TurnEntry[];
  turn: number | null;
  round: number;
  rolling?: boolean;
};

export function turnState(): Promise<TurnState> {
  return api<TurnState>('/api/turn');
}

/** The one op a seat's own assignment allows (rule 5): a score for its
 *  own row. The server checks that the row is really this screen's —
 *  asking for anything else here just gets refused. */
export function scoreEntry(entryId: string, score: number | null): Promise<TurnState> {
  return api<TurnState>('/api/turn', { body: { op: 'score', entryId, score } });
}

/** The board asset, plus its live state minus everything hidden. */
export type PublicBoard = {
  board: {
    id: string;
    key: string;
    name: string;
    widthInches?: number;
    grid?: { on?: boolean; color?: string; opacity?: number };
  };
  state: {
    placements?: PublicPlacement[];
    /** Hidden ones never arrive — the redaction strips them server-side. */
    zones?: { id?: string; effect?: string; cells: [number, number][] }[];
    /**
     * Already flattened to one mask — no area names, no shapes. `base`
     * says what the cells mean: under `dark` they are the lit ones,
     * under `clear` they are the covered ones.
     */
    fog?: { base?: 'dark' | 'clear'; revealed?: [number, number][]; fogged?: [number, number][] };
    view?: { mode?: 'fit' | 'true'; zoom?: number; cu?: number; cv?: number };
  } | null;
};

/** Where a thing stands and what it looks like; how it's DOING comes
 *  through `entityId` at render, never from here (§5). */
export type PublicPlacement = {
  entityId?: string;
  label?: string;
  color?: string;
  /** Normalized image coordinates, 0..1 (docs/BATTLEMAP.md). */
  u: number;
  v: number;
  sizeInches?: number;
  shape?: 'disc' | 'square' | 'triangle';
  /** Degrees, clockwise. */
  rot?: number;
};

/** The picture the art frame is showing. Null means the frame rests. */
export type PublicHandout = { id: string; name: string; key: string };

export type PublicSnapshot = {
  campaign: { slug: string; name: string };
  roster: PublicEntity[];
  turn: PublicTurn;
  board: PublicBoard | null;
  handout: PublicHandout | null;
  /** The line the DM put up for the room. Null means the glass is clear. */
  notice: PublicNotice | null;
};

/** What the whole table is being told — never anything aimed at one player. */
export type PublicNotice = { text: string; at: string };

export function publicSnapshot(): Promise<PublicSnapshot> {
  return api<PublicSnapshot>('/api/public');
}

/**
 * Put a line up on the shared glass, or take it down with empty words.
 *
 * One door both ways (`server/notice.ts`): a notice is not a note, it
 * is not stored with the campaign, and it reaches the room through the
 * public snapshot every passive surface already renders.
 */
export function setNotice(text: string): Promise<{ notice: PublicNotice | null }> {
  return api<{ notice: PublicNotice | null }>('/api/notice', { body: { text } });
}

// ---- how far away everything is ---------------------------------------
//
// The DM's door onto `server/geometry.ts` — the fight measured on the
// calibrated board, in inches, in squares, and in the system's own word
// for that reach. DM-gated because it reports hidden tokens as hidden
// (the public snapshot removes them), so nothing that draws from this
// may ever be a player-facing surface.

export function fightGeometry(from?: string): Promise<BoardFacts> {
  return api<BoardFacts>(`/api/geometry${from ? `?from=${encodeURIComponent(from)}` : ''}`);
}

// ---- handouts and passed notes ----------------------------------------
//
// A handout is a named campaign row whose file is a host asset
// (`server/handouts.ts`); a note is ephemeral table traffic aimed at
// zero or more characters (`server/notes.ts`). The one thing this file
// has to be careful about is the ASYMMETRY of the two note doors: the
// DM's list comes from `/api/notes`, and every other screen asks
// `/api/notes/mine`, which the server resolves from that screen's own
// assignment. A seat never asks about anyone else, because there is no
// way to phrase the question.

export type Handout = { id: string; name: string; key: string; notes?: string };

export function handouts(): Promise<Handout[]> {
  return api<Handout[]>('/api/handouts');
}

/**
 * The one place the client sends bytes instead of JSON. Hand-rolled for
 * that reason — `api()` serializes everything it's given — and the auth
 * headers are the same two, because rule 7 has only the one secret.
 */
export async function uploadHandout(file: File): Promise<{ key: string }> {
  const headers: Record<string, string> = { 'Content-Type': file.type };
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  const res = await fetch('/api/handouts/upload', { method: 'POST', headers, body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof (body as { error?: string }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText,
    );
  }
  return body as { key: string };
}

/** Author or rename — the ordinary templates door, which handouts share. */
export function saveHandout(
  handout: { id?: string; name: string; key: string; notes?: string },
): Promise<{ id: string }> {
  const { id, name, key, notes } = handout;
  return api<{ id: string }>('/api/templates/handouts', {
    body: {
      template: {
        ...(id ? { id } : {}),
        name,
        data: { key, ...(notes?.trim() ? { notes: notes.trim() } : {}) },
      },
    },
  });
}

/** Its own door: the frame stops showing it and the bytes go with it. */
export function deleteHandout(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/handouts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Aim the art frame — one manifest ref, written like the board's. Null rests it. */
export function showHandout(id: string | null): Promise<unknown> {
  return api('/api/campaign/refs', { method: 'PUT', body: { handout: id } });
}

// ---- what the plugins put on screen, and how a pane knocks back ------
//
// §15's UI tier (2026-08-20). Two doors and no third: the list of panes
// the running plugins provide, and the way to call one plugin's own
// door. Everything a plugin adds to this client arrives through those.
//
// The STORE used to live here — `vendors()`, `shop()`, `writeCart()`,
// `sell()` and their shapes, mirrored off `server/store-flow.ts`. All
// of it is the store plugin's now (`examples/plugins/store/`), and its
// panes call `pluginCall` instead. That deletion is the point of the
// extraction, not a side effect of it: teller ships no store, so
// teller's api client knows no word of one.

export type Pane = {
  point: string;
  name: string;
  label?: string;
  blurb?: string;
  order?: number;
  subject?: 'entity' | 'none';
  icon?: string;
  /** The door whose non-null answer means this pane is showing right now. */
  when?: string;
  /** Which plugin provided it — what its own doors are addressed by. */
  plugin: string;
  code: { takeover: string; style?: string };
};

/**
 * Every pane the running plugins provide. `[]` on a host with none, and
 * `[]` is not an error — a teller with no plugins isn't degraded, it's
 * complete (§15).
 */
export function panes(): Promise<Pane[]> {
  return api<Pane[]>('/api/panes').catch(() => []);
}

/**
 * Knock on one plugin's door.
 *
 * The pane never writes its own plugin id: it is handed one of these
 * bound to the plugin that provided it (`BlockCtx.plugin`), so a pane
 * cannot address anybody else's doors by typo, and moving a pane
 * between plugins changes nothing in its code.
 */
export function pluginCall<T>(
  pluginId: string,
  door: string,
  opts: { method?: string; path?: string[]; body?: unknown } = {},
): Promise<T> {
  const tail = (opts.path ?? []).map(encodeURIComponent).join('/');
  return api<T>(
    `/api/plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(door)}${tail ? `/${tail}` : ''}`,
    {
      ...(opts.method ? { method: opts.method } : {}),
      ...(opts.body === undefined ? {} : { body: opts.body }),
    },
  );
}

export type PassedNote = {
  id: string;
  at: string;
  text?: string;
  handout?: { id: string; name: string; key: string };
  /** Entity ids. EMPTY IS THE WHOLE TABLE, never nobody. */
  to: string[];
};

/** Pass one. Absent or empty `to` is the table-wide notice. */
export function passNote(note: {
  text?: string;
  handoutId?: string;
  to?: string[];
}): Promise<PassedNote> {
  return api<PassedNote>('/api/notes', { body: note });
}

/** Every note passed at this table — the DM's own review list. */
export function passedNotes(): Promise<PassedNote[]> {
  return api<PassedNote[]>('/api/notes');
}

/** What THIS screen was passed, answered from its assignment. */
export function myNotes(): Promise<PassedNote[]> {
  return api<PassedNote[]>('/api/notes/mine');
}

// ---- `.story` — the campaign as a file, and the doors back in --------
//
// Four calls, and three of them send or receive BYTES rather than
// JSON, so they are hand-rolled beside `uploadHandout` for the same
// reason: `api()` serializes everything it's given, and an archive is
// a file.

export type Rights = { basis: 'homebrew' | 'personal' | 'licensed'; holder?: string; terms?: string };

export type StorySections = {
  templates: boolean;
  entities: boolean;
  turn: boolean;
  boards: boolean;
  assets: boolean;
  events: boolean;
  undo: boolean;
};

export type StoryIdentity = { id: string; version: number; rights: Rights };

/** What this campaign remembers about its own file. Null until the first export. */
export function storyIdentity(): Promise<{ name: string; identity: StoryIdentity | null }> {
  return api<{ name: string; identity: StoryIdentity | null }>('/api/story');
}

function bytesHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  return headers;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof (body as { error?: string }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText,
    );
  }
  return body as T;
}

/**
 * Write the campaign out, and hand the browser the download.
 *
 * POST, unlike `download()` above, because the switches are an object
 * and a query string is a worse JSON. Same blob trick for the same
 * reason: a bare `<a download>` sends no auth header (rule 7).
 * Anything the server left out comes back in a header, since the body
 * is the file itself.
 */
export async function exportStory(opts: {
  sections?: Partial<StorySections>;
  rights?: Rights;
}): Promise<{ filename: string; skipped: string[] }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  const res = await fetch('/api/story/export', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts),
  });
  if (!res.ok) return jsonOrThrow(res);
  const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  const filename = named?.[1] ?? 'campaign.story';
  const skipped: string[] = JSON.parse(
    decodeURIComponent(res.headers.get('x-story-skipped') ?? '%5B%5D'),
  );
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return { filename, skipped };
}

export type StorySummary = {
  manifest: { story: string; version: number; name: string; rights: Rights; exportedAt?: string };
  kind: string;
  sections: { name: string; count: number; label: string }[];
  missing: { slot: 'system' | 'pack' | 'book'; ref: { id: string; name: string } }[];
};

/** Look in the box before opening it. Changes nothing. */
export async function inspectStory(file: File | Blob): Promise<StorySummary> {
  const res = await fetch('/api/story/inspect', {
    method: 'POST',
    headers: bytesHeaders(),
    body: file,
  });
  return jsonOrThrow<StorySummary>(res);
}

export type ImportReport = {
  applied: string[];
  skipped: string[];
  missing: StorySummary['missing'];
};

/** Door (a): a NEW campaign, stamped from the file, and played. */
export async function campaignFromStory(
  file: File | Blob,
  name?: string,
): Promise<ImportReport & { slug: string; from: string; name: string }> {
  const q = name?.trim() ? `?name=${encodeURIComponent(name.trim())}` : '';
  const res = await fetch(`/api/campaigns/from-story${q}`, {
    method: 'POST',
    headers: bytesHeaders(),
    body: file,
  });
  return jsonOrThrow(res);
}

/** Door (b): layer it onto the table already being played. */
export async function importStory(file: File | Blob): Promise<ImportReport> {
  const res = await fetch('/api/story/import', {
    method: 'POST',
    headers: bytesHeaders(),
    body: file,
  });
  return jsonOrThrow<ImportReport>(res);
}
