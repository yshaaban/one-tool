/**
 * LLM Agent Loop — Groq / OpenAI-compatible tool-calling loop.
 *
 * Wires the single-tool CLI runtime to a real LLM via Groq's
 * OpenAI-compatible /chat/completions endpoint with tool_use.
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... npm run agent
 *   GROQ_API_KEY=gsk_... npm run agent -- "count error lines in /logs/app.log"
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';

import { buildDemoRuntime } from './demo-runtime.js';
import type { AgentCLI } from './runtime.js';

/* ------------------------------------------------------------------ */
/*  Types for the OpenAI chat completions response                    */
/* ------------------------------------------------------------------ */

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface Choice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: Choice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/* ------------------------------------------------------------------ */
/*  Config from env                                                   */
/* ------------------------------------------------------------------ */

function loadEnvFile(): void {
  try {
    // From dist/src/ go up two levels to project root
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const envPath = path.resolve(thisDir, '..', '..', '.env');
    const envText = readFileSync(envPath, 'utf-8');
    for (const line of envText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch { /* .env is optional if vars are already set */ }
}

interface AgentConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

function loadConfig(): AgentConfig {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY is required. Set it in .env or as an environment variable.');
    process.exit(1);
  }

  return {
    apiKey,
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
    baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
  };
}

/* ------------------------------------------------------------------ */
/*  Tool definition (single tool: run)                                */
/* ------------------------------------------------------------------ */

function buildToolDef(runtime: AgentCLI) {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'run',
        description: runtime.buildToolDescription(),
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The CLI command to execute.',
            },
          },
          required: ['command'],
        },
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Chat completions call                                             */
/* ------------------------------------------------------------------ */

async function chatCompletion(
  config: ReturnType<typeof loadConfig>,
  messages: ChatMessage[],
  tools: ReturnType<typeof buildToolDef>,
): Promise<ChatCompletionResponse> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools,
      tool_choice: 'auto',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq API ${res.status}: ${body}`);
  }

  return (await res.json()) as ChatCompletionResponse;
}

/* ------------------------------------------------------------------ */
/*  Agent loop: send → tool_call → execute → repeat                   */
/* ------------------------------------------------------------------ */

const MAX_TOOL_ROUNDS = 20;

async function agentLoop(
  runtime: AgentCLI,
  config: ReturnType<typeof loadConfig>,
  userMessage: string,
  messages: ChatMessage[],
  tools: ReturnType<typeof buildToolDef>,
): Promise<string> {
  messages.push({ role: 'user', content: userMessage });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatCompletion(config, messages, tools);
    const choice = response.choices[0];
    if (!choice) throw new Error('empty response from model');

    const assistantMsg = choice.message;

    // Push the assistant message into history
    const historyEntry: ChatMessage = {
      role: 'assistant',
      content: assistantMsg.content,
    };
    if (assistantMsg.tool_calls?.length) {
      historyEntry.tool_calls = assistantMsg.tool_calls;
    }
    messages.push(historyEntry);

    // If no tool calls, we're done
    if (!assistantMsg.tool_calls?.length) {
      return assistantMsg.content ?? '(no response)';
    }

    // Execute each tool call
    for (const tc of assistantMsg.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(tc.function.arguments) as { command?: string };
        const command = args.command ?? '';
        console.log(`  \x1b[2m> ${command}\x1b[0m`);
        result = await runtime.run(command);
      } catch (e) {
        result = `tool error: ${e instanceof Error ? e.message : String(e)}`;
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return '(max tool rounds reached)';
}

/* ------------------------------------------------------------------ */
/*  Main: interactive REPL or one-shot                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const runtime = await buildDemoRuntime();
  const tools = buildToolDef(runtime);

  const systemPrompt = [
    'You are a helpful agent with access to a single tool called `run`.',
    'It executes CLI-style commands over a virtual file system and registered adapters.',
    'Use the tool to answer the user\'s questions. You can chain multiple calls.',
    '',
    runtime.buildToolDescription(),
  ].join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // One-shot mode: pass a prompt as CLI arg
  const inlinePrompt = process.argv.slice(2).join(' ').trim();
  if (inlinePrompt) {
    console.log(`\x1b[36mYou:\x1b[0m ${inlinePrompt}\n`);
    const reply = await agentLoop(runtime, config, inlinePrompt, messages, tools);
    console.log(`\n\x1b[33mAgent:\x1b[0m ${reply}`);
    return;
  }

  // Interactive REPL
  console.log('One-Tool Agent (Groq: %s)', config.model);
  console.log('Type a question or task. The agent will use the CLI runtime to answer.');
  console.log("Type 'quit' to exit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (;;) {
      const raw = (await rl.question('\x1b[36mYou:\x1b[0m ')).trim();
      if (raw === 'quit' || raw === 'exit') break;
      if (!raw) continue;

      try {
        const reply = await agentLoop(runtime, config, raw, messages, tools);
        console.log(`\n\x1b[33mAgent:\x1b[0m ${reply}\n`);
      } catch (e) {
        console.error(`\n\x1b[31mError:\x1b[0m ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

await main();
