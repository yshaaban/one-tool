import { MemoryVFS, cat, createAgentCLI, head, help, json, memory, write } from 'one-tool';
import { collectCommands } from 'one-tool/extensions';

import { ticketCommands } from '../shared/support-ticket.js';
import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  runCommandSequence,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: collectCommands([help, cat, head, json, memory, write, ticketCommands]),
  });

  printHeading(
    io,
    'Application: support desk',
    'A focused support workflow with a custom ticket command, report writing, and working-memory handoff notes.',
  );

  await runCommandSequence(io, runtime, [
    'ticket list --open | head -n 2',
    'ticket lookup TICKET-123 | json get customer.email',
    'ticket lookup TICKET-123 | write /reports/ticket-123.json',
    'cat /reports/ticket-123.json | json get title',
    'memory store "Escalate TICKET-123 with Acme after refund timeout review."',
    'memory search "Acme refund timeout"',
  ]);
}

await runIfEntrypoint(import.meta.url, main);
