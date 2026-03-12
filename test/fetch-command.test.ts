import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentCLI, MemoryVFS } from '../src/index.js';

async function runFetch(payload: unknown, contentType = 'text/plain'): Promise<string> {
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
    adapters: {
      fetch: {
        async fetch() {
          return { contentType, payload };
        },
      },
    },
  });

  return runtime.run('fetch sample');
}

test('fetch renders string payloads unchanged', async () => {
  const output = await runFetch('hello world');
  assert.match(output, /^hello world\b/m);
  assert.match(output, /\[exit:0 \| /);
});

test('fetch renders numeric payloads as strings', async () => {
  const output = await runFetch(42, 'application/json');
  assert.match(output, /^42\b/m);
  assert.match(output, /\[exit:0 \| /);
});

test('fetch renders boolean payloads as strings', async () => {
  const output = await runFetch(false, 'application/json');
  assert.match(output, /^false\b/m);
  assert.match(output, /\[exit:0 \| /);
});

test('fetch renders null payloads as null', async () => {
  const output = await runFetch(null, 'application/json');
  assert.match(output, /^null\b/m);
  assert.match(output, /\[exit:0 \| /);
});

test('fetch renders undefined payloads as null', async () => {
  const output = await runFetch(undefined, 'application/json');
  assert.match(output, /^null\b/m);
  assert.match(output, /\[exit:0 \| /);
});

test('fetch pretty-prints object payloads', async () => {
  const output = await runFetch({ account: 'Acme', active: true }, 'application/json');
  assert.match(output, /"account": "Acme"/);
  assert.match(output, /"active": true/);
  assert.match(output, /\[exit:0 \| /);
});

test('fetch pretty-prints array payloads', async () => {
  const output = await runFetch(['a', 'b'], 'application/json');
  assert.match(output, /\[\n {2}"a",\n {2}"b"\n\]/);
  assert.match(output, /\[exit:0 \| /);
});

test('fetch returns textual byte payloads directly', async () => {
  const output = await runFetch(new TextEncoder().encode('bytes payload'), 'application/octet-stream');
  assert.match(output, /^bytes payload\b/m);
  assert.match(output, /\[exit:0 \| /);
});

test('fetch routes binary byte payloads through the runtime binary guard', async () => {
  const output = await runFetch(new Uint8Array([0, 1, 2, 3]), 'application/octet-stream');
  assert.match(output, /command produced binary output that should not be sent to the model/);
  assert.match(output, /Saved to: \/.system\/cmd-output\/cmd-0001\.bin/);
  assert.match(output, /Use: stat \/.system\/cmd-output\/cmd-0001\.bin/);
  assert.match(output, /\[exit:0 \| /);
});
