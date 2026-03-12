import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryVFS } from '../src/index.js';

test('normalize resolves paths correctly', () => {
  const vfs = new MemoryVFS();
  assert.equal(vfs.normalize('/'), '/');
  assert.equal(vfs.normalize('/foo/bar'), '/foo/bar');
  assert.equal(vfs.normalize('foo/bar'), '/foo/bar');
  assert.equal(vfs.normalize('/foo/../bar'), '/bar');
  assert.equal(vfs.normalize('/foo/./bar'), '/foo/bar');
  assert.equal(vfs.normalize('//foo//bar//'), '/foo/bar');
});

test('normalize prevents path escape', () => {
  const vfs = new MemoryVFS();
  assert.equal(vfs.normalize('/../../etc/passwd'), '/etc/passwd');
  assert.equal(vfs.normalize('/../..'), '/');
  assert.equal(vfs.normalize('/foo/../../bar'), '/bar');
});

test('writeBytes and readBytes round-trip', async () => {
  const vfs = new MemoryVFS();
  const data = new TextEncoder().encode('hello world');
  await vfs.writeBytes('/test.txt', data);
  const result = await vfs.readBytes('/test.txt');
  assert.deepEqual(result, data);
});

test('readText returns string', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/test.txt', new TextEncoder().encode('hello'));
  const text = await vfs.readText('/test.txt');
  assert.equal(text, 'hello');
});

test('appendBytes appends to existing file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/test.txt', new TextEncoder().encode('hello'));
  await vfs.appendBytes('/test.txt', new TextEncoder().encode(' world'));
  const text = await vfs.readText('/test.txt');
  assert.equal(text, 'hello world');
});

test('appendBytes creates file if missing', async () => {
  const vfs = new MemoryVFS();
  await vfs.appendBytes('/new.txt', new TextEncoder().encode('content'));
  const text = await vfs.readText('/new.txt');
  assert.equal(text, 'content');
});

test('mkdir creates nested directories', async () => {
  const vfs = new MemoryVFS();
  await vfs.mkdir('/a/b/c', true);
  assert.equal(await vfs.isDir('/a'), true);
  assert.equal(await vfs.isDir('/a/b'), true);
  assert.equal(await vfs.isDir('/a/b/c'), true);
});

test('listdir returns sorted entries with dirs first', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/z.txt', new TextEncoder().encode(''));
  await vfs.writeBytes('/a.txt', new TextEncoder().encode(''));
  await vfs.mkdir('/m-dir', true);
  const entries = await vfs.listdir('/');
  assert.deepEqual(entries, ['m-dir/', 'a.txt', 'z.txt']);
});

test('listdir throws ENOENT for missing path', async () => {
  const vfs = new MemoryVFS();
  await assert.rejects(() => vfs.listdir('/missing'), /ENOENT/);
});

test('listdir throws ENOTDIR for file path', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/file.txt', new TextEncoder().encode('x'));
  await assert.rejects(() => vfs.listdir('/file.txt'), /ENOTDIR/);
});

test('readBytes throws ENOENT for missing file', async () => {
  const vfs = new MemoryVFS();
  await assert.rejects(() => vfs.readBytes('/missing'), /ENOENT/);
});

test('readBytes throws EISDIR for directory', async () => {
  const vfs = new MemoryVFS();
  await vfs.mkdir('/dir', true);
  await assert.rejects(() => vfs.readBytes('/dir'), /EISDIR/);
});

test('stat returns correct info for file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/test.txt', new TextEncoder().encode('abc'));
  const info = await vfs.stat('/test.txt');
  assert.equal(info.exists, true);
  assert.equal(info.isDir, false);
  assert.equal(info.size, 3);
  assert.equal(info.mediaType, 'text/plain');
});

test('stat returns correct info for directory', async () => {
  const vfs = new MemoryVFS();
  await vfs.mkdir('/mydir', true);
  const info = await vfs.stat('/mydir');
  assert.equal(info.exists, true);
  assert.equal(info.isDir, true);
  assert.equal(info.size, 0);
  assert.equal(info.mediaType, 'inode/directory');
  assert.ok(info.modifiedEpochMs > 0);
});

test('stat returns exists=false for missing path', async () => {
  const vfs = new MemoryVFS();
  const info = await vfs.stat('/nope');
  assert.equal(info.exists, false);
});

test('delete removes file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/test.txt', new TextEncoder().encode('x'));
  await vfs.delete('/test.txt');
  assert.equal(await vfs.exists('/test.txt'), false);
});

test('delete removes directory recursively', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/dir/sub/file.txt', new TextEncoder().encode('x'));
  await vfs.delete('/dir');
  assert.equal(await vfs.exists('/dir'), false);
  assert.equal(await vfs.exists('/dir/sub/file.txt'), false);
});

test('delete root throws', async () => {
  const vfs = new MemoryVFS();
  await assert.rejects(() => vfs.delete('/'), /cannot delete root/);
});

test('copy duplicates file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/a.txt', new TextEncoder().encode('data'));
  await vfs.copy('/a.txt', '/b.txt');
  assert.equal(await vfs.readText('/a.txt'), 'data');
  assert.equal(await vfs.readText('/b.txt'), 'data');
});

