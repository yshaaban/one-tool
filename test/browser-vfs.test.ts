import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import 'fake-indexeddb/auto';

import { BrowserVFS } from '../src/vfs/browser-vfs.js';

let vfs: BrowserVFS;
let dbCounter = 0;

function uniqueDb(): string {
  return `test-db-${Date.now()}-${dbCounter++}`;
}

beforeEach(async () => {
  vfs = await BrowserVFS.open(uniqueDb());
});

afterEach(async () => {
  const name = vfs.dbName;
  vfs.close();
  await BrowserVFS.destroy(name);
});

// ── Path normalization ──────────────────────────────────────────

test('normalize resolves paths correctly', () => {
  assert.equal(vfs.normalize('/'), '/');
  assert.equal(vfs.normalize('/foo/bar'), '/foo/bar');
  assert.equal(vfs.normalize('foo/bar'), '/foo/bar');
  assert.equal(vfs.normalize('/foo/../bar'), '/bar');
  assert.equal(vfs.normalize('/foo/./bar'), '/foo/bar');
  assert.equal(vfs.normalize('//foo//bar//'), '/foo/bar');
});

test('normalize prevents path escape', () => {
  assert.equal(vfs.normalize('/../../etc/passwd'), '/etc/passwd');
  assert.equal(vfs.normalize('/../..'), '/');
  assert.equal(vfs.normalize('/foo/../../bar'), '/bar');
});

// ── CRUD operations ─────────────────────────────────────────────

test('writeBytes and readBytes round-trip', async () => {
  const data = new TextEncoder().encode('hello world');
  await vfs.writeBytes('/test.txt', data);
  const result = await vfs.readBytes('/test.txt');
  assert.deepEqual(result, data);
});

test('readText returns string', async () => {
  await vfs.writeBytes('/test.txt', new TextEncoder().encode('hello'));
  const text = await vfs.readText('/test.txt');
  assert.equal(text, 'hello');
});

test('appendBytes appends to existing file', async () => {
  await vfs.writeBytes('/test.txt', new TextEncoder().encode('hello'));
  await vfs.appendBytes('/test.txt', new TextEncoder().encode(' world'));
  const text = await vfs.readText('/test.txt');
  assert.equal(text, 'hello world');
});

test('appendBytes creates file if missing', async () => {
  await vfs.appendBytes('/new.txt', new TextEncoder().encode('content'));
  const text = await vfs.readText('/new.txt');
  assert.equal(text, 'content');
});

test('writeBytes creates parent dirs automatically', async () => {
  await vfs.writeBytes('/deep/nested/file.txt', new TextEncoder().encode('ok'));
  assert.equal(await vfs.isDir('/deep'), true);
  assert.equal(await vfs.isDir('/deep/nested'), true);
  assert.equal(await vfs.readText('/deep/nested/file.txt'), 'ok');
});

test('overwrite existing file with writeBytes', async () => {
  await vfs.writeBytes('/file.txt', new TextEncoder().encode('old'));
  await vfs.writeBytes('/file.txt', new TextEncoder().encode('new'));
  assert.equal(await vfs.readText('/file.txt'), 'new');
});

// ── Directory operations ────────────────────────────────────────

test('mkdir creates nested directories', async () => {
  await vfs.mkdir('/a/b/c', true);
  assert.equal(await vfs.isDir('/a'), true);
  assert.equal(await vfs.isDir('/a/b'), true);
  assert.equal(await vfs.isDir('/a/b/c'), true);
});

test('mkdir is idempotent', async () => {
  await vfs.mkdir('/a/b', true);
  await vfs.mkdir('/a/b', true); // no throw
  assert.equal(await vfs.isDir('/a/b'), true);
});

test('mkdir without parents throws for missing parent', async () => {
  await assert.rejects(() => vfs.mkdir('/a/b/c', false), /ENOENT/);
});

test('mkdir without parents throws ENOTDIR when parent is a file', async () => {
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.mkdir('/a/b', false), /ENOTDIR/);
});

test('listdir returns sorted entries with dirs first', async () => {
  await vfs.writeBytes('/z.txt', new TextEncoder().encode(''));
  await vfs.writeBytes('/a.txt', new TextEncoder().encode(''));
  await vfs.mkdir('/m-dir', true);
  const entries = await vfs.listdir('/');
  assert.deepEqual(entries, ['m-dir/', 'a.txt', 'z.txt']);
});

test('listdir throws ENOENT for missing path', async () => {
  await assert.rejects(() => vfs.listdir('/missing'), /ENOENT/);
});

test('listdir throws ENOTDIR for file path', async () => {
  await vfs.writeBytes('/file.txt', new TextEncoder().encode('x'));
  await assert.rejects(() => vfs.listdir('/file.txt'), /ENOTDIR/);
});

test('listdir on fresh VFS returns empty array', async () => {
  const entries = await vfs.listdir('/');
  assert.deepEqual(entries, []);
});

