import { MemoryVFS, createAgentCLI } from '@onetool/one-tool';

import {
  createExampleIO,
  formatExecutionSummary,
  runIfEntrypointWithErrorHandling,
  type ExampleOptions,
} from '../_example-utils.js';

function createLargeLog(): string {
  return Array.from({ length: 80 }, function (_, index) {
    return `2026-03-13T10:${String(index).padStart(2, '0')}:00Z INFO line=${index + 1}`;
  }).join('\n');
}

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const encoder = new TextEncoder();
  const vfs = new MemoryVFS();

  await vfs.writeBytes('/logs/large.log', encoder.encode(createLargeLog()));
  await vfs.writeBytes('/images/logo.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

  const runtime = await createAgentCLI({
    vfs,
    outputLimits: {
      maxLines: 5,
      maxBytes: 120,
    },
  });

  const overflow = await runtime.runDetailed('cat /logs/large.log');
  const binary = await runtime.runDetailed('cat /images/logo.png');

  io.write('Advanced · Overflow and binary handling');
  io.write('Use structured execution metadata to react to truncation and binary guards.');

  io.write('\nOverflow');
  io.write(overflow.presentation.text);
  io.write(formatExecutionSummary(overflow));
  io.write(`savedPath: ${overflow.presentation.savedPath ?? '(none)'}`);

  io.write('\nBinary guard');
  io.write(binary.presentation.text);
  io.write(formatExecutionSummary(binary));
  io.write(`savedPath: ${binary.presentation.savedPath ?? '(none)'}`);
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
