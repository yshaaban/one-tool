# Adding a Command

The command system is metadata-driven. A new built-in command should be easy to add and should pick up baseline coverage automatically.

Before expanding built-ins, read [`docs/architecture-principles.md`](docs/architecture-principles.md). New
commands and compatibility work should preserve the one-tool model, rooted workspace semantics, and
measurable command contracts.

Before changing a command, decide which category it belongs to:

- GNU-style subset command
- Unix-inspired, product-shaped command
- product-native one-tool command

The current classification lives in [`docs/parity/compatibility-matrix.md`](docs/parity/compatibility-matrix.md). Do not imply GNU/Linux compatibility for commands outside that subset.

## Quick Start

1. Add the handler in `src/commands/groups/<group>.ts` or create a new group file.
2. Export a `CommandSpec` with complete metadata.
3. Add the spec to that group's exported command array.
4. If you created a new group file, register it in `src/commands/register.ts`.
5. Update the command-name snapshot in `test/commands/system.test.ts`.
6. Run `npm test`.

For consumers outside this repo, the public command-registration API lives in:

- `@onetool/one-tool/commands`
- root exports from `@onetool/one-tool`
- stable authoring helpers live in `@onetool/one-tool/extensions`
- stable test helpers live in `@onetool/one-tool/testing`

Built-in group selection uses these string names:

- `'system'`
- `'fs'`
- `'text'`
- `'adapters'`
- `'data'`

These correspond to the exported arrays `systemCommands`, `fsCommands`, `textCommands`, `adapterCommands`, and `dataCommands`.

## Minimal Example

```ts
import { ok, type CommandContext, type CommandResult, type CommandSpec } from '@onetool/one-tool';
import { stdinNotAcceptedError, usageError } from '@onetool/one-tool/extensions';

async function cmdSay(_ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return stdinNotAcceptedError('say');
  }
  if (args.length === 0) {
    return usageError('say', 'say <text...>');
  }
  return ok(args.join(' '));
}

export const say: CommandSpec = {
  name: 'say',
  summary: 'Write arguments back as output.',
  usage: 'say <text...>',
  details: 'Examples:\n  say hello world',
  handler: cmdSay,
  acceptsStdin: false,
  minArgs: 1,
  conformanceArgs: ['hello', 'world'],
};
```

Then add it to the group array:

```ts
export const textCommands: CommandSpec[] = [grep, head, tail, say];
```

If you create a new group file, also wire it into `src/commands/register.ts`.

## `CommandSpec` Metadata

The built-in commands should set these fields:

- `acceptsStdin`: whether the command accepts piped input
- `minArgs`: minimum required positional arguments
- `maxArgs`: maximum allowed positional arguments when fixed
- `requiresAdapter`: adapter dependency such as `search` or `fetch`
- `conformanceArgs`: representative valid arguments used by the conformance suite

The fields are optional at the type level, but built-in commands in this repo should provide the applicable ones. In practice that means every built-in should set `acceptsStdin`, `minArgs`, and `conformanceArgs`, and should also set `maxArgs` and `requiresAdapter` when those constraints apply. `conformanceArgs` should represent a real invocation that does not throw; it may still return an error result.

## Free Conformance Tests

Every registered built-in command is covered by `test/commands/conformance.test.ts`.

Always generated:

- spec strings and handler are valid
- metadata is internally consistent
- representative call never throws
- zero-arg failure paths mention the command name
- `help <command>` returns the command summary

Generated from metadata:

- `acceptsStdin: false` → rejects stdin with a clear message
- `minArgs > 0` → too few args returns exit `1`
- `maxArgs` → too many args returns exit `1`
- `requiresAdapter` → missing adapter returns a helpful error

The same logic is exported for downstream consumers:

```ts
import {
  createCommandConformanceCases,
  createTestCommandContext,
  createTestCommandRegistry,
} from '@onetool/one-tool/testing';

const registry = createTestCommandRegistry({
  includeGroups: ['system'],
  excludeCommands: ['memory'],
  commands: [say],
});

const cases = createCommandConformanceCases({
  registry,
  makeCtx: createTestCommandContext,
});
```

Each case exposes `commandName`, `name`, and `run()`.

For focused command-level tests, use:

