import readline from 'node:readline/promises';
import process from 'node:process';

import { buildDemoRuntime } from './demo-runtime.js';

const EXAMPLES = [
  'help',
  'ls /',
  'cat /notes/todo.txt',
  'cat /logs/app.log | grep -c ERROR',
  'cat /logs/app.log | grep -i "failed login"',
  'search "refund timeout incident" | head -n 5',
  'search "EU VAT invoice" | write /research/vat.txt',
  'fetch order:123 | json get customer.email',
  'cat /config/prod.json | json get owner.email',
  'memory search "Acme follow-up"',
  'cp /drafts/qbr.md /reports/qbr-v1.md && ls /reports',
  'cat /missing.txt || cat /config/default.json',
];

async function printExamples(runtime: Awaited<ReturnType<typeof buildDemoRuntime>>): Promise<void> {
  for (const command of EXAMPLES) {
    console.log(`\n$ ${command}`);
    console.log(await runtime.run(command));
  }
}

async function main(): Promise<void> {
  const runtime = await buildDemoRuntime();

  console.log('Single-tool CLI runtime demo (TypeScript)');
  console.log('-----------------------------------------');
  console.log(runtime.buildToolDescription());
  console.log("\nType a command, or 'examples', or 'quit'.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (;;) {
      const raw = (await rl.question('\nrun> ')).trim();
      if (raw === 'quit' || raw === 'exit') {
        break;
      }
      if (raw === 'examples') {
        await printExamples(runtime);
        continue;
      }
      if (!raw) {
        continue;
      }
      console.log(await runtime.run(raw));
    }
  } finally {
    rl.close();
  }
}

await main();
