// WHERE EVERYONE IS STANDING — the fight's geometry, MEASURED here so
// nothing downstream has to derive it.
//
// This file exists because of a fact teller HELD and did not pass on. A
// fight deployed from an encounter puts u/v placements on a calibrated
// board (docs/BATTLEMAP.md: map space is normalized image coordinates,
// and `widthInches` is what makes a drawn square a real inch), and the
// only consumer that ever turned that into a distance was the client,
// at draw time, in pixels. So a proposer handed the table's state was
// handed no positions, no ranges and no ground — and a fact you hold
// and don't pass on is one the reader invents.
//
// Three rules shaped what's below, and they are the same three the
// old assistant work learned the hard way:
//
//   * MEASURE, don't make the reader derive. Distances come out of
//     here as numbers in the board's own calibrated inches (and in
//     squares, when the grid is calibrated), never as raw u/v pairs
//     with an invitation to do trigonometry.
//   * LABEL everything. Every measurement carries its unit and says
//     what it was measured FROM, because an unlabelled aggregate
//     teaches a wrong unit price.
//   * AN EXPLICIT ABSENCE BEATS A SILENT ONE. There is no empty
//     result here: no board, no placements, an acting creature with no
//     token, a map whose proportions can't be read — each answers
//     `{ present: false, why }` in its own words. "No board this
//     fight" is a fact worth stating; a missing key is not.
//
// It is the SERVER's twin of `client/components/board/model.ts` — the
// client measures in order to draw, this measures in order to tell —
// and the shared law is docs/BATTLEMAP.md, not either file. Nothing
// here invents a second spelling of `hidden`: a hidden token is
// REPORTED as hidden and kept, because the audience for this is the
// DM's own screen (see `read:board`, which is a DM-gated need).

import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { refIn } from '../core/entity.ts';
import type { BoardFacts, TokenFacts } from '../core/registry.ts';
import type { Session } from './session.ts';

/** Natural pixel dimensions — the one thing only the image itself knows. */
export type ImageSize = { w: number; h: number };

/**
 * A picture's pixel dimensions, read out of its header.
 *
 * The board's own aspect ratio is load-bearing: `widthInches` declares
 * how wide the map is in the room, and how TALL it is follows from the
 * picture's proportions. Without them a vertical distance has no unit,
 * so this is the difference between a measured answer and a guess.
 *
 * Header bytes only — a battlemap is print artwork (64 MB is allowed)
 * and nothing here wants the pixels. A format this can't read answers
 * `undefined`, which becomes an explicit "proportions unknown" upstream
 * rather than a silently flat map.
 */
export function imageSizeOf(path: string): ImageSize | undefined {
  if (!existsSync(path)) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(64 * 1024);
    const read = readSync(fd, head, 0, head.length, 0);
    return sizeInHeader(head.subarray(0, read));
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The header parse, split out so it can be tested without a file. */
export function sizeInHeader(b: Buffer): ImageSize | undefined {
  // PNG — IHDR is always the first chunk, at a fixed offset.
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  // GIF — width and height are little-endian at byte 6.
  if (b.length >= 10 && b.subarray(0, 3).toString('latin1') === 'GIF') {
    return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  }
  // WebP — RIFF container, three sub-formats, each with its own spelling.
  if (
    b.length >= 30 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    const kind = b.subarray(12, 16).toString('latin1');
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { w, h };
    }
    return undefined;
  }
  // JPEG — walk the segments to whichever SOF frame header comes first.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) {
        at += 1;
        continue;
      }
      const marker = b[at + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const length = b.readUInt16BE(at + 2);
      // Every SOF but the four that aren't frame headers (DHT/JPG/DAC/DNL).
      const isFrame =
        marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { h: b.readUInt16BE(at + 5), w: b.readUInt16BE(at + 7) };
      at += 2 + length;
    }
  }
  return undefined;
}

/**
 * How many 1-inch cells across and down, from the map's declared width
 * and the picture's own proportions.
 *
 * The same arithmetic the editor draws with (`gridOf`), stated here
 * because the server has no DOM to ask an `<img>`. Rows are not rounded:
 * a map is rarely a whole number of inches tall, and rounding it would
 * stretch every vertical distance on the board.
 */
