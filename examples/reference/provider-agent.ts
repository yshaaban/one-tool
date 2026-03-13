import readline from 'node:readline/promises';
import process from 'node:process';

import { buildDemoRuntime } from '../demo-runtime.js';
import { createAgentSession, loadConfig, loadEnvFile, runAgentTurn } from '../agent-support.js';
import { formatExampleError, runIfEntrypointWithErrorHandling } from '../shared/example-utils.js';

export async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const runtime = await buildDemoRuntime();
  const session = createAgentSession(runtime);

  const inlinePrompt = process.argv.slice(2).join(' ').trim();
  if (inlinePrompt) {
    console.log(`\x1b[36mYou:\x1b[0m ${inlinePrompt}\n`);
    const { reply } = await runAgentTurn(runtime, config, inlinePrompt, session, {
      onToolCall(command) {
        console.log(`  \x1b[2m> ${command}\x1b[0m`);
      },
    });
    console.log(`\n\x1b[33mAgent:\x1b[0m ${reply}`);
    return;
  }

  console.log('One-Tool Agent (%s: %s)', config.provider, config.model);
  console.log('Type a question or task. The agent will use the CLI runtime to answer.');
  console.log("Type 'quit' to exit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (;;) {
      const raw = (await rl.question('\x1b[36mYou:\x1b[0m ')).trim();
      if (raw === 'quit' || raw === 'exit') {
        break;
      }
      if (!raw) {
        continue;
      }

      try {
        const { reply } = await runAgentTurn(runtime, config, raw, session, {
          onToolCall(command) {
            console.log(`  \x1b[2m> ${command}\x1b[0m`);
          },
        });
        console.log(`\n\x1b[33mAgent:\x1b[0m ${reply}\n`);
      } catch (caught) {
        console.error(`\n\x1b[31mError:\x1b[0m ${formatExampleError(caught)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
