import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryVFS } from '../../src/index.js';
import { textEncoder } from '../../src/types.js';
import { makeCtx, NO_STDIN, runCommand, stdoutText } from './harness.js';

test('fs: ls lists an empty root', async () => {
  const { result } = await runCommand('ls');
  assert.equal(result.exitCode, 0);
  assert.equal(stdoutText(result), '');
});

test('fs: ls reports missing paths', async () => {
  const { result } = await runCommand('ls', ['/missing']);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ls: path not found: \/missing/);
});

test('fs: stat reports missing paths', async () => {
  const { result } = await runCommand('stat', ['/missing.txt']);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /stat: path not found: \/missing\.txt/);
});

test('fs: cat reads text files', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/notes/todo.txt', textEncoder.encode('line one'));

  const { result } = await runCommand('cat', ['/notes/todo.txt'], { ctx });
  assert.equal(result.exitCode, 0);
  assert.equal(result.contentType, 'text/plain');
  assert.equal(stdoutText(result), 'line one');
});

test('fs: cat rejects directories', async () => {
  const ctx = makeCtx();
  await ctx.vfs.mkdir('/notes', true);

  const { result } = await runCommand('cat', ['/notes'], { ctx });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /cat: path is a directory: \/notes/);
});

test('fs: cat rejects binary files', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/images/logo.bin', new Uint8Array([0, 1, 2, 3]));

  const { result } = await runCommand('cat', ['/images/logo.bin'], { ctx });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /cat: binary file/);
  assert.match(result.stderr, /Use: stat \/images\/logo\.bin/);
});

test('fs: write supports inline and stdin content', async () => {
  const ctx = makeCtx();

  const inline = await runCommand('write', ['/notes/inline.txt', 'hello'], { ctx });
  assert.equal(inline.result.exitCode, 0);
  assert.match(inline.result.stderr, /^$/);

  const piped = await runCommand('write', ['/notes/stdin.txt'], {
    ctx,
    stdin: textEncoder.encode('from stdin'),
  });
  assert.equal(piped.result.exitCode, 0);

  assert.equal(stdoutText(await ctx.vfs.readBytes('/notes/inline.txt')), 'hello');
  assert.equal(stdoutText(await ctx.vfs.readBytes('/notes/stdin.txt')), 'from stdin');
});

test('fs: write reports missing content and parent-not-directory errors', async () => {
  const missingContent = await runCommand('write', ['/notes/empty.txt']);
  assert.equal(missingContent.result.exitCode, 1);
  assert.match(missingContent.result.stderr, /write: no content provided/);

  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/blocked', textEncoder.encode('file'));

  const blockedParent = await runCommand('write', ['/blocked/child.txt', 'hi'], { ctx });
  assert.equal(blockedParent.result.exitCode, 1);
  assert.match(blockedParent.result.stderr, /write: parent is not a directory: \/blocked/);
});

test('fs: write reports resource limit failures cleanly', async () => {
  const ctx = makeCtx({
    vfs: new MemoryVFS({
      resourcePolicy: {
        maxFileBytes: 3,
      },
    }),
  });

  const { result } = await runCommand('write', ['/notes/large.txt', 'hello'], { ctx });
  assert.equal(result.exitCode, 1);
  assert.match(
    result.stderr,
    /write: resource limit exceeded \(maxFileBytes: 5 > 3\) at \/notes\/large\.txt/,
  );
});

test('fs: append extends files and rejects missing content', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/notes/log.txt', textEncoder.encode('start'));

  const appended = await runCommand('append', ['/notes/log.txt', ' next'], { ctx });
  assert.equal(appended.result.exitCode, 0);
  assert.equal(stdoutText(await ctx.vfs.readBytes('/notes/log.txt')), 'start next');

  const missingContent = await runCommand('append', ['/notes/log.txt'], { ctx, stdin: NO_STDIN });
  assert.equal(missingContent.result.exitCode, 1);
  assert.match(missingContent.result.stderr, /append: no content provided/);
});

test('fs: mkdir creates nested directories', async () => {
  const ctx = makeCtx();

  const { result } = await runCommand('mkdir', ['/reports/2026/q1'], { ctx });
  assert.equal(result.exitCode, 0);
  assert.match(stdoutText(result), /created \/reports\/2026\/q1/);

  const info = await ctx.vfs.stat('/reports/2026/q1');
  assert.equal(info.exists, true);
  assert.equal(info.isDir, true);
});

