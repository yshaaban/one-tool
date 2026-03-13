import assert from 'node:assert/strict';
import test from 'node:test';

test('package exports resolve the documented entrypoints', async function (): Promise<void> {
  const root = await import('one-tool');
  const commands = await import('one-tool/commands');
  const extensions = await import('one-tool/extensions');
  const mcp = await import('one-tool/mcp');
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
  assert.equal(typeof root.find, 'object');
  assert.equal(typeof root.sort, 'object');
  assert.equal(typeof root.uniq, 'object');
  assert.equal(typeof root.wc, 'object');

  assert.equal(typeof commands.createCommandRegistry, 'function');
  assert.ok(Array.isArray(commands.fsCommands));
  assert.ok(Array.isArray(commands.textCommands));
  assert.ok(Array.isArray(commands.systemCommands));
  assert.ok(Array.isArray(commands.builtinCommandPresetNames));
  assert.equal(typeof commands.builtinCommandPresets, 'object');
  assert.equal(typeof commands.find, 'object');
  assert.equal(typeof commands.sort, 'object');
  assert.equal(typeof commands.uniq, 'object');
  assert.equal(typeof commands.wc, 'object');

  assert.equal(typeof extensions.collectCommands, 'function');
  assert.equal(typeof extensions.defineCommandGroup, 'function');
  assert.equal(typeof extensions.formatVfsError, 'function');
  assert.equal(typeof extensions.parseCountFlag, 'function');
  assert.equal(typeof extensions.readBytesInput, 'function');
  assert.equal(typeof extensions.readJsonInput, 'function');
  assert.equal(typeof extensions.readTextInput, 'function');
  assert.equal(typeof extensions.stdinNotAcceptedError, 'function');
  assert.equal(typeof extensions.usageError, 'function');

  assert.equal(typeof mcp.createMcpServer, 'function');
  assert.equal(typeof mcp.serveStdioMcpServer, 'function');

  assert.equal(typeof testing.createCommandConformanceCases, 'function');
  assert.equal(typeof testing.createTestCommandContext, 'function');
  assert.equal(typeof testing.createTestCommandRegistry, 'function');
  assert.equal(typeof testing.runRegisteredCommand, 'function');
  assert.equal(typeof testing.DemoSearch, 'function');
  assert.equal(typeof testing.DemoFetch, 'function');
  assert.equal(typeof testing.buildWorld, 'function');
  assert.equal(typeof testing.runOracle, 'function');
  assert.equal(typeof testing.assertScenario, 'function');
  assert.equal(typeof root.DemoSearch, 'function');
  assert.equal(typeof root.DemoFetch, 'function');
  assert.equal(typeof root.buildWorld, 'function');
  assert.equal(typeof root.runOracle, 'function');
  assert.equal(typeof root.assertScenario, 'function');
  assert.equal(typeof root.createMcpServer, 'function');
  assert.equal(typeof root.serveStdioMcpServer, 'function');

  assert.equal(typeof memoryVfs.MemoryVFS, 'function');
  assert.equal(typeof nodeVfs.NodeVFS, 'function');
  assert.equal(typeof browserVfs.BrowserVFS, 'function');
});
