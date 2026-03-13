import { createAgentCLI, MemoryVFS } from 'one-tool';

import {
  createExampleIO,
  formatExecutionSummary,
  printHeading,
  runIfEntrypoint,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

const LOG_TEXT = [
  '2026-03-13T10:01:10Z INFO boot complete',
  '2026-03-13T10:02:10Z ERROR failed login user=alice',
  '2026-03-13T10:03:10Z WARN retry payment timeout order=123',
  '2026-03-13T10:04:10Z ERROR refund timeout order=123',
].join('\n');

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const encoder = new TextEncoder();
  const vfs = new MemoryVFS();

  await vfs.mkdir('/logs', true);
  await vfs.writeBytes('/logs/app.log', encoder.encode(LOG_TEXT));

  const runtime = await createAgentCLI({ vfs });
  const command = 'cat /logs/app.log | grep ERROR | head -n 1';
  const execution = await runtime.runDetailed(command);

  printHeading(
    io,
    'Quickstart: structured execution',
    'Use runDetailed() when you need structured exit codes, per-command traces, and presentation metadata.',
  );
  io.write(`\n$ ${command}`);
  io.write(execution.presentation.text);
  io.write('\nStructured summary');
  io.write(formatExecutionSummary(execution));
}

await runIfEntrypoint(import.meta.url, main);
