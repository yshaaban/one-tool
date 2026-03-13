import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentCLI, MemoryVFS, type CommandSpec } from '../src/index.js';
import { err, ok, okBytes, textDecoder } from '../src/types.js';

const echo: CommandSpec = {
  name: 'echo',
  summary: 'Echo text.',
  usage: 'echo <text...>',
  details: 'Examples:\n  echo hello',
  async handler(_ctx, args) {
    return ok(args.join(' '));
  },
};

const fail: CommandSpec = {
  name: 'fail',
  summary: 'Fail immediately.',
  usage: 'fail',
  details: 'Examples:\n  fail',
  async handler() {
    return err('fail: forced failure');
  },
};

const burst: CommandSpec = {
  name: 'burst',
  summary: 'Emit three lines.',
  usage: 'burst',
  details: 'Examples:\n  burst',
  async handler() {
    return ok('first line\nsecond line\nthird line');
  },
};

const binary: CommandSpec = {
  name: 'binary',
  summary: 'Emit binary bytes.',
  usage: 'binary',
  details: 'Examples:\n  binary',
  async handler() {
    return okBytes(Uint8Array.of(0, 1, 2, 3), 'application/octet-stream');
  },
};

test('runDetailed returns chain and command traces with skip metadata', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: [echo, fail],
  });
  await runtime.initialize();

  const execution = await runtime.runDetailed('echo ok || echo skipped; fail && echo skipped2; echo final');

  assert.equal(execution.exitCode, 0);
  assert.equal(textDecoder.decode(execution.stdout), 'ok\nfinal');
  assert.equal(execution.trace.length, 5);

  assert.equal(execution.trace[0]?.executed, true);
  assert.equal(execution.trace[0]?.exitCode, 0);
  assert.deepEqual(execution.trace[0]?.commands[0]?.argv, ['echo', 'ok']);

  assert.equal(execution.trace[1]?.executed, false);
  assert.equal(execution.trace[1]?.skippedReason, 'previous_succeeded');

  assert.equal(execution.trace[2]?.executed, true);
  assert.equal(execution.trace[2]?.exitCode, 1);
  assert.equal(execution.trace[2]?.commands[0]?.stderr, 'fail: forced failure');

  assert.equal(execution.trace[3]?.executed, false);
  assert.equal(execution.trace[3]?.skippedReason, 'previous_failed');

  assert.equal(execution.trace[4]?.executed, true);
  assert.deepEqual(execution.trace[4]?.commands[0]?.argv, ['echo', 'final']);
  assert.equal(execution.presentation.stdoutMode, 'plain');
  assert.match(execution.presentation.text, /\[exit:0 \| /);
});

test('runDetailed captures unknown commands as structured failures', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
  });
  await runtime.initialize();

  const execution = await runtime.runDetailed('missingcmd arg');

  assert.equal(execution.exitCode, 127);
  assert.equal(execution.trace.length, 1);
  assert.deepEqual(execution.trace[0]?.commands[0]?.argv, ['missingcmd', 'arg']);
  assert.equal(execution.trace[0]?.commands[0]?.exitCode, 127);
  assert.match(execution.stderr, /unknown command: missingcmd/);
  assert.match(execution.presentation.body, /\[error] unknown command: missingcmd/);
});

test('runDetailed reports parse errors without command traces', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: [echo],
  });
  await runtime.initialize();

  const execution = await runtime.runDetailed('echo "unterminated');

  assert.equal(execution.exitCode, 2);
  assert.equal(execution.trace.length, 0);
  assert.equal(execution.stdout.length, 0);
  assert.match(execution.presentation.body, /\[error]/);
  assert.match(execution.presentation.text, /\[exit:2 \| /);
});

test('runDetailed exposes truncation metadata', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: [burst],
    outputLimits: { maxLines: 1, maxBytes: 1024 },
  });
  await runtime.initialize();

  const execution = await runtime.runDetailed('burst');

  assert.equal(execution.presentation.stdoutMode, 'truncated');
  assert.equal(execution.presentation.totalLines, 3);
  assert.ok((execution.presentation.totalBytes ?? 0) > 0);
  assert.equal(await runtime.ctx.vfs.exists(execution.presentation.savedPath ?? ''), true);
  assert.match(execution.presentation.body, /output truncated \(3 lines,/);
  assert.equal(textDecoder.decode(execution.stdout), 'first line\nsecond line\nthird line');
});

test('run returns the same presentation text exposed by runDetailed', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: [echo],
  });
  await runtime.initialize();

  const text = await runtime.run('echo hello world');
  const execution = await runtime.runDetailed('echo hello world');

  assert.equal(text, execution.presentation.text);
});

test('runDetailed exposes binary-guard metadata', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: [binary],
  });
  await runtime.initialize();

  const execution = await runtime.runDetailed('binary');

  assert.equal(execution.presentation.stdoutMode, 'binary-guard');
  assert.equal(execution.presentation.totalBytes, 4);
  assert.match(execution.presentation.savedPath ?? '', /\.bin$/);
  assert.equal(await runtime.ctx.vfs.exists(execution.presentation.savedPath ?? ''), true);
  assert.match(execution.presentation.body, /command produced binary output/);
  assert.deepEqual(Array.from(execution.stdout), [0, 1, 2, 3]);
});
