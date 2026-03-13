/**
 * Browser-safe agent loop — ported from examples/agent-support.ts.
 *
 * This is a copy (not import) because the original imports from `one-tool`
 * which pulls Node-only code. The site only aliases `one-tool/browser`.
 */

import { buildToolDefinition, type AgentCLI, type ToolDescriptionVariant } from 'one-tool/browser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface AgentConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface AgentSession {
  messages: ChatMessage[];
  tools: ReturnType<typeof buildToolDefinition>[];
}

export interface AgentTurnOptions {
  onToolCall?: (command: string, result: string) => void;
}

export interface AgentTurnResult {
  reply: string;
  toolCallCount: number;
}

// ---------------------------------------------------------------------------
// Defaults (OpenAI only — other providers don't support browser CORS)
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gpt-5.2-chat-latest';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export function createBrowserConfig(apiKey: string, model?: string, baseUrl?: string): AgentConfig {
  return {
    apiKey,
    model: model || DEFAULT_MODEL,
    baseUrl: normalizeBaseUrl(baseUrl || DEFAULT_BASE_URL),
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  runtime: AgentCLI,
  promptVariant: ToolDescriptionVariant = 'full-tool-description',
): string {
  const toolDescription = runtime.buildToolDescription(promptVariant);
  const lines = [
    'You are a helpful agent with access to a single tool called `run`.',
    'It executes CLI-style commands over a virtual file system and registered adapters.',
    "Use the tool to answer the user's questions. You can chain multiple calls.",
    'When the task asks about files, logs, search, fetch, or memory, inspect the runtime with the tool before answering.',
    '',
    toolDescription,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function createAgentSession(runtime: AgentCLI): AgentSession {
  return {
    messages: [{ role: 'system', content: buildSystemPrompt(runtime) }],
    tools: [buildToolDefinition(runtime, 'run')],
  };
}

// ---------------------------------------------------------------------------
// Chat completion (OpenAI-compatible)
// ---------------------------------------------------------------------------

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
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
        throw new Error(`Network error calling ${url}: ${errorMessage(caught)}`, { cause: caught });
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
      throw new Error(`${config.baseUrl} API ${res.status}: ${body}`);
    }

    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after')) ?? 500 * (attempt + 1);
    await delayMs(retryAfterMs);
  }

  throw new Error(`failed to call ${config.baseUrl} after retries`);
}

// ---------------------------------------------------------------------------
// Agent turn
// ---------------------------------------------------------------------------

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
    if (!choice) throw new Error('empty response from model');

    const assistantMsg = choice.message;
    const historyEntry: ChatMessage = { role: 'assistant', content: assistantMsg.content };
    if (assistantMsg.tool_calls?.length) {
      historyEntry.tool_calls = assistantMsg.tool_calls;
    }
    session.messages.push(historyEntry);

    if (!assistantMsg.tool_calls?.length) {
      return { reply: assistantMsg.content ?? '(no response)', toolCallCount };
    }

    toolCallCount += assistantMsg.tool_calls.length;

    for (const toolCall of assistantMsg.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(toolCall.function.arguments) as { command?: string };
        const command = args.command ?? '';
        result = await runtime.run(command);
        options.onToolCall?.(command, result);
      } catch (caught) {
        result = `tool error: ${errorMessage(caught)}`;
        options.onToolCall?.(toolCall.function.arguments, result);
      }

      session.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return { reply: '(max tool rounds reached)', toolCallCount };
}
