// Rule 7, ported: one key, and assignments — no accounts, no other
// secrets.
//
// There is exactly one secret in teller: the DM key, minted into
// `<data>/dm.key` on first run. It is the root of trust and the only
// thing that ever confers authority by being known. Everything else is
// an assignment: the server looks up what a display was assigned and
// allows exactly that. Authorization is role-derived — never re-derive
// it from a secret the client holds.
//
// The old world proved this shape (worker/displays.ts, worker/
// tickets.ts); this is the same law on node:crypto — synchronous,
// because the host is not a Worker and doesn't have to pretend
// `crypto.subtle` is the only door.
//
// One deliberate simplification the move made possible: displays have
// no campaign column. The room's screens belong to the MACHINE (rule
// 9), the host runs one campaign at a time, and an adopted screen is
// at whatever table the host is serving. "Bring a screen over" — the
// old world's cross-campaign dance — dissolves; adoption is simply a
// consumed pairing code.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Display, Shelf } from '../core/store.ts';

/** Read the one key, minting it on first run — `teller key` prints this. */
export function loadDmKey(dataDir: string): string {
  const path = join(dataDir, 'dm.key');
  if (existsSync(path)) {
    const key = readFileSync(path, 'utf8').trim();
    if (key) return key;
  }
  const key = randomBytes(24).toString('hex');
  writeFileSync(path, key + '\n', { mode: 0o600 });
  return key;
}

/**
 * Where a display must be named in a URL (the SSE stream can't send
 * headers), use its handle — sha-256(id), which identifies but never
 * authorises. Told to the screen by the server: a LAN origin is not a
 * secure context and has no `crypto.subtle` of its own.
 */
