import assert from 'node:assert/strict';
import test from 'node:test';

import { SimpleMemory } from '../src/memory.js';

function withMockedNow(run: () => void): void {
  const originalNow = Date.now;
  let current = 1_700_000_000_000;
  Date.now = function (): number {
    current += 1;
    return current;
  };

  try {
    run();
  } finally {
    Date.now = originalNow;
  }
}

test('SimpleMemory.store returns items with incrementing ids and timestamps', function (): void {
  withMockedNow(function (): void {
    const memory = new SimpleMemory();

    const first = memory.store('first note');
    const second = memory.store('second note', { source: 'demo' });

    assert.equal(first.id, 1);
    assert.equal(first.text, 'first note');
    assert.equal(typeof first.createdEpochMs, 'number');
    assert.deepEqual(first.metadata, {});

    assert.equal(second.id, 2);
    assert.equal(second.text, 'second note');
    assert.ok(second.createdEpochMs > first.createdEpochMs);
    assert.deepEqual(second.metadata, { source: 'demo' });
  });
});

test('SimpleMemory.recent returns the newest items first', function (): void {
  withMockedNow(function (): void {
    const memory = new SimpleMemory();
    memory.store('one');
    memory.store('two');
    memory.store('three');

    assert.deepEqual(
      memory.recent(2).map(function (item) {
        return item.text;
      }),
      ['three', 'two'],
    );
  });
});

test('SimpleMemory.recent returns all items when the limit exceeds the total', function (): void {
  withMockedNow(function (): void {
    const memory = new SimpleMemory();
    memory.store('one');
    memory.store('two');

    assert.deepEqual(
      memory.recent(10).map(function (item) {
        return item.text;
      }),
      ['two', 'one'],
    );
  });
});

test('SimpleMemory.search finds items by token overlap', function (): void {
  withMockedNow(function (): void {
    const memory = new SimpleMemory();
    memory.store('Acme payment timeout incident');
    memory.store('Quarterly business review notes');

    assert.deepEqual(
      memory.search('payment').map(function (item) {
        return item.text;
      }),
      ['Acme payment timeout incident'],
    );
  });
});

test('SimpleMemory.search ranks by overlap score and then recency', function (): void {
  withMockedNow(function (): void {
    const memory = new SimpleMemory();
    memory.store('acme payment timeout');
    memory.store('acme timeout');
    memory.store('payment timeout');

    assert.deepEqual(
      memory.search('acme payment timeout').map(function (item) {
        return item.text;
      }),
      ['acme payment timeout', 'payment timeout', 'acme timeout'],
    );
  });
});

test('SimpleMemory.search falls back to recent when the query is empty', function (): void {
  withMockedNow(function (): void {
    const memory = new SimpleMemory();
    memory.store('one');
    memory.store('two');

    assert.deepEqual(
      memory.search('').map(function (item) {
        return item.text;
      }),
      ['two', 'one'],
    );
  });
});

test('SimpleMemory.search returns an empty array when nothing matches', function (): void {
  withMockedNow(function (): void {
    const memory = new SimpleMemory();
    memory.store('acme renewal');

    assert.deepEqual(memory.search('vat invoice'), []);
  });
});
