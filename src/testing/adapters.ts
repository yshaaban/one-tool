import type { FetchAdapter, FetchResponse, SearchAdapter, SearchHit } from '../types.js';
import { compareCLocaleText, tokenizeForSearch } from '../utils.js';

export interface DemoSearchDocument {
  title: string;
  body: string;
  source: string;
}

interface ScoredSearchHit {
  score: number;
  hit: SearchHit;
}

export class DemoSearch implements SearchAdapter {
  private readonly docs: DemoSearchDocument[];

  constructor(docs: DemoSearchDocument[]) {
    this.docs = docs.map(cloneDemoSearchDocument);
  }

  async search(query: string, limit = 10): Promise<SearchHit[]> {
    const queryTokens = tokenizeForSearch(query);
    const scored: ScoredSearchHit[] = [];

    for (const doc of this.docs) {
      const overlap = countTokenOverlap(queryTokens, `${doc.title}\n${doc.body}`);
      if (overlap === 0) {
        continue;
      }

      scored.push({
        score: overlap,
        hit: {
          title: doc.title,
          snippet: truncateSnippet(doc.body),
          source: doc.source,
        },
      });
    }

    scored.sort(compareScoredSearchHits);
    return scored.slice(0, limit).map(function (entry) {
      return entry.hit;
    });
  }
}

export class DemoFetch implements FetchAdapter {
  private readonly resources: Record<string, unknown>;

  constructor(resources: Record<string, unknown>) {
    this.resources = cloneResourceMap(resources);
  }

  async fetch(resource: string): Promise<FetchResponse> {
    if (!Object.hasOwn(this.resources, resource)) {
      throw new Error(`resource not found: ${resource}`);
    }

    const payload = cloneDemoPayload(this.resources[resource]);
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

function cloneDemoSearchDocument(doc: DemoSearchDocument): DemoSearchDocument {
  return {
    title: doc.title,
    body: doc.body,
    source: doc.source,
  };
}

function countTokenOverlap(queryTokens: Set<string>, text: string): number {
  const tokens = tokenizeForSearch(text);
  let overlap = 0;

  for (const token of queryTokens) {
    if (tokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function truncateSnippet(body: string): string {
  const snippet = body.replace(/\s+/g, ' ').trim();
  if (snippet.length <= 160) {
    return snippet;
  }
  return `${snippet.slice(0, 157)}...`;
}

function compareScoredSearchHits(left: ScoredSearchHit, right: ScoredSearchHit): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return compareCLocaleText(left.hit.title, right.hit.title);
}

function cloneResourceMap(resources: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};

  for (const [resource, payload] of Object.entries(resources)) {
    clone[resource] = cloneDemoPayload(payload);
  }

  return clone;
}

function cloneDemoPayload(payload: unknown): unknown {
  if (payload instanceof Uint8Array) {
    return new Uint8Array(payload);
  }

  if (
    payload === null ||
    payload === undefined ||
    typeof payload === 'string' ||
    typeof payload === 'number' ||
    typeof payload === 'boolean'
  ) {
    return payload;
  }

  return structuredClone(payload);
}
