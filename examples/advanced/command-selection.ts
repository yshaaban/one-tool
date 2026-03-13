import { MemoryVFS, createAgentCLI, createCommandRegistry } from 'one-tool';

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from '../_example-utils.js';

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: {
      includeGroups: ['system', 'text'],
      excludeCommands: ['memory'],
    },
  });
  const registryOnly = createCommandRegistry({
    includeGroups: ['system', 'fs'],
    excludeCommands: ['rm'],
  });

  io.write('Advanced · Command selection');
  io.write('Select built-ins by preset, group, and exclusion instead of exposing the full command surface.');
  io.write(`Runtime commands: ${runtime.registry.names().join(', ')}`);
  io.write(`Registry-only example: ${registryOnly.names().join(', ')}`);

  for (const command of ['help grep', 'tail -n 1', 'memory recent', 'rm /notes/todo.txt']) {
    io.write(`\n$ ${command}`);
    io.write(await runtime.run(command));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
