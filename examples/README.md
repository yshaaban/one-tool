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

Recommended order:

- Start with `01` through `04` to learn the runtime, familiar command forms, pipelines, and traces.
- Then move to `05` through `08` for adapters, persistence, MCP, and model-driven workflows.

| #   | File                        | What it covers                                                                     |
| --- | --------------------------- | ---------------------------------------------------------------------------------- |
| 01  | `01-hello-world.ts`         | `write`, `cat`, `stat`, `mkdir -p`, `ls`, and the base runtime surface             |
| 02  | `02-custom-command.ts`      | A domain command plus `help ticket`, `ticket list --open`, `write`, and `json get` |
| 03  | `03-readonly-agent.ts`      | The read-only preset with `cat`, `stat`, `find`, `sort`, and `grep`                |
| 04  | `04-detailed-execution.ts`  | Longer composed commands, fallbacks, traces, and `runDetailed()` metadata          |
| 05  | `05-adapters.ts`            | `search`, `fetch`, `json get`, `write`, and `memory search` in one flow            |
| 06  | `06-browser-persistence.ts` | BrowserVFS persistence with `write`, `append`, `cat`, and `stat`                   |
| 07  | `07-mcp-server.ts`          | `serveStdioMcpServer`, `NodeVFS`, and Claude Code setup                            |
| 08  | `08-llm-agent.ts`           | A model using the same command surface through `run(command)`                      |

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
