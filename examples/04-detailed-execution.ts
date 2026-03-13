import { MemoryVFS, createAgentCLI } from 'one-tool';

import {
  createExampleIO,
  formatExecutionSummary,
  runIfEntrypointWithErrorHandling,
  type ExampleOptions,
} from './_example-utils.js';

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const encoder = new TextEncoder();
  const vfs = new MemoryVFS();

  await vfs.writeBytes(
    '/logs/app.log',
    encoder.encode(
      [
        '2026-03-13T10:01:10Z INFO boot complete',
        '2026-03-13T10:02:10Z ERROR failed login user=alice',
        '2026-03-13T10:03:10Z WARN payment timeout order=123',
        '2026-03-13T10:04:10Z ERROR refund timeout order=123',
        '',
      ].join('\n'),
    ),
  );

  const runtime = await createAgentCLI({ vfs });

  io.write('04 · Detailed execution');
  io.write('Use runDetailed() when you need structured traces instead of presentation text only.');

  for (const command of ['grep ERROR /logs/app.log | wc -l', 'cat /missing.txt']) {
    const execution = await runtime.runDetailed(command);
    io.write(`\n$ ${command}`);
    io.write(execution.presentation.text);
    io.write(formatExecutionSummary(execution));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
