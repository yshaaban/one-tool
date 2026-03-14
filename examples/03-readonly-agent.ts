import { MemoryVFS, createAgentCLI } from '@onetool/one-tool';

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
    'cat /logs/app.log',
    'stat /logs/app.log',
    'find /logs -type f | sort',
    'ls -a /',
    'grep -c ERROR /logs/app.log',
    'write /test.txt "this should fail"',
  ]) {
    io.write(`\n$ ${command}`);
    io.write(await runtime.run(command));
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
