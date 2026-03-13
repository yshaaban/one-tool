import { BrowserVFS } from 'one-tool/vfs/browser';
import { createAgentCLI } from 'one-tool';

import { createExampleDbName, ensureIndexedDbSupport } from '../shared/browser.js';
import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  runCommandSequence,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const dbName = createExampleDbName('one-tool-browser-vfs');

  await ensureIndexedDbSupport();

  try {
    const firstVfs = await BrowserVFS.open(dbName);
    const firstRuntime = await createAgentCLI({
      vfs: firstVfs,
      builtinCommands: { preset: 'filesystem' },
    });

    printHeading(
      io,
      'Recipe: BrowserVFS persistence',
      'In Node-based demos this recipe installs fake-indexeddb automatically. In a real browser, BrowserVFS uses the native IndexedDB implementation.',
    );
    await runCommandSequence(io, firstRuntime, [
      'write /notes/summary.txt "key findings persisted in IndexedDB"',
      'ls /notes',
    ]);

    firstVfs.close();

    const secondVfs = await BrowserVFS.open(dbName);
    const secondRuntime = await createAgentCLI({
      vfs: secondVfs,
      builtinCommands: { preset: 'filesystem' },
    });
    await runCommandSequence(io, secondRuntime, ['cat /notes/summary.txt']);
    secondVfs.close();
  } finally {
    await BrowserVFS.destroy(dbName);
  }
}

await runIfEntrypoint(import.meta.url, main);