test('fs: cp copies files and blocks subtree copies', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/src.txt', textEncoder.encode('copy me'));
  await ctx.vfs.mkdir('/tree', true);

  const copied = await runCommand('cp', ['/src.txt', '/dst.txt'], { ctx });
  assert.equal(copied.result.exitCode, 0);
  assert.equal(stdoutText(await ctx.vfs.readBytes('/dst.txt')), 'copy me');

  const subtree = await runCommand('cp', ['/tree', '/tree/sub'], { ctx });
  assert.equal(subtree.result.exitCode, 1);
  assert.match(subtree.result.stderr, /cp: destination is inside the source directory: \/tree\/sub/);
});

test('fs: mv renames files and blocks subtree moves', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/draft.txt', textEncoder.encode('move me'));
  await ctx.vfs.mkdir('/tree', true);

  const moved = await runCommand('mv', ['/draft.txt', '/archive.txt'], { ctx });
  assert.equal(moved.result.exitCode, 0);
  assert.equal(stdoutText(await ctx.vfs.readBytes('/archive.txt')), 'move me');

  const movedInfo = await ctx.vfs.stat('/draft.txt');
  assert.equal(movedInfo.exists, false);

  const subtree = await runCommand('mv', ['/tree', '/tree/sub'], { ctx });
  assert.equal(subtree.result.exitCode, 1);
  assert.match(subtree.result.stderr, /mv: destination is inside the source directory: \/tree\/sub/);
});

test('fs: mv reports missing sources before destination-shape validation', async () => {
  const ctx = makeCtx({
    vfs: new MemoryVFS({
      resourcePolicy: {
        maxDirectoryDepth: 0,
      },
    }),
  });

  const missing = await runCommand('mv', ['/missing', '/missing/sub'], { ctx });
  assert.equal(missing.result.exitCode, 1);
  assert.match(missing.result.stderr, /mv: source not found: \/missing/);
});

test('fs: rm removes files and protects root', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/tmp/out.txt', textEncoder.encode('bye'));

  const removed = await runCommand('rm', ['/tmp/out.txt'], { ctx });
  assert.equal(removed.result.exitCode, 0);
  assert.match(stdoutText(removed.result), /removed \/tmp\/out\.txt/);

  const root = await runCommand('rm', ['/'], { ctx });
  assert.equal(root.result.exitCode, 1);
  assert.match(root.result.stderr, /rm: cannot delete root: \//);
});

test('fs: find walks recursively and supports filters', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/docs/a.txt', textEncoder.encode('a'));
  await ctx.vfs.writeBytes('/docs/nested/b.md', textEncoder.encode('b'));
  await ctx.vfs.mkdir('/docs/empty', true);

  const all = await runCommand('find', ['/docs'], { ctx });
  assert.equal(all.result.exitCode, 0);
  assert.equal(stdoutText(all.result), '/docs\n/docs/empty\n/docs/nested\n/docs/nested/b.md\n/docs/a.txt');

  const filesOnly = await runCommand('find', ['/docs', '--type', 'file'], { ctx });
  assert.equal(filesOnly.result.exitCode, 0);
  assert.equal(stdoutText(filesOnly.result), '/docs/nested/b.md\n/docs/a.txt');

  const named = await runCommand('find', ['/docs', '--name', '*.md'], { ctx });
  assert.equal(named.result.exitCode, 0);
  assert.equal(stdoutText(named.result), '/docs/nested/b.md');
});

test('fs: find supports max depth and validates flags', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/tree/top.txt', textEncoder.encode('top'));
  await ctx.vfs.writeBytes('/tree/deep/down.txt', textEncoder.encode('down'));

  const shallow = await runCommand('find', ['/tree', '--max-depth', '1'], { ctx });
  assert.equal(shallow.result.exitCode, 0);
  assert.equal(stdoutText(shallow.result), '/tree\n/tree/deep\n/tree/top.txt');

  const invalidType = await runCommand('find', ['/tree', '--type', 'other'], { ctx });
  assert.equal(invalidType.result.exitCode, 1);
  assert.match(invalidType.result.stderr, /find: invalid value for --type: other/);

  const invalidDepth = await runCommand('find', ['/tree', '--max-depth', '-1'], { ctx });
  assert.equal(invalidDepth.result.exitCode, 1);
  assert.match(invalidDepth.result.stderr, /find: invalid integer for --max-depth: -1/);
});
