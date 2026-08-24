// BOARDS — the battlemap as an ASSET (§4), and the door its picture
// comes in through.
//
// A board is `{ id, key, name, widthInches, grid }` on the SHELF, the
// same category as a book or a pack's art: reusable across campaigns,
// referenced by id, and nothing about a fight is in it. What's on it
// right now — placements, fog, zones, the view — is `board_state`, per
// campaign, and never travels in a `.story`.
//
// This file is the handout door's twin (`server/handouts.ts`) and
// deliberately so: bytes in, content-hash out, same-picture-twice costs
// one copy. Three things differ, each for a reason:
//
//   * The bytes land under `map/`, not `art/`. Both are roots `/files/`
//     will serve, and the old world's board images already live there —
//     a DM copying `~/.teller/map/` across keeps every key working.
//   * A board is allowed to be BIG. A handout is a photo of a napkin;
//     a battlemap is print-destined artwork (Boylei's are 10800px at
//     300dpi), so the cap is 64 MB rather than 16.
//   * The ROW is a shelf row, not a campaign template, because a board
//     outlives the campaign that showed it.
//
// `widthInches` and `grid` are calibration between pixels and the room
// (§4) — teller-the-program, not campaign content — which is why they
// sit on the asset and not in the state.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '../core/id.ts';
import { tokenColor } from '../core/tokens.ts';

/** How big a picture the door will take. A battlemap is print artwork. */
export const MAX_BYTES = 64 * 1024 * 1024;

/** What an image arrives as, and what it lands on disk as. Nothing else is accepted. */
const EXTS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Is this a picture, and what does it land as? Undefined means "not one". */
export function extFor(contentType: string): string | undefined {
  return EXTS[contentType.split(';')[0].trim().toLowerCase()];
}

/**
 * Put the bytes on the shelf and answer the key.
 *
 * Content-hashed, so the same map dropped twice is one file — and so a
 * board's picture has a name nobody had to choose. The ROW's identity is
 * still its minted `brd_` id (rule 4a): renaming a board, or two boards
 * over one picture (a lit version and a dark one), is ordinary.
 */
export function saveBoardBytes(dataDir: string, bytes: Buffer, ext: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const key = `map/${hash}.${ext}`;
  const path = join(dataDir, key);
  mkdirSync(join(dataDir, 'map'), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, bytes);
  return key;
}

/** The grid style a board draws with — read defensively, since it's blob. */
export type BoardGrid = { on?: boolean; color?: string; opacity?: number };

/**
 * What an author may say about a board's grid, and nothing else.
 *
 * Narrow rather than pass-through: the grid rides to every passive
 * surface inside the snapshot, and a blob that accepted anything would
 * be a channel from the console to the table that nobody was watching.
 * An empty result reads as "no opinion" — the table's own defaults.
 */
export function toGrid(raw: unknown): BoardGrid | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as { on?: unknown; color?: unknown; opacity?: unknown };
  const out: BoardGrid = {};
  if (typeof o.on === 'boolean') out.on = o.on;
  if (typeof o.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.color)) out.color = o.color;
  if (typeof o.opacity === 'number' && o.opacity >= 0 && o.opacity <= 1) out.opacity = o.opacity;
  return Object.keys(out).length ? out : undefined;
}

/**
 * A map's intended physical width, in true inches — the one fact that
 * makes a drawn square a real inch (docs/BATTLEMAP.md). Absent is
 * legitimate and means fit-to-screen with no cells, so this answers
 * `null` for "the author said no width" and `undefined` for "the author
 * didn't mention it".
 */
export function toWidthInches(raw: unknown): number | null | undefined {
  if (raw === null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

// -- what a fight does to the state on a board -------------------------
//
// Two edits the console used to be the only author of, and now isn't:
// deleting an entity has to take its tokens with it, and deploying a
// prepared fight has to put tokens down. Both are here, PURE, so the
// session stays a session and the shapes are testable without a board,
// a picture or a server.
//
// The state blob is `{ placements, view, fog, zones }` and these touch
// exactly one key of it. A marker (`label`, no `entityId`) is nobody's
// entity and is never anyone's business but the person who painted it.

/** A placement as it lands in the blob. Loose on the way in, like every read. */
type StoredPlacement = {
  id?: string;
  entityId?: string;
  label?: string;
  color?: string;
  u?: number;
  v?: number;
  sizeInches?: number;
  hidden?: boolean;
};

function placementsIn(state: unknown): StoredPlacement[] | undefined {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  const raw = (state as { placements?: unknown }).placements;
  return Array.isArray(raw) ? (raw as StoredPlacement[]) : undefined;
}

/**
 * The state with every token for these entities gone.
 *
 * `undefined` means nothing on this board named any of them — the
 * caller writes nothing, so a board the fight never touched keeps its
 * `updated_at` and stays out of the log.
 */
export function withoutEntities(state: unknown, ids: Set<string>): unknown | undefined {
  const placements = placementsIn(state);
  if (!placements?.length) return undefined;
  const kept = placements.filter(
    (p) => !(typeof p.entityId === 'string' && ids.has(p.entityId)),
  );
  if (kept.length === placements.length) return undefined;
  return { ...(state as object), placements: kept };
}

/** Where a deployed foe starts, as the recipe wrote it down. */
export type Deploying = { entityId: string; u: number; v: number; hidden?: boolean };

/**
 * The state with the deployed foes standing on it.
 *
 * Defaults are the PLACE strip's, because a token that arrived by
 * deploy and a token the Warden dropped by hand have to be the same
 * kind of thing: a 1-inch base, and the next colour in the palette
 * counting from what's already on the board (`core/tokens.ts` — one
 * palette, so a foe doesn't change colour between prep and deploy).
 * `hidden` is the recipe's own, defaulting to on the table: the author
 * ticks the box for the thing waiting in the dark.
 *
 * An entity already standing on this board is not placed twice — a
 * second token for one foe is a foe the Warden moves in two places.
 */
export function withDeployed(
  state: unknown,
  foes: Deploying[],
): { data: unknown; placed: number } {
  const placements = placementsIn(state) ?? [];
  const standing = new Set(
    placements.flatMap((p) => (typeof p.entityId === 'string' ? [p.entityId] : [])),
  );
  const added: StoredPlacement[] = [];
  for (const foe of foes) {
    if (standing.has(foe.entityId)) continue;
    standing.add(foe.entityId);
    added.push({
      id: newId('plc'),
      entityId: foe.entityId,
      u: foe.u,
      v: foe.v,
      sizeInches: 1,
      color: tokenColor(placements.length + added.length),
      hidden: foe.hidden === true,
    });
  }
  const base = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  return { data: { ...base, placements: [...placements, ...added] }, placed: added.length };
}
