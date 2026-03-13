import { help } from 'one-tool';
import {
  createCommandConformanceCases,
  createTestCommandContext,
  createTestCommandRegistry,
  runRegisteredCommand,
  stdoutText,
} from 'one-tool/testing';
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

  printHeading(
    io,
    'Recipe: testing custom commands',
    'Use one-tool/testing to build a registry, execute commands directly, and generate metadata-driven conformance checks.',
  );
  io.write(`Conformance cases: ${cases.length}`);
  io.write(`First case: ${cases[0]?.commandName} — ${cases[0]?.name}`);
  await cases[0]?.run();

  const { result } = await runRegisteredCommand('ticket', ['lookup', 'TICKET-123'], {
    ctx: createTestCommandContext({ registry }),
  });
  io.write(`\nDirect command result\n${stdoutText(result)}`);
}

await runIfEntrypoint(import.meta.url, main);
