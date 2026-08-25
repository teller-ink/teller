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
import { bandOf, bandsIn, type Band } from '../core/bands.ts';
import { inchGrid, type ImageSize } from '../core/fog.ts';
import { refIn } from '../core/entity.ts';
import type { BoardFacts, MoveFacts, TokenFacts } from '../core/registry.ts';
import type { Session } from './session.ts';

/**
 * Natural pixel dimensions — the one thing only the image itself knows.
 * Declared in `core/fog.ts` (the lattice is derived from it at both ends)
 * and re-exported here, so every existing import still reads geometry.
 */
export type { ImageSize };

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
 * and the picture's own proportions — the PHYSICAL lattice, and the one
 * every calibration-gated feature here still asks for.
 *
 * The arithmetic itself moved to `core/fog.ts` (`inchGrid`), because the
 * editor draws with it, the paint raster falls back to it, and three
 * copies of one formula is three chances to disagree about where a cell
 * is. This stays as the server's spelling — `undefined` rather than
 * `null`, which is what every caller in here already reads.
 *
 * Painting is NOT gated on this any more: fog and areas read `rasterOf`,
 * which answers a lattice for an uncalibrated board too. Distance,
 * snapping and the grid overlay are still inches or nothing.
 */
export function gridOf(
  widthInches: number | undefined,
  size: ImageSize | undefined,
): { cols: number; rows: number } | undefined {
  return inchGrid(widthInches, size) ?? undefined;
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
 * The system's range ladder lives in `core/bands.ts` — a sheet reads it
 * too (what a weapon reaches at each rung), and one parser for one
 * declaration is the whole rule. Re-exported here so every caller of
 * geometry's own `Band`/`bandsIn`/`bandOf` kept its import.
 */
export { bandOf, bandsIn, type Band };

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
      // And the ground in the way, which is a fact about the PATH and
      // not about either end of it (see `zonesCrossed`).
      if (grid) {
        const crossed = zonesCrossed(from, t, zones, grid);
        if (crossed.length) t.between = crossed;
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

// ---------------------------------------------------------------------
// WHO WENT WHERE — the same three rules, applied to the round before.
//
// A board state is a photograph, and a photograph cannot say that
// anybody moved. The old assistant told a creature who had closed on it
// and who had backed off, by band, and the new world had nothing to
// tell it with: placements are overwritten in place and the only row
// the log carried was `board.updated`, which says a board changed and
// not one thing about the fight.
//
// So the fact is MADE here, by diffing, and it is made narrowly on
// purpose. A drag lands as a whole-state PUT — placements, fog, zones
// and the view arrive together — so a write that repainted a zone or
// re-aimed the table must produce no movement at all, or the history
// fills with creatures that stood perfectly still.

/** One token's step, as the log keeps it. Map space, because that's the stored truth. */
export type MoveRecord = {
  boardId: string;
  placementId?: string;
  /** The entity that moved, when the token is somebody. */
  by?: string;
  byName: string;
  /** Behind the screen at the moment it moved. */
  hidden?: boolean;
  from: { u: number; v: number };
  to: { u: number; v: number };
  round?: number;
};

/** A placement as the diff reads it — id, who, where, and nothing else. */
type Standing = { placementId?: string; entityId?: string; label?: string; hidden: boolean; u: number; v: number };

function standingIn(data: unknown): Standing[] {
  const state = (data && typeof data === 'object' ? data : {}) as { placements?: unknown };
  const raw = Array.isArray(state.placements) ? (state.placements as StoredPlacement[]) : [];
  return raw.flatMap((p): Standing[] => {
    const u = num(p.u);
    const v = num(p.v);
    if (u === undefined || v === undefined) return [];
    return [
      {
        ...(typeof p.id === 'string' ? { placementId: p.id } : {}),
        ...(typeof p.entityId === 'string' ? { entityId: p.entityId } : {}),
        ...(typeof p.label === 'string' && p.label.trim() ? { label: p.label.trim() } : {}),
        hidden: p.hidden === true,
        u,
        v,
      },
    ];
  });
}

/** How near two map-space points have to be to count as the same spot. */
const STILL = 1e-6;

/**
 * What MOVED between two board states — nothing else, ever.
 *
 * Tokens are matched by their placement id, and by entity id for a
 * state old enough not to have one. Three writes deliberately produce
 * nothing:
 *
 *   * a token that ARRIVED (deployed, dropped from the roster) — an
 *     arrival is not a step, and reporting it as one would have a
 *     creature "moving" out of nowhere on the round it was placed;
 *   * a token that LEFT — same fact from the other end;
 *   * a write that touched the view, the fog or the paint and left
 *     every u/v exactly where it was.
 */
export function movesBetween(
  before: unknown,
  after: unknown,
): { placementId?: string; entityId?: string; label?: string; hidden: boolean; from: { u: number; v: number }; to: { u: number; v: number } }[] {
  const was = standingIn(before);
  const now = standingIn(after);
  const byPlacement = new Map(was.flatMap((s) => (s.placementId ? [[s.placementId, s] as const] : [])));
  const byEntity = new Map(was.flatMap((s) => (s.entityId ? [[s.entityId, s] as const] : [])));
  const out = [];
  for (const to of now) {
    const from =
      (to.placementId ? byPlacement.get(to.placementId) : undefined) ??
      (to.entityId ? byEntity.get(to.entityId) : undefined);
    if (!from) continue;
    if (Math.abs(from.u - to.u) < STILL && Math.abs(from.v - to.v) < STILL) continue;
    out.push({
      ...(to.placementId ? { placementId: to.placementId } : {}),
      ...(to.entityId ? { entityId: to.entityId } : {}),
      ...(to.label ? { label: to.label } : {}),
      hidden: to.hidden,
      from: { u: from.u, v: from.v },
      to: { u: to.u, v: to.v },
    });
  }
  return out;
}

/**
 * A step, MEASURED — how far, and whether it closed the gap on whoever
 * is acting.
 *
 * The direction is worked out here for the same reason every distance
 * is: a reader handed two coordinate pairs and asked whether one of
 * them got nearer will do trigonometry, and will eventually do it
 * generously. Toward and away are teller's to say.
 *
 * The acting creature's OWN step gets no direction — "toward yourself"
 * is not a fact — but it still gets a distance, because how far a
 * creature went last round is how it judges what this one can afford.
 */
export function measureMove(
  record: MoveRecord,
  board: BoardFacts,
  bands: Band[],
): MoveFacts {
  const facts: MoveFacts = { name: record.byName };
  if (record.round !== undefined) facts.round = record.round;
  if (record.hidden) facts.hidden = true;
  if (!board.present) return facts;
  const width = board.board.widthInches;
  const tall = board.board.heightInches;
  if (!width || !tall) return facts;
  const at = (p: { u: number; v: number }) => ({ x: p.u * width, y: p.v * tall });
  const span = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    round1(Math.hypot(b.x - a.x, b.y - a.y));

  const went = span(at(record.from), at(record.to));
  facts.wentInches = went;
  if (board.grid) facts.wentSquares = Math.round(went);
  const far = bandOf(went, bands);
  if (far) facts.wentBand = { name: far.name, ...(far.world ? { world: far.world } : {}) };

  const acting = board.tokens.find((t) => t.acting);
  if (!acting) return facts;
  if (record.by && record.by === acting.entityId) {
    facts.mine = true;
    return facts;
  }
  const here = at(acting);
  const was = span(here, at(record.from));
  const is = span(here, at(record.to));
  facts.wasAwayInches = was;
  facts.nowAwayInches = is;
  const wasBand = bandOf(was, bands);
  const nowBand = bandOf(is, bands);
  if (wasBand) facts.wasBand = { name: wasBand.name, ...(wasBand.world ? { world: wasBand.world } : {}) };
  if (nowBand) facts.nowBand = { name: nowBand.name, ...(nowBand.world ? { world: nowBand.world } : {}) };
  // Half an inch, the old implementation's threshold: a step that
  // circles at the same reach is neither an approach nor a retreat, and
  // calling it one would put intent in the reader's mouth.
  const delta = was - is;
  facts.sense = Math.abs(delta) < 0.5 ? 'neither' : delta > 0 ? 'toward' : 'away';
  return facts;
}

/**
 * WHAT LIES BETWEEN — the painted ground a straight line crosses.
 *
 * Standing-in is a fact about a tile; this is a fact about a PATH, and
 * it is the one that changes a decision. A creature will cross open
 * sand without a thought and will think twice about six squares of
 * fire, so the ground in the way is a real reason to go around, wait,
 * or pick a different target.
 *
 * Sampled in quarter-cell steps rather than rasterised properly,
 * because this feeds a sentence and not a physics engine, and a quarter
 * of a square is finer than any ruling it could change.
 *
 * A zone EITHER END is standing in is left out: both ends are already
 * reported as standing in it, and repeating it here would read as a
 * second, separate patch to be crossed.
 */
export function zonesCrossed(
  from: { u: number; v: number },
  to: { u: number; v: number },
  zones: { name: string; cells: [number, number][]; hidden?: boolean }[],
  grid: { cols: number; rows: number },
): { name: string; cells: number; hidden?: boolean }[] {
  const a = cellOf(from.u, from.v, grid);
  const b = cellOf(to.u, to.v, grid);
  const ends = new Set([`${a[0]},${a[1]}`, `${b[0]},${b[1]}`]);
  const held = new Set(
    zones
      .filter((z) => z.cells.some((c) => ends.has(`${c[0]},${c[1]}`)))
      .map((z) => z.name),
  );
  const ax = from.u * grid.cols;
  const ay = from.v * grid.rows;
  const bx = to.u * grid.cols;
  const by = to.v * grid.rows;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 4));
  const seen = new Set<string>();
  const hit = new Map<string, { cells: number; hidden?: boolean }>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const key = `${Math.floor(ax + (bx - ax) * t)},${Math.floor(ay + (by - ay) * t)}`;
    if (ends.has(key) || seen.has(key)) continue;
    seen.add(key);
    for (const zone of zones) {
      if (held.has(zone.name)) continue;
      if (!zone.cells.some((c) => `${c[0]},${c[1]}` === key)) continue;
      const at = hit.get(zone.name) ?? { cells: 0, ...(zone.hidden ? { hidden: true } : {}) };
      at.cells += 1;
      hit.set(zone.name, at);
    }
  }
  return [...hit.entries()].map(([name, what]) => ({ name, ...what }));
}
