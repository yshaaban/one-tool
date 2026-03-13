import { type CommandContext, type CommandResult, type CommandSpec, err, ok } from 'one-tool';
import { defineCommandGroup, stdinNotAcceptedError, usageError } from 'one-tool/extensions';

interface TicketRecord {
  id: string;
  status: 'open' | 'pending' | 'closed';
  priority: 'low' | 'medium' | 'high';
  customer: {
    name: string;
    email: string;
  };
  title: string;
  updatedAt: string;
}

export const TICKETS: readonly TicketRecord[] = Object.freeze([
  {
    id: 'TICKET-123',
    status: 'open',
    priority: 'high',
    customer: {
      name: 'Acme Corp',
      email: 'ops@acme.example',
    },
    title: 'Refund timeout on enterprise checkout',
    updatedAt: '2026-03-13T09:15:00Z',
  },
  {
    id: 'TICKET-124',
    status: 'pending',
    priority: 'medium',
    customer: {
      name: 'Northwind',
      email: 'billing@northwind.example',
    },
    title: 'Invoice export missing VAT fields',
    updatedAt: '2026-03-13T08:42:00Z',
  },
  {
    id: 'TICKET-125',
    status: 'open',
    priority: 'medium',
    customer: {
      name: 'Globex',
      email: 'support@globex.example',
    },
    title: 'Repeated failed login alerts after SSO rotation',
    updatedAt: '2026-03-13T07:05:00Z',
  },
]);

function findTicket(id: string): TicketRecord | undefined {
  return TICKETS.find(function (ticket) {
    return ticket.id === id;
  });
}

function renderTickets(records: readonly TicketRecord[]): string {
  return records
    .map(function (ticket) {
      return `${ticket.id}\t${ticket.priority}\t${ticket.title}`;
    })
    .join('\n');
}

async function cmdTicket(_ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return stdinNotAcceptedError('ticket');
  }

  const action = args[0];
  if (action === 'lookup') {
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

  if (action === 'list') {
    if (args.length > 2) {
      return usageError('ticket', 'ticket list [--open]');
    }
    if (args.length === 2 && args[1] !== '--open') {
      return usageError('ticket', 'ticket list [--open]');
    }

    if (args[1] === '--open') {
      return ok(
        renderTickets(
          TICKETS.filter(function (ticket) {
            return ticket.status === 'open';
          }),
        ),
      );
    }

    return ok(
      TICKETS.map(function (ticket) {
        return `${ticket.id}\t${ticket.status}\t${ticket.title}`;
      }).join('\n'),
    );
  }

  return usageError('ticket', 'ticket <lookup <ticket-id> | list [--open]>');
}

export const ticket: CommandSpec = {
  name: 'ticket',
  summary: 'Inspect a mock support queue with lookup and list commands.',
  usage: 'ticket <lookup <ticket-id> | list [--open]>',
  details:
    'Examples:\n' +
    '  ticket lookup TICKET-123\n' +
    '  ticket lookup TICKET-123 | json get status\n' +
    '  ticket list --open | head -n 5',
  handler: cmdTicket,
  acceptsStdin: false,
  minArgs: 1,
  maxArgs: 2,
  conformanceArgs: ['lookup', 'TICKET-123'],
};

export const ticketCommands = defineCommandGroup('support', [ticket]);
