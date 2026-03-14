import {
  BrowserVFS,
  MemoryVFS,
  SimpleMemory,
  cat,
  createAgentCLI,
  err,
  head,
  help,
  json,
  ok,
  write,
  type AgentCLI,
  type AgentCLIOptions,
  type CommandContext,
  type CommandResult,
  type CommandSpec,
} from '@onetool/one-tool/browser';
import type { ExampleRuntimeKind } from '../examples/types';
import { DemoFetch, DemoSearch } from './adapters';

const APP_LOG = [
  '2026-03-12T10:00:01Z INFO startup complete',
  '2026-03-12T10:01:10Z ERROR payment timeout order=123',
  '2026-03-12T10:01:11Z ERROR payment timeout order=124',
  '2026-03-12T10:01:12Z WARN retry scheduled order=124',
  '2026-03-12T10:02:10Z ERROR failed login user=alice',
  '2026-03-12T10:03:55Z INFO healthcheck ok',
  '',
].join('\n');

const DEFAULT_CONFIG = JSON.stringify({ env: 'default', retries: 3, region: 'us-east-1' }, null, 2) + '\n';

const ACME_ACCOUNT = [
  'Customer: Acme Corp',
  'Status: renewal at risk',
  'Owner: sara@example.com',
  'Notes: prefers Monday check-ins and a concise status summary.',
  '',
].join('\n');

const QBR_DRAFT = '# QBR draft\n\nOpen items:\n- Revenue variance\n- Renewal risk\n';

const SEARCH_DOCS = [
  {
    title: 'Refund timeout incident retro',
    body: 'Payment timeouts spiked during a deploy. Root cause was a retry storm against the order service.',
    source: 'kb://incidents/refund-timeout',
  },
  {
    title: 'Acme renewal risk notes',
    body: 'Acme wants a tighter weekly status update and is blocked on invoice mapping.',
    source: 'kb://accounts/acme-renewal',
  },
  {
    title: 'Login failure playbook',
    body: 'Repeated failed login errors can indicate bot traffic or a stale SSO configuration.',
    source: 'kb://security/login-failure-playbook',
  },
] as const;

const FETCH_RESOURCES: Record<string, unknown> = {
  'kb://incidents/refund-timeout': {
    title: 'Refund timeout incident retro',
    summary:
      'Payment timeouts spiked during a deploy. Root cause was a retry storm against the order service.',
    guidance: [
      'Reduce aggressive retries against the order service.',
      'Watch payment timeout rate during deploys.',
      'Escalate to checkout on-call if timeout rate exceeds 2%.',
    ],
  },
  'kb://accounts/acme-renewal': {
    title: 'Acme renewal risk notes',
    summary: 'Acme wants a tighter weekly status update and is blocked on invoice mapping.',
    guidance: ['Send a concise weekly update.', 'Resolve invoice mapping blockers before renewal review.'],
  },
  'kb://security/login-failure-playbook': {
    title: 'Login failure playbook',
    summary: 'Repeated failed login errors can indicate bot traffic or a stale SSO configuration.',
    guidance: ['Check SSO configuration drift.', 'Investigate bot traffic if failures spike.'],
  },
  'order:123': {
    id: '123',
    status: 'timed_out',
    customer: { name: 'Acme Corp', email: 'buyer@acme.example' },
    amount: 1499,
  },
  'crm/customer/acme': {
    id: 'cust_acme',
    owner: { name: 'Sara', email: 'sara@example.com' },
    tier: 'enterprise',
    renewal_month: '2026-04',
  },
};

const SITE_BROWSER_DB = 'one-tool-site-browser-example';

