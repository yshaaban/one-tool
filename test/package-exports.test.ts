import assert from 'node:assert/strict';
import test from 'node:test';

test('package exports resolve the documented entrypoints', async function (): Promise<void> {
  const root = await import('one-tool');
  const commands = await import('one-tool/commands');
  const testing = await import('one-tool/testing');
  const memoryVfs = await import('one-tool/vfs/memory');
  const nodeVfs = await import('one-tool/vfs/node');
  const browserVfs = await import('one-tool/vfs/browser');

  assert.equal(typeof root.createAgentCLI, 'function');
  assert.equal(typeof root.createCommandRegistry, 'function');
  assert.equal(typeof root.createCommandConformanceCases, 'function');
  assert.equal(typeof root.createTestCommandContext, 'function');
  assert.equal(typeof root.createTestCommandRegistry, 'function');
  assert.ok(Array.isArray(root.builtinCommandPresetNames));
  assert.equal(typeof root.builtinCommandPresets, 'object');

  assert.equal(typeof commands.createCommandRegistry, 'function');
  assert.ok(Array.isArray(commands.fsCommands));
  assert.ok(Array.isArray(commands.textCommands));
  assert.ok(Array.isArray(commands.systemCommands));
  assert.ok(Array.isArray(commands.builtinCommandPresetNames));
  assert.equal(typeof commands.builtinCommandPresets, 'object');

  assert.equal(typeof testing.createCommandConformanceCases, 'function');
  assert.equal(typeof testing.createTestCommandContext, 'function');
  assert.equal(typeof testing.createTestCommandRegistry, 'function');
  assert.equal(typeof testing.runRegisteredCommand, 'function');

  assert.equal(typeof memoryVfs.MemoryVFS, 'function');
  assert.equal(typeof nodeVfs.NodeVFS, 'function');
  assert.equal(typeof browserVfs.BrowserVFS, 'function');
});
