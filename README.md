# one-tool: Single-Tool CLI Runtime for LLM Agents

This project is a **complete TypeScript reference implementation** of the pattern from your essay:

- expose **one** tool: `run(command: string)`
- make commands feel like a CLI
- support `|`, `&&`, `||`, and `;`
- emulate local files through a **virtual file system (VFS)**
- do **not** invoke a real shell
- make help, errors, truncation, and footers do the navigation work for the model

The implementation is **ESM, strict TypeScript, async-friendly**, and ships with multiple VFS backends:

- `NodeVFS` for a rooted host-backed workspace
- `MemoryVFS` for pure in-memory tests and embeddings
- `BrowserVFS` for IndexedDB-backed browser persistence

---

## What this runtime gives you

### 1. One model-facing tool
Your app exposes exactly one tool:

```ts
const runtime = await createAgentCLI(...);

async function runTool(command: string): Promise<string> {
  return runtime.run(command);
}
```

Everything else is hidden behind registered commands.

### 2. Shell-like composition without a shell
The runtime parses and executes:

- `|`
- `&&`
- `||`
- `;`

But it never calls `/bin/sh`, `bash`, `exec`, or `spawn`.

### 3. Emulated local files
The model can work with paths like these as if they were local:

- `/notes/todo.txt`
- `/logs/app.log`
- `/config/prod.json`
- `/reports/refund.txt`

Under the hood those are rooted to a safe directory you control.

### 4. A presentation layer built for LLMs
The runtime adds:

- binary output guard
- overflow mode for large outputs
- consistent footer: `[exit:N | 12ms]`
- prescriptive error messages

That keeps tool results compact, navigable, and recoverable.

---

## Project layout

```text
one-tool/
├─ .env.example
├─ COMMANDS.md
├─ package.json
├─ tsconfig.json
├─ README.md
├─ src/
│  ├─ types.ts
│  ├─ memory.ts
│  ├─ parser.ts
│  ├─ utils.ts
│  ├─ commands/
│  │  ├─ core.ts
│  │  ├─ register.ts
│  │  ├─ index.ts
│  │  ├─ groups/
│  │  └─ shared/
│  ├─ runtime.ts
│  ├─ tool-schema.ts
│  └─ index.ts
├─ src/vfs/
│  ├─ interface.ts
│  ├─ path-utils.ts
│  ├─ memory-vfs.ts
│  ├─ node-vfs.ts
│  ├─ browser-vfs.ts
│  └─ index.ts
├─ examples/
│  ├─ demo-adapters.ts
│  ├─ demo-runtime.ts
│  ├─ demo-app.ts
│  ├─ agent-support.ts
│  └─ agent.ts
└─ test/
   ├─ agent-live.integration.ts
   ├─ commands/
   │  ├─ adapters.test.ts
   │  ├─ conformance.test.ts
   │  ├─ data.test.ts
   │  ├─ fs.test.ts
   │  ├─ harness.ts
   │  ├─ system.test.ts
   │  └─ text.test.ts
   ├─ runtime.test.ts
   ├─ memory-vfs.test.ts
   ├─ browser-vfs.test.ts
   └─ node-vfs.test.ts
```

---

## Quick start

```bash
npm install
npm run build
npm run demo
```

Then try:

```text
help
ls /
cat /logs/app.log | grep -c ERROR
fetch order:123 | json get customer.email
search "refund timeout incident" | write /reports/refund.txt
```

For the real provider-backed agent or live integration tests, start from the checked-in env sample:

```bash
cp .env.example .env
```

Then edit `.env` and fill either the Groq block or the OpenAI block.

For adding or modifying built-in commands, see `COMMANDS.md`.

## Command development

Built-in commands are metadata-driven. Each `CommandSpec` can declare stdin behavior, arg bounds, adapter requirements, and representative sample args. The conformance suite in `test/commands/conformance.test.ts` uses that metadata to generate baseline tests automatically for every registered command.

Use `COMMANDS.md` for the exact workflow and checklist.

---

## Architecture

## Execution layer
The execution layer stays close to Unix semantics:

