# API Reference

Full API reference for `one-tool`.

For the top-level overview, start with [`../README.md`](../README.md). For command authoring, see [`../COMMANDS.md`](../COMMANDS.md).

---

## Core runtime

### `createAgentCLI(options)`

```ts
import { createAgentCLI, type AgentCLIOptions } from 'one-tool';
```

Creates a fully initialized runtime with the configured command registry.

```ts
interface AgentCLIOptions {
  vfs: VFS;
  adapters?: ToolAdapters;
  memory?: SimpleMemory;
  registry?: CommandRegistry;
  builtinCommands?: BuiltinCommandSelection | false;
  commands?: Iterable<CommandSpec>;
  outputLimits?: AgentCLIOutputLimits;
}

interface AgentCLIOutputLimits {
  maxLines?: number;
  maxBytes?: number;
}
```

`maxLines` and `maxBytes` must be non-negative integers.

Default behavior:

- if you pass neither `registry` nor `builtinCommands`, all built-in commands are registered
- if you pass `builtinCommands`, only the selected built-ins are registered
- if you pass `commands`, they are registered after built-ins and replace built-ins with the same name
- if you pass `registry`, it is used as-is and cannot be combined with `builtinCommands` or `commands`
- if you pass `outputLimits`, they override the default 200-line / 50KB truncation policy

Examples:

```ts
import { createAgentCLI, MemoryVFS } from 'one-tool';

const fullRuntime = await createAgentCLI({
  vfs: new MemoryVFS(),
});

const readOnlyRuntime = await createAgentCLI({
  vfs: new MemoryVFS(),
  builtinCommands: { preset: 'readOnly' },
});
```

To add only your own commands:

```ts
import { createAgentCLI, MemoryVFS } from 'one-tool';

const customOnlyRuntime = await createAgentCLI({
  vfs: new MemoryVFS(),
  builtinCommands: false,
  commands: [myCommand],
});
```

To mix selected built-ins with custom commands:

```ts
import { createAgentCLI, MemoryVFS } from 'one-tool';

const runtime = await createAgentCLI({
  vfs: new MemoryVFS(),
  builtinCommands: {
    includeGroups: ['system', 'text'],
    excludeCommands: ['memory'],
  },
  commands: [myCommand],
});
```

### `AgentCLI`

```ts
class AgentCLI {
  readonly registry: CommandRegistry;
  readonly ctx: CommandContext;

  initialize(): Promise<void>;
  run(commandLine: string): Promise<string>;
  buildToolDescription(): string;
}
```

Most integrations only need:

- `runtime.run(commandLine)`
- `buildToolDefinition(runtime)`

Advanced integrations can also:

- inspect `runtime.registry`
- register custom commands
- access `runtime.ctx`

If you construct `new AgentCLI(options)` directly instead of using `createAgentCLI(options)`, call `await runtime.initialize()` before the first `run(...)` so the internal output directory exists.

---

## Tool definition

### `buildToolDefinition(runtime, toolName?)`

```ts
import { buildToolDefinition } from 'one-tool';

const tool = buildToolDefinition(runtime);
```

Returns an OpenAI-compatible function-tool definition:

```ts
{
  type: 'function',
  function: {
    name: 'run',
    description: '...',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' }
      },
      required: ['command']
    }
  }
}
```

The generated description includes the runtime’s current command list, so register any custom commands before building the tool definition.

The exported `ToolDefinition` type matches this object shape.

---

## Adapters

```ts
interface SearchHit {
  title: string;
  snippet: string;
  source?: string;
}

interface SearchAdapter {
  search(query: string, limit?: number): Promise<SearchHit[]> | SearchHit[];
}

interface FetchResponse {
  contentType: string;
  payload: unknown;
}

interface FetchAdapter {
  fetch(resource: string): Promise<FetchResponse> | FetchResponse;
}

interface ToolAdapters {
  search?: SearchAdapter;
  fetch?: FetchAdapter;
}
```

`search` is intended for ranked textual results.

`fetch` is intended for exact-resource lookup returning text, JSON, or bytes.

---

## Memory

```ts
import { SimpleMemory } from 'one-tool';
```

`SimpleMemory` is an in-process, lightweight working-memory store used by the built-in `memory` command.

---

## Result helpers

For custom commands:

```ts
import { ok, okBytes, err } from 'one-tool';
```

Use:

- `ok(text)`
- `okBytes(bytes, contentType?)`
- `err(message, { exitCode? })`

---

## Command extension surface

For custom commands and advanced integrations, the main extension types are:

```ts
interface CommandSpec {
  name: string;
  summary: string;
  usage: string;
  details: string;
  handler: CommandHandler;
  acceptsStdin?: boolean;
  minArgs?: number;
  maxArgs?: number;
  requiresAdapter?: keyof ToolAdapters;
  conformanceArgs?: string[];
}

type CommandHandler = (
  ctx: CommandContext,
  args: string[],
  stdin: Uint8Array,
) => CommandResult | Promise<CommandResult>;
```

The metadata fields are optional in the public type, but built-in commands in this repo use them so the conformance suite can validate them automatically.

For authoring patterns and examples:

- [`../COMMANDS.md`](../COMMANDS.md)
- `npm run example:custom-command`

---

## Command registry

The command system is also exported directly:

```ts
import { CommandRegistry, createCommandRegistry, registerBuiltinCommands, registerCommands } from 'one-tool';

const registry = new CommandRegistry();
registerBuiltinCommands(registry);
```

You can also register only part of the built-in surface, and control collisions:

