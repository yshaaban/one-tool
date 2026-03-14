import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import 'fake-indexeddb/auto';

import { buildDemoRuntime } from '@onetool/one-tool/testing';
import { BrowserVFS, MemoryVFS } from '../src/index.js';

async function withNodeRuntime(
  runTest: (runtime: Awaited<ReturnType<typeof buildDemoRuntime>>) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cli-agent-runtime-ts-'));
  try {
    const runtime = await buildDemoRuntime({ rootDir: root });
    await runTest(runtime);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withMemoryRuntime(
  runTest: (runtime: Awaited<ReturnType<typeof buildDemoRuntime>>) => Promise<void>,
): Promise<void> {
  const runtime = await buildDemoRuntime({ vfs: new MemoryVFS() });
  await runTest(runtime);
}

let browserDbCounter = 0;

async function withBrowserRuntime(
  runTest: (runtime: Awaited<ReturnType<typeof buildDemoRuntime>>) => Promise<void>,
): Promise<void> {
  const dbName = `runtime-browser-db-${Date.now()}-${browserDbCounter++}`;
  const vfs = await BrowserVFS.open(dbName);
  try {
    const runtime = await buildDemoRuntime({ vfs });
    await runTest(runtime);
  } finally {
    vfs.close();
    await BrowserVFS.destroy(dbName);
  }
}

const backends = [
  { name: 'NodeVFS', withRuntime: withNodeRuntime },
  { name: 'MemoryVFS', withRuntime: withMemoryRuntime },
  { name: 'BrowserVFS', withRuntime: withBrowserRuntime },
] as const;

for (const backend of backends) {
  test(`${backend.name}: counts error lines through a pipeline`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('cat /logs/app.log | grep -c ERROR');
      assert.match(output, /^3\b/m);
      assert.match(output, /\[exit:0 \| /);
    });
  });

  test(`${backend.name}: extracts JSON fields from fetch output`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('fetch order:123 | json get customer.email');
      assert.match(output, /buyer@acme\.example/);
      assert.match(output, /\[exit:0 \| /);
    });
  });

  test(`${backend.name}: falls back through || when the first command fails`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('cat /missing.txt || cat /config/default.json');
      assert.match(output, /"env": "default"/);
      assert.match(output, /\[exit:0 \| /);
    });
  });

  test(`${backend.name}: finds matching files and sorts the results`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('find /config --type file --name "*.json" | sort');
      assert.match(output, /\/config\/default\.json/);
      assert.match(output, /\/config\/prod\.json/);
      assert.match(output, /\[exit:0 \| /);
    });
  });

  test(`${backend.name}: counts discovered files through wc`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('find /config --type file --name "*.json" | wc -w');
      assert.match(output, /^2$/m);
      assert.match(output, /\[exit:0 \| /);
    });
  });

  test(`${backend.name}: writes and reads emulated local files without a shell`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('write /tmp/hello.txt hello && cat /tmp/hello.txt');
      assert.match(output, /hello/);
    });
  });

  test(`${backend.name}: rejects write with no content`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('write /tmp/empty.txt');
      assert.match(output, /write: no content provided/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: rejects append with no content`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('append /tmp/empty.txt');
      assert.match(output, /append: no content provided/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: writes piped stdin content to a file`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('fetch text:runbook | write /tmp/runbook.txt && cat /tmp/runbook.txt');
      assert.match(output, /Escalate payment timeouts to the checkout on-call/);
      assert.match(output, /\[exit:0 \| /);
    });
  });

  test(`${backend.name}: appends piped stdin content to a file`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run(
        'write /tmp/notes.txt start && fetch text:runbook | append /tmp/notes.txt && cat /tmp/notes.txt',
      );
      assert.match(output, /start/);
      assert.match(output, /Escalate payment timeouts to the checkout on-call/);
      assert.match(output, /\[exit:0 \| /);
    });
  });

  test(`${backend.name}: guards binary output and suggests inspection`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('cat /images/logo.png');
      assert.match(output, /binary file/);
      assert.match(output, /Use: stat \/images\/logo\.png/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports write parent-not-directory errors cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('write /blocked file && write /blocked/child.txt nope');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /write: parent is not a directory: \/blocked/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports append parent-not-directory errors cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('write /blocked file && append /blocked/child.txt nope');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /append: parent is not a directory: \/blocked/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports write-to-directory errors cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('mkdir /dir && write /dir nope');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /write: path is a directory: \/dir\. Use: ls \/dir/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports mkdir collisions cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('write /taken file && mkdir /taken');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /mkdir: path already exists: \/taken/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports mkdir parent-not-directory errors cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('write /blocked file && mkdir /blocked/child');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /mkdir: parent is not a directory: \/blocked/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports copy parent-not-directory errors cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('write /blocked file && write /src hi && cp /src /blocked/child.txt');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /cp: parent is not a directory: \/blocked/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports move parent-not-directory errors cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('write /blocked file && write /src hi && mv /src /blocked/child.txt');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /mv: parent is not a directory: \/blocked/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports subtree copy errors cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('mkdir /src && cp /src /src/sub');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /cp: destination is inside the source directory: \/src\/sub/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports subtree move errors cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('mkdir /src && mv /src /src/sub');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /mv: destination is inside the source directory: \/src\/sub/);
      assert.match(output, /\[exit:1 \| /);
    });
  });

  test(`${backend.name}: reports root delete protection cleanly`, async () => {
    await backend.withRuntime(async (runtime) => {
      const output = await runtime.run('rm /');
      assert.doesNotMatch(output, /internal runtime error/);
      assert.match(output, /rm: cannot delete root: \//);
      assert.match(output, /\[exit:1 \| /);
    });
  });
}
