import { type AgentCLI, MemoryVFS, cat, createAgentCLI, head, help, json, write } from 'one-tool';
import { collectCommands } from 'one-tool/extensions';

import { ticketCommands } from '../shared/support-ticket.js';
import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  runCommandExample,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

async function runExamples(io: ReturnType<typeof createExampleIO>, runtime: AgentCLI): Promise<void> {
  await runCommandExample(io, runtime, 'help ticket');
  await runCommandExample(io, runtime, 'ticket lookup TICKET-123 | json get status');
  await runCommandExample(io, runtime, 'ticket list --open | head -n 2');
  await runCommandExample(io, runtime, 'ticket lookup TICKET-123 | write /reports/ticket-123.json');
  await runCommandExample(io, runtime, 'cat /reports/ticket-123.json | json get customer.email');
}

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: collectCommands([help, cat, write, head, json, ticketCommands]),
  });

  printHeading(
    io,
    'Quickstart: custom command',
    'This runtime exposes one custom ticket command and a small built-in subset. It uses only the public one-tool and one-tool/extensions surfaces.',
  );
  io.write(runtime.buildToolDescription());
  await runExamples(io, runtime);
}

await runIfEntrypoint(import.meta.url, main);
