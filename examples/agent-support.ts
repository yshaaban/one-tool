import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { AgentCLI } from '../src/index.js';
import { buildToolDefinition } from '../src/index.js';
import { errorMessage } from '../src/utils.js';

export interface ToolCall {
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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type AgentProvider = 'groq' | 'openai';

export interface AgentConfig {
  provider: AgentProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface AgentSession {
  messages: ChatMessage[];
  tools: ReturnType<typeof buildToolDefinition>[];
}

export interface AgentTurnOptions {
  onToolCall?: (command: string) => void;
}

export interface AgentTurnResult {
  reply: string;
  toolCallCount: number;
}

export function loadEnvFile(): void {
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const envPath = path.resolve(thisDir, '..', '..', '.env');
    const envText = readFileSync(envPath, 'utf-8');
    for (const line of envText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const eq = trimmed.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    /* .env is optional if vars are already set */
  }
}

function resolveProvider(preferredProvider?: string): AgentProvider {
  const raw = preferredProvider?.trim().toLowerCase();
  if (raw === 'groq' || raw === 'openai') {
    return raw;
  }
  if (raw) {
    throw new Error(`unsupported AGENT_PROVIDER: ${preferredProvider}`);
  }
  if (process.env.GROQ_API_KEY) {
    return 'groq';
  }
  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }
  return 'groq';
}

export function loadConfig(preferredProvider = process.env.AGENT_PROVIDER): AgentConfig {
  const provider = resolveProvider(preferredProvider);

  if (provider === 'groq') {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is required for provider=groq.');
    }
    return {
      provider,
      apiKey,
      model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
      baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for provider=openai.');
  }
  return {
    provider,
    apiKey,
    model: process.env.OPENAI_MODEL ?? 'gpt-5.2',
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  };
}

function buildSystemPrompt(runtime: AgentCLI): string {
  return [
    'You are a helpful agent with access to a single tool called `run`.',
    'It executes CLI-style commands over a virtual file system and registered adapters.',
    'Use the tool to answer the user\'s questions. You can chain multiple calls.',
    'When the task asks about files, logs, search, fetch, or memory, inspect the runtime with the tool before answering.',
    '',
    runtime.buildToolDescription(),
  ].join('\n');
}

export function createAgentSession(runtime: AgentCLI): AgentSession {
  return {
    messages: [{ role: 'system', content: buildSystemPrompt(runtime) }],
    tools: [buildToolDefinition(runtime)],
  };
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) {
    return null;
  }
  return Math.max(0, at - Date.now());
}

async function chatCompletion(
  config: AgentConfig,
  messages: ChatMessage[],
  tools: ReturnType<typeof buildToolDefinition>[],
): Promise<ChatCompletionResponse> {
  const url = `${config.baseUrl}/chat/completions`;

  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
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
    } catch (caught) {
      if (attempt === 2) {
        const cause = caught instanceof Error && caught.cause ? ` (${caught.cause})` : '';
        throw new Error(`Network error calling ${url}: ${errorMessage(caught)}${cause}`);
      }
      await delayMs(500 * (attempt + 1));
      continue;
    }

    if (res.ok) {
      return (await res.json()) as ChatCompletionResponse;
    }

    const body = await res.text();
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt === 2) {
      throw new Error(`${config.provider} API ${res.status}: ${body}`);
    }

    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after')) ?? 500 * (attempt + 1);
    await delayMs(retryAfterMs);
  }

  throw new Error(`failed to call ${config.provider} after retries`);
}

const MAX_TOOL_ROUNDS = 20;

export async function runAgentTurn(
  runtime: AgentCLI,
  config: AgentConfig,
  userMessage: string,
  session: AgentSession,
  options: AgentTurnOptions = {},
): Promise<AgentTurnResult> {
  session.messages.push({ role: 'user', content: userMessage });

  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatCompletion(config, session.messages, session.tools);
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('empty response from model');
    }

    const assistantMsg = choice.message;
    const historyEntry: ChatMessage = {
      role: 'assistant',
      content: assistantMsg.content,
    };
    if (assistantMsg.tool_calls?.length) {
      historyEntry.tool_calls = assistantMsg.tool_calls;
    }
    session.messages.push(historyEntry);

    if (!assistantMsg.tool_calls?.length) {
      return {
        reply: assistantMsg.content ?? '(no response)',
        toolCallCount,
      };
    }

    toolCallCount += assistantMsg.tool_calls.length;

    for (const toolCall of assistantMsg.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(toolCall.function.arguments) as { command?: string };
        const command = args.command ?? '';
        options.onToolCall?.(command);
        result = await runtime.run(command);
      } catch (caught) {
        result = `tool error: ${errorMessage(caught)}`;
      }

      session.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return {
    reply: '(max tool rounds reached)',
    toolCallCount,
  };
}
