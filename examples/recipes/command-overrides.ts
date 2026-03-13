import {
  type CommandContext,
  type CommandResult,
  type CommandSpec,
  MemoryVFS,
  createAgentCLI,
  createCommandRegistry,
  ok,
  registerCommands,
} from 'one-tool';

import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  runCommandSequence,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

async function customHelpHandler(
  ctx: CommandContext,
  args: string[],
  stdin: Uint8Array,
): Promise<CommandResult> {
  const requested = args[0] ?? '(all commands)';
  const stdinSummary = stdin.length > 0 ? 'stdin provided' : 'no stdin';
  return ok(
    `custom help surface\nrequested: ${requested}\ncommands: ${ctx.registry.names().join(', ')}\n${stdinSummary}`,
  );
}

const customHelp: CommandSpec = {
  name: 'help',
  summary: 'Render a custom help surface owned by the application.',
  usage: 'help [command]',
  details: 'Example:\n  help\n  help grep',
  handler: customHelpHandler,
  acceptsStdin: false,
  minArgs: 0,
  maxArgs: 1,
  conformanceArgs: [],
};

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const registry = createCommandRegistry({ preset: 'textOnly' });
  registerCommands(registry, [customHelp], { onConflict: 'replace' });
  registry.unregister('tail');

  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    registry,
  });

  printHeading(
    io,
    'Recipe: command overrides',
    'Use a caller-owned registry when you need exact command ownership. This example replaces help and removes tail.',
  );

  await runCommandSequence(io, runtime, ['help', 'tail -n 2']);
}

await runIfEntrypoint(import.meta.url, main);
