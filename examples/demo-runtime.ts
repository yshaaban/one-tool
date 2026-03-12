import { createAgentCLI, type AgentCLI, type VFS, NodeVFS, SimpleMemory } from '../src/index.js';
import { DemoFetch, DemoSearch } from './demo-adapters.js';

export async function seedVfs(vfs: VFS): Promise<void> {
  await vfs.writeBytes(
    '/notes/todo.txt',
    new TextEncoder().encode(
      [
        '1. Review refund incident timeline',
        '2. Confirm Acme renewal owner',
        '3. Draft follow-up email',
        '',
      ].join('\n'),
    ),
  );

  await vfs.writeBytes(
    '/logs/app.log',
    new TextEncoder().encode(
      [
        '2026-03-12T10:00:01Z INFO startup complete',
        '2026-03-12T10:01:10Z ERROR payment timeout order=123',
        '2026-03-12T10:01:11Z ERROR payment timeout order=124',
        '2026-03-12T10:01:12Z WARN retry scheduled order=124',
        '2026-03-12T10:02:10Z ERROR failed login user=alice',
        '2026-03-12T10:03:55Z INFO healthcheck ok',
        '',
      ].join('\n'),
    ),
  );

  await vfs.writeBytes(
    '/config/default.json',
    new TextEncoder().encode(
      JSON.stringify(
        {
          env: 'default',
          retries: 3,
          region: 'us-east-1',
        },
        null,
        2,
      ) + '\n',
    ),
  );

  await vfs.writeBytes(
    '/config/prod.json',
    new TextEncoder().encode(
      JSON.stringify(
        {
          env: 'prod',
          retries: 5,
          region: 'eu-west-1',
          owner: {
            email: 'ops@example.com',
          },
        },
        null,
        2,
      ) + '\n',
    ),
  );

  await vfs.writeBytes(
    '/accounts/acme.md',
    new TextEncoder().encode(
      [
        'Customer: Acme Corp',
        'Status: renewal at risk',
        'Owner: sara@example.com',
        'Notes: prefers Monday check-ins and a concise status summary.',
        '',
      ].join('\n'),
    ),
  );

  await vfs.mkdir('/drafts', true);
  await vfs.writeBytes(
    '/drafts/qbr.md',
    new TextEncoder().encode('# QBR draft\n\nOpen items:\n- Revenue variance\n- Renewal risk\n'),
  );

  await vfs.writeBytes('/images/logo.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]));
}

export function seedMemory(memory: SimpleMemory): void {
  memory.store('Acme prefers Monday follow-ups.');
  memory.store('Refund incident touched payments, billing, and checkout.');
  memory.store('Ops owner for production config is ops@example.com.');
}

export async function buildDemoRuntime(rootDir = './agent_state'): Promise<AgentCLI> {
  const vfs = new NodeVFS(rootDir);
  await seedVfs(vfs);

  const searchDocs = [
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
      title: 'EU VAT invoice checklist',
      body: 'Collect legal entity name, billing address, VAT ID, and invoice delivery contact before issuing invoices.',
      source: 'kb://finance/eu-vat-checklist',
    },
    {
      title: 'Login failure playbook',
      body: 'Repeated failed login errors can indicate bot traffic or a stale SSO configuration.',
      source: 'kb://security/login-failure-playbook',
    },
  ];

  const fetchResources: Record<string, unknown> = {
    'order:123': {
      id: '123',
      status: 'timed_out',
      customer: {
        name: 'Acme Corp',
        email: 'buyer@acme.example',
      },
      amount: 1499,
    },
    'crm/customer/acme': {
      id: 'cust_acme',
      owner: {
        name: 'Sara',
        email: 'sara@example.com',
      },
      tier: 'enterprise',
      renewal_month: '2026-04',
    },
    'text:runbook': 'Escalate payment timeouts to the checkout on-call if the error rate exceeds 2%.',
  };

  const memory = new SimpleMemory();
  seedMemory(memory);

  const runtime = await createAgentCLI({
    vfs,
    adapters: {
      search: new DemoSearch(searchDocs),
      fetch: new DemoFetch(fetchResources),
    },
    memory,
  });

  return runtime;
}
