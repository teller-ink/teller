import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  archiveFolder,
  archiveJson,
  folderEntries,
  openArchive,
  readArchive,
  unpackArchive,
  writeArchive,
} from './archive.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-archive-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const text = (s: string) => Buffer.from(s, 'utf8');

describe('writeArchive / readArchive', () => {
  it('round-trips names and bytes', () => {
    const zip = writeArchive([
      { name: 'pack.json', data: text('{"id":"pak_1"}') },
      { name: 'art/logo.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]) },
    ]);
    const back = readArchive(zip);
    expect([...back.keys()]).toEqual(['pack.json', 'art/logo.png']);
    expect(back.get('pack.json')?.toString('utf8')).toBe('{"id":"pak_1"}');
    expect([...(back.get('art/logo.png') ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);
  });

  it('deflates what compresses and stores what does not', () => {
    const big = text('a'.repeat(10_000));
    const zip = writeArchive([{ name: 'big.json', data: big }]);
    expect(zip.length).toBeLessThan(1_000);
    expect(readArchive(zip).get('big.json')?.toString('utf8')).toBe(big.toString('utf8'));

    const tiny = text('x');
    const stored = writeArchive([{ name: 'x', data: tiny }]);
    expect(readArchive(stored).get('x')?.toString('utf8')).toBe('x');
  });

  it('the same folder twice is the same bytes — an archive you can diff', () => {
    const entries = [{ name: 'pack.json', data: text('{}') }];
    expect(writeArchive(entries).equals(writeArchive(entries))).toBe(true);
  });

  it('something that is not a zip is an error the caller can report', () => {
    expect(() => readArchive(text('not a zip at all'))).toThrow(/teller file/);
  });

  it('an empty archive is legal and reads back empty', () => {
    expect(readArchive(writeArchive([])).size).toBe(0);
  });
});

describe('folderEntries', () => {
  it('names files relative, with forward slashes, and leaves dot-anything behind', () => {
    mkdirSync(join(dir, 'art'), { recursive: true });
    mkdirSync(join(dir, '.build', 'blocks'), { recursive: true });
    writeFileSync(join(dir, 'pack.json'), '{}');
    writeFileSync(join(dir, 'art', 'logo.png'), 'png');
    writeFileSync(join(dir, '.build', 'blocks', 'Foe.js'), 'compiled');
    writeFileSync(join(dir, '.DS_Store'), 'junk');
    expect(folderEntries(dir).map((e) => e.name)).toEqual(['art/logo.png', 'pack.json']);
  });
});

describe('archiveFolder / unpackArchive', () => {
  it('a folder becomes an archive becomes the same folder', () => {
    mkdirSync(join(dir, 'src', 'art'), { recursive: true });
    writeFileSync(join(dir, 'src', 'pack.json'), '{"id":"pak_1"}');
    writeFileSync(join(dir, 'src', 'art', 'logo.png'), 'pixels');
    const zip = archiveFolder(join(dir, 'src'));

    const to = join(dir, 'landed');
    expect(unpackArchive(openArchive(zip), to).sort()).toEqual(['art/logo.png', 'pack.json']);
    expect(readFileSync(join(to, 'pack.json'), 'utf8')).toBe('{"id":"pak_1"}');
    expect(readFileSync(join(to, 'art', 'logo.png'), 'utf8')).toBe('pixels');
  });

  it('rewrite gets each member on the way out', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.json'), 'one');
    writeFileSync(join(dir, 'src', 'b.json'), 'two');
    const zip = archiveFolder(join(dir, 'src'), (name, data) =>
      name === 'a.json' ? text('changed') : data,
    );
    const back = readArchive(zip);
    expect(back.get('a.json')?.toString('utf8')).toBe('changed');
    expect(back.get('b.json')?.toString('utf8')).toBe('two');
  });

  it('an entry naming its way out of the folder is dropped, never followed', () => {
    const zip = writeArchive([
      { name: '../escaped.json', data: text('nope') },
      { name: 'pack.json', data: text('{}') },
    ]);
    const to = join(dir, 'landed');
    expect(unpackArchive(openArchive(zip), to)).toEqual(['pack.json']);
    expect(() => readFileSync(join(dir, 'escaped.json'))).toThrow();
  });

  it('a zip made the ordinary way — everything under one folder — is flattened', () => {
    const zip = writeArchive([
      { name: 'wiw-guidebook/pack.json', data: text('{"id":"pak_1"}') },
      { name: 'wiw-guidebook/art/logo.png', data: text('pixels') },
    ]);
    const files = openArchive(zip);
    expect([...files.keys()].sort()).toEqual(['art/logo.png', 'pack.json']);
    expect(archiveJson(files, 'pack.json')).toEqual({ id: 'pak_1' });
  });

  it('a manifest already at the root is left exactly where it is', () => {
    const files = openArchive(
      writeArchive([
        { name: 'pack.json', data: text('{}') },
        { name: 'art/logo.png', data: text('pixels') },
      ]),
    );
    expect([...files.keys()].sort()).toEqual(['art/logo.png', 'pack.json']);
  });
});

// The format is only worth anything if other tools agree it is a zip —
// the whole point is handing the file to a person, who will double-click
// it long before they drop it on a teller host.
describe('the rest of the world can open it', () => {
  it('unzip -t passes, and the members come back out', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'pack.json'), JSON.stringify({ id: 'pak_1' }));
    writeFileSync(join(dir, 'src', 'big.json'), 'a'.repeat(5_000));
    const file = join(dir, 'out.pack');
    writeFileSync(file, archiveFolder(join(dir, 'src')));

    let listed: string;
    try {
      listed = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
    } catch {
      return; // no unzip on this machine — the round-trip above still stands
    }
    expect(listed).toContain('pack.json');
    execFileSync('unzip', ['-t', file]);
    execFileSync('unzip', ['-o', '-q', file, '-d', join(dir, 'out')]);
    expect(readFileSync(join(dir, 'out', 'pack.json'), 'utf8')).toBe('{"id":"pak_1"}');
  });

  it('reads back an archive some other tool wrote', () => {
    mkdirSync(join(dir, 'src', 'art'), { recursive: true });
    writeFileSync(join(dir, 'src', 'pack.json'), JSON.stringify({ id: 'pak_1' }));
    writeFileSync(join(dir, 'src', 'art', 'logo.png'), 'pixels');
    const file = join(dir, 'theirs.pack');
    try {
      execFileSync('zip', ['-q', '-r', file, '.'], { cwd: join(dir, 'src') });
    } catch {
      return; // no zip on this machine
    }
    const files = openArchive(readFileSync(file));
    expect(archiveJson(files, 'pack.json')).toEqual({ id: 'pak_1' });
    expect(files.get('art/logo.png')?.toString('utf8')).toBe('pixels');
  });
});
