import type { MemoryItem } from './types.js';
import { tokenizeForSearch } from './utils.js';

export class SimpleMemory {
  private items: MemoryItem[] = [];
  private nextId = 1;

  store(text: string, metadata: Record<string, unknown> = {}): MemoryItem {
    const item: MemoryItem = {
      id: this.nextId,
      text,
      createdEpochMs: Date.now(),
      metadata,
    };
    this.nextId += 1;
    this.items.push(item);
    return item;
  }

  recent(limit = 10): MemoryItem[] {
    return [...this.items.slice(-limit)].reverse();
  }

  search(query: string, limit = 10): MemoryItem[] {
    const queryTokens = tokenizeForSearch(query);
    if (queryTokens.size === 0) {
      return this.recent(limit);
    }

    const scored: Array<{ score: number; item: MemoryItem }> = [];
    for (const item of this.items) {
      const itemTokens = tokenizeForSearch(item.text);
      let overlap = 0;
      for (const token of queryTokens) {
        if (itemTokens.has(token)) {
          overlap += 1;
        }
      }
      if (overlap > 0) {
        scored.push({ score: overlap, item });
      }
    }

    scored.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.item.createdEpochMs - left.item.createdEpochMs;
    });

    return scored.slice(0, limit).map((entry) => entry.item);
  }
}
