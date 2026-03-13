import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NO_STDIN,
  createCommandConformanceCases,
  createTestCommandContext,
  createTestCommandRegistry,
  runRegisteredCommand,
  stdinText,
  stdoutText,
  type CommandSpec,
} from '../src/index.js';
import { ok } from '../src/types.js';

const echo: CommandSpec = {
  name: 'echo',
  summary: 'Echo text.',
  usage: 'echo <text...>',
  details: 'Examples:\n  echo hello',
  async handler(_ctx, args) {
    return ok(args.join(' '));
  },
};

test('createTestCommandRegistry supports the same selection API as runtime registries', function (): void {
  const registry = createTestCommandRegistry({
    preset: 'textOnly',
    commands: [echo],
    onConflict: 'replace',
  });

  assert.deepEqual(registry.names(), ['echo', 'grep', 'head', 'help', 'sort', 'tail', 'uniq', 'wc']);
});

test('createTestCommandContext and runRegisteredCommand provide a stable public harness', async function (): Promise<void> {
  const registry = createTestCommandRegistry({
    includeGroups: ['system'],
    excludeCommands: ['memory'],
    commands: [echo],
  });
  const ctx = createTestCommandContext({ registry });
  const { result } = await runRegisteredCommand('echo', ['hello', 'world'], { ctx, stdin: NO_STDIN });

  assert.equal(result.exitCode, 0);
  assert.equal(stdoutText(result), 'hello world');
  assert.deepEqual(Array.from(stdinText('ok')), [111, 107]);
});

test('conformance helper works with the stable public testing harness', async function (): Promise<void> {
  const registry = createTestCommandRegistry({
    includeGroups: ['system'],
    excludeCommands: ['memory'],
    commands: [echo],
  });
  const cases = createCommandConformanceCases({
    registry,
    makeCtx: createTestCommandContext,
  }).filter(function (conformanceCase) {
    return conformanceCase.commandName === 'echo';
  });

  assert.ok(cases.length >= 3);
  for (const conformanceCase of cases) {
    await conformanceCase.run();
  }
});

test('runRegisteredCommand isolates callers from argument mutation', async function (): Promise<void> {
  const mutating: CommandSpec = {
    name: 'mutate',
    summary: 'Mutate args.',
    usage: 'mutate <value>',
    details: 'Examples:\n  mutate hello',
    async handler(_ctx, args) {
      args[0] = 'changed';
      return ok(args.join(' '));
    },
  };
  const inputArgs = ['original'];
  const registry = createTestCommandRegistry({
    includeGroups: [],
    commands: [mutating],
  });
  const ctx = createTestCommandContext({ registry });

  const { result } = await runRegisteredCommand('mutate', inputArgs, { ctx });
  assert.equal(stdoutText(result), 'changed');
  assert.deepEqual(inputArgs, ['original']);
});
