import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildToolDefinition, type AgentCLI, type ToolDescriptionVariant } from 'one-tool';

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

export type AgentProvider = 'groq' | 'openai' | 'anthropic';

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

export interface AgentSessionOptions {
  promptVariant?: ToolDescriptionVariant;
}

export interface AgentTurnOptions {
  onToolCall?: (command: string) => void;
}

export interface AgentTurnResult {
  reply: string;
  toolCallCount: number;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function resolveEnvPath(thisDir: string): string | null {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(thisDir, '..', '.env'),
    path.resolve(thisDir, '..', '..', '.env'),
  ];

  for (const candidate of envCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function loadEnvFile(): void {
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const envPath = resolveEnvPath(thisDir);
    if (!envPath) {
      return;
    }
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
  if (raw === 'groq' || raw === 'openai' || raw === 'anthropic') {
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
  if (process.env.ANTHROPIC_API_KEY) {
    return 'anthropic';
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
      baseUrl: normalizeBaseUrl(process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'),
    };
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for provider=openai.');
    }
    return {
      provider,
      apiKey,
      model: process.env.OPENAI_MODEL ?? 'gpt-5.2',
      baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for provider=anthropic.');
  }
  return {
    provider,
    apiKey,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
    baseUrl: normalizeBaseUrl(process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1'),
  };
}

function buildSystemPrompt(
  runtime: AgentCLI,
  promptVariant: ToolDescriptionVariant = 'full-tool-description',
): string {
  const toolDescription = runtime.buildToolDescription(promptVariant);
  const lines = buildPromptIntro(promptVariant, runtime.registry.has('help'));
  lines.push('', toolDescription);
  return lines.join('\n');
}

function buildPromptIntro(promptVariant: ToolDescriptionVariant, hasHelp: boolean): string[] {
  switch (promptVariant) {
    case 'minimal-tool-description': {
      const lines = buildToolInspectionPromptIntro();
      lines.push(buildDiscoveryPromptLine(hasHelp, 'usage when needed.'));
      return lines;
    }
    case 'terse': {
      const lines = buildToolInspectionPromptIntro();
      if (hasHelp) {
        lines.push('Command summaries are intentionally terse. Use `help` when you need details.');
      } else {
        lines.push(
          "Command summaries are intentionally terse. Run '<command>' with no args when you need details.",
        );
      }
      return lines;
    }
    case 'full-tool-description':
      return [
        'You are a helpful agent with access to a single tool called `run`.',
        'It executes CLI-style commands over a virtual file system and registered adapters.',
        "Use the tool to answer the user's questions. You can chain multiple calls.",
        'When the task asks about files, logs, search, fetch, or memory, inspect the runtime with the tool before answering.',
      ];
  }
}

function buildToolInspectionPromptIntro(): string[] {
  return [
    'You are a helpful agent with access to a single tool called `run`.',
    'It behaves like a CLI over a virtual file system and registered adapters.',
    'Use the tool to inspect state before answering.',
  ];
}

function buildDiscoveryPromptLine(hasHelp: boolean, suffix: string): string {
  if (hasHelp) {
    return `Use \`help\` to discover commands and ${suffix}`;
  }
  return `Run '<command>' with no args to discover ${suffix}`;
}

export function createAgentSession(runtime: AgentCLI, options: AgentSessionOptions = {}): AgentSession {
  const promptVariant = options.promptVariant ?? 'full-tool-description';
  return {
    messages: [{ role: 'system', content: buildSystemPrompt(runtime, promptVariant) }],
    tools: [buildToolDefinition(runtime, 'run', { descriptionVariant: promptVariant })],
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
        const message = `Network error calling ${url}: ${errorMessage(caught)}`;
        throw new Error(message, { cause: caught });
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
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
