// Zip, both directions — because rule 4a says a pack (and now a panel)
// is "an ARCHIVE, and equally a FOLDER", and the new world only ever
// had the folder half.
//
// NO DEPENDENCY, and that is a decision rather than an omission. The old
// world already hand-rolls this twice (`worker/zip.ts`, `worker/unzip.ts`)
// against the platform's own compression streams; the requirements are
// the same narrow ones they were, and `node:zlib` supplies raw deflate
// in both directions with nothing installed. fflate would have been the
// pick if anything here needed a library — it doesn't, and a dependency
// that exists to save eighty lines of a frozen format is a dependency
// that has to be audited forever.
//
// The differences from the old pair, all of them because this runs on
// Node and writes files rather than streaming to a browser:
//
//   * SYNCHRONOUS, on Buffers. The sweep is synchronous top to bottom
//     (`sweepPacks`, `compileFolder`), and a `.pack` is kilobytes of
//     JSON and a few pictures — not the hundred-megabyte rulebook the
//     streaming writer was built for. A book still never rides along
//     (rule 4a), so the case that forced streaming cannot arise here.
//   * Sizes go IN the local header, not in a trailing data descriptor.
//     Buffering is free when the file is already in memory, and a header
//     that states its own sizes is what every other unzipper prefers.
//   * DEFLATE, not STORE. A pack is mostly JSON, which halves twice
//     over; the old writer chose STORE because it was shipping PDFs that
//     were already compressed. An entry that deflates no smaller is
//     stored instead, so the choice is per-file and never a loss.
//
// Timestamps are pinned to 1980-01-01, exactly as the old writer pinned
// them and for the same reason: exporting the same pack twice produces
// the same bytes, and an archive you can diff is one you can trust.
//
// Reading handles STORE and DEFLATE both, through the central directory
// at the end of the file — the only part of the format that is reliably
// complete, since an archive written by someone else's tool may well
// have written its sizes after the payload.

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** One member of an archive — a POSIX-style relative name, and its bytes. */
export type ArchiveEntry = { name: string; data: Buffer };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
};

/** Bit 11: the name is UTF-8. No bit 3 — sizes are in the header. */
const FLAGS = 0x0800;
const DOS_DATE = 0x21; // 1980-01-01, pinned

/** Build a zip in memory. Entries keep the order they were handed over. */
export function writeArchive(entries: ArchiveEntry[]): Buffer {
  const encoder = new TextEncoder();
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(encoder.encode(entry.name));
    const crc = crc32(entry.data);
    const deflated = deflateRawSync(entry.data);
    const stored = deflated.length >= entry.data.length;
    const payload = stored ? entry.data : deflated;
    const method = stored ? 0 : 8;
    const start = offset;

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(FLAGS),
      u16(method),
      u16(0),
      u16(DOS_DATE),
      u32(crc),
      u32(payload.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    chunks.push(local, payload);
    offset += local.length + payload.length;

    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(FLAGS),
        u16(method),
        u16(0),
        u16(DOS_DATE),
        u32(crc),
        u32(payload.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(start),
        name,
      ]),
    );
  }

  const dirStart = offset;
  const directory = Buffer.concat(central);
  return Buffer.concat([
    ...chunks,
    directory,
    Buffer.concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(entries.length),
      u16(entries.length),
      u32(directory.length),
      u32(dirStart),
      u16(0),
    ]),
  ]);
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/**
 * Every member of an archive, by name. Throws on something that isn't a
 * zip at all — the caller turns that into a load-report problem, never a
 * crash, exactly as a `pack.json` that doesn't parse becomes one.
 */
export function readArchive(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("that doesn't look like a teller file");

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localAt = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // a directory entry carries nothing

    // The LOCAL header's own name/extra lengths decide where the payload
    // starts — they can differ from the central directory's.
    const localNameLen = buffer.readUInt16LE(localAt + 26);
    const localExtraLen = buffer.readUInt16LE(localAt + 28);
    const start = localAt + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(start, start + compressed);
    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`${name}: unsupported compression method ${method}`);
  }
  return files;
}

