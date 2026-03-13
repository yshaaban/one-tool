import type { SearchAdapter, SearchHit, FetchAdapter, FetchResponse } from 'one-tool/browser';

export interface DemoSearchDoc {
  title: string;
  body: string;
  source: string;
}

function clonePayload(payload: unknown): unknown {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload);
  }
  return JSON.parse(JSON.stringify(payload)) as unknown;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 1),
  );
}

export class DemoSearch implements SearchAdapter {
  private docs: DemoSearchDoc[];

  constructor(docs: DemoSearchDoc[]) {
    this.docs = [...docs];
  }

  async search(query: string, limit = 10): Promise<SearchHit[]> {
    const queryTokens = tokenize(query);
    const scored: Array<{ score: number; hit: SearchHit }> = [];

    for (const doc of this.docs) {
      const tokens = tokenize(`${doc.title} ${doc.body}`);
      let overlap = 0;
      for (const t of queryTokens) {
        if (tokens.has(t)) overlap++;
      }
      if (overlap === 0) continue;

      let snippet = doc.body.replace(/\s+/g, ' ').trim();
      if (snippet.length > 160) snippet = snippet.slice(0, 157) + '...';

      scored.push({ score: overlap, hit: { title: doc.title, snippet, source: doc.source } });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((e) => e.hit);
  }
}

export class DemoFetch implements FetchAdapter {
  private resources: Record<string, unknown>;

  constructor(resources: Record<string, unknown>) {
    this.resources = { ...resources };
  }

  async fetch(resource: string): Promise<FetchResponse> {
    if (!(resource in this.resources)) {
      throw new Error(`resource not found: ${resource}`);
    }
    const payload = this.resources[resource];
    if (typeof payload === 'string') {
      return { contentType: 'text/plain', payload };
    }
    return { contentType: 'application/json', payload: clonePayload(payload) };
  }
}
