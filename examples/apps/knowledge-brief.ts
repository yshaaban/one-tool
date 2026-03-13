import { createAgentCLI, MemoryVFS, SimpleMemory } from 'one-tool';
import { DemoFetch, DemoSearch } from 'one-tool/testing';

import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  runCommandSequence,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

const SEARCH_DOCS = [
  {
    title: 'EU VAT incident response',
    body: 'When invoice export misses VAT fields, create a fallback report and notify billing support.',
    source: 'kb://vat-incident',
  },
  {
    title: 'Refund timeout handling',
    body: 'Refund timeout events usually require a payment trace, a customer contact, and a short follow-up brief.',
    source: 'kb://refund-timeout',
  },
];

const FETCH_RESOURCES = {
  'account:acme': {
    owner: {
      name: 'Sara',
      email: 'sara@example.com',
    },
    plan: 'enterprise',
  },
  'order:123': {
    id: 'order:123',
    amount: 1499,
    customer: {
      email: 'buyer@acme.example',
    },
  },
};

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    memory: new SimpleMemory(),
    adapters: {
      search: new DemoSearch(SEARCH_DOCS),
      fetch: new DemoFetch(FETCH_RESOURCES),
    },
  });

  printHeading(
    io,
    'Application: knowledge brief',
    'Search internal docs, fetch structured records, and save a reusable brief for later runs.',
  );

  await runCommandSequence(io, runtime, [
    'search "refund timeout" | head -n 2',
    'fetch order:123 | json get customer.email',
    'fetch account:acme | json get owner.email',
    'search "refund timeout" | write /briefs/refund-timeout.md',
    'append /briefs/refund-timeout.md "Owner: sara@example.com"',
    'memory store "Refund timeout owner: sara@example.com"',
    'cat /briefs/refund-timeout.md',
  ]);
}

await runIfEntrypoint(import.meta.url, main);
