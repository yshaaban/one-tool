import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { resolveExecutionPolicy } from '../src/execution-policy.js';
import { createTestCommandContext } from '../src/testing/index.js';
import {
  collectCommands,
  defineCommandGroup,
  formatVfsError,
  missingAdapterError,
  parseCountFlag,
  readBytesInput,
  readJsonInput,
  readTextInput,
  stdinNotAcceptedError,
  usageError,
  type CommandGroup,
} from '../src/extensions/index.js';
import { NodeVFS, type CommandSpec } from '../src/index.js';
import { ok, textEncoder } from '../src/types.js';

const echo: CommandSpec = {
  name: 'echo',
  summary: 'Echo text.',
  usage: 'echo <text...>',
  details: 'Examples:\n  echo hello',
  async handler(_ctx, args) {
    return ok(args.join(' '));
  },
};

test('extension error helpers return agent-friendly messages', async function (): Promise<void> {
  assert.equal(usageError('demo', 'demo <path>').stderr, 'demo: usage: demo <path>');
  assert.equal(stdinNotAcceptedError('demo').stderr, 'demo: does not accept stdin');
  assert.equal(missingAdapterError('searchx', 'search').stderr, 'searchx: no search adapter configured');

  const ctx = createTestCommandContext();
  await ctx.vfs.mkdir('/logs', true);
  await ctx.vfs.writeBytes('/reports', textEncoder.encode('not-a-dir'));

  try {
    await ctx.vfs.readBytes('/missing.txt');
    assert.fail('expected ENOENT');
  } catch (caught) {
    const result = await formatVfsError(ctx, 'show', '/missing.txt', caught, {
      notFoundLabel: 'file not found',
    });
    assert.equal(result.stderr, 'show: file not found: /missing.txt. Use: ls /');
  }

  try {
    await ctx.vfs.readBytes('/logs');
    assert.fail('expected EISDIR');
  } catch (caught) {
    const result = await formatVfsError(ctx, 'show', '/logs', caught);
    assert.equal(result.stderr, 'show: path is a directory: /logs. Use: ls /logs');
  }

  try {
    await ctx.vfs.writeBytes('/reports/output.txt', textEncoder.encode('x'), false);
    assert.fail('expected ENOTDIR');
  } catch (caught) {
    const result = await formatVfsError(ctx, 'write', '/reports/output.txt', caught);
    assert.equal(result.stderr, 'write: parent is not a directory: /reports');
  }
});

