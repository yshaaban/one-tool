import { SimpleMemory } from '../memory.js';
import { textEncoder } from '../types.js';
import type { VFS } from '../vfs/interface.js';
import type { DemoSearchDocument } from './adapters.js';

export const TODO_TEXT = [
  '1. Review refund incident timeline',
  '2. Confirm Acme renewal owner',
  '3. Draft follow-up email',
  '',
].join('\n');

export const APP_LOG_TEXT = [
  '2026-03-12T10:00:01Z INFO startup complete',
  '2026-03-12T10:01:10Z ERROR payment timeout order=123',
  '2026-03-12T10:01:11Z ERROR payment timeout order=124',
  '2026-03-12T10:01:12Z WARN retry scheduled order=124',
  '2026-03-12T10:02:10Z ERROR failed login user=alice',
  '2026-03-12T10:03:55Z INFO healthcheck ok',
  '',
].join('\n');

export const DEFAULT_CONFIG_TEXT =
  JSON.stringify(
    {
      env: 'default',
      retries: 3,
      region: 'us-east-1',
    },
    null,
    2,
  ) + '\n';

export const PROD_CONFIG_TEXT =
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
  ) + '\n';

export const ACME_ACCOUNT_TEXT = [
  'Customer: Acme Corp',
  'Status: renewal at risk',
  'Owner: sara@example.com',
  'Notes: prefers Monday check-ins and a concise status summary.',
  '',
].join('\n');

export const QBR_DRAFT_TEXT = '# QBR draft\n\nOpen items:\n- Revenue variance\n- Renewal risk\n';

export const LOGO_PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

export const DEMO_FILES: Record<string, string | Uint8Array> = {
  '/notes/todo.txt': TODO_TEXT,
  '/logs/app.log': APP_LOG_TEXT,
  '/config/default.json': DEFAULT_CONFIG_TEXT,
  '/config/prod.json': PROD_CONFIG_TEXT,
  '/accounts/acme.md': ACME_ACCOUNT_TEXT,
  '/drafts/qbr.md': QBR_DRAFT_TEXT,
  '/images/logo.png': LOGO_PNG_BYTES,
};

export const DEMO_SEARCH_DOCS: DemoSearchDocument[] = [
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

export const DEMO_FETCH_RESOURCES: Record<string, unknown> = {
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

export const DEMO_MEMORY_ENTRIES = [
  'Acme prefers Monday follow-ups.',
  'Refund incident touched payments, billing, and checkout.',
  'Ops owner for production config is ops@example.com.',
];

export async function seedDemoVfs(vfs: VFS): Promise<void> {
  for (const [filePath, content] of Object.entries(DEMO_FILES)) {
    const bytes = content instanceof Uint8Array ? new Uint8Array(content) : textEncoder.encode(content);
    await vfs.writeBytes(filePath, bytes);
  }
}

export function seedDemoMemory(memory: SimpleMemory): void {
  for (const entry of DEMO_MEMORY_ENTRIES) {
    memory.store(entry);
  }
}

export function generateLargeLog(): string {
  const lines: string[] = [];
  const bobTimeoutLines = new Set<number>();

  for (let index = 0; index < 15; index += 1) {
    bobTimeoutLines.add(60 + index * 10);
  }

  for (let lineNumber = 1; lineNumber <= 300; lineNumber += 1) {
    const second = String((lineNumber - 1) % 60).padStart(2, '0');
    const minute = String(Math.floor((lineNumber - 1) / 60)).padStart(2, '0');
    const timestamp = `2026-03-12T12:${minute}:${second}Z`;

    if (bobTimeoutLines.has(lineNumber)) {
      lines.push(`${timestamp} ERROR timeout user=bob request=req-${String(lineNumber).padStart(4, '0')}`);
      continue;
    }

    if (lineNumber % 17 === 0) {
      lines.push(`${timestamp} WARN timeout user=carol request=req-${String(lineNumber).padStart(4, '0')}`);
      continue;
    }

    lines.push(`${timestamp} INFO heartbeat seq=${String(lineNumber).padStart(4, '0')}`);
  }

  lines.push('');
  return lines.join('\n');
}
