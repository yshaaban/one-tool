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
  const dbName = createExampleDbName('one-tool-browser-notebook');

  await ensureIndexedDbSupport();

  try {
    const firstVfs = await BrowserVFS.open(dbName);
    const firstRuntime = await createAgentCLI({
      vfs: firstVfs,
      builtinCommands: { preset: 'filesystem' },
    });

    printHeading(
      io,
      'Application: browser notebook',
      'Persist notes across sessions with BrowserVFS. This pattern maps directly to browser-based personal workspaces.',
    );
    await runCommandSequence(io, firstRuntime, [
      'write /notes/daily.md "Investigate refund timeout queue"',
      'append /notes/daily.md "Owner: sara@example.com"',
      'find /notes --type file',
    ]);
    firstVfs.close();

    const secondVfs = await BrowserVFS.open(dbName);
    const secondRuntime = await createAgentCLI({
      vfs: secondVfs,
      builtinCommands: { preset: 'filesystem' },
    });
    await runCommandSequence(io, secondRuntime, ['cat /notes/daily.md', 'wc -w /notes/daily.md']);
    secondVfs.close();
  } finally {
    await BrowserVFS.destroy(dbName);
  }
}

await runIfEntrypoint(import.meta.url, main);
