import assert from 'node:assert/strict';

import { CommandRegistry, type CommandContext, type CommandSpec } from '../../src/commands/index.js';
import {
  NO_STDIN,
  createTestCommandContext,
  createTestCommandRegistry,
  runRegisteredCommand,
  stdoutText,
  stdinText,
  type RunRegisteredCommandResult,
} from '../../src/testing/index.js';

export { NO_STDIN, stdinText, stdoutText };

export function makeRegistry(): CommandRegistry {
  return createTestCommandRegistry();
}

export function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return createTestCommandContext(overrides);
}

export function getSpec(name: string, registry: CommandRegistry): CommandSpec {
  const spec = registry.get(name);
  assert.ok(spec, `expected command to exist: ${name}`);
  return spec;
}

export async function runCommand(
  name: string,
  args: string[] = [],
  options: { ctx?: CommandContext; stdin?: Uint8Array } = {},
): Promise<RunRegisteredCommandResult> {
  return runRegisteredCommand(name, args, options);
}
