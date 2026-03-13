import { MemoryVFS, buildToolDefinition, createAgentCLI } from '@onetool/one-tool';

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from '../_example-utils.js';

function preview(description: string): string {
  return description.split('\n').slice(0, 4).join('\n');
}

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: { preset: 'textOnly' },
  });

  io.write('Advanced · Prompt variants');
  io.write('Compare full, minimal, and terse tool descriptions for evaluation work.');

  for (const variant of ['full-tool-description', 'minimal-tool-description', 'terse'] as const) {
    const tool = buildToolDefinition(runtime, 'run', {
      descriptionVariant: variant,
    });
    io.write(`\n${variant}`);
    io.write(preview(tool.function.description));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
