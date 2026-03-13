import assert from 'node:assert/strict';
import test from 'node:test';

import type { CommandContext } from '../src/commands/index.js';
import { readBytesFromFileOrStdin } from '../src/commands/shared/bytes.js';
import { MemoryVFS, SimpleMemory } from '../src/index.js';
import { CommandRegistry } from '../src/commands/index.js';
import { textEncoder } from '../src/types.js';
import type { ResolvedAgentCLIExecutionPolicy } from '../src/execution-policy.js';

function makeCtx(
  vfs = new MemoryVFS(),
  executionPolicy: ResolvedAgentCLIExecutionPolicy = {},
): CommandContext {
  return {
    vfs,
    adapters: {},
    memory: new SimpleMemory(),
    registry: new CommandRegistry(),
    executionPolicy,
    outputDir: '/.system/cmd-output',
    outputCounter: 0,
  };
}

test('readBytesFromFileOrStdin reads file bytes without text decoding', async function (): Promise<void> {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/notes.bin', new Uint8Array([0, 255, 10]));

  const input = await readBytesFromFileOrStdin(ctx, 'notes.bin', new Uint8Array(), 'bytes');

  assert.equal(input.error, undefined);
  assert.equal(input.source, '/notes.bin');
  assert.deepEqual(Array.from(input.data ?? []), [0, 255, 10]);
});

test('readBytesFromFileOrStdin reads stdin bytes and preserves identity semantics', async function (): Promise<void> {
  const ctx = makeCtx();
  const stdin = new Uint8Array([1, 2, 3]);

  const input = await readBytesFromFileOrStdin(ctx, undefined, stdin, 'bytes');

  assert.equal(input.error, undefined);
  assert.equal(input.source, 'stdin');
  assert.deepEqual(Array.from(input.data ?? []), [1, 2, 3]);
  assert.notEqual(input.data, stdin);
});

test('readBytesFromFileOrStdin reports missing files and directories', async function (): Promise<void> {
  const ctx = makeCtx();
  await ctx.vfs.mkdir('/docs', true);

  const missing = await readBytesFromFileOrStdin(ctx, '/missing.bin', new Uint8Array(), 'bytes');
  assert.match(missing.error?.stderr ?? '', /bytes: file not found: \/missing\.bin/);

  const directory = await readBytesFromFileOrStdin(ctx, '/docs', new Uint8Array(), 'bytes');
  assert.match(directory.error?.stderr ?? '', /bytes: path is a directory: \/docs/);
});

test('readBytesFromFileOrStdin enforces the materialized byte limit for files and stdin', async function (): Promise<void> {
  const ctx = makeCtx(new MemoryVFS(), { maxMaterializedBytes: 2 });
  await ctx.vfs.writeBytes('/large.bin', textEncoder.encode('abc'));

  const fileLimited = await readBytesFromFileOrStdin(ctx, '/large.bin', new Uint8Array(), 'bytes');
  assert.match(fileLimited.error?.stderr ?? '', /bytes: input exceeds max materialized size/);

  const stdinLimited = await readBytesFromFileOrStdin(ctx, undefined, textEncoder.encode('abc'), 'bytes');
  assert.match(stdinLimited.error?.stderr ?? '', /bytes: input exceeds max materialized size/);
});

test('readBytesFromFileOrStdin reports when no file path or stdin is provided', async function (): Promise<void> {
  const ctx = makeCtx();

  const input = await readBytesFromFileOrStdin(ctx, undefined, new Uint8Array(), 'bytes');

  assert.match(input.error?.stderr ?? '', /bytes: no input provided/);
});