test('listdir only returns direct children', async () => {
  await vfs.writeBytes('/a/b/deep.txt', new TextEncoder().encode('x'));
  await vfs.writeBytes('/a/top.txt', new TextEncoder().encode('x'));
  const entries = await vfs.listdir('/a');
  assert.deepEqual(entries, ['b/', 'top.txt']);
});

// ── File/dir collision guards ───────────────────────────────────

test('writeBytes throws EISDIR when path is a directory', async () => {
  await vfs.mkdir('/mydir', true);
  await assert.rejects(() => vfs.writeBytes('/mydir', new TextEncoder().encode('x')), /EISDIR/);
});

test('appendBytes throws EISDIR when path is a directory', async () => {
  await vfs.mkdir('/mydir', true);
  await assert.rejects(() => vfs.appendBytes('/mydir', new TextEncoder().encode('x')), /EISDIR/);
});

test('mkdir throws EEXIST when path is a file', async () => {
  await vfs.writeBytes('/thing', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.mkdir('/thing', true), /EEXIST/);
  await assert.rejects(() => vfs.mkdir('/thing', false), /EEXIST/);
});

test('mkdir with parents throws ENOTDIR when ancestor is a file', async () => {
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.mkdir('/a/b/c', true), /ENOTDIR/);
});

test('writeBytes with makeParents throws ENOTDIR when ancestor is a file', async () => {
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.writeBytes('/a/b.txt', new TextEncoder().encode('x')), /ENOTDIR/);
});

test('appendBytes with makeParents throws ENOTDIR when ancestor is a file', async () => {
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.appendBytes('/a/b.txt', new TextEncoder().encode('x')), /ENOTDIR/);
});

test('writeBytes with makeParents=false throws ENOENT for missing parent', async () => {
  await assert.rejects(
    () => vfs.writeBytes('/missing/file.txt', new TextEncoder().encode('x'), false),
    /ENOENT/,
  );
});

test('appendBytes with makeParents=false throws ENOENT for missing parent', async () => {
  await assert.rejects(
    () => vfs.appendBytes('/missing/file.txt', new TextEncoder().encode('x'), false),
    /ENOENT/,
  );
});

test('writeBytes with makeParents=false throws ENOTDIR when parent is a file', async () => {
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.writeBytes('/a/b.txt', new TextEncoder().encode('x'), false), /ENOTDIR/);
});

test('appendBytes with makeParents=false throws ENOTDIR when parent is a file', async () => {
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.appendBytes('/a/b.txt', new TextEncoder().encode('x'), false), /ENOTDIR/);
});

// ── Error handling ──────────────────────────────────────────────

test('readBytes throws ENOENT for missing file', async () => {
  await assert.rejects(() => vfs.readBytes('/missing'), /ENOENT/);
});

test('readBytes throws EISDIR for directory', async () => {
  await vfs.mkdir('/dir', true);
  await assert.rejects(() => vfs.readBytes('/dir'), /EISDIR/);
});

test('delete throws ENOENT for missing path', async () => {
  await assert.rejects(() => vfs.delete('/missing'), /ENOENT/);
});

test('delete root throws', async () => {
  await assert.rejects(() => vfs.delete('/'), /cannot delete root/);
});

// ── Stat ────────────────────────────────────────────────────────

test('stat returns correct info for file', async () => {
  await vfs.writeBytes('/test.txt', new TextEncoder().encode('abc'));
  const info = await vfs.stat('/test.txt');
  assert.equal(info.exists, true);
  assert.equal(info.isDir, false);
  assert.equal(info.size, 3);
  assert.equal(info.mediaType, 'text/plain');
  assert.ok(info.modifiedEpochMs > 0);
});

test('stat returns correct info for directory', async () => {
  await vfs.mkdir('/mydir', true);
  const info = await vfs.stat('/mydir');
  assert.equal(info.exists, true);
  assert.equal(info.isDir, true);
  assert.equal(info.size, 0);
  assert.equal(info.mediaType, 'inode/directory');
  assert.ok(info.modifiedEpochMs > 0);
});

test('stat returns exists=false for missing path', async () => {
  const info = await vfs.stat('/nope');
  assert.equal(info.exists, false);
});

// ── Copy / Move / Delete ────────────────────────────────────────

test('delete removes file', async () => {
  await vfs.writeBytes('/test.txt', new TextEncoder().encode('x'));
  await vfs.delete('/test.txt');
  assert.equal(await vfs.exists('/test.txt'), false);
});

test('delete removes directory recursively', async () => {
  await vfs.writeBytes('/dir/sub/file.txt', new TextEncoder().encode('x'));
  await vfs.delete('/dir');
  assert.equal(await vfs.exists('/dir'), false);
  assert.equal(await vfs.exists('/dir/sub'), false);
  assert.equal(await vfs.exists('/dir/sub/file.txt'), false);
});

test('copy duplicates file', async () => {
  await vfs.writeBytes('/a.txt', new TextEncoder().encode('data'));
  await vfs.copy('/a.txt', '/b.txt');
  assert.equal(await vfs.readText('/a.txt'), 'data');
  assert.equal(await vfs.readText('/b.txt'), 'data');
});

