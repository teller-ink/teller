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