```ts
import assert from 'node:assert/strict';
import {
  createTestCommandContext,
  createTestCommandRegistry,
  runRegisteredCommand,
  stdoutText,
} from '@onetool/one-tool/testing';

const registry = createTestCommandRegistry({
  includeGroups: ['system'],
  excludeCommands: ['memory'],
  commands: [say],
});

const ctx = createTestCommandContext({ registry });
const { result } = await runRegisteredCommand('say', ['hello', 'world'], { ctx });
assert.equal(stdoutText(result), 'hello world');
```

## Handler Contract

- Signature: `(ctx, args, stdin) => CommandResult | Promise<CommandResult>`
- Return `ok(...)`, `okBytes(...)`, or `err(...)`
- Do not throw for user-facing failures
- Conformance tests assume normal usage failures return `err(...)` instead of throwing
- Prefix user-facing errors with the command name, for example `grep: invalid regex: ...`
- Check `stdin.length > 0` for piped input

## Error Handling Patterns

Agent-facing errors should be easy to parse and easy to act on.

Use these rules consistently:

- prefix every error with the command name
- keep the main reason short and concrete
- include a next step when one is obvious
- translate VFS error codes into plain language instead of leaking raw `ENOENT` or `EISDIR`
- reserve fallback `errorMessage(...)` output for genuinely unexpected failures

For many commands, the simplest path is to use the stable helpers from `@onetool/one-tool/extensions` and avoid duplicating input parsing or VFS error translation:

```ts
import { okBytes, type CommandContext, type CommandResult } from '@onetool/one-tool';
import { formatVfsError, stdinNotAcceptedError, usageError } from '@onetool/one-tool/extensions';

async function cmdShow(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return stdinNotAcceptedError('show');
  }
  if (args.length !== 1) {
    return usageError('show', 'show <path>');
  }

  const targetPath = args[0]!;

  try {
    const bytes = await ctx.vfs.readBytes(targetPath);
    return okBytes(bytes, 'application/octet-stream');
  } catch (caught) {
    return formatVfsError(ctx, 'show', targetPath, caught, {
      notFoundLabel: 'file not found',
    });
  }
}
```

For text input that may come from stdin or a file, use the input helpers:

```ts
import { ok, type CommandContext, type CommandResult } from '@onetool/one-tool';
import { readTextInput, usageError } from '@onetool/one-tool/extensions';

async function cmdPreview(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (args.length > 1) {
    return usageError('preview', 'preview [path]');
  }

  const input = await readTextInput(ctx, 'preview', args[0], stdin);
  if (!input.ok) {
    return input.error;
  }

  return ok(input.value.slice(0, 80));
}
```

Good errors in this SDK usually follow one of these shapes:

- `cat: file not found: /notes/todo.txt. Use: ls /notes`
- `cat: path is a directory: /reports. Use: ls /reports`
- `write: parent is not a directory: /reports`
- `grep: invalid regex: Unterminated character class`

## Useful Helpers

- `@onetool/one-tool/extensions`
  - `usageError(...)`
  - `stdinNotAcceptedError(...)`
  - `missingAdapterError(...)`
  - `formatVfsError(...)`
  - `readTextInput(...)`
  - `readBytesInput(...)`
  - `readJsonInput(...)`
  - `parseCountFlag(...)`
  - `defineCommandGroup(...)`
  - `collectCommands(...)`

These are the stable helpers for downstream command authors.

Repo-internal helpers under `src/commands/shared/` still exist for the built-in command implementations in this repository, but they are not the public command-authoring surface.

## Command-Specific Tests

The conformance suite covers the baseline. Add focused behavior tests in the matching file under `test/commands/` for any command-specific logic.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { runCommand, stdoutText } from './harness.js';

test('say writes arguments back out', async () => {
  const { result } = await runCommand('say', ['hello', 'world']);
  assert.equal(result.exitCode, 0);
  assert.equal(stdoutText(result), 'hello world');
});
```

## Checklist

- handler added in the right group file
- `CommandSpec` metadata filled in
- group array updated
- `src/commands/register.ts` updated if needed
- `test/commands/system.test.ts` snapshot updated
- `npm run snapshots` regenerated when the command or its behavior affects committed snapshot coverage
- command-specific tests added when behavior needs more than baseline conformance coverage
- reusable conformance coverage still passes through `createCommandConformanceCases(...)`
