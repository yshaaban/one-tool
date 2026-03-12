import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentSession, loadConfig, runAgentTurn, type ChatMessage } from '../examples/agent-support.js';
import { buildDemoRuntime } from '../examples/demo-runtime.js';
import { MemoryVFS } from '../src/index.js';

const ENV_KEYS = [
  'AGENT_PROVIDER',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'GROQ_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
] as const;

function withEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => Promise<void> | void,
): Promise<void> | void {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  const restore = (): void => {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  };

  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).finally(restore);
    }
    restore();
  } catch (caught) {
    restore();
    throw caught;
  }
}

test('loadConfig prefers groq when both keys exist', () =>
  withEnv(
    {
      AGENT_PROVIDER: undefined,
      GROQ_API_KEY: 'groq-key',
      OPENAI_API_KEY: 'openai-key',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.provider, 'groq');
      assert.equal(config.apiKey, 'groq-key');
      assert.equal(config.model, 'openai/gpt-oss-120b');
    },
  ));

test('loadConfig falls back to openai when groq key is absent', () =>
  withEnv(
    {
      AGENT_PROVIDER: undefined,
      GROQ_API_KEY: undefined,
      OPENAI_API_KEY: 'openai-key',
      OPENAI_MODEL: undefined,
    },
    () => {
      const config = loadConfig();
      assert.equal(config.provider, 'openai');
      assert.equal(config.apiKey, 'openai-key');
      assert.equal(config.model, 'gpt-5.2');
    },
  ));

test('loadConfig honors explicit openai provider', () =>
  withEnv(
    {
      AGENT_PROVIDER: 'openai',
      GROQ_API_KEY: 'groq-key',
      OPENAI_API_KEY: 'openai-key',
      OPENAI_MODEL: 'gpt-5.2',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.provider, 'openai');
      assert.equal(config.apiKey, 'openai-key');
    },
  ));

test('loadConfig rejects unsupported providers', () =>
  withEnv(
    {
      AGENT_PROVIDER: 'anthropic',
      GROQ_API_KEY: 'groq-key',
      OPENAI_API_KEY: 'openai-key',
    },
    () => {
      assert.throws(() => loadConfig(), /unsupported AGENT_PROVIDER: anthropic/);
    },
  ));

test('createAgentSession seeds the system prompt and one run tool', async () => {
  const runtime = await buildDemoRuntime({ vfs: new MemoryVFS() });
  const session = createAgentSession(runtime);

  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0]?.role, 'system');
  assert.match(session.messages[0]?.content ?? '', /single tool called `run`/);
  assert.equal(session.tools.length, 1);
  assert.equal(session.tools[0]?.function.name, 'run');
});

test('runAgentTurn executes tool calls and returns the final assistant reply', async () => {
  const runtime = await buildDemoRuntime({ vfs: new MemoryVFS() });
  const session = createAgentSession(runtime);

  const replies = [
    {
      id: 'chatcmpl-tool',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'run',
                  arguments: JSON.stringify({ command: 'grep -c "ERROR" /logs/app.log' }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    {
      id: 'chatcmpl-final',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '{"error_count":3}',
          },
          finish_reason: 'stop',
        },
      ],
    },
  ];

  const toolResults: string[] = [];
  const commands: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { messages: ChatMessage[] };
    const last = body.messages.at(-1);
    if (last?.role === 'tool') {
      toolResults.push(last.content ?? '');
    }
    const next = replies.shift();
    if (!next) {
      throw new Error('unexpected extra fetch');
    }
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await runAgentTurn(
      runtime,
      {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-5.2',
        baseUrl: 'https://api.openai.com/v1',
      },
      'Count the ERROR lines.',
      session,
      {
        onToolCall(command) {
          commands.push(command);
        },
      },
    );

    assert.equal(result.reply, '{"error_count":3}');
    assert.equal(result.toolCallCount, 1);
    assert.equal(replies.length, 0);
    assert.equal(commands.length, 1);
    assert.match(commands[0] ?? '', /grep -c/);
    assert.equal(toolResults.length, 1);
    assert.match(toolResults[0] ?? '', /3/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