/**
 * Every file under a folder, named relative to it with forward slashes
 * — the archive's own shape. Dot-anything is skipped, which is what
 * leaves `.build/` behind: compile output regenerates against the
 * recipient's own mtimes, and shipping it would be handing over an
 * answer instead of the question (`copyPanelToTable`'s reasoning, and
 * `copyNewer`'s skip, said once more here).
 */
export function folderEntries(dir: string, base = dir): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...folderEntries(path, base));
    else out.push({ name: relative(base, path).split(sep).join('/'), path });
  }
  return out;
}

/**
 * A folder, as archive bytes. `rewrite` gets each member's name and
 * bytes and may hand back different bytes — which is how export reverses
 * anything install rewrote (art keys, rule 4a) without this function
 * learning what a pack is.
 */
export function archiveFolder(
  dir: string,
  rewrite?: (name: string, data: Buffer) => Buffer,
): Buffer {
  return writeArchive(
    folderEntries(dir).map(({ name, path }) => {
      const data = readFileSync(path);
      return { name, data: rewrite ? rewrite(name, data) : data };
    }),
  );
}

/**
 * An archive, read as the folder it wants to become — every member by
 * name, with a single common leading directory stripped if there is one
 * and nothing sits at the root. Zipping a folder with Finder or `zip -r`
 * produces `wiw-guidebook/pack.json`, and refusing that archive would be
 * refusing the archive most people will actually make. An archive we
 * wrote has its manifest at the root and passes through untouched.
 *
 * This, not `readArchive`, is what an installer should call — the
 * manifest has to be readable at `pack.json` before anything is written
 * anywhere, so the flattening cannot wait until unpack time.
 */
export function openArchive(buffer: Buffer): Map<string, Buffer> {
  return flattened(readArchive(buffer));
}

function flattened(files: Map<string, Buffer>): Map<string, Buffer> {
  const names = [...files.keys()];
  if (!names.length) return files;
  const roots = new Set(names.map((n) => n.split('/')[0]));
  if (roots.size !== 1 || names.some((n) => !n.includes('/'))) return files;
  const prefix = `${[...roots][0]}/`;
  return new Map(names.map((n) => [n.slice(prefix.length), files.get(n) as Buffer]));
}

/**
 * Unpack an archive INTO a folder, which is the installed form (rule
 * 4a: "unzipped it's a directory on the shelf you edit in place").
 * Existing files are written over — an upgrade — and files the archive
 * doesn't mention are left alone, because deleting what somebody added
 * beside a pack is not a thing an install may decide.
 *
 * A member naming its way out of the destination is dropped rather than
 * followed: an archive is a file that arrived from elsewhere, and `../`
 * in a zip entry is the oldest trick there is.
 */
export function unpackArchive(files: Map<string, Buffer>, dir: string): string[] {
  const written: string[] = [];
  for (const [name, data] of files) {
    const path = join(dir, name);
    if (path !== dir && !path.startsWith(dir + sep)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    written.push(name);
  }
  return written;
}

/** Read one JSON member of an archive, or undefined if it isn't there or doesn't parse. */
export function archiveJson(files: Map<string, Buffer>, name: string): unknown {
  const held = files.get(name);
  if (!held) return undefined;
  try {
    return JSON.parse(held.toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Is this archive newer than the folder it would install into? The
 * cheap gate that runs BEFORE any zip is read, so the steady state — an
 * archive sitting beside the folder it already produced, sweep after
 * sweep — costs one `stat` and nothing else. Same mtime skip
 * `copyNewer` and `compilePanelCode` use, for the same reason.
 */
export function archiveIsNewer(archive: string, marker: string): boolean {
  try {
    if (!existsSync(marker)) return true;
    return statSync(archive).mtimeMs > statSync(marker).mtimeMs;
  } catch {
    return true;
  }
}
