# Examples

Start with the numbered files in this folder. They are ordered from simplest to most integrated.

From a fresh repo checkout:

```bash
npm install
npm run build
npm run demo
```

After the first build, you can also run a source example directly:

```bash
npm exec tsx examples/01-hello-world.ts
```

The npm aliases are the supported way to run the primary set:

```bash
npm run demo
npm run example:custom-command
npm run example:readonly-agent
npm run example:detailed-execution
npm run example:adapters
npm run example:browser-persistence
npm run example:mcp-server
npm run agent
```

## Onboarding path

| #   | File                        | What it shows                                                           |
| --- | --------------------------- | ----------------------------------------------------------------------- |
| 01  | `01-hello-world.ts`         | Create a runtime, run commands, and inspect the single tool definition  |
| 02  | `02-custom-command.ts`      | Add one domain command and use it in pipelines with built-ins           |
| 03  | `03-readonly-agent.ts`      | Restrict the runtime to a safe read-only preset                         |
| 04  | `04-detailed-execution.ts`  | Inspect exit codes, traces, and `runDetailed()` metadata                |
| 05  | `05-adapters.ts`            | Wire `search` and `fetch` adapters into the runtime                     |
| 06  | `06-browser-persistence.ts` | Persist a BrowserVFS workspace with IndexedDB                           |
| 07  | `07-mcp-server.ts`          | Expose the runtime as an MCP tool for Claude Code or another MCP client |
| 08  | `08-llm-agent.ts`           | Connect the runtime to a real LLM provider                              |

Notes:

- Examples `01` through `05` use `MemoryVFS` and need no cleanup.
- Example `06` installs `fake-indexeddb` automatically when it runs in Node.
- Example `08` uses `agent-support.ts` for provider wiring, supports `--self-test`, and requires an API key in `.env` for live provider calls.

## Advanced examples

Advanced examples live in `examples/advanced/`. They cover focused SDK surfaces that are useful after the basics:

- `advanced/command-selection.ts`
- `advanced/command-overrides.ts`
- `advanced/extension-helpers.ts`
- `advanced/overflow-and-binary.ts`
- `advanced/prompt-variants.ts`
- `advanced/scenario-testing.ts`
- `advanced/testing-custom-commands.ts`
- `advanced/http-tool-endpoint.ts`
