// HANDOUTS — the picture the table is meant to be looking at, and the
// gallery it comes out of (§M-6's other half, ratified 2026-08-20).
//
// A handout is a NAMED CAMPAIGN ROW whose file stays a host asset. The
// row lives in the `handouts` template slot — `{ id, name, data: { key
// } }` — because that is where a campaign's own authored things already
// live, with CRUD doors, a merge layer and an event row per edit. No
// table was added and no column was promoted: a handout is prep with a
// picture attached, which is what the slot is for.
//
// The FILE does not live in the row. `data.key` is a path into the data
// dir (`art/handouts/<hash>.<ext>`), served through `/files/` behind
// the same ticket law as a board image or a pack's art — an `<img>`
// cannot send a header (rule 7). Rule 9 draws the same line it always
// draws: the row travels with the campaign, the bytes stay on the host.
//
// WHY AN UPLOAD DOOR, when packs deliberately have none. A pack is
// authored on the shelf and swept in; there is a folder to put it in
// and a person who put it there. A handout is a photograph the DM took
// of a napkin two minutes ago, mid-session, on a phone. Requiring them
// to find `~/.teller/art/` first is requiring them not to bother. So:
// bytes in, content-hash out, and the same hash for the same picture
// means passing round the same file twice costs one copy.
//
// Content-hashed rather than minted for exactly that reason, and for
// one more: identity of the ROW is its `tpl_` id (rule 4a — identity is
// the id, never the name), so renaming a handout, or having two rows
// name one picture, is ordinary and cheap.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from './session.ts';

/** The template slot. One word, in one place. */
export const HANDOUTS = 'handouts';

/** How big a picture the door will take. A handout is a photo, not a rulebook. */
export const MAX_BYTES = 16 * 1024 * 1024;

/** What an image arrives as, and what it lands on disk as. Nothing else is accepted. */
const EXTS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** A handout as everything downstream reads it — the row, flattened. */
export type Handout = { id: string; name: string; key: string; notes?: string };

/** The row shape, read defensively: a template row is whatever was authored. */
export function toHandout(raw: unknown): Handout | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as { id?: unknown; name?: unknown; data?: unknown; notes?: unknown };
  const data = (o.data ?? {}) as { key?: unknown; notes?: unknown };
  if (typeof o.id !== 'string' || !o.id) return undefined;
  if (typeof data.key !== 'string' || !data.key) return undefined;
  const out: Handout = {
    id: o.id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name : o.id,
    key: data.key,
  };
  const notes = typeof data.notes === 'string' ? data.notes : o.notes;
  if (typeof notes === 'string' && notes.trim()) out.notes = notes;
  return out;
}

/** Every handout this campaign has, oldest first (the slot's own order). */
export function handoutsOf(session: Session): Handout[] {
  return session.campaign
    .templatesIn(HANDOUTS)
    .map(toHandout)
    .filter((h): h is Handout => h !== undefined);
}

/**
 * One handout of this campaign's, by id — undefined if that id isn't
 * one. Through the SLOT rather than `templateRaw`, which is
 * slot-agnostic: an encounter recipe that happened to carry a `key`
 * must not be showable on the art frame by naming its id.
 */
export function handoutOf(session: Session, id: string): Handout | undefined {
  return handoutsOf(session).find((h) => h.id === id);
}

/**
 * The one the art frame is showing, read off the LIVE manifest.
 *
 * Live and not `loaded.manifest` for the same reason `activeBoard` is:
 * swapping the handout re-resolves nothing, so the loaded snapshot
 * would keep answering with the last thing that forced a reload. A ref
 * naming a row that has since been deleted reports as nothing showing,
 * never as a broken frame.
 */
export function activeHandout(session: Session): Handout | null {
  const ref = session.campaign.root().refs?.handout;
  const id = Array.isArray(ref) ? ref[0]?.id : ref?.id;
  if (!id) return null;
  return handoutOf(session, id) ?? null;
}

/** Is this a picture, and what does it land as? Undefined means "not one". */
export function extFor(contentType: string): string | undefined {
  return EXTS[contentType.split(';')[0].trim().toLowerCase()];
}

/**
 * Put the bytes on the shelf and answer the key.
 *
 * Under `art/` because that is one of the two roots `/files/` will
 * serve from, and in its own `handouts/` subfolder so a sweep of pack
 * art never has to wonder what these are.
 */
export function saveHandoutBytes(dataDir: string, bytes: Buffer, ext: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const key = `art/handouts/${hash}.${ext}`;
  const path = join(dataDir, key);
  mkdirSync(join(dataDir, 'art', 'handouts'), { recursive: true });
  // Same bytes, same name: a re-upload of the same picture is a no-op
  // rather than a second copy.
  if (!existsSync(path)) writeFileSync(path, bytes);
  return key;
}
