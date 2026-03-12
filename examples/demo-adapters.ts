import type { FetchAdapter, FetchResponse, SearchAdapter, SearchHit } from '../src/index.js';

function tokenizeForSearch(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(matches);
}

export class DemoSearch implements SearchAdapter {
  private readonly docs: Array<Record<string, string>>;

  constructor(docs: Array<Record<string, string>>) {
    this.docs = [...docs];
  }

  async search(query: string, limit = 10): Promise<SearchHit[]> {
    const queryTokens = tokenizeForSearch(query);
    const scored: Array<{ score: number; hit: SearchHit }> = [];

    for (const doc of this.docs) {
      const title = doc.title ?? 'untitled';
      const body = doc.body ?? '';
      const source = doc.source ?? '';
      const tokens = tokenizeForSearch(`${title}\n${body}`);
      let overlap = 0;
      for (const token of queryTokens) {
        if (tokens.has(token)) {
          overlap += 1;
        }
      }
      if (overlap === 0) {
        continue;
      }

      let snippet = body.replace(/\s+/g, ' ').trim();
      if (snippet.length > 160) {
        snippet = `${snippet.slice(0, 157)}...`;
      }

      scored.push({
        score: overlap,
        hit: {
          title,
          snippet,
          source,
        },
      });
    }

    scored.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.hit.title.localeCompare(right.hit.title);
    });

    return scored.slice(0, limit).map((entry) => entry.hit);
  }
}

export class DemoFetch implements FetchAdapter {
  private readonly resources: Record<string, unknown>;

  constructor(resources: Record<string, unknown>) {
    this.resources = { ...resources };
  }

  async fetch(resource: string): Promise<FetchResponse> {
    if (!(resource in this.resources)) {
      throw new Error(`resource not found: ${resource}`);
    }

    const payload = this.resources[resource];
    if (payload instanceof Uint8Array) {
      return {
        contentType: 'application/octet-stream',
        payload,
      };
    }
    if (typeof payload === 'string') {
      return {
        contentType: 'text/plain',
        payload,
      };
    }
    return {
      contentType: 'application/json',
      payload,
    };
  }
}