```ts
registerBuiltinCommands(
  registry,
  { includeGroups: ['system', 'text'], excludeCommands: ['memory'] },
  { onConflict: 'replace' },
);
```

`CommandRegistry` supports:

- `register(spec)` to add a command
- `has(name)` to check whether a command is registered
- `get(name)` to look up a command
- `replace(spec)` to replace an existing command by name
- `unregister(name)` to remove a command
- `all()` to list all registered specs in sorted order
- `names()` to list command names in sorted order

Most applications do not need to create a separate registry because `AgentCLI` already creates one and exposes it as `runtime.registry`.

If you prefer runtime-level configuration instead of constructing a registry yourself, pass the same built-in selection object through `createAgentCLI({ builtinCommands: ... })`.

For selective built-in enablement:

```ts
import { createCommandRegistry } from 'one-tool';

const registry = createCommandRegistry({
  preset: 'textOnly',
});
```

Valid built-in group names are:

- `'system'`
- `'fs'`
- `'text'`
- `'adapters'`
- `'data'`

Built-in preset names are:

- `'full'`
- `'readOnly'`
- `'filesystem'`
- `'textOnly'`
- `'dataOnly'`

Presets are exported through `builtinCommandPresets` and `builtinCommandPresetNames`.

For easy overrides:

```ts
import { createCommandRegistry, ok, registerCommands, type CommandSpec } from 'one-tool';

const customSearch: CommandSpec = {
  name: 'search',
  summary: 'Search a private corpus.',
  usage: 'search <query>',
  details: 'Examples:\n  search renewal risk',
  async handler(_ctx, args) {
    return ok(`private search for: ${args.join(' ')}`);
  },
};

const registry = createCommandRegistry();
registerCommands(registry, [customSearch], { onConflict: 'replace' });
```

`createCommandRegistry({ commands })` uses `onConflict: 'error'` unless you set a different mode explicitly.

Built-in command groups are exported as:

- `systemCommands`
- `fsCommands`
- `textCommands`
- `adapterCommands`
- `dataCommands`

---

## Command testing helpers

The package exports stable testing helpers under `one-tool/testing`:

```ts
import {
  createCommandConformanceCases,
  createTestCommandContext,
  createTestCommandRegistry,
  runRegisteredCommand,
  stdoutText,
} from 'one-tool/testing';
```

Use `runRegisteredCommand(...)` for focused command tests:

```ts
import assert from 'node:assert/strict';
import {
  createTestCommandContext,
  createTestCommandRegistry,
  runRegisteredCommand,
  stdoutText,
} from 'one-tool/testing';

const registry = createTestCommandRegistry({
  includeGroups: ['system'],
  excludeCommands: ['memory'],
});

const ctx = createTestCommandContext({ registry });
const { result } = await runRegisteredCommand('help', ['help'], { ctx });
assert.match(stdoutText(result), /Usage: help \\[command\\]/);
```

Use `createCommandConformanceCases(...)` for metadata-driven baseline coverage:

```ts
const cases = createCommandConformanceCases({
  registry,
  makeCtx: createTestCommandContext,
});
```

Each case has:

- `commandName`
- `name`
- `run()`

For full command-authoring and test patterns, see [`../COMMANDS.md`](../COMMANDS.md).

---

## Package exports

### Browser import path

The package exposes a browser-specific subpath:

```ts
import { BrowserVFS } from 'one-tool/vfs/browser';
```

You can also import `BrowserVFS` from the root entrypoint when your environment supports it, but the subpath is the clearest browser-specific import.

### Package exports table

| Import path            | Contents                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `one-tool`             | Core runtime, types, command APIs, testing helpers, tool schema, and all VFS backends |
| `one-tool/commands`    | Command registry helpers, built-in command groups, and command specs                  |
| `one-tool/testing`     | Stable command-testing helpers and reusable command conformance helpers               |
| `one-tool/vfs/node`    | `NodeVFS` and deprecated `RootedVFS`                                                  |
| `one-tool/vfs/memory`  | `MemoryVFS`                                                                           |
| `one-tool/vfs/browser` | `BrowserVFS`                                                                          |

---

## Output model

The runtime returns one formatted string per `run(...)` call.

### Successful text output

```text
Customer: Acme Corp
Status: renewal at risk

[exit:0 | 2ms]
```

### User-facing command errors

```text
[error] cat: file not found: /notes/missing.txt. Use: ls /notes

[exit:1 | 0ms]
```

### Binary guard

If a command produces binary bytes, the runtime stores them and returns guidance:

```text
[error] command produced binary output that should not be sent to the model.
Saved to: /.system/cmd-output/cmd-0001.bin
Use: stat /.system/cmd-output/cmd-0001.bin

[exit:0 | 1ms]
```

### Overflow handling

If output exceeds 200 lines or 50KB by default, the runtime stores the full text and returns a preview:

```text
[first preview chunk]

--- output truncated (5000 lines, 245.3KB) ---
Full output: /.system/cmd-output/cmd-0003.txt
Explore: cat /.system/cmd-output/cmd-0003.txt | grep <pattern>
         cat /.system/cmd-output/cmd-0003.txt | tail -n 100

[exit:0 | 45ms]
```

This is a major part of the design: large results become explorable, not destructive to the context window.

You can tune those thresholds:

```ts
import { createAgentCLI, MemoryVFS } from 'one-tool';

const runtime = await createAgentCLI({
  vfs: new MemoryVFS(),
  outputLimits: {
    maxLines: 100,
    maxBytes: 20 * 1024,
  },
});
```

Both values must be non-negative integers.