test('copy duplicates directory tree', async () => {
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await vfs.writeBytes('/src/lib/util.ts', new TextEncoder().encode('util'));
  await vfs.copy('/src', '/dst');
  assert.equal(await vfs.readText('/dst/main.ts'), 'code');
  assert.equal(await vfs.readText('/dst/lib/util.ts'), 'util');
  assert.equal(await vfs.exists('/src/main.ts'), true);
});

test('copy directory creates missing destination parents', async () => {
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await vfs.copy('/src', '/a/b/dst');
  assert.equal(await vfs.isDir('/a'), true);
  assert.equal(await vfs.isDir('/a/b'), true);
  assert.equal(await vfs.readText('/a/b/dst/main.ts'), 'code');
});

test('copy directory into its own child throws EINVAL', async () => {
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await assert.rejects(() => vfs.copy('/src', '/src/sub'), /EINVAL/);
});

test('copy throws EEXIST for existing destination dir', async () => {
  await vfs.mkdir('/src', true);
  await vfs.mkdir('/dst', true);
  await assert.rejects(() => vfs.copy('/src', '/dst'), /EEXIST/);
});

test('copy throws ENOENT for missing source', async () => {
  await assert.rejects(() => vfs.copy('/missing', '/dst'), /ENOENT/);
});

test('move transfers file', async () => {
  await vfs.writeBytes('/old.txt', new TextEncoder().encode('data'));
  await vfs.move('/old.txt', '/new.txt');
  assert.equal(await vfs.exists('/old.txt'), false);
  assert.equal(await vfs.readText('/new.txt'), 'data');
});

test('move transfers directory tree', async () => {
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await vfs.writeBytes('/src/lib/util.ts', new TextEncoder().encode('util'));
  await vfs.move('/src', '/dst');
  assert.equal(await vfs.exists('/src'), false);
  assert.equal(await vfs.readText('/dst/main.ts'), 'code');
  assert.equal(await vfs.readText('/dst/lib/util.ts'), 'util');
});

test('move directory into its own child throws EINVAL', async () => {
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await assert.rejects(() => vfs.move('/src', '/src/sub'), /EINVAL/);
});

// ── exists / isDir ──────────────────────────────────────────────

test('exists returns true for files and dirs', async () => {
  await vfs.writeBytes('/file.txt', new TextEncoder().encode('x'));
  await vfs.mkdir('/dir', true);
  assert.equal(await vfs.exists('/file.txt'), true);
  assert.equal(await vfs.exists('/dir'), true);
  assert.equal(await vfs.exists('/nope'), false);
});

test('isDir distinguishes files from dirs', async () => {
  await vfs.writeBytes('/file.txt', new TextEncoder().encode('x'));
  await vfs.mkdir('/dir', true);
  assert.equal(await vfs.isDir('/file.txt'), false);
  assert.equal(await vfs.isDir('/dir'), true);
  assert.equal(await vfs.isDir('/nope'), false);
});

// ── Persistence (BrowserVFS-specific) ───────────────────────────

test('data persists across close/reopen', async () => {
  const dbName = uniqueDb();
  const vfs1 = await BrowserVFS.open(dbName);
  await vfs1.writeBytes('/persist.txt', new TextEncoder().encode('survive'));
  await vfs1.mkdir('/persistdir', true);
  vfs1.close();

  const vfs2 = await BrowserVFS.open(dbName);
  assert.equal(await vfs2.readText('/persist.txt'), 'survive');
  assert.equal(await vfs2.isDir('/persistdir'), true);
  vfs2.close();
  await BrowserVFS.destroy(dbName);
});

test('separate database names are isolated', async () => {
  const dbA = uniqueDb();
  const dbB = uniqueDb();
  const vfsA = await BrowserVFS.open(dbA);
  const vfsB = await BrowserVFS.open(dbB);

  await vfsA.writeBytes('/shared-name.txt', new TextEncoder().encode('from A'));
  assert.equal(await vfsA.exists('/shared-name.txt'), true);
  assert.equal(await vfsB.exists('/shared-name.txt'), false);

  vfsA.close();
  vfsB.close();
  await BrowserVFS.destroy(dbA);
  await BrowserVFS.destroy(dbB);
});

// ── Binary data ─────────────────────────────────────────────────

test('handles binary data correctly', async () => {
  const binary = new Uint8Array([0, 1, 2, 127, 128, 255]);
  await vfs.writeBytes('/bin.dat', binary);
  const result = await vfs.readBytes('/bin.dat');
  assert.deepEqual(result, binary);
});

test('append preserves binary data', async () => {
  const part1 = new Uint8Array([0, 1, 2]);
  const part2 = new Uint8Array([3, 4, 5]);
  await vfs.writeBytes('/bin.dat', part1);
  await vfs.appendBytes('/bin.dat', part2);
  const result = await vfs.readBytes('/bin.dat');
  assert.deepEqual(result, new Uint8Array([0, 1, 2, 3, 4, 5]));
});
