import { MemoryVFS, createAgentCLI } from 'one-tool';

import { createExampleIO, runIfEntrypointWithErrorHandling, type ExampleOptions } from './_example-utils.js';

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
        '2026-03-13T10:03:10Z WARN retry scheduled order=123',
        '',
      ].join('\n'),
    ),
  );

  const runtime = await createAgentCLI({
    vfs,
    builtinCommands: { preset: 'readOnly' },
  });

  io.write('03 · Read-only agent');
  io.write('Start from the safe readOnly preset when the model must inspect state but not mutate it.');

  for (const command of [
    'ls /logs',
    'cat /logs/app.log | grep ERROR',
    'write /logs/notes.txt "this should fail"',
    'rm /logs/app.log',
  ]) {
    io.write(`\n$ ${command}`);
    io.write(await runtime.run(command));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
