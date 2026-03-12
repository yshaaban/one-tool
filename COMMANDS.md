# Adding a Command

The command system is metadata-driven. A new built-in command should be easy to add and should pick up baseline coverage automatically.

## Quick Start

1. Add the handler in `src/commands/groups/<group>.ts` or create a new group file.
2. Export a `CommandSpec` with complete metadata.
3. Add the spec to that group's exported command array.
4. If you created a new group file, register it in `src/commands/register.ts`.
5. Update the command-name snapshot in `test/commands/system.test.ts`.
6. Run `npm test`.

For consumers outside this repo, the public command-registration API lives in:

- `one-tool/commands`
- root exports from `one-tool`
- stable test helpers live in `one-tool/testing`

Built-in group selection uses these string names:

- `'system'`
- `'fs'`
- `'text'`
- `'adapters'`
- `'data'`

These correspond to the exported arrays `systemCommands`, `fsCommands`, `textCommands`, `adapterCommands`, and `dataCommands`.

## Minimal Example

```ts
import { err, ok } from '../../types.js';
import type { CommandContext, CommandSpec } from '../core.js';

async function cmdEcho(_ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (stdin.length > 0) {
    return err('echo: does not accept stdin');
  }
  if (args.length === 0) {
    return err('echo: usage: echo <text...>');
  }
  return ok(args.join(' '));
}

export const echo: CommandSpec = {
  name: 'echo',
  summary: 'Echo arguments back as output.',
  usage: 'echo <text...>',
  details: 'Examples:\n  echo hello world',
  handler: cmdEcho,
  acceptsStdin: false,
  minArgs: 1,
  conformanceArgs: ['hello', 'world'],
};
```

Then add it to the group array:

```ts
export const textCommands: CommandSpec[] = [grep, head, tail, echo];
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
} from 'one-tool/testing';

const registry = createTestCommandRegistry({
  includeGroups: ['system'],
  excludeCommands: ['memory'],
  commands: [echo],
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
} from 'one-tool/testing';

const registry = createTestCommandRegistry({
  includeGroups: ['system'],
  excludeCommands: ['memory'],
  commands: [echo],
});

const ctx = createTestCommandContext({ registry });
const { result } = await runRegisteredCommand('echo', ['hello', 'world'], { ctx });
assert.equal(stdoutText(result), 'hello world');
```

## Handler Contract

- Signature: `(ctx, args, stdin) => CommandResult | Promise<CommandResult>`
- Return `ok(...)`, `okBytes(...)`, or `err(...)`
- Do not throw for user-facing failures
- Conformance tests assume normal usage failures return `err(...)` instead of throwing
- Prefix user-facing errors with the command name, for example `grep: invalid regex: ...`
- Check `stdin.length > 0` for piped input

## Useful Helpers

- `src/commands/shared/errors.ts`
  - `errorCode(...)`
  - `errorPath(...)`
  - `blockingParentPath(...)`
  - `firstFileInPath(...)`
- `src/commands/shared/io.ts`
  - `renderHelp(...)`
  - `readTextFromFileOrStdin(...)`
  - `contentFromArgsOrStdin(...)`
  - `parseNFlag(...)`
- `src/commands/shared/json.ts`
  - `loadJson(...)`
  - `extractJsonPath(...)`
  - `renderFetchPayload(...)`

## Command-Specific Tests

The conformance suite covers the baseline. Add focused behavior tests in the matching file under `test/commands/` for any command-specific logic.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { runCommand, stdoutText } from './harness.js';

test('echo writes arguments back out', async () => {
  const { result } = await runCommand('echo', ['hello', 'world']);
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
- command-specific tests added when behavior needs more than baseline conformance coverage
- reusable conformance coverage still passes through `createCommandConformanceCases(...)`
