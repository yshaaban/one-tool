import { buildToolDefinition, createAgentCLI, NodeVFS } from 'one-tool';

import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  runCommandSequence,
  type ExampleRunOptions,
} from '../shared/example-utils.js';
import { withTempDir } from '../shared/temp-dir.js';

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);

  await withTempDir('one-tool-node-basic', async function (rootDir): Promise<void> {
    const runtime = await createAgentCLI({
      vfs: new NodeVFS(rootDir),
    });

    const tool = buildToolDefinition(runtime);

    printHeading(
      io,
      'Quickstart: Node runtime',
      'This is the smallest end-to-end setup: create the runtime, run a few commands, and build the model-facing tool definition.',
    );
    io.write(`Tool: ${tool.function.name}`);
    io.write(`Description preview: ${tool.function.description.split('\n')[0] ?? '(empty)'}`);

    await runCommandSequence(io, runtime, [
      'write /notes/hello.txt "hello from one-tool"',
      'ls /notes',
      'cat /notes/hello.txt',
    ]);
  });
}

await runIfEntrypoint(import.meta.url, main);