export function displayHandle(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

// ---------------------------------------------------------------------
// Tickets — short-lived permission slips for what can't send a header.
//
// An HMAC over subject + expiry, signed with the one key. Nothing is
// stored, so nothing has to be cleaned up; a ticket is useless for
// anything but its own subject; and it dies on its own. This is NOT a
// second secret — it's the same key proving it signed something.

function sign(secret: string, subject: string, expires: number): string {
  return createHmac('sha256', secret)
    .update(`${subject}.${expires}`)
    .digest('hex')
    .slice(0, 32);
}

/** `subject` is what the ticket opens — `stream:dm`, `stream:<handle>`. */
export function mintTicket(secret: string, subject: string, minutes: number): string {
  const expires = Date.now() + minutes * 60_000;
  return `${expires}.${sign(secret, subject, expires)}`;
}

export function checkTicket(
  secret: string,
  subject: string,
  ticket: string | null,
): boolean {
  const [expires, presented] = (ticket ?? '').split('.');
  if (!expires || !presented) return false;
  if (!Number(expires) || Number(expires) < Date.now()) return false;
  // Signed over the expiry that was PRESENTED — signing a fresh one
  // would compare two different messages and never match.
  return safeEqual(sign(secret, subject, Number(expires)), presented);
}

/**
 * A session's worth. Long, because an EventSource reconnects on its
 * own and a ticket that dies mid-game would take the table's screens
 * with it.
 */
export const STREAM_MINUTES = 12 * 60;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------
// Who is calling, and what may they do.

export type Auth = {
  /** The root of trust: the one key, held by the DM's own device. */
  key: boolean;
  display?: Display;
};

/**
 * Resolve the caller from its headers. This is the only place a display
 * id is trusted, and it grants nothing on its own — the ROLE decides,
 * and the role is set by the DM.
 */
export function resolveAuth(
  shelf: Shelf,
  dmKey: string,
  headers: { key?: string; display?: string },
): Auth {
  const auth: Auth = { key: Boolean(headers.key && safeEqual(headers.key, dmKey)) };
  if (headers.display) {
    const display = shelf.display(headers.display);
    if (display) {
      shelf.touchDisplay(display.id);
      auth.display = display;
    }
  }
  return auth;
}

/** An adopted screen — its pairing code was consumed by a claim. */
export function adopted(display: Display | undefined): display is Display {
  return Boolean(display && !display.code);
}

/** Full authority — the key, or a screen the DM pointed at the console. */
export function canDm(auth: Auth): boolean {
  if (auth.key) return true;
  return adopted(auth.display) && auth.display.role === 'console';
}

/** Anyone the DM has adopted may watch; every role belongs at the table. */
export function canWatch(auth: Auth): boolean {
  return auth.key || adopted(auth.display);
}

/**
 * May this caller edit this entity? The DM may edit anyone; a seat may
 * edit the one entity it was pointed at, and nobody else.
 */
export function canEditEntity(auth: Auth, entityId: string): boolean {
  if (canDm(auth)) return true;
  const d = auth.display;
  return adopted(d) && d.role === 'seat' && d.params.entityId === entityId;
}

/** The one character a seat was pointed at — undefined for anything else, and for a seat nobody pointed. */
export function seatEntity(auth: Auth): string | undefined {
  const d = auth.display;
  if (!adopted(d) || d.role !== 'seat') return undefined;
  const id = d.params.entityId;
  return typeof id === 'string' && id ? id : undefined;
}

// ---------------------------------------------------------------------
// What a screen that isn't the DM may READ off the content stack.
//
// The write side was always role-derived; the read side was a gate per
// door and one door had none (the audit, 2026-11-16): `/api/stack/
// declarations/<slot>` answered any adopted screen for any slot, and
// because the campaign's own template half is a layer of that stack,
// "any slot" meant the encounter recipes with their hidden foes, every
// bestiary stat block and the handouts nobody had been shown. A slot is
// a name anyone can type, so the answer has to be a list someone WROTE
// DOWN — what the shipped client asks for, role by role — and a slot
// that isn't on it belongs to the DM. A new screen that needs a new
// slot adds it here, out loud, rather than inheriting it by accident.
//
// THE SEAT's line (decided for the project owner, 2026-11-16): a seat
// reads its OWN character whole, the PUBLIC roster and turn order for
// everyone else, and the slots its own screens use — the sheet's
// vocabulary, the creation builder's trades and creation, and the
// catalogue it shops and fits upgrades from. It does not read the
// encounters, the bestiary's stat blocks, the handout gallery or anybody
// else's sheet: a seat lives on a player's own phone, and "the player
// can see the ambush from a terminal" is the same leak as the table TV
// showing it. Before this the seat read all prep by design, because it
// shopped the catalogue and the gate couldn't tell the catalogue from
// the encounters.

/** What a passive screen renders with: the kind declarations behind its chips, and nothing else. */
const PASSIVE_DECLARATIONS: ReadonlySet<string> = new Set(['kinds']);

/**
 * What a seat's own screens ask for: the sheet (`panels`, `screens`,
 * `ladders`, `statuses`, `sections`, `bands`, `kinds`) and the creation
 * builder (`trades`, `creation` — the system's mechanic, §M-4a — and
 * `catalog`, because a starting kit is picked off the goods list).
 *
 * `catalog` is here because a builder that lives on somebody's SHELF
 * asks for it as a declaration, not only as a stampable template, and
 * this list was first written from the repo alone: the shelf's own
 * panel code is the other half of "what the shipped client requests",
 * and a slot missing here is a player's character builder answering
 * 401 at the table. Goods and prices are what a shop shows a customer;
 * nothing in them is prep.
 */
const SEAT_DECLARATIONS: ReadonlySet<string> = new Set([
  'panels',
  'screens',
  'ladders',
  'statuses',
  'sections',
  'bands',
  'kinds',
  'trades',
  'creation',
  'catalog',
]);

/**
 * The stampable slots a seat reads: the catalogue it shops from and the
 * upgrades a fitting may have been stamped from (`client/lib/spend.ts`,
 * `client/lib/amend.ts`). The bestiary is not here — a foe's numbers are
 * what the public snapshot exists to withhold.
 */
const SEAT_TEMPLATES: ReadonlySet<string> = new Set(['catalog', 'upgrades']);

/** May this caller read one declaration slot? Unknown slots are the DM's. */
export function mayReadDeclarations(auth: Auth, slot: string): boolean {
  if (canDm(auth)) return true;
  if (!adopted(auth.display)) return false;
  // A seat nobody pointed at a character draws nothing, so it reads as
  // passive glass does.
  if (seatEntity(auth)) return SEAT_DECLARATIONS.has(slot);
  return PASSIVE_DECLARATIONS.has(slot);
}

/** May the ROOM — a passive screen, or a door any of them can knock on — read this slot? */
export function roomMayReadDeclarations(slot: string): boolean {
  return PASSIVE_DECLARATIONS.has(slot);
}

/** May this caller read one template slot? The DM any; a seat its shop; nobody else. */
export function mayReadTemplates(auth: Auth, slot: string): boolean {
  if (canDm(auth)) return true;
  return seatEntity(auth) !== undefined && SEAT_TEMPLATES.has(slot);
}

/** Every declaration slot this caller may read — what the file door scans for art. */
export function readableDeclarations(auth: Auth): string[] {
  if (canDm(auth)) return [];
  if (!adopted(auth.display)) return [];
  return [...(seatEntity(auth) ? SEAT_DECLARATIONS : PASSIVE_DECLARATIONS)];
}

/** Every template slot this caller may read, short of the DM's all. */
export function readableTemplates(auth: Auth): string[] {
  return seatEntity(auth) !== undefined ? [...SEAT_TEMPLATES] : [];
}

/** Who did it, for the event log (rule 3). Never a bare display id. */
export function actorOf(auth: Auth, claimed?: string): string {
  if (canDm(auth)) return claimed?.trim() || 'console';
  const d = auth.display;
  if (adopted(d) && d.role === 'seat') {
    return `seat:${String(d.params.entityId ?? d.name ?? 'unassigned')}`;
  }
  if (adopted(d)) return `display:${d.role}`;
  return 'anon';
}
