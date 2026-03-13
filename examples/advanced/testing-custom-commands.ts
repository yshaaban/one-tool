import { help } from '@onetool/one-tool';
import {
  createCommandConformanceCases,
  createTestCommandContext,
  createTestCommandRegistry,
  runRegisteredCommand,
  stdoutText,
} from '@onetool/one-tool/testing';
import {
  collectCommands,
  defineCommandGroup,
  stdinNotAcceptedError,
  usageError,
} from '@onetool/one-tool/extensions';
import { type CommandContext, type CommandResult, type CommandSpec, ok } from '@onetool/one-tool';

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from '../_example-utils.js';

async function cmdTicket(_ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return stdinNotAcceptedError('ticket');
  }
  if (args[0] !== 'lookup' || args[1] !== 'TICKET-123' || args.length !== 2) {
    return usageError('ticket', 'ticket lookup <ticket-id>');
  }
  return ok(
    JSON.stringify(
      {
        id: 'TICKET-123',
        status: 'open',
      },
      null,
      2,
    ),
    { contentType: 'application/json' },
  );
}

const ticket: CommandSpec = {
  name: 'ticket',
  summary: 'Inspect a mock support ticket.',
  usage: 'ticket lookup <ticket-id>',
  details: 'Example:\n  ticket lookup TICKET-123',
  handler: cmdTicket,
  acceptsStdin: false,
  minArgs: 2,
  maxArgs: 2,
  conformanceArgs: ['lookup', 'TICKET-123'],
};

const ticketCommands = defineCommandGroup('support', [ticket]);

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const registry = createTestCommandRegistry({
    includeGroups: ['system'],
    commands: collectCommands([help, ticketCommands]),
    onConflict: 'replace',
  });

  const cases = createCommandConformanceCases({
    registry,
    strictMetadata: true,
    makeCtx(overrides) {
      return createTestCommandContext({
        registry,
        ...overrides,
      });
    },
  });

  io.write('Advanced · Testing custom commands');
  io.write(
    'Use @onetool/one-tool/testing to create registries, run commands directly, and generate conformance cases.',
  );
  io.write(`Conformance cases: ${cases.length}`);
  io.write(`First case: ${cases[0]?.commandName} — ${cases[0]?.name}`);
  await cases[0]?.run();

  const { result } = await runRegisteredCommand('ticket', ['lookup', 'TICKET-123'], {
    ctx: createTestCommandContext({ registry }),
  });
  io.write(`\nDirect command result\n${stdoutText(result)}`);
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
