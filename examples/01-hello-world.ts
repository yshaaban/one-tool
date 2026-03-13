import { MemoryVFS, buildToolDefinition, createAgentCLI } from '@onetool/one-tool';

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from './_example-utils.js';

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await createAgentCLI({
    vfs: new MemoryVFS(),
  });
  const tool = buildToolDefinition(runtime);

  io.write('01 · Hello world');
  io.write('Create a runtime, run a few commands, and inspect the single tool definition.');
  io.write(`Tool name: ${tool.function.name}`);
  io.write(`Tool description: ${tool.function.description.split('\n')[0] ?? '(empty)'}`);

  for (const command of ['write /hello.txt "Hello from one-tool"', 'cat /hello.txt', 'ls /']) {
    io.write(`\n$ ${command}`);
    io.write(await runtime.run(command));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
