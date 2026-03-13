# Provider Guide

Guide for the maintained provider-backed agent example.

For the runtime overview, start with [`../README.md`](../README.md). The provider-backed example itself lives in `examples/agent.ts`.

---

## Provider-backed agent example

Run the example agent with:

```bash
npm run agent
```

Force a provider explicitly:

```bash
AGENT_PROVIDER=groq npm run agent
AGENT_PROVIDER=openai npm run agent
AGENT_PROVIDER=anthropic npm run agent
```

When you use `examples/agent-support.ts` directly for evaluation work, `createAgentSession(...)` also accepts a prompt variant:

```ts
const fullSession = createAgentSession(runtime);
const minimalSession = createAgentSession(runtime, {
  promptVariant: 'minimal-tool-description',
});
const terseSession = createAgentSession(runtime, {
  promptVariant: 'terse',
});
```

Use the default full variant for production-like runs. Use the minimal and terse variants to compare how much command detail the model needs.

Provider selection rules:

- if `AGENT_PROVIDER` is unset and `GROQ_API_KEY` exists, Groq is preferred
- otherwise if `OPENAI_API_KEY` exists, OpenAI is used
- otherwise if `ANTHROPIC_API_KEY` exists, Anthropic is used
- `AGENT_PROVIDER=groq` forces Groq
- `AGENT_PROVIDER=openai` forces OpenAI
- `AGENT_PROVIDER=anthropic` forces Anthropic
- invalid `AGENT_PROVIDER` values fail fast

---

## Recommended `.env` setups

```bash
# Groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-120b

# OpenAI
AGENT_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.2

# Anthropic (OpenAI-compatible endpoint)
AGENT_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

Optional endpoint overrides:

- `GROQ_BASE_URL` overrides the Groq endpoint
- `OPENAI_BASE_URL` overrides the OpenAI endpoint
- `ANTHROPIC_BASE_URL` overrides the Anthropic OpenAI-compatible endpoint

---

## Live integration tests

Live integration tests are opt-in:

```bash
npm run test:live
npm run test:live:groq
npm run test:live:openai
npm run test:live:anthropic
```

---

## Compatibility notes

- the example agent is maintained against OpenAI-compatible APIs
- Groq, OpenAI, and Anthropic are covered by maintained examples and live-test entrypoints
- Anthropic support in this repo uses Anthropic's OpenAI-compatible endpoint, not the native Messages API
- other providers may be usable if your agent loop can send OpenAI-style tool definitions and tool calls, but they are not covered by maintained examples or tests in this repo
- the runtime itself does not depend on a provider SDK
