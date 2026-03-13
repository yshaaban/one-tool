import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentSession, loadConfig, loadEnvFile, runAgentTurn } from '../examples/agent-support.js';
import { buildDemoRuntime } from '@onetool/one-tool/testing';
import { MemoryVFS } from '../src/index.js';

loadEnvFile();

const liveTestsEnabled = process.env.LIVE_AGENT_TESTS === '1';
const hasGroqKey = Boolean(process.env.GROQ_API_KEY);
const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);

function resolveLiveProvider(): 'groq' | 'openai' | 'anthropic' {
  const raw = process.env.AGENT_PROVIDER?.trim().toLowerCase();
  if (!raw) {
    if (hasGroqKey) {
      return 'groq';
    }
    if (hasOpenAIKey) {
      return 'openai';
    }
    if (hasAnthropicKey) {
      return 'anthropic';
    }
    return 'groq';
  }
  if (raw === 'groq' || raw === 'openai' || raw === 'anthropic') {
    return raw;
  }
  throw new Error(`unsupported AGENT_PROVIDER: ${process.env.AGENT_PROVIDER}`);
}

const liveProvider = resolveLiveProvider();

function liveSkipReason(
  provider: 'groq' | 'openai' | 'anthropic',
  apiKeyPresent: boolean,
  envName: string,
): false | string {
  if (!liveTestsEnabled) {
    return 'requires LIVE_AGENT_TESTS=1';
  }
  if (!apiKeyPresent) {
    return `requires ${envName}`;
  }
  return false;
}

function liveTestSkip(provider: 'groq' | 'openai' | 'anthropic'): false | string {
  if (provider === 'groq') {
    return liveSkipReason('groq', hasGroqKey, 'GROQ_API_KEY');
  }
  if (provider === 'anthropic') {
    return liveSkipReason('anthropic', hasAnthropicKey, 'ANTHROPIC_API_KEY');
  }
  return liveSkipReason('openai', hasOpenAIKey, 'OPENAI_API_KEY');
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`no JSON object found in: ${trimmed}`);
  }
  return JSON.parse(match[0]) as Record<string, unknown>;
}

async function runLiveAgent(provider: 'groq' | 'openai' | 'anthropic'): Promise<void> {
  const runtime = await buildDemoRuntime({ vfs: new MemoryVFS() });
  const session = createAgentSession(runtime);
  const config = loadConfig(provider);
  const prompt =
    'Use the run tool to inspect the runtime. Count ERROR lines in /logs/app.log and fetch order:123 to extract customer.email. ' +
    'Respond with strict JSON only: {"error_count":number,"customer_email":string}.';

  const result = await runAgentTurn(runtime, config, prompt, session);
  assert.ok(result.toolCallCount >= 1, `${provider} should use the run tool at least once`);

  const parsed = extractJsonObject(result.reply);
  assert.equal(parsed.error_count, 3);
  assert.equal(parsed.customer_email, 'buyer@acme.example');
}

test(
  `live agent: ${liveProvider} can use the runtime tool to answer grounded questions`,
  {
    timeout: 120_000,
    skip: liveTestSkip(liveProvider),
  },
  async () => {
    await runLiveAgent(liveProvider);
  },
);
