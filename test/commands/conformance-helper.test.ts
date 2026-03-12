import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommandRegistry, type CommandSpec } from '../../src/commands/index.js';
import { createCommandConformanceCases } from '../../src/testing/index.js';
import { err, ok } from '../../src/types.js';
import { makeCtx } from './harness.js';

const echo: CommandSpec = {
  name: 'echo',
  summary: 'Echo text back.',
  usage: 'echo <text...>',
  details: 'Examples:\n  echo hello',
  async handler(_ctx, args, stdin) {
    if (stdin.length > 0) {
      return err('echo: does not accept stdin');
    }
    if (args.length === 0) {
      return err('echo: usage: echo <text...>');
    }
    return ok(args.join(' '));
  },
};

test('createCommandConformanceCases works for custom commands without strict metadata', async function (): Promise<void> {
  const registry = createCommandRegistry({
    includeGroups: ['system'],
    excludeCommands: ['memory'],
    commands: [echo],
  });
  const cases = createCommandConformanceCases({
    registry,
    makeCtx,
  }).filter(function (conformanceCase) {
    return conformanceCase.commandName === 'echo';
  });

  assert.deepEqual(
    cases.map(function (conformanceCase) {
      return conformanceCase.name;
    }),
    [
      'has valid spec metadata',
      'representative call never throws',
      'error output references command name',
      'help entry exists',
    ],
  );

  for (const conformanceCase of cases) {
    await conformanceCase.run();
  }
});

test('createCommandConformanceCases can enforce strict metadata when desired', async function (): Promise<void> {
  const registry = createCommandRegistry({
    includeGroups: ['system'],
    excludeCommands: ['memory'],
    commands: [echo],
  });
  const metadataCase = createCommandConformanceCases({
    registry,
    makeCtx,
    strictMetadata: true,
  }).find(function (conformanceCase) {
    return conformanceCase.commandName === 'echo' && conformanceCase.name === 'has valid spec metadata';
  });

  assert.ok(metadataCase);
  await assert.rejects(async function (): Promise<void> {
    await metadataCase.run();
  }, /echo should declare acceptsStdin/);
});

test('createCommandConformanceCases supplies fallback args for adapter checks', async function (): Promise<void> {
  const searchOnly: CommandSpec = {
    name: 'lookup',
    summary: 'Lookup results.',
    usage: 'lookup <query>',
    details: 'Examples:\n  lookup renewals',
    requiresAdapter: 'search',
    minArgs: 1,
    async handler(ctx, args) {
      if (args.length === 0) {
        return err('lookup: usage: lookup <query>');
      }
      if (!ctx.adapters.search) {
        return err('lookup: no search adapter configured');
      }
      return ok('unused');
    },
  };

  const registry = createCommandRegistry({
    includeGroups: ['system'],
    excludeCommands: ['memory'],
    commands: [searchOnly],
  });
  const adapterCase = createCommandConformanceCases({
    registry,
    makeCtx,
  }).find(function (conformanceCase) {
    return (
      conformanceCase.commandName === 'lookup' && conformanceCase.name === 'reports missing search adapter'
    );
  });

  assert.ok(adapterCase);
  await adapterCase.run();
});
