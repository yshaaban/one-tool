import readline from 'node:readline/promises';
import process from 'node:process';

import { buildDemoRuntime } from '../demo-runtime.js';
import { runIfEntrypoint } from '../shared/example-utils.js';

const EXAMPLES = [
  'help',
  'ls /',
  'cat /notes/todo.txt',
  'cat /logs/app.log | grep -c ERROR',
  'cat /logs/app.log | grep -i "failed login"',
  'find /config --type file --name "*.json" | sort',
  'find /config --type file --name "*.json" | wc -l',
  'search "refund timeout incident" | head -n 5',
  'search "EU VAT invoice" | write /research/vat.txt',
  'fetch order:123 | json get customer.email',
  'cat /config/prod.json | json get owner.email',
  'memory search "Acme follow-up"',
  'cp /drafts/qbr.md /reports/qbr-v1.md && ls /reports',
  'cat /missing.txt || cat /config/default.json',
] as const;

async function printExamples(runtime: Awaited<ReturnType<typeof buildDemoRuntime>>): Promise<void> {
  for (const command of EXAMPLES) {
    console.log(`\n$ ${command}`);
    console.log(await runtime.run(command));
  }
}

async function handleCommand(
  runtime: Awaited<ReturnType<typeof buildDemoRuntime>>,
  rawInput: string,
): Promise<boolean> {
  const raw = rawInput.trim();
  if (raw === 'quit' || raw === 'exit') {
    return false;
  }
  if (raw === 'examples') {
    await printExamples(runtime);
    return true;
  }
  if (!raw) {
    return true;
  }

  console.log(await runtime.run(raw));
  return true;
}

async function runInteractiveSession(
  runtime: Awaited<ReturnType<typeof buildDemoRuntime>>,
  rl: readline.Interface,
): Promise<void> {
  for (;;) {
    const raw = await rl.question('\nrun> ');
    const shouldContinue = await handleCommand(runtime, raw);
    if (!shouldContinue) {
      return;
    }
  }
}

async function runPipedSession(
  runtime: Awaited<ReturnType<typeof buildDemoRuntime>>,
  rl: readline.Interface,
): Promise<void> {
  for await (const raw of rl) {
    const shouldContinue = await handleCommand(runtime, raw);
    if (!shouldContinue) {
      return;
    }
  }
}

export async function main(): Promise<void> {
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
    if (process.stdin.isTTY) {
      await runInteractiveSession(runtime, rl);
    } else {
      await runPipedSession(runtime, rl);
    }
  } finally {
    rl.close();
  }
}

await runIfEntrypoint(import.meta.url, main);
