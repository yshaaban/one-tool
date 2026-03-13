import { createAgentCLI } from 'one-tool';
import { BrowserVFS } from 'one-tool/vfs/browser';

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from './_example-utils.js';

async function ensureIndexedDbSupport(): Promise<void> {
  if ('indexedDB' in globalThis) {
    return;
  }

  await import('fake-indexeddb/auto');
}

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const dbName = `one-tool-browser-persistence-${crypto.randomUUID()}`;

  await ensureIndexedDbSupport();

  try {
    const firstVfs = await BrowserVFS.open(dbName);
    const firstRuntime = await createAgentCLI({
      vfs: firstVfs,
      builtinCommands: { preset: 'filesystem' },
    });

    io.write('06 · Browser persistence');
    io.write(
      'BrowserVFS stores workspace state in IndexedDB. This Node example uses fake-indexeddb to show the same pattern.',
    );

    for (const command of ['write /notes/summary.txt "key findings"', 'ls /notes']) {
      io.write(`\n$ ${command}`);
      io.write(await firstRuntime.run(command));
    }

    firstVfs.close();

    const secondVfs = await BrowserVFS.open(dbName);
    const secondRuntime = await createAgentCLI({
      vfs: secondVfs,
      builtinCommands: { preset: 'filesystem' },
    });

    io.write('\n$ cat /notes/summary.txt');
    io.write(await secondRuntime.run('cat /notes/summary.txt'));
    secondVfs.close();
  } finally {
    await BrowserVFS.destroy(dbName);
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
