import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CommandRegistry,
  builtinCommandPresetNames,
  builtinCommandPresets,
  createCommandRegistry,
  listBuiltinCommands,
  registerBuiltinCommands,
  registerCommands,
  type CommandSpec,
} from '../../src/commands/index.js';
import { ok } from '../../src/types.js';
import { NO_STDIN, makeCtx, stdoutText } from './harness.js';

const customHelp: CommandSpec = {
  name: 'help',
  summary: 'Custom help summary.',
  usage: 'help',
  details: 'Examples:\n  help',
  async handler() {
    return ok('custom help');
  },
};

const echo: CommandSpec = {
  name: 'echo',
  summary: 'Echo text.',
  usage: 'echo <text...>',
  details: 'Examples:\n  echo hello',
  async handler(_ctx, args) {
    return ok(args.join(' '));
  },
};

test('createCommandRegistry supports group selection and command exclusion', function (): void {
  const registry = createCommandRegistry({
    includeGroups: ['system', 'text', 'text'],
    excludeCommands: ['memory'],
  });

  assert.deepEqual(registry.names(), ['grep', 'head', 'help', 'sort', 'tail', 'uniq', 'wc']);
  assert.deepEqual(
    listBuiltinCommands({ includeGroups: ['adapters'] }).map(function (spec) {
      return spec.name;
    }),
    ['search', 'fetch'],
  );
});

test('builtin command presets expose stable, useful default selections', function (): void {
  assert.deepEqual(builtinCommandPresetNames, ['full', 'readOnly', 'filesystem', 'textOnly', 'dataOnly']);
  assert.deepEqual(builtinCommandPresets.textOnly.excludeCommands, ['memory']);
  assert.equal(Object.isFrozen(builtinCommandPresetNames), true);
  assert.equal(Object.isFrozen(builtinCommandPresets), true);
  assert.equal(Object.isFrozen(builtinCommandPresets.textOnly.excludeCommands), true);

  assert.deepEqual(createCommandRegistry({ preset: 'readOnly' }).names(), [
    'calc',
    'cat',
    'fetch',
    'find',
    'grep',
    'head',
    'help',
    'json',
    'ls',
    'search',
    'sort',
    'stat',
    'tail',
    'uniq',
    'wc',
  ]);
  assert.deepEqual(createCommandRegistry({ preset: 'filesystem' }).names(), [
    'append',
    'cat',
    'cp',
    'find',
    'grep',
    'head',
    'help',
    'ls',
    'mkdir',
    'mv',
    'rm',
    'sort',
    'stat',
    'tail',
    'uniq',
    'wc',
    'write',
  ]);
  assert.deepEqual(
    listBuiltinCommands({ preset: 'dataOnly' }).map(function (spec) {
      return spec.name;
    }),
    ['help', 'search', 'fetch', 'json', 'calc'],
  );
});

test('createCommandRegistry rejects unknown builtin groups safely', function (): void {
  assert.throws(function (): CommandRegistry {
    return createCommandRegistry({
      includeGroups: ['__proto__' as never],
    });
  }, /unknown builtin command group: __proto__/);
});

test('createCommandRegistry rejects unknown builtin presets safely', function (): void {
  assert.throws(function (): CommandRegistry {
    return createCommandRegistry({
      preset: '__proto__' as never,
    });
  }, /unknown builtin command preset: __proto__/);
});

test('registerCommands can replace existing built-ins on conflict', async function (): Promise<void> {
  const registry = createCommandRegistry({ includeGroups: ['system'] });
  registerCommands(registry, [customHelp], { onConflict: 'replace' });

  const ctx = makeCtx({ registry });
  const result = await registry.get('help')!.handler(ctx, [], NO_STDIN);
  assert.equal(result.exitCode, 0);
  assert.equal(stdoutText(result), 'custom help');
});

test('registerBuiltinCommands supports conflict options on existing registries', async function (): Promise<void> {
  const registry = new CommandRegistry();
  registry.register(customHelp);

  registerBuiltinCommands(registry, { includeGroups: ['system'] }, { onConflict: 'skip' });
  let result = await registry.get('help')!.handler(makeCtx({ registry }), [], NO_STDIN);
  assert.equal(stdoutText(result), 'custom help');

  registerBuiltinCommands(registry, { includeGroups: ['system'] }, { onConflict: 'replace' });
  result = await registry.get('help')!.handler(makeCtx({ registry }), [], NO_STDIN);
  assert.notEqual(stdoutText(result), 'custom help');
});

test('CommandRegistry supports has, replace, and unregister', async function (): Promise<void> {
  const registry = new CommandRegistry();
  registry.register(echo);

  assert.equal(registry.has('echo'), true);
  assert.equal(registry.has('help'), false);

  const replaced: CommandSpec = {
    ...echo,
    async handler() {
      return ok('replaced');
    },
  };
  registry.replace(replaced);

  const result = await registry.get('echo')!.handler(makeCtx({ registry }), [], NO_STDIN);
  assert.equal(stdoutText(result), 'replaced');

  assert.equal(registry.unregister('echo'), true);
  assert.equal(registry.unregister('echo'), false);
  assert.equal(registry.has('echo'), false);
  assert.throws(function (): void {
    registry.replace(echo);
  }, /command not registered: echo/);
});