- parse the command string
- resolve chains and pipelines
- dispatch only registered commands
- pass raw stdout bytes through pipes
- keep stderr out of pipes
- stop a pipeline on first failed stage

That last point is a deliberate simplification for agent workflows.

## Presentation layer
Only after the pipeline finishes do we:

- detect binary output
- truncate oversized text
- save full output to a virtual file
- append duration + exit metadata
- attach error text

That separation is critical. If you decorate output before the pipeline completes, you break pipe semantics.

---

## Supported operators

| Operator | Meaning |
|---|---|
| `|` | pipe stdout to next command |
| `&&` | run next pipeline only if previous succeeded |
| `||` | run next pipeline only if previous failed |
| `;` | always run next pipeline |

Examples:

```text
cat /logs/app.log | grep ERROR | tail -n 20
cat /config/prod.json || cat /config/default.json
search "EU VAT" | head -n 5 | write /research/vat.txt
cp /drafts/qbr.md /reports/qbr-v1.md && ls /reports
```

---

## Built-in commands

| Command | Purpose |
|---|---|
| `help` | list commands or show command help |
| `ls` | list directory contents |
| `stat` | show file metadata |
| `cat` | read text files |
| `write` | write file from inline content or stdin |
| `append` | append content to a file |
| `grep` | filter lines by regex |
| `head` | first N lines |
| `tail` | last N lines |
| `mkdir` | create directories |
| `cp` | copy file/directory |
| `mv` | move/rename file/directory |
| `rm` | delete file/directory |
| `search` | adapter-backed search command |
| `fetch` | adapter-backed fetch command |
| `json` | pretty-print, inspect keys, extract paths |
| `memory` | store/search lightweight working memory |
| `calc` | safe arithmetic |

---

## 10 realistic tool-calling patterns

These are the kinds of calls you want the model to learn.

### 1. Count matching log lines
```text
cat /logs/app.log | grep -c ERROR
```

### 2. Inspect only the interesting tail
```text
cat /logs/app.log | grep timeout | tail -n 20
```

### 3. Fallback if a file is missing
```text
cat /config/prod.json || cat /config/default.json
```

### 4. Search and persist findings
```text
search "refund timeout incident" | write /reports/refund-incident.txt
```

### 5. Fetch structured data and extract one field
```text
fetch order:123 | json get customer.email
```

### 6. Copy a draft, then inspect the target
```text
cp /drafts/qbr.md /reports/qbr-v1.md && cat /reports/qbr-v1.md
```

### 7. Build a report incrementally
```text
write /reports/acme-summary.txt "Account: Acme Corp"
append /reports/acme-summary.txt "Owner: sara@example.com"
cat /reports/acme-summary.txt
```

### 8. Save distilled memory from a file
```text
cat /accounts/acme.md | head -n 3 | memory store
memory search "Acme owner"
```

### 9. Explore large result sets safely
```text
search "VAT invoice checklist" | write /research/vat.txt
cat /research/vat.txt | grep VAT
```

### 10. Compose computation with retrieval
```text
fetch order:123 | json get amount
calc (1499 * 1.2) / 100
```

---

## Important design choices

### This is not a real shell
The parser intentionally blocks or does not implement:

- environment expansion
- globbing
- command substitution
- redirection
- background tasks

If the model tries those, the parser returns a guided error.

### Paths are rooted
All virtual paths are normalized under `/` and resolved under a root directory you choose. This prevents path escape.

### Binary data is never blindly shown to the model
If a command produces binary output, the runtime stores it in a file and returns guidance instead of dumping entropy into the context window.

### Large output is stored, not stuffed into context
If output is too large, the runtime returns a preview plus:

- total size
- overflow file path
- suggested exploration commands

That turns “too much output” into “navigable output.”

---

## How to wire your own tools

Wrap each backend capability as a command and return text or JSON.

This runtime already includes two adapter slots:

- `search`
- `fetch`

### Search adapter example

```ts
import type { SearchAdapter, SearchHit } from 'one-tool';

class MySearch implements SearchAdapter {
  async search(query: string, limit = 10): Promise<SearchHit[]> {
    const rows = await mySearchBackend.search(query, { limit });

    return rows.map((row) => ({
      title: row.title,
      snippet: row.snippet,
      source: row.url,
    }));
  }
}
```

