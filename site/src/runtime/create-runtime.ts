import {
  BrowserVFS,
  MemoryVFS,
  SimpleMemory,
  createAgentCLI,
  err,
  help,
  json,
  ok,
  type AgentCLI,
  type AgentCLIOptions,
  type CommandContext,
  type CommandSpec,
} from 'one-tool/browser';
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
  summary: 'Look up a support ticket and return structured details.',
  usage: 'ticket lookup <ticket-id>',
  details: 'Examples:\n  ticket lookup T-123\n  ticket lookup T-456 | json get owner.email',
  acceptsStdin: false,
  minArgs: 2,
  handler: cmdTicket,
};

const tickets: Record<string, { id: string; status: string; owner: { email: string }; priority: string }> = {
  'T-123': {
    id: 'T-123',
    status: 'open',
    owner: { email: 'sara@example.com' },
    priority: 'high',
  },
  'T-456': {
    id: 'T-456',
    status: 'closed',
    owner: { email: 'ops@example.com' },
    priority: 'low',
  },
};

async function cmdTicket(_ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (stdin.length > 0) {
    return err('ticket: does not accept stdin');
  }

  if (args.length !== 2 || args[0] !== 'lookup') {
    return err('ticket: usage: ticket lookup <ticket-id>');
  }

  const ticket = tickets[args[1]!];
  if (!ticket) {
    return err(`ticket: ticket not found: ${args[1]!}`);
  }

  return ok(JSON.stringify(ticket, null, 2), { contentType: 'application/json' });
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
    commands: [help, json, ticketCommand],
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
