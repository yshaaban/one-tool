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

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from '../_example-utils.js';

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
  details: 'Examples:\n  help\n  help grep',
  handler: customHelpHandler,
  acceptsStdin: false,
  minArgs: 0,
  maxArgs: 1,
  conformanceArgs: [],
};

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const registry = createCommandRegistry({ preset: 'textOnly' });
  registerCommands(registry, [customHelp], { onConflict: 'replace' });
  registry.unregister('tail');

  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    registry,
  });

  io.write('Advanced · Command overrides');
  io.write('Own the registry directly when you need to replace or remove built-ins.');

  for (const command of ['help', 'tail -n 2']) {
    io.write(`\n$ ${command}`);
    io.write(await runtime.run(command));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