export function gridOf(
  widthInches: number | undefined,
  size: ImageSize | undefined,
): { cols: number; rows: number } | undefined {
  if (!widthInches || !size?.w || !size.h) return undefined;
  return {
    cols: Math.max(1, Math.round(widthInches)),
    rows: Math.max(1, (widthInches * size.h) / size.w),
  };
}

/** Which cell a map-space point falls in — the client's `cellOf`, server-side. */
export function cellOf(
  u: number,
  v: number,
  grid: { cols: number; rows: number },
): [number, number] {
  return [
    Math.min(grid.cols - 1, Math.max(0, Math.floor(u * grid.cols))),
    Math.min(Math.ceil(grid.rows) - 1, Math.max(0, Math.floor(v * grid.rows))),
  ];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * ONE RUNG OF THE SYSTEM'S RANGE LADDER, as it declares one.
 *
 * `from` is inclusive, `to` exclusive, both in the board's true
 * inches; `world` is what that reach is in the fiction. Nothing here
 * knows any game's rungs — a system with no `bands` declaration has no
 * ladder and every distance stays a bare measurement.
 */
export type Band = { name: string; from?: number; to?: number; world?: string };

/** The declared rungs, read forgivingly out of whatever the layer wrote. */
export function bandsIn(raw: unknown): Band[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item): Band[] => {
    const b = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return [];
    const band: Band = { name };
    if (num(b.from) !== undefined) band.from = num(b.from);
    if (num(b.to) !== undefined) band.to = num(b.to);
    if (typeof b.world === 'string' && b.world.trim()) band.world = b.world.trim();
    return [band];
  });
}

/**
 * What a measurement IS, in the system's own words.
 *
 * Table inches are teller's unit and nobody's world, and the
 * conversion is TELLER'S to do — a reader asked to map a number onto a
 * ladder will eventually map it generously, which is how a melee
 * attack got thrown across a clearing to dodge a fire. Handing over
 * both spellings costs one string and settles the argument: the number
 * is the evidence, the band is the vocabulary.
 */
export function bandOf(inches: number, bands: Band[]): Band | undefined {
  for (const b of bands) {
    if (inches >= (b.from ?? 0) && (b.to === undefined || inches < b.to)) return b;
  }
  return undefined;
}

type StoredPlacement = {
  id?: unknown;
  entityId?: unknown;
  label?: unknown;
  u?: unknown;
  v?: unknown;
  sizeInches?: unknown;
  hidden?: unknown;
};

type StoredZone = { effect?: unknown; cells?: unknown; hidden?: unknown };

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Measure the fight on the board this campaign is showing.
 *
 * `actingId` is the entity whose turn it is; every distance is FROM its
 * token. Nothing here reads the turn order itself — the caller knows
 * whose turn it is, and this file's whole job is the ground.
 */
