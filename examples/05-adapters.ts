import {
  MemoryVFS,
  SimpleMemory,
  createAgentCLI,
  type FetchAdapter,
  type FetchResponse,
  type SearchAdapter,
  type SearchHit,
} from 'one-tool';

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from './_example-utils.js';

const DEMO_DOCS: readonly SearchHit[] = Object.freeze([
  {
    title: 'Refund timeout playbook',
    snippet: 'Refund timeout incidents require a payment trace, customer contact, and follow-up summary.',
    source: 'kb://refund-timeout',
  },
  {
    title: 'Billing escalation checklist',
    snippet: 'Collect order id, customer email, region, and invoice context before escalating to billing.',
    source: 'kb://billing-checklist',
  },
]);

const DEMO_RESOURCES: Readonly<Record<string, unknown>> = Object.freeze({
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
    'search refund timeout',
    'fetch order:123 | json get customer.email',
    'fetch order:123 | json get amount',
    'memory store "Refund timeout owner: buyer@acme.example"',
    'memory search "refund timeout owner"',
  ]) {
    io.write(`\n$ ${command}`);
    io.write(await runtime.run(command));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
