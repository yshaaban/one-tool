/**
 * Browser-safe agent loop for the website.
 *
 * This browser demo targets OpenRouter's OpenAI-compatible HTTP API. That gives
 * the site a browser-usable endpoint without pretending direct OpenAI browser
 * requests are reliable.
 */

import OpenAI from 'openai';
import { buildToolDefinition, type AgentCLI, type ToolDescriptionVariant } from 'one-tool/browser';

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
}

export interface AgentSession {
  messages: ChatMessage[];
  tools: ReturnType<typeof buildToolDefinition>[];
}

export interface AgentTurnOptions {
  onToolCall?: (command: string, result: string) => void;
  onToolCallStart?: (command: string) => void;
  onToolCallComplete?: (command: string, result: string) => void;
}

export interface AgentTurnResult {
  reply: string;
  toolCallCount: number;
}

export interface BrowserModelOption {
  value: string;
  label: string;
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_REFERER = 'https://yrsh.github.io/one-tool/';
const OPENROUTER_TITLE = 'one-tool website demo';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_TOOL_ROUNDS = 20;

export const browserModelOptions: BrowserModelOption[] = [
  { value: 'openai/gpt-oss-120b', label: 'OpenAI: gpt-oss-120b (recommended)' },
  { value: 'meta-llama/llama-3.1-8b-instruct', label: 'Meta: Llama 3.1 8B Instruct' },
  { value: 'minimax/minimax-m2.5', label: 'MiniMax: MiniMax M2.5' },
  { value: 'x-ai/grok-4-fast', label: 'xAI: Grok 4 Fast' },
  { value: 'stepfun/step-3.5-flash:free', label: 'StepFun: Step 3.5 Flash (free)' },
];

export function createBrowserConfig(apiKey: string, model?: string): AgentConfig {
  return {
    apiKey,
    model: (model || DEFAULT_MODEL).trim(),
  };
}

export function disposeAgentSession(_session: AgentSession | null): void {}

export function createAgentSession(runtime: AgentCLI): AgentSession {
  return {
    messages: [{ role: 'system', content: buildSystemPrompt(runtime) }],
    tools: [buildToolDefinition(runtime, 'run')],
  };
}

export async function runAgentTurn(
  runtime: AgentCLI,
  config: AgentConfig,
  userMessage: string,
  session: AgentSession,
  options: AgentTurnOptions = {},
): Promise<AgentTurnResult> {
  const nextMessages = session.messages.slice();
  nextMessages.push({ role: 'user', content: userMessage });

  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatCompletion(config, nextMessages, session.tools);
    const choice = response.choices[0];
    if (!choice) throw new Error('empty response from model');

    const assistantMsg = choice.message;
    const historyEntry: ChatMessage = { role: 'assistant', content: assistantMsg.content };
    if (assistantMsg.tool_calls?.length) {
      historyEntry.tool_calls = assistantMsg.tool_calls;
    }
    nextMessages.push(historyEntry);

    if (!assistantMsg.tool_calls?.length) {
      const reply = assistantMsg.content?.trim();
      if (reply) {
        session.messages = nextMessages;
        return { reply, toolCallCount };
      }

      session.messages = nextMessages;
      return {
        reply: [
          `The selected model (${config.model}) returned no text and no tool calls.`,
          `For this demo, pick one of the models in the dropdown and try again.`,
        ].join(' '),
        toolCallCount,
      };
    }

    toolCallCount += assistantMsg.tool_calls.length;

    for (const toolCall of assistantMsg.tool_calls) {
      const result = await runToolCall(runtime, toolCall, options);
      nextMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  session.messages = nextMessages;
  return { reply: '(max tool rounds reached)', toolCallCount };
}

function buildSystemPrompt(
  runtime: AgentCLI,
  promptVariant: ToolDescriptionVariant = 'full-tool-description',
): string {
  const toolDescription = runtime.buildToolDescription(promptVariant);
  const commandNames = runtime.registry.names();
  const commandList = commandNames.length > 0 ? commandNames.join(', ') : '(none)';
  return [
    'You are a helpful agent with access to a single tool called `run`.',
    'It executes CLI-style commands over a virtual file system and registered adapters.',
    "Use the tool to answer the user's questions. You can chain multiple calls.",
    'When the task asks about files, logs, search, fetch, or memory, inspect the runtime with the tool before answering.',
    'Stay inside the documented command surface. Do not assume Unix flags or shell behavior that help output does not show.',
    'If you are unsure about command syntax, call `help <command>` before retrying.',
    'Search results already include useful snippets. Use those snippets directly unless you have a clear reason to fetch another resource.',
    'Treat `source:` values in search results as citations, not file paths. Do not use `cat`, `ls`, or `find` on them.',
    'Only use `fetch` for resource IDs that the runtime explicitly supports.',
    `Available commands: ${commandList}`,
    'Use `help` when you need to discover exact command usage.',
    '',
    toolDescription,
  ].join('\n');
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createOpenRouterClient(config: AgentConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: OPENROUTER_BASE_URL,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      'HTTP-Referer': resolveSiteReferer(),
      'X-Title': OPENROUTER_TITLE,
    },
  });
}

async function chatCompletion(
  config: AgentConfig,
  messages: ChatMessage[],
  tools: ReturnType<typeof buildToolDefinition>[],
): Promise<ChatCompletionResponse> {
  const client = createOpenRouterClient(config);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: config.model,
        messages: messages as never,
        tools,
        tool_choice: 'auto',
      });

      return completion as unknown as ChatCompletionResponse;
    } catch (caught) {
      if (attempt === 2) {
        throw new Error(`OpenRouter request failed for model ${config.model}: ${errorMessage(caught)}`, {
          cause: caught,
        });
      }

      await delayMs(500 * (attempt + 1));
    }
  }

  throw new Error(`failed to call OpenRouter after retries`);
}

async function runToolCall(
  runtime: AgentCLI,
  toolCall: ToolCall,
  options: AgentTurnOptions,
): Promise<string> {
  let command = extractToolCommand(toolCall.function.arguments);
  let result = '';

  options.onToolCallStart?.(command);

  try {
    result = await runtime.run(command);
  } catch (caught) {
    result = `tool error: ${errorMessage(caught)}`;
  }

  options.onToolCall?.(command, result);
  options.onToolCallComplete?.(command, result);
  return result;
}

function extractToolCommand(rawArguments: string): string {
  try {
    const args = JSON.parse(rawArguments) as { command?: string };
    return args.command ?? rawArguments;
  } catch {
    return rawArguments;
  }
}

function resolveSiteReferer(): string {
  if (typeof globalThis.location?.origin === 'string' && globalThis.location.origin.length > 0) {
    return `${globalThis.location.origin}/`;
  }

  return OPENROUTER_REFERER;
}
