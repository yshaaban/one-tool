import {
  type CommandContext,
  type CommandResult,
  type CommandSpec,
  MemoryVFS,
  cat,
  createAgentCLI,
  err,
  head,
  help,
  json,
  ok,
  write,
} from 'one-tool';
import { collectCommands, stdinNotAcceptedError, usageError } from 'one-tool/extensions';

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from './_example-utils.js';

interface TicketRecord {
  id: string;
  status: 'open' | 'pending';
  priority: 'high' | 'medium';
  customer: {
    email: string;
  };
  title: string;
}

const tickets: readonly TicketRecord[] = Object.freeze([
  {
    id: 'TICKET-123',
    status: 'open',
    priority: 'high',
    customer: {
      email: 'ops@acme.example',
    },
    title: 'Refund timeout on enterprise checkout',
  },
  {
    id: 'TICKET-124',
    status: 'pending',
    priority: 'medium',
    customer: {
      email: 'billing@northwind.example',
    },
    title: 'Invoice export missing VAT fields',
  },
]);

function findTicket(id: string): TicketRecord | undefined {
  return tickets.find(function (ticket) {
    return ticket.id === id;
  });
}

async function cmdTicket(_ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return stdinNotAcceptedError('ticket');
  }

  const action = args[0];
  switch (action) {
    case 'lookup': {
      const ticketId = args[1];
      if (ticketId === undefined || args.length !== 2) {
        return usageError('ticket', 'ticket lookup <ticket-id>');
      }

      const ticket = findTicket(ticketId);
      if (!ticket) {
        return err(`ticket: ticket not found: ${ticketId}`);
      }

      return ok(JSON.stringify(ticket, null, 2), {
        contentType: 'application/json',
      });
    }
    case 'list': {
      const listMode = args[1];
      if (args.length > 2 || (listMode !== undefined && listMode !== '--open')) {
        return usageError('ticket', 'ticket list [--open]');
      }

      const visibleTickets =
        listMode === '--open'
          ? tickets.filter(function (ticket) {
              return ticket.status === 'open';
            })
          : tickets;
      const rows = visibleTickets
        .map(function (ticket) {
          return `${ticket.id}\t${ticket.priority}\t${ticket.title}`;
        })
        .join('\n');
      return ok(rows);
    }
    default:
      return usageError('ticket', 'ticket <lookup <ticket-id> | list [--open]>');
  }
}

const ticket: CommandSpec = {
  name: 'ticket',
  summary: 'Inspect a small mock support queue.',
  usage: 'ticket <lookup <ticket-id> | list [--open]>',
  details:
    'Examples:\n' +
    '  ticket lookup TICKET-123\n' +
    '  ticket lookup TICKET-123 | json get status\n' +
    '  ticket list --open | head -n 2',
  handler: cmdTicket,
  acceptsStdin: false,
  minArgs: 1,
  maxArgs: 2,
  conformanceArgs: ['lookup', 'TICKET-123'],
};

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: collectCommands([help, cat, write, head, json, ticket]),
  });

  io.write('02 · Custom command');
  io.write('Add one domain command and compose it with built-ins.');

  for (const command of [
    'help ticket',
    'ticket lookup TICKET-123 | json get status',
    'ticket list --open | head -n 2',
    'ticket lookup TICKET-123 | write /reports/ticket-123.json',
    'cat /reports/ticket-123.json | json get customer.email',
  ]) {
    io.write(`\n$ ${command}`);
    io.write(await runtime.run(command));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
