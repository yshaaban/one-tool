/**
 * LLM Agent Loop — Groq first, OpenAI optional.
 *
 * Wires the single-tool CLI runtime to a real LLM via an
 * OpenAI-compatible /chat/completions endpoint.
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... npm run agent
 *   OPENAI_API_KEY=sk-... AGENT_PROVIDER=openai OPENAI_MODEL=gpt-5.2 npm run agent
 */

import readline from 'node:readline/promises';
import process from 'node:process';

import { buildDemoRuntime } from './demo-runtime.js';
import { createAgentSession, loadConfig, loadEnvFile, runAgentTurn } from './agent-support.js';
import { errorMessage } from '../src/utils.js';

async function main(): Promise<void> {
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
        console.error(`\n\x1b[31mError:\x1b[0m ${errorMessage(caught)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

try {
  await main();
} catch (caught) {
  console.error(errorMessage(caught));
  process.exit(1);
}
