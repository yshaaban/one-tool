# one-tool

Single-tool CLI runtime for LLM agents.

`one-tool` gives a model exactly one tool:

```ts
run(command: string)
```

Behind that one entrypoint, the runtime provides:

- shell-like composition with `|`, `&&`, `||`, and `;`
- a rooted virtual file system
- adapter-backed retrieval and fetch commands
- model-friendly output formatting
- command discovery through `help`, usage text, and guided errors

It is built for the common agent problem:

> You want the power of CLI-style composition without exposing a real shell.

<p align="center">
  <img src="docs/diagrams/tool-surface.svg" alt="Diagram showing the model calling run(command), the one-tool runtime dispatching commands, and formatted results returning through rooted files, adapters, and memory." width="980" />
</p>

---

## Documentation map

- Start here:
  - [Why this library exists](#why-this-library-exists)
  - [Quick start](#quick-start)
  - [Five-minute integration](#five-minute-integration)
- Command reference:
  - [Command language overview](#command-language)
  - [Built-in command groups](#built-in-command-groups)
  - full command reference in [`docs/command-reference.md`](docs/command-reference.md)
- API and integration reference:
  - [`docs/api.md`](docs/api.md)
  - [`docs/vfs.md`](docs/vfs.md)
  - [`docs/providers.md`](docs/providers.md)
- Command authoring:
  - [`COMMANDS.md`](COMMANDS.md)
  - runnable example: `npm run example:custom-command`

---

## Why this library exists

Many agent systems expose a large set of narrow tools:

- one tool for file reads
- one tool for file writes
- one tool for search
- one tool for HTTP
- one tool for JSON inspection
- one tool for memory

That often creates three problems:

1. The model has to discover and plan across too many tool boundaries.
2. Multi-step work becomes verbose and brittle.
3. CLI-style reasoning patterns get lost.

`one-tool` takes the opposite approach:

- expose one tool
- make it feel like a small CLI
- keep execution safe and rooted
- make outputs compact, navigable, and recoverable

The result is a model-facing interface that is simpler, but still expressive.

---

## Quick start

### Requirements

- Node `>= 20.11`
- npm

### Run the repo locally

```bash
npm install
npm run build
npm run demo
```

The demo runtime seeds:

- a rooted workspace under `./agent_state`
- example files such as `/logs/app.log`, `/config/prod.json`, and `/accounts/acme.md`
- demo `search` and `fetch` adapters
- seeded in-memory working memory entries

Then try:

```text
help
ls /
cat /logs/app.log | grep -c ERROR
fetch order:123 | json get customer.email
search "refund timeout incident" | write /reports/refund.txt
```

For the provider-backed agent example or live integration tests:

```bash
cp .env.example .env
```

Then fill in either the Groq or OpenAI section described in [`docs/providers.md`](docs/providers.md).

---

## Five-minute integration

### Minimal Node example

```ts
import {
  buildToolDefinition,
  createAgentCLI,
  NodeVFS,
  SimpleMemory,
  type FetchAdapter,
  type FetchResponse,
  type SearchAdapter,
  type SearchHit,
} from 'one-tool';

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

class MyFetch implements FetchAdapter {
  async fetch(resource: string): Promise<FetchResponse> {
    const payload = await myApi.lookup(resource);
    return {
      contentType: 'application/json',
      payload,
    };
  }
}

const runtime = await createAgentCLI({
  vfs: new NodeVFS('./agent_state'),
  adapters: {
    search: new MySearch(),
    fetch: new MyFetch(),
  },
  memory: new SimpleMemory(),
});

export async function run(command: string): Promise<string> {
  return runtime.run(command);
}

const tool = buildToolDefinition(runtime);
```

`mySearchBackend` and `myApi` are placeholders for your own services. The runtime surface stays the same whether those are local libraries, HTTP clients, databases, or SDK calls.

### Example result

For:

```text
cat /logs/app.log | grep -c ERROR
```

The model sees something like:

```text
3

[exit:0 | 2ms]
```

For a missing file:

```text
[error] cat: file not found: /notes/missing.txt. Use: ls /notes

[exit:1 | 0ms]
```

For complete API details, see [`docs/api.md`](docs/api.md).

---

## Common questions

### Why one tool instead of many?

Because the model usually reasons better over one composable tool than a large menu of narrow tools.

- one `run(command)` tool means one schema to understand
- command discovery happens inside the runtime through `help`, usage text, and errors
- compositions like `cat /logs/app.log | grep ERROR | head -n 5` stay in one tool call instead of three
- fewer round trips usually means less brittle planning and less context churn

### How do I choose which commands to enable?

Start with presets:

- `full`
- `readOnly`
- `filesystem`
- `textOnly`
- `dataOnly`

Then refine with explicit includes, excludes, or a custom registry.

Examples and full registry options are documented in [`docs/api.md#command-registry`](docs/api.md#command-registry).

### Which VFS should I use?

| Scenario               | Backend      | Why                                      |
| ---------------------- | ------------ | ---------------------------------------- |
| Server-side agent      | `NodeVFS`    | Persists to disk and survives restarts   |
| Unit tests             | `MemoryVFS`  | Fast, deterministic, no cleanup required |
| Browser agent          | `BrowserVFS` | IndexedDB-backed persistence             |
| Ephemeral/stateless    | `MemoryVFS`  | No persistence overhead                  |
| Long-lived local agent | `NodeVFS`    | Workspace survives process restarts      |

Full backend details: [`docs/vfs.md`](docs/vfs.md)

### Can I add custom commands?

Yes.

- authoring guide: [`COMMANDS.md`](COMMANDS.md)
- runnable custom example: `npm run example:custom-command`
- API details: [`docs/api.md#command-extension-surface`](docs/api.md#command-extension-surface)

### Does this work with my model provider?

The runtime itself is provider-agnostic.

- OpenAI: covered by maintained example and live-test entrypoint
- Groq: covered by maintained example and live-test entrypoint
- other OpenAI-compatible providers: often usable if they support tool calling, but not covered by maintained examples or tests in this repo

Provider details: [`docs/providers.md`](docs/providers.md)

---

## How it works

<p align="center">
  <img src="docs/diagrams/runtime-architecture.svg" alt="Detailed architecture diagram for one-tool showing the model, run tool, AgentCLI, registry, VFS backends, adapters, memory, and final formatted output." width="980" />
</p>

Execution semantics:

- stdout bytes flow through pipes
- stderr does not flow through pipes
- a pipeline stops on the first failed stage
- `&&`, `||`, and `;` control whether the next pipeline runs
- relative paths resolve under `/`
- there is no process environment, cwd mutation, or shell state

The runtime intentionally makes discovery cheap:

- `help` lists commands
- `help <command>` gives details and examples
- calling a command with the wrong shape returns guided usage
- large output becomes navigable output, not useless output

---

## Command language

Supported operators:

| Operator            | Meaning                                                  |
| ------------------- | -------------------------------------------------------- |
| `<code>\|</code>`   | pipe stdout to the next command                          |
| `&&`                | run the next pipeline only if the previous one succeeded |
| `<code>\|\|</code>` | run the next pipeline only if the previous one failed    |
| `;`                 | always run the next pipeline                             |

The parser also supports:

- single quotes
- double quotes
- backslash escaping

This is intentionally not a real shell. It does not implement:

- environment expansion
- globbing
- command substitution
- redirection
- backgrounding

All paths are rooted under `/`. Relative paths also resolve under `/`.

Full syntax, unsupported constructs, and examples: [`docs/command-reference.md#command-language`](docs/command-reference.md#command-language)

---

## Built-in command groups

The runtime ships with 22 built-in commands.

| Group      | Commands                                                                  | Reference                                                                                                |
| ---------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| System     | `help`, `memory`                                                          | [`docs/command-reference.md#system-commands`](docs/command-reference.md#system-commands)                 |
| Filesystem | `ls`, `stat`, `cat`, `write`, `append`, `mkdir`, `cp`, `mv`, `rm`, `find` | [`docs/command-reference.md#filesystem-commands`](docs/command-reference.md#filesystem-commands)         |
| Text       | `grep`, `head`, `tail`, `sort`, `uniq`, `wc`                              | [`docs/command-reference.md#text-commands`](docs/command-reference.md#text-commands)                     |
| Data       | `json`, `calc`                                                            | [`docs/command-reference.md#data-commands`](docs/command-reference.md#data-commands)                     |
| Adapters   | `search`, `fetch`                                                         | [`docs/command-reference.md#adapter-backed-commands`](docs/command-reference.md#adapter-backed-commands) |

Example workflows:

```text
cat /logs/app.log | grep ERROR | tail -n 20
find /config --type file --name "*.json" | sort
search "Acme renewal risk" | head -n 5 | write /notes/acme-risk.txt
fetch order:123 | json get customer.email
```

Full command tables, examples, and workflows: [`docs/command-reference.md`](docs/command-reference.md)

---

## Public API

Primary entrypoints:

| Surface                                          | Purpose                                             | Reference                                                                    |
| ------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `createAgentCLI(...)`                            | create a runtime                                    | [`docs/api.md#core-runtime`](docs/api.md#core-runtime)                       |
| `buildToolDefinition(...)`                       | expose an OpenAI-compatible tool definition         | [`docs/api.md#tool-definition`](docs/api.md#tool-definition)                 |
| `CommandRegistry` / `createCommandRegistry(...)` | select, override, and compose commands              | [`docs/api.md#command-registry`](docs/api.md#command-registry)               |
| `one-tool/testing`                               | test custom commands and conformance                | [`docs/api.md#command-testing-helpers`](docs/api.md#command-testing-helpers) |
| package subpaths                                 | import focused surfaces like `one-tool/vfs/browser` | [`docs/api.md#package-exports`](docs/api.md#package-exports)                 |

Most integrations only need:

- `runtime.run(commandLine)`
- `buildToolDefinition(runtime)`

Full API reference: [`docs/api.md`](docs/api.md)

---

## VFS backends

All backends implement the same `VFS` interface.

| Backend      | Best for                       | Persistence                         | Notes                                |
| ------------ | ------------------------------ | ----------------------------------- | ------------------------------------ |
| `NodeVFS`    | server/runtime agents          | host filesystem under a chosen root | safest default for Node integrations |
| `MemoryVFS`  | tests, demos, ephemeral agents | none                                | fast and deterministic               |
| `BrowserVFS` | browser agents                 | IndexedDB                           | persistent client-side filesystem    |

Full interface, backend behavior, and workspace model: [`docs/vfs.md`](docs/vfs.md)

---

## Provider-backed agent example

This repo includes a maintained provider-backed example agent in `examples/agent.ts`.

```bash
npm run agent
```

Live integration tests are opt-in:

```bash
npm run test:live
npm run test:live:groq
npm run test:live:openai
```

Environment setup, provider selection, and compatibility notes: [`docs/providers.md`](docs/providers.md)

---

## Security model

The runtime is intentionally safer than exposing a real shell, but it is not a complete sandbox.

What it does:

- roots all file paths under `/`
- blocks path escape through normalization
- rejects shell features such as redirection, subshells, backticks, and environment expansion
- never spawns host processes
- routes network access through explicit developer-supplied adapters

What still matters:

- `NodeVFS` touches a real host directory under the root you choose
- `fetch` and `search` can reach real systems if your adapters do
- custom commands can do anything your code does

For production use, treat adapters and custom commands as your trust boundary.

---

## Adding commands

Built-in commands in this repo use metadata-driven conformance coverage, and the same conformance helper is exposed for downstream consumers.

For command authoring:

- full guide: [`COMMANDS.md`](COMMANDS.md)
- runnable example: `npm run example:custom-command`
- API details: [`docs/api.md#command-extension-surface`](docs/api.md#command-extension-surface)

Register custom commands before calling `buildToolDefinition(runtime)` if the model should see them in the generated tool description.

---

## Testing

Main entrypoints:

```bash
npm test
npm run demo
npm run example:custom-command
npm run agent
```

`npm test` includes both deterministic contract tests and deterministic end-to-end scenario tests.

Live provider tests:

```bash
npm run test:live
npm run test:live:groq
npm run test:live:openai
```

Testing helpers and conformance utilities are documented in [`docs/api.md#command-testing-helpers`](docs/api.md#command-testing-helpers). Command authoring patterns live in [`COMMANDS.md`](COMMANDS.md).

---

## Project layout

```text
one-tool/
├─ README.md
├─ COMMANDS.md
├─ docs/
│  ├─ api.md
│  ├─ command-reference.md
│  ├─ providers.md
│  ├─ vfs.md
│  └─ diagrams/
├─ examples/
├─ src/
└─ test/
```

---

## Known limitations

- `run(...)` returns a complete formatted string, not a streaming result
- output formatting is fixed even though the overflow thresholds are configurable
- built-in adapters are limited to `search` and `fetch`; other integrations should be custom commands
- the library does not manage your outer agent loop, retries, token budgets, or provider cost tracking
- access control is at command granularity; if you need subcommand-level policy, expose a narrower command

### Non-goals

- full shell compatibility
- arbitrary process spawning
- shell redirection semantics
- globbing and environment expansion
- hidden mutable runtime state like a working directory