test('copy duplicates directory tree', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await vfs.copy('/src', '/dst');
  assert.equal(await vfs.readText('/dst/main.ts'), 'code');
  assert.equal(await vfs.exists('/src/main.ts'), true);
});

test('copy directory creates missing destination parents', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await vfs.copy('/src', '/a/b/dst');
  assert.equal(await vfs.isDir('/a'), true);
  assert.equal(await vfs.isDir('/a/b'), true);
  assert.equal(await vfs.readText('/a/b/dst/main.ts'), 'code');
});

test('copy directory into its own child throws EINVAL', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await assert.rejects(() => vfs.copy('/src', '/src/sub'), /EINVAL/);
});

test('move transfers file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/old.txt', new TextEncoder().encode('data'));
  await vfs.move('/old.txt', '/new.txt');
  assert.equal(await vfs.exists('/old.txt'), false);
  assert.equal(await vfs.readText('/new.txt'), 'data');
});

test('move transfers directory tree', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await vfs.writeBytes('/src/lib/util.ts', new TextEncoder().encode('util'));
  await vfs.move('/src', '/dst');
  assert.equal(await vfs.exists('/src'), false);
  assert.equal(await vfs.readText('/dst/main.ts'), 'code');
  assert.equal(await vfs.readText('/dst/lib/util.ts'), 'util');
});

test('move directory into its own child throws EINVAL', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
  await assert.rejects(() => vfs.move('/src', '/src/sub'), /EINVAL/);
});

test('writeBytes creates parent dirs automatically', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/deep/nested/file.txt', new TextEncoder().encode('ok'));
  assert.equal(await vfs.isDir('/deep'), true);
  assert.equal(await vfs.isDir('/deep/nested'), true);
  assert.equal(await vfs.readText('/deep/nested/file.txt'), 'ok');
});

test('writeBytes with makeParents=false throws for missing parent', async () => {
  const vfs = new MemoryVFS();
  await assert.rejects(
    () => vfs.writeBytes('/missing/file.txt', new TextEncoder().encode('x'), false),
    /ENOENT/,
  );
});

test('appendBytes with makeParents=false throws for missing parent', async () => {
  const vfs = new MemoryVFS();
  await assert.rejects(
    () => vfs.appendBytes('/missing/file.txt', new TextEncoder().encode('x'), false),
    /ENOENT/,
  );
});

// ── File/dir collision guards ───────────────────────────────────

test('writeBytes throws EISDIR when path is a directory', async () => {
  const vfs = new MemoryVFS();
  await vfs.mkdir('/mydir', true);
  await assert.rejects(() => vfs.writeBytes('/mydir', new TextEncoder().encode('x')), /EISDIR/);
});

test('appendBytes throws EISDIR when path is a directory', async () => {
  const vfs = new MemoryVFS();
  await vfs.mkdir('/mydir', true);
  await assert.rejects(() => vfs.appendBytes('/mydir', new TextEncoder().encode('x')), /EISDIR/);
});

test('mkdir throws EEXIST when path is a file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/thing', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.mkdir('/thing', true), /EEXIST/);
  await assert.rejects(() => vfs.mkdir('/thing', false), /EEXIST/);
});

test('mkdir with parents throws ENOTDIR when ancestor is a file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.mkdir('/a/b/c', true), /ENOTDIR/);
});

test('writeBytes with makeParents throws ENOTDIR when ancestor is a file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.writeBytes('/a/b.txt', new TextEncoder().encode('x')), /ENOTDIR/);
});

test('appendBytes with makeParents throws ENOTDIR when ancestor is a file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.appendBytes('/a/b.txt', new TextEncoder().encode('x')), /ENOTDIR/);
});

test('writeBytes with makeParents=false throws ENOTDIR when parent is a file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.writeBytes('/a/b.txt', new TextEncoder().encode('x'), false), /ENOTDIR/);
});

test('appendBytes with makeParents=false throws ENOTDIR when parent is a file', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/a', new TextEncoder().encode('file'));
  await assert.rejects(() => vfs.appendBytes('/a/b.txt', new TextEncoder().encode('x'), false), /ENOTDIR/);
});

test('mkdir is idempotent', async () => {
  const vfs = new MemoryVFS();
  await vfs.mkdir('/a/b', true);
  await vfs.mkdir('/a/b', true); // no throw
  assert.equal(await vfs.isDir('/a/b'), true);
});

test('listdir on fresh VFS returns empty array', async () => {
  const vfs = new MemoryVFS();
  const entries = await vfs.listdir('/');
  assert.deepEqual(entries, []);
});

test('exists returns true for files and dirs', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/file.txt', new TextEncoder().encode('x'));
  await vfs.mkdir('/dir', true);
  assert.equal(await vfs.exists('/file.txt'), true);
  assert.equal(await vfs.exists('/dir'), true);
  assert.equal(await vfs.exists('/nope'), false);
});

test('isDir distinguishes files from dirs', async () => {
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/file.txt', new TextEncoder().encode('x'));
  await vfs.mkdir('/dir', true);
  assert.equal(await vfs.isDir('/file.txt'), false);
  assert.equal(await vfs.isDir('/dir'), true);
  assert.equal(await vfs.isDir('/nope'), false);
});
