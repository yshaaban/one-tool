import {
  type AgentCLI,
  type CommandResult,
  MemoryVFS,
  cat,
  createAgentCLI,
  err,
  head,
  help,
  json,
  ok,
  type CommandContext,
  type CommandSpec,
  write,
} from '../src/index.js';

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

const TICKETS: TicketRecord[] = [
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
];

function findTicket(id: string): TicketRecord | undefined {
  return TICKETS.find(function (ticket) {
    return ticket.id === id;
  });
}

function renderOpenTickets(): string {
  return TICKETS.filter(function (ticket) {
    return ticket.status === 'open';
  })
    .map(function (ticket) {
      return `${ticket.id}\t${ticket.priority}\t${ticket.title}`;
    })
    .join('\n');
}

async function cmdTicket(_ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('ticket: does not accept stdin');
  }

  const action = args[0];
  if (action === 'lookup') {
    const ticketId = args[1];
    if (ticketId === undefined || args.length !== 2) {
      return err('ticket: usage: ticket lookup <ticket-id>');
    }

    const ticket = findTicket(ticketId);
    if (!ticket) {
      return err(`ticket: ticket not found: ${ticketId}`);
    }

    return ok(JSON.stringify(ticket, null, 2), { contentType: 'application/json' });
  }

  if (action === 'list') {
    if (args.length > 2) {
      return err('ticket: usage: ticket list [--open]');
    }
    if (args.length === 2 && args[1] !== '--open') {
      return err('ticket: usage: ticket list [--open]');
    }
    if (args[1] === '--open') {
      return ok(renderOpenTickets());
    }

    return ok(
      TICKETS.map(function (ticket) {
        return `${ticket.id}\t${ticket.status}\t${ticket.title}`;
      }).join('\n'),
    );
  }

  return err('ticket: usage: ticket <lookup <ticket-id> | list [--open]>');
}

const ticket: CommandSpec = {
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

async function runExample(runtime: AgentCLI, command: string): Promise<void> {
  console.log(`\n$ ${command}`);
  console.log(await runtime.run(command));
}

async function main(): Promise<void> {
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: [help, cat, write, head, json, ticket],
  });

  console.log('Custom command example');
  console.log('----------------------');
  console.log('This runtime exposes a custom ticket command plus a small built-in subset.');
  console.log(runtime.buildToolDescription());

  await runExample(runtime, 'help ticket');
  await runExample(runtime, 'ticket lookup TICKET-123 | json get status');
  await runExample(runtime, 'ticket list --open | head -n 2');
  await runExample(runtime, 'ticket lookup TICKET-123 | write /reports/ticket-123.json');
  await runExample(runtime, 'cat /reports/ticket-123.json | json get customer.email');
}

await main();