test('formatVfsError reports workspace-escape paths cleanly', async function (): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'one-tool-extension-node-vfs-'));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'one-tool-extension-outside-'));

  try {
    const vfs = new NodeVFS(root);
    await writeFile(path.join(outsideRoot, 'secret.txt'), 'secret');
    await symlink(path.join(outsideRoot, 'secret.txt'), path.join(vfs.rootDir, 'secret-link.txt'));

    const ctx = createTestCommandContext({ vfs });

    try {
      await ctx.vfs.readBytes('/secret-link.txt');
      assert.fail('expected EESCAPE');
    } catch (caught) {
      const result = await formatVfsError(ctx, 'show', '/secret-link.txt', caught);
      assert.equal(result.stderr, 'show: path escapes workspace root: /secret-link.txt');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test('formatVfsError uses the typed resource-limit path when it differs from the input path', async function (): Promise<void> {
  const ctx = createTestCommandContext({
    vfs: new NodeVFS(await mkdtemp(path.join(os.tmpdir(), 'one-tool-extension-limit-')), {
      resourcePolicy: {
        maxEntriesPerDirectory: 0,
      },
    }),
  });

  try {
    await ctx.vfs.writeBytes('/notes/todo.txt', textEncoder.encode('hello'));
    assert.fail('expected ERESOURCE_LIMIT');
  } catch (caught) {
    const result = await formatVfsError(ctx, 'write', '/notes/todo.txt', caught);
    assert.equal(result.stderr, 'write: resource limit exceeded (maxEntriesPerDirectory: 1 > 0) at /');
  } finally {
    await rm((ctx.vfs as NodeVFS).rootDir, { recursive: true, force: true });
  }
});

test('readTextInput reads from files and stdin', async function (): Promise<void> {
  const ctx = createTestCommandContext();
  await ctx.vfs.writeBytes('/notes/todo.txt', textEncoder.encode('alpha\nbeta'));

  const fromFile = await readTextInput(ctx, 'demo', '/notes/todo.txt', new Uint8Array());
  if (!fromFile.ok) {
    assert.fail(fromFile.error.stderr);
  }
  assert.equal(fromFile.value, 'alpha\nbeta');

  const fromStdin = await readTextInput(ctx, 'demo', undefined, textEncoder.encode('stdin text'));
  if (!fromStdin.ok) {
    assert.fail(fromStdin.error.stderr);
  }
  assert.equal(fromStdin.value, 'stdin text');
});

test('readBytesInput reads binary input and validates missing input', async function (): Promise<void> {
  const ctx = createTestCommandContext();
  await ctx.vfs.writeBytes('/blob.bin', Uint8Array.of(1, 2, 3));
  await ctx.vfs.mkdir('/docs', true);

  const fromFile = await readBytesInput(ctx, 'bytes', '/blob.bin', new Uint8Array());
  if (!fromFile.ok) {
    assert.fail(fromFile.error.stderr);
  }
  assert.deepEqual(Array.from(fromFile.value), [1, 2, 3]);

  const missingFile = await readBytesInput(ctx, 'bytes', '/missing.bin', new Uint8Array());
  assert.equal(missingFile.ok, false);
  if (missingFile.ok) {
    assert.fail('expected missing file to fail');
  }
  assert.equal(missingFile.error.stderr, 'bytes: file not found: /missing.bin. Use: ls /');

  const directory = await readBytesInput(ctx, 'bytes', '/docs', new Uint8Array());
  assert.equal(directory.ok, false);
  if (directory.ok) {
    assert.fail('expected directory input to fail');
  }
  assert.equal(directory.error.stderr, 'bytes: path is a directory: /docs. Use: ls /docs');

  const missing = await readBytesInput(ctx, 'bytes', undefined, new Uint8Array());
  assert.equal(missing.ok, false);
  if (missing.ok) {
    assert.fail('expected readBytesInput to fail');
  }
  assert.equal(missing.error.stderr, "bytes: no input provided. Usage: see 'help bytes'");
});

test('input helpers enforce max materialized size', async function (): Promise<void> {
  const ctx = createTestCommandContext({
    executionPolicy: resolveExecutionPolicy({ maxMaterializedBytes: 3 }),
  });
  await ctx.vfs.writeBytes('/notes/todo.txt', textEncoder.encode('hello'));

  const textResult = await readTextInput(ctx, 'show', '/notes/todo.txt', new Uint8Array());
  assert.equal(textResult.ok, false);
  if (textResult.ok) {
    assert.fail('expected text helper to fail');
  }
  assert.match(textResult.error.stderr, /show: input exceeds max materialized size/);

  const bytesResult = await readBytesInput(ctx, 'bytes', undefined, textEncoder.encode('hello'));
  assert.equal(bytesResult.ok, false);
  if (bytesResult.ok) {
    assert.fail('expected bytes helper to fail');
  }
  assert.match(bytesResult.error.stderr, /bytes: input exceeds max materialized size/);
});

test('readJsonInput parses JSON and reports invalid documents', async function (): Promise<void> {
  const ctx = createTestCommandContext();
  await ctx.vfs.writeBytes('/data/order.json', textEncoder.encode('{"id":123,"status":"open"}'));

  const parsed = await readJsonInput<{ id: number; status: string }>(
    ctx,
    'jsonx',
    '/data/order.json',
    new Uint8Array(),
  );
  if (!parsed.ok) {
    assert.fail(parsed.error.stderr);
  }
  assert.equal(parsed.value.id, 123);
  assert.equal(parsed.value.status, 'open');

  const invalid = await readJsonInput(ctx, 'jsonx', undefined, textEncoder.encode('{bad json'));
  assert.equal(invalid.ok, false);
  if (invalid.ok) {
    assert.fail('expected invalid JSON to fail');
  }
  assert.match(invalid.error.stderr, /jsonx: invalid JSON:/);
});

test('text and json input helpers convert thrown file-read errors into helper failures', async function (): Promise<void> {
  const ctx = createTestCommandContext();
  await ctx.vfs.writeBytes('/data/report.txt', textEncoder.encode('ready'));
  await ctx.vfs.writeBytes('/data/report.json', textEncoder.encode('{"status":"ready"}'));

  const originalReadBytes = ctx.vfs.readBytes.bind(ctx.vfs);
  ctx.vfs.readBytes = async function (path: string): Promise<Uint8Array> {
    if (path === '/data/report.txt' || path === '/data/report.json') {
      const error = new Error(`ENOENT:${path}`) as Error & { code?: string };
      error.code = 'ENOENT';
      throw error;
    }
    return originalReadBytes(path);
  };

  const textResult = await readTextInput(ctx, 'demo', '/data/report.txt', new Uint8Array());
  assert.equal(textResult.ok, false);
  if (textResult.ok) {
    assert.fail('expected text helper to fail');
  }
  assert.equal(textResult.error.stderr, 'demo: file not found: /data/report.txt. Use: ls /data');

  const jsonResult = await readJsonInput(ctx, 'jsonx', '/data/report.json', new Uint8Array());
  assert.equal(jsonResult.ok, false);
  if (jsonResult.ok) {
    assert.fail('expected json helper to fail');
  }
  assert.equal(jsonResult.error.stderr, 'jsonx: file not found: /data/report.json. Use: ls /data');
});

test('parseCountFlag parses -n values and preserves remaining args', function (): void {
  const defaultCount = parseCountFlag('headx', ['file.txt'], 10);
  if (!defaultCount.ok) {
    assert.fail(defaultCount.error.stderr);
  }
  assert.equal(defaultCount.value.count, 10);
  assert.deepEqual(defaultCount.value.rest, ['file.txt']);

  const explicitCount = parseCountFlag('headx', ['-n', '5', 'file.txt'], 10);
  if (!explicitCount.ok) {
    assert.fail(explicitCount.error.stderr);
  }
  assert.equal(explicitCount.value.count, 5);
  assert.deepEqual(explicitCount.value.rest, ['file.txt']);

  const invalidCount = parseCountFlag('headx', ['-n', 'abc'], 10);
  assert.equal(invalidCount.ok, false);
  if (invalidCount.ok) {
    assert.fail('expected invalid count to fail');
  }
  assert.equal(invalidCount.error.stderr, 'headx: invalid integer for -n: abc');
});

test('command-group helpers package and flatten custom command packs', function (): void {
  const supportGroup = defineCommandGroup('support', [echo]);
  const collected = collectCommands([supportGroup, echo]);

  assert.equal(supportGroup.name, 'support');
  assert.ok(Object.isFrozen(supportGroup));
  assert.ok(Object.isFrozen(supportGroup.commands));
  assert.deepEqual(
    collected.map(function (spec) {
      return spec.name;
    }),
    ['echo', 'echo'],
  );

  assert.throws(function (): CommandGroup {
    return defineCommandGroup('   ', [echo]);
  }, /command group name is required/);
});
