import {
  MemoryVFS,
  SimpleMemory,
  createAgentCLI,
  type FetchAdapter,
  type FetchResponse,
  type SearchAdapter,
  type SearchHit,
} from '@onetool/one-tool';

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from './_example-utils.js';

const DEMO_DOCS: readonly SearchHit[] = Object.freeze([
  {
    title: 'Refund timeout playbook',
    snippet: 'Refund timeout incidents require a payment trace, customer contact, and follow-up summary.',
    source: 'kb://incidents/refund-timeout',
  },
  {
    title: 'Billing escalation checklist',
    snippet: 'Collect order id, customer email, region, and invoice context before escalating to billing.',
    source: 'kb://billing-checklist',
  },
]);

const DEMO_RESOURCES: Readonly<Record<string, unknown>> = Object.freeze({
  'kb://incidents/refund-timeout': {
    title: 'Refund timeout playbook',
    summary: 'Refund timeout incidents require a payment trace, customer contact, and follow-up summary.',
    guidance: [
      'Reduce aggressive retries against the order service.',
      'Watch payment timeout rate during deploys.',
      'Escalate to checkout on-call if timeout rate exceeds 2%.',
    ],
  },
  'order:123': {
    id: '123',
    amount: 1499,
    customer: {
      email: 'buyer@acme.example',
    },
  },
});

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map(function (term) {
      return term.trim();
    })
    .filter(Boolean);
}

class DemoSearch implements SearchAdapter {
  async search(query: string, limit = 10): Promise<SearchHit[]> {
    const queryTerms = tokenizeQuery(query);
    return DEMO_DOCS.filter(function (doc) {
      const haystack = `${doc.title}\n${doc.snippet}`.toLowerCase();
      return queryTerms.every(function (term) {
        return haystack.includes(term);
      });
    }).slice(0, limit);
  }
}

class DemoFetch implements FetchAdapter {
  async fetch(resource: string): Promise<FetchResponse> {
    if (!Object.hasOwn(DEMO_RESOURCES, resource)) {
      throw new Error(`resource not found: ${resource}`);
    }

    return {
      contentType: 'application/json',
      payload: structuredClone(DEMO_RESOURCES[resource]),
    };
  }
}

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    memory: new SimpleMemory(),
    adapters: {
      search: new DemoSearch(),
      fetch: new DemoFetch(),
    },
  });

  io.write('05 · Adapters');
  io.write(
    'Register search and fetch adapters to bring external retrieval into the same run(command) surface.',
  );

  for (const command of [
    'search "refund timeout" | head -n 1',
    'fetch order:123 | json get customer.email',
    'fetch order:123 | json get amount',
    'fetch kb://incidents/refund-timeout | json get guidance[0]',
    'search "refund timeout" | write /reports/refund.txt && cat /reports/refund.txt',
    'memory store "Refund timeout owner: buyer@acme.example"',
    'memory search refund',
  ]) {
    io.write(`\n$ ${command}`);
    io.write(await runtime.run(command));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
