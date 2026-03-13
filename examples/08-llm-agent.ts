import readline from 'node:readline/promises';
import process from 'node:process';

import { MemoryVFS } from 'one-tool';
import { buildDemoRuntime } from 'one-tool/testing';

import { createAgentSession, loadConfig, loadEnvFile, runAgentTurn } from './agent-support.js';
import {
  createExampleIO,
  formatExampleError,
  getExampleArgs,
  runIfEntrypointWithErrorHandling,
  type ExampleOptions,
} from './_example-utils.js';

async function buildRuntime() {
  return buildDemoRuntime({ vfs: new MemoryVFS() });
}

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const args = getExampleArgs(options);
  const runtime = await buildRuntime();
  if (args.includes('--self-test')) {
    io.write('08 · LLM agent');
    io.write('Self-test: build the seeded runtime used by the provider-backed agent path.');

    for (const command of ['grep -c ERROR /logs/app.log', 'fetch order:123 | json get customer.email']) {
      io.write(`\n$ ${command}`);
      io.write(await runtime.run(command));
    }
    return;
  }

  loadEnvFile();
  const config = loadConfig();
  const session = createAgentSession(runtime);
  const inlinePrompt = args.join(' ').trim();
  if (inlinePrompt) {
    console.log(`You: ${inlinePrompt}\n`);
    const { reply } = await runAgentTurn(runtime, config, inlinePrompt, session, {
      onToolCall(command) {
        console.log(`  > ${command}`);
      },
    });
    console.log(`\nAgent: ${reply}`);
    return;
  }

  console.log('08 · LLM agent');
  console.log('Provider: %s | Model: %s', config.provider, config.model);
  console.log('Type a question. The agent will use the one-tool runtime to answer.');
  console.log("Type 'quit' to exit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (;;) {
      const raw = (await rl.question('You: ')).trim();
      if (raw === 'quit' || raw === 'exit') {
        break;
      }
      if (!raw) {
        continue;
      }

      try {
        const { reply } = await runAgentTurn(runtime, config, raw, session, {
          onToolCall(command) {
            console.log(`  > ${command}`);
          },
        });
        console.log(`\nAgent: ${reply}\n`);
      } catch (caught) {
        console.error(`\nError: ${formatExampleError(caught)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
