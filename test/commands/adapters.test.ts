import assert from 'node:assert/strict';
import test from 'node:test';

import { textEncoder } from '../../src/types.js';
import { makeCtx, runCommand, stdoutText } from './harness.js';

test('adapters: search reports missing adapters and formats hits', async () => {
  const missing = await runCommand('search', ['refund']);
  assert.equal(missing.result.exitCode, 1);
  assert.match(missing.result.stderr, /search: no search adapter configured/);

  const ctx = makeCtx({
    adapters: {
      search: {
        async search() {
          return [
            {
              title: 'Refund timeout incident',
              source: 'kb://incidents/123',
              snippet: 'Retry payments after the gateway timeout clears.',
            },
          ];
        },
      },
    },
  });
  const { result } = await runCommand('search', ['refund', 'timeout'], { ctx });
  assert.equal(result.exitCode, 0);
  assert.match(stdoutText(result), /1\. Refund timeout incident/);
  assert.match(stdoutText(result), /source: kb:\/\/incidents\/123/);
});

test('adapters: search renders an explicit empty result state', async () => {
  const ctx = makeCtx({
    adapters: {
      search: {
        async search() {
          return [];
        },
      },
    },
  });
  const { result } = await runCommand('search', ['refund'], { ctx });
  assert.equal(result.exitCode, 0);
  assert.equal(stdoutText(result), '(no results)');
});

test('adapters: search maps adapter errors instead of throwing', async () => {
  const ctx = makeCtx({
    adapters: {
      search: {
        async search() {
          throw new Error('search backend unavailable');
        },
      },
    },
  });

  const { result } = await runCommand('search', ['refund'], { ctx });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /search: adapter error: search backend unavailable/);
});

test('adapters: fetch reports missing adapters and renders JSON payloads', async () => {
  const missing = await runCommand('fetch', ['order:123']);
  assert.equal(missing.result.exitCode, 1);
  assert.match(missing.result.stderr, /fetch: no fetch adapter configured/);

  const ctx = makeCtx({
    adapters: {
      fetch: {
        async fetch() {
          return {
            contentType: 'application/json',
            payload: { account: 'Acme', active: true },
          };
        },
      },
    },
  });
  const { result } = await runCommand('fetch', ['order:123'], { ctx });
  assert.equal(result.exitCode, 0);
  assert.equal(result.contentType, 'application/json');
  assert.match(stdoutText(result), /"account": "Acme"/);
});

test('adapters: fetch renders text payloads unchanged', async () => {
  const ctx = makeCtx({
    adapters: {
      fetch: {
        async fetch() {
          return {
            contentType: 'text/plain',
            payload: 'hello world',
          };
        },
      },
    },
  });
  const { result } = await runCommand('fetch', ['message:1'], { ctx });
  assert.equal(result.exitCode, 0);
  assert.equal(result.contentType, 'text/plain');
  assert.equal(stdoutText(result), 'hello world');
});

test('adapters: fetch returns raw byte payloads to the runtime layer', async () => {
  const bytes = textEncoder.encode('payload');
  const ctx = makeCtx({
    adapters: {
      fetch: {
        async fetch() {
          return {
            contentType: 'application/octet-stream',
            payload: bytes,
          };
        },
      },
    },
  });
  const { result } = await runCommand('fetch', ['blob:1'], { ctx });
  assert.equal(result.exitCode, 0);
  assert.equal(result.contentType, 'application/octet-stream');
  assert.deepEqual(result.stdout, bytes);
});

test('adapters: fetch maps not-found and generic adapter errors', async () => {
  const notFoundCtx = makeCtx({
    adapters: {
      fetch: {
        async fetch() {
          throw new Error('resource not found');
        },
      },
    },
  });
  const notFound = await runCommand('fetch', ['order:404'], { ctx: notFoundCtx });
  assert.equal(notFound.result.exitCode, 1);
  assert.match(notFound.result.stderr, /fetch: resource not found: order:404/);

  const genericCtx = makeCtx({
    adapters: {
      fetch: {
        async fetch() {
          throw new Error('gateway timeout');
        },
      },
    },
  });
  const generic = await runCommand('fetch', ['order:500'], { ctx: genericCtx });
  assert.equal(generic.result.exitCode, 1);
  assert.match(generic.result.stderr, /fetch: adapter error: gateway timeout/);

  const codedNotFoundCtx = makeCtx({
    adapters: {
      fetch: {
        async fetch() {
          const error = new Error('missing order') as Error & { code?: string };
          error.code = 'NOT_FOUND';
          throw error;
        },
      },
    },
  });
  const codedNotFound = await runCommand('fetch', ['order:404'], { ctx: codedNotFoundCtx });
  assert.equal(codedNotFound.result.exitCode, 1);
  assert.match(codedNotFound.result.stderr, /fetch: resource not found: order:404/);

  const statusNotFoundCtx = makeCtx({
    adapters: {
      fetch: {
        async fetch() {
          const error = new Error('missing order') as Error & { status?: number };
          error.status = 404;
          throw error;
        },
      },
    },
  });
  const statusNotFound = await runCommand('fetch', ['order:404'], { ctx: statusNotFoundCtx });
  assert.equal(statusNotFound.result.exitCode, 1);
  assert.match(statusNotFound.result.stderr, /fetch: resource not found: order:404/);
});
