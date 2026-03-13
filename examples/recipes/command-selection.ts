import { createAgentCLI, MemoryVFS, createCommandRegistry, listBuiltinCommands } from 'one-tool';
import { collectCommands } from 'one-tool/extensions';

import { ticketCommands } from '../shared/support-ticket.js';
import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const full = listBuiltinCommands();
  const readOnly = listBuiltinCommands({ preset: 'readOnly' });
  const selectedRegistry = createCommandRegistry({
    includeGroups: ['system', 'text'],
    excludeCommands: ['memory'],
  });
  const customOnlyRuntime = await createAgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: collectCommands([ticketCommands]),
  });

  printHeading(
    io,
    'Recipe: command selection',
    'Start from presets, then refine with groups, exclusions, or custom-only runtimes.',
  );
  io.write(`full preset: ${full.length} commands`);
  io.write(
    `readOnly preset: ${readOnly
      .map(function (spec) {
        return spec.name;
      })
      .join(', ')}`,
  );
  io.write(`system+text without memory: ${selectedRegistry.names().join(', ')}`);
  io.write(`custom-only runtime: ${customOnlyRuntime.registry.names().join(', ')}`);
}

await runIfEntrypoint(import.meta.url, main);
