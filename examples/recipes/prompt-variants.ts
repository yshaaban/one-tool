import { buildToolDefinition, createAgentCLI, MemoryVFS } from 'one-tool';

import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

function preview(description: string): string {
  return description.split('\n').slice(0, 4).join('\n');
}

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: { preset: 'textOnly' },
  });

  printHeading(
    io,
    'Recipe: prompt variants',
    'Use full, minimal, and terse descriptions when evaluating how much command detail your model needs.',
  );

  for (const variant of ['full-tool-description', 'minimal-tool-description', 'terse'] as const) {
    const tool = buildToolDefinition(runtime, 'run', {
      descriptionVariant: variant,
    });
    io.write(`\n${variant}`);
    io.write(preview(tool.function.description));
  }
}

await runIfEntrypoint(import.meta.url, main);