### Fetch adapter example

```ts
import type { FetchAdapter, FetchResponse } from 'one-tool';

class MyFetch implements FetchAdapter {
  async fetch(resource: string): Promise<FetchResponse> {
    const payload = await myApi.lookup(resource);

    return {
      contentType: 'application/json',
      payload,
    };
  }
}
```

### Build your runtime

```ts
import { createAgentCLI, NodeVFS, SimpleMemory, buildToolDefinition } from 'one-tool';

const runtime = await createAgentCLI({
  vfs: new NodeVFS('./agent_state'),
  adapters: {
    search: new MySearch(),
    fetch: new MyFetch(),
  },
  memory: new SimpleMemory(),
});
```

Expose exactly one model-facing tool:

```ts
export async function run(command: string): Promise<string> {
  return runtime.run(command);
}
```

And build the model-facing tool definition dynamically:

```ts
const tool = buildToolDefinition(runtime);
```

---

## How file manipulation works without a shell

The model sees file commands that feel local:

```text
ls /reports
write /reports/q1.txt "hello"
append /reports/q1.txt "world"
cat /reports/q1.txt
grep hello /reports/q1.txt
mv /reports/q1.txt /archive/q1.txt
```

But there is:

- no shell
- no working directory state
- no direct host filesystem access outside the root
- no wildcard expansion

Everything is routed through a VFS backend such as `NodeVFS`, `MemoryVFS`, or `BrowserVFS`.

That means you can emulate a local file workspace safely while keeping the command pattern the model already understands.

---

## Overflow behavior

When output exceeds 200 lines or 50KB, the runtime returns:

```text
[first preview chunk]

--- output truncated (5000 lines, 245.3KB) ---
Full output: /.system/cmd-output/cmd-0003.txt
Explore: cat /.system/cmd-output/cmd-0003.txt | grep <pattern>
         cat /.system/cmd-output/cmd-0003.txt | tail -n 100
[exit:0 | 45ms]
```

This is one of the most useful behaviors for real agents.

---

## Example demo flow

```text
help
ls /
cat /logs/app.log | grep ERROR | tail -n 5
fetch order:123 | json pretty
search "Acme renewal risk" | write /notes/acme-risk.txt
cat /notes/acme-risk.txt
memory store "Acme wants tighter weekly updates"
memory search "Acme updates"
```

To run the provider-backed agent example:

```bash
npm run agent
# or force OpenAI explicitly
AGENT_PROVIDER=openai npm run agent
```

The example prefers Groq when both keys are present. Set `AGENT_PROVIDER=openai` to switch providers explicitly.

Recommended `.env` setups:

```bash
# Groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-120b

# OpenAI
AGENT_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.2
```

The live integration test is opt-in and follows the same provider resolution as the agent: Groq first when both keys are present, otherwise OpenAI. Use the provider-specific scripts to force one side explicitly:

```bash
npm run test:live
npm run test:live:groq
npm run test:live:openai
```

---

## Why the runtime is async

The original Python reference was synchronous. This TypeScript version is intentionally async so you can plug in:

- databases
- web APIs
- search backends
- RPC services
- queues
- storage layers

without changing the shape of the model-facing tool.

The LLM still sees one tool:

```ts
run(command: string)
```

Internally, each command can await whatever it needs.

---

## Tests

A small Node test suite is included:

```bash
npm run test
```

It covers:

- pipelines
- JSON extraction
- `||` fallback
- file writes/reads
- binary guard behavior

---

## Suggested next extensions

The base implementation is intentionally small. Useful next additions:

- `find`
- `sort`
- `uniq`
- `wc`
- `template`
- `table`
- `csv`
- `http`
- `sql`
- `memory facts`
- topic-scoped file roots
- per-command auth policies
- cost budgets and per-command rate limits

---

## Core takeaway

Give the model a single `run(command)` tool.

Make command discovery happen through:

- help text
- error messages
- consistent output format

Keep execution shell-free.

Keep files rooted.

Keep outputs model-friendly.

That preserves the power of CLI composition without the risks of a real shell.
