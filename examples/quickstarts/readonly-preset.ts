import { createAgentCLI, MemoryVFS } from 'one-tool';

import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  runCommandSequence,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const encoder = new TextEncoder();
  const vfs = new MemoryVFS();

  await vfs.mkdir('/notes', true);
  await vfs.writeBytes('/notes/readonly.txt', encoder.encode('This workspace is preloaded and read-only.'));

  const runtime = await createAgentCLI({
    vfs,
    builtinCommands: { preset: 'readOnly' },
  });

  printHeading(
    io,
    'Quickstart: read-only preset',
    'Use the built-in readOnly preset when the agent should inspect state but not mutate files or memory.',
  );
  io.write(`Commands: ${runtime.registry.names().join(', ')}`);

  await runCommandSequence(io, runtime, [
    'cat /notes/readonly.txt',
    'write /notes/new.txt "this should fail"',
  ]);
}

await runIfEntrypoint(import.meta.url, main);