const ticketCommand: CommandSpec = {
  name: 'ticket',
  summary: 'Inspect a small mock support queue.',
  usage: 'ticket <lookup <ticket-id> | list [--open]>',
  details:
    'Examples:\n' +
    '  ticket lookup TICKET-123\n' +
    '  ticket lookup TICKET-123 | json get status\n' +
    '  ticket list --open | head -n 2',
  acceptsStdin: false,
  minArgs: 1,
  maxArgs: 2,
  handler: cmdTicket,
};

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
    customer: { email: 'ops@acme.example' },
    priority: 'high',
    title: 'Refund timeout on enterprise checkout',
  },
  {
    id: 'TICKET-124',
    status: 'pending',
    customer: { email: 'billing@northwind.example' },
    priority: 'medium',
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
    return err('ticket: does not accept stdin');
  }

  const action = args[0];
  switch (action) {
    case 'lookup': {
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
    case 'list': {
      const listMode = args[1];
      if (args.length > 2 || (listMode !== undefined && listMode !== '--open')) {
        return err('ticket: usage: ticket list [--open]');
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
      return err('ticket: usage: ticket <lookup <ticket-id> | list [--open]>');
  }
}

function createDemoMemory(): SimpleMemory {
  const memory = new SimpleMemory();
  memory.store('Acme prefers Monday follow-ups.');
  memory.store('Refund incident touched payments, billing, and checkout.');
  return memory;
}

function createDemoAdapters(): { search: DemoSearch; fetch: DemoFetch } {
  return {
    search: new DemoSearch([...SEARCH_DOCS]),
    fetch: new DemoFetch(FETCH_RESOURCES),
  };
}

async function seedDemoVfs(vfs: MemoryVFS): Promise<void> {
  const encoder = new TextEncoder();

  await vfs.mkdir('/logs', true);
  await vfs.writeBytes('/logs/app.log', encoder.encode(APP_LOG));
  await vfs.mkdir('/config', true);
  await vfs.writeBytes('/config/default.json', encoder.encode(DEFAULT_CONFIG));
  await vfs.mkdir('/accounts', true);
  await vfs.writeBytes('/accounts/acme.md', encoder.encode(ACME_ACCOUNT));
  await vfs.mkdir('/drafts', true);
  await vfs.writeBytes('/drafts/qbr.md', encoder.encode(QBR_DRAFT));
  await vfs.mkdir('/notes', true);
  await vfs.mkdir('/images', true);
  await vfs.writeBytes('/images/logo.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]));
}

export async function createDemoRuntime(): Promise<AgentCLI> {
  const vfs = new MemoryVFS();
  await seedDemoVfs(vfs);
  return createAgentCLI(createSeededMemoryOptions(vfs, true));
}

function createSeededMemoryOptions(vfs: MemoryVFS, withAdapters: boolean): AgentCLIOptions {
  return {
    vfs,
    memory: createDemoMemory(),
    ...(withAdapters ? { adapters: createDemoAdapters() } : {}),
  };
}

export async function createEmptyRuntime(): Promise<AgentCLI> {
  return createAgentCLI({ vfs: new MemoryVFS() });
}

export async function createCustomCommandRuntime(): Promise<AgentCLI> {
  return createAgentCLI({
    vfs: new MemoryVFS(),
    builtinCommands: false,
    commands: [help, cat, write, head, json, ticketCommand],
  });
}

export async function createReadonlyRuntime(): Promise<AgentCLI> {
  const vfs = new MemoryVFS();
  await seedDemoVfs(vfs);
  return createAgentCLI({
    ...createSeededMemoryOptions(vfs, false),
    builtinCommands: { preset: 'readOnly' },
  });
}

export async function createBrowserPersistenceRuntime(): Promise<AgentCLI> {
  const vfs = await BrowserVFS.open(SITE_BROWSER_DB);
  return createAgentCLI({ vfs });
}

export async function createRuntimeForExample(kind: ExampleRuntimeKind): Promise<AgentCLI> {
  switch (kind) {
    case 'empty':
      return createEmptyRuntime();
    case 'demo':
      return createDemoRuntime();
    case 'custom-command':
      return createCustomCommandRuntime();
    case 'readOnly':
      return createReadonlyRuntime();
    case 'browser-persistence':
      return createBrowserPersistenceRuntime();
  }
}

export function closeRuntime(runtime: AgentCLI | null | undefined): void {
  const vfs = runtime?.ctx.vfs;
  if (vfs && 'close' in vfs && typeof vfs.close === 'function') {
    vfs.close();
  }
}