export function fightGeometry(session: Session, actingId?: string): BoardFacts {
  const showing = refIn(session.loaded.manifest.refs, 'board');
  if (!showing) return { present: false, why: 'no board is showing at this table' };
  const board = session.shelf.board(showing.id);
  if (!board) {
    return {
      present: false,
      why: `the board this table names ('${showing.name}') is not on this shelf`,
    };
  }
  const raw = session.campaign.boardState(board.id);
  const state = (raw && typeof raw === 'object' ? raw : {}) as {
    placements?: unknown;
    zones?: unknown;
  };
  const placements = Array.isArray(state.placements)
    ? (state.placements as StoredPlacement[])
    : [];
  if (!placements.length) {
    return { present: false, why: `nothing is placed on the board ('${board.name}')` };
  }

  const size = session.dataDir ? imageSizeOf(join(session.dataDir, board.key)) : undefined;
  const grid = gridOf(board.widthInches, size);
  const heightInches =
    board.widthInches && size?.w && size.h
      ? round1((board.widthInches * size.h) / size.w)
      : undefined;

  // Names come from the entity a token links to; a token may legitimately
  // be unlinked (a rock, something in the dark) and keeps its own label.
  const named = new Map(
    session.campaign.children(session.loaded.manifest.id).map((e) => [e.id, e.name]),
  );

  const zones = (Array.isArray(state.zones) ? (state.zones as StoredZone[]) : [])
    .map((z) => ({
      name: typeof z.effect === 'string' && z.effect.trim() ? z.effect.trim() : 'unnamed',
      cells: (Array.isArray(z.cells) ? z.cells : []).flatMap((c): [number, number][] =>
        Array.isArray(c) && num(c[0]) !== undefined && num(c[1]) !== undefined
          ? [[Number(c[0]), Number(c[1])]]
          : [],
      ),
      hidden: z.hidden === true,
    }))
    .filter((z) => z.cells.length > 0);

  const tokens: TokenFacts[] = [];
  for (const p of placements) {
    const u = num(p.u);
    const v = num(p.v);
    if (u === undefined || v === undefined) continue;
    const entityId = typeof p.entityId === 'string' ? p.entityId : undefined;
    const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : undefined;
    const token: TokenFacts = {
      name: (entityId ? named.get(entityId) : undefined) ?? label ?? 'an unnamed token',
      hidden: p.hidden === true,
      u,
      v,
    };
    if (typeof p.id === 'string') token.placementId = p.id;
    if (entityId) token.entityId = entityId;
    const sizeInches = num(p.sizeInches);
    if (sizeInches !== undefined) token.sizeInches = sizeInches;
    if (grid) {
      const cell = cellOf(u, v, grid);
      token.cell = cell;
      const inside = zones.filter((z) => z.cells.some((c) => c[0] === cell[0] && c[1] === cell[1]));
      const near = zones.filter(
        (z) =>
          !inside.includes(z) &&
          z.cells.some(
            (c) => Math.abs(c[0] - cell[0]) <= 1 && Math.abs(c[1] - cell[1]) <= 1,
          ),
      );
      if (inside.length) token.inZones = inside.map((z) => z.name);
      if (near.length) token.nearZones = near.map((z) => z.name);
    }
    tokens.push(token);
  }

  const bands = bandsIn(session.loaded.declarations('bands'));
  const from = actingId ? tokens.find((t) => t.entityId === actingId) : undefined;
  if (from) {
    from.acting = true;
    for (const t of tokens) {
      if (t === from) continue;
      if (board.widthInches && heightInches) {
        const dx = (t.u - from.u) * board.widthInches;
        const dy = (t.v - from.v) * heightInches;
        t.awayInches = round1(Math.hypot(dx, dy));
        // A calibrated cell IS one true inch (docs/BATTLEMAP.md), so
        // squares are the same measurement in the unit the table counts.
        if (grid) t.awaySquares = Math.round(t.awayInches);
        // And the same measurement a third time, in the only unit
        // anybody at the table says out loud.
        const band = bandOf(t.awayInches, bands);
        if (band) {
          t.awayBand = { name: band.name, ...(band.world ? { world: band.world } : {}) };
        }
      }
    }
  }

  const facts: BoardFacts = {
    present: true,
    board: { id: board.id, name: board.name },
    units:
      board.widthInches && heightInches
        ? 'distances are straight-line, in true inches on the printed map; one grid square is one inch'
        : 'this board declares no physical width, so nothing could be measured in inches',
    tokens,
    zones: zones.map((z) => ({
      name: z.name,
      cells: z.cells.length,
      hidden: z.hidden,
      standingIn: tokens
        .filter((t) => t.inZones?.includes(z.name))
        .map((t) => t.name),
    })),
  };
  if (board.widthInches) facts.board.widthInches = board.widthInches;
  if (heightInches) facts.board.heightInches = heightInches;
  if (grid) facts.grid = grid;
  else if (!board.widthInches) facts.gridless = 'this board has no declared width, so it has no grid';
  else facts.gridless = "this board's picture proportions could not be read, so it has no grid";
  if (from) facts.measuredFrom = from.name;
  else if (actingId) {
    facts.unmeasured =
      'the creature whose turn it is has no token on this board, so no distance was measured';
  } else facts.unmeasured = 'nobody is acting, so no distance was measured';
  return facts;
}
