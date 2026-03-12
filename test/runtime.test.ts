import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { buildDemoRuntime } from '../src/demo-runtime.js';

async function withRuntime(runTest: (runtime: Awaited<ReturnType<typeof buildDemoRuntime>>) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cli-agent-runtime-ts-'));
  try {
    const runtime = await buildDemoRuntime(root);
    await runTest(runtime);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('counts error lines through a pipeline', async () => {
  await withRuntime(async (runtime) => {
    const output = await runtime.run('cat /logs/app.log | grep -c ERROR');
    assert.match(output, /^3\b/m);
    assert.match(output, /\[exit:0 \| /);
  });
});

test('extracts JSON fields from fetch output', async () => {
  await withRuntime(async (runtime) => {
    const output = await runtime.run('fetch order:123 | json get customer.email');
    assert.match(output, /buyer@acme\.example/);
    assert.match(output, /\[exit:0 \| /);
  });
});

test('falls back through || when the first command fails', async () => {
  await withRuntime(async (runtime) => {
    const output = await runtime.run('cat /missing.txt || cat /config/default.json');
    assert.match(output, /"env": "default"/);
    assert.match(output, /\[exit:0 \| /);
  });
});

test('writes and reads emulated local files without a shell', async () => {
  await withRuntime(async (runtime) => {
    const output = await runtime.run('write /tmp/hello.txt hello && cat /tmp/hello.txt');
    assert.match(output, /hello/);
  });
});

test('guards binary output and suggests inspection', async () => {
  await withRuntime(async (runtime) => {
    const output = await runtime.run('cat /images/logo.png');
    assert.match(output, /binary file/);
    assert.match(output, /Use: stat \/images\/logo\.png/);
    assert.match(output, /\[exit:1 \| /);
  });
});
