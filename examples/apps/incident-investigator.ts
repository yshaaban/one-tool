import { MemoryVFS } from 'one-tool';

import { buildDemoRuntime } from '../demo-runtime.js';
import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  runCommandSequence,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await buildDemoRuntime({
    vfs: new MemoryVFS(),
  });

  printHeading(
    io,
    'Application: incident investigator',
    'A read-heavy workflow that inspects logs, checks fallback config, fetches structured order data, and writes a report.',
  );

  await runCommandSequence(io, runtime, [
    'grep -c ERROR /logs/app.log',
    'cat /logs/app.log | grep timeout | tail -n 2',
    'cat /config/prod-missing.json || cat /config/default.json | json get region',
    'fetch order:123 | json get customer.email',
    'search refund timeout incident | head -n 3',
    'search refund timeout incident | write /reports/refund-incident.txt',
    'cat /reports/refund-incident.txt | head -n 5',
  ]);
}

await runIfEntrypoint(import.meta.url, main);
