import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentCLI, CommandRegistry, type CommandSpec, createCommandRegistry } from '../src/index.js';
import { ok } from '../src/types.js';
import { MemoryVFS } from '../src/vfs/memory-vfs.js';

const echo: CommandSpec = {
  name: 'echo',
  summary: 'Echo text back.',
  usage: 'echo <text...>',
  details: 'Examples:\n  echo hello',
  async handler(_ctx, args) {
    if (args.length === 0) {
      return ok('');
    }
    return ok(args.join(' '));
  },
};

const overridingHelp: CommandSpec = {
  name: 'help',
  summary: 'Overridden help.',
  usage: 'help',
  details: 'Examples:\n  help',
  async handler() {
    return ok('override help');
  },
};

test('AgentCLI can start with a selective built-in set', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: {
      includeGroups: ['system', 'text'],
      excludeCommands: ['memory'],
    },
  });
  await runtime.initialize();

  assert.deepEqual(runtime.registry.names(), ['grep', 'head', 'help', 'tail']);
  assert.match(runtime.buildToolDescription(), /help/);
  assert.doesNotMatch(runtime.buildToolDescription(), /memory/);

  const result = await runtime.run('ls');
  assert.match(result, /unknown command: ls/);
});

test('AgentCLI can run with only custom commands and no built-ins', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: [echo],
  });
  await runtime.initialize();

  assert.deepEqual(runtime.registry.names(), ['echo']);
  assert.doesNotMatch(runtime.buildToolDescription(), /run 'help' to list commands/);

  const result = await runtime.run('echo hello world');
  assert.match(result, /^hello world/m);
});

test('AgentCLI reports an empty registry clearly', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
  });
  await runtime.initialize();

  assert.match(runtime.buildToolDescription(), /\(no commands registered\)/);
  assert.match(runtime.buildToolDescription(), /Register built-in or custom commands/);

  const result = await runtime.run('echo hello');
  assert.match(result, /unknown command: echo/);
  assert.match(result, /Available: \(none\)/);
});

test('AgentCLI extra commands replace built-ins by default', async function (): Promise<void> {
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    commands: [overridingHelp],
  });
  await runtime.initialize();

  const result = await runtime.run('help');
  assert.match(result, /^override help/m);
});

test('AgentCLI can use a caller-owned registry', async function (): Promise<void> {
  const registry = createCommandRegistry({
    includeGroups: ['system'],
    excludeCommands: ['memory'],
    commands: [echo],
  });
  const runtime = new AgentCLI({
    vfs: new MemoryVFS(),
    registry,
  });
  await runtime.initialize();

  assert.equal(runtime.registry, registry);
  assert.deepEqual(runtime.registry.names(), ['echo', 'help']);
});

test('AgentCLI rejects mixing registry with other registration options', function (): void {
  const registry = new CommandRegistry();

  assert.throws(function (): AgentCLI {
    return new AgentCLI({
      vfs: new MemoryVFS(),
      registry,
      commands: [echo],
    });
  }, /registry cannot be combined with commands/);

  assert.throws(function (): AgentCLI {
    return new AgentCLI({
      vfs: new MemoryVFS(),
      registry,
      builtinCommands: false,
    });
  }, /registry cannot be combined with builtinCommands/);
});
