import {
  CommandRegistry,
  createCommandRegistry,
  type CommandContext,
  type CommandSpec,
  type CreateCommandRegistryOptions,
} from '../commands/index.js';
import { resolveExecutionPolicy } from '../execution-policy.js';
import { SimpleMemory } from '../memory.js';
import { textDecoder, textEncoder, type CommandResult } from '../types.js';
import { MemoryVFS } from '../vfs/memory-vfs.js';

export type CreateTestCommandContextOptions = Partial<CommandContext>;

export interface RunRegisteredCommandOptions {
  ctx?: CommandContext;
  stdin?: Uint8Array;
}

export interface RunRegisteredCommandResult {
  ctx: CommandContext;
  result: CommandResult;
  spec: CommandSpec;
}

export const NO_STDIN = new Uint8Array();

export function createTestCommandRegistry(options: CreateCommandRegistryOptions = {}): CommandRegistry {
  return createCommandRegistry(options);
}

export function createTestCommandContext(overrides: CreateTestCommandContextOptions = {}): CommandContext {
  const registry = overrides.registry ?? createTestCommandRegistry();

  return {
    vfs: overrides.vfs ?? new MemoryVFS(),
    adapters: overrides.adapters ?? {},
    memory: overrides.memory ?? new SimpleMemory(),
    registry,
    executionPolicy: overrides.executionPolicy ?? resolveExecutionPolicy(),
    outputDir: overrides.outputDir ?? '/output',
    outputCounter: overrides.outputCounter ?? 0,
  };
}

export function getRegisteredCommand(name: string, registry: CommandRegistry): CommandSpec {
  const spec = registry.get(name);
  if (!spec) {
    throw new Error(`expected command to exist: ${name}`);
  }
  return spec;
}

export async function runRegisteredCommand(
  name: string,
  args: string[] = [],
  options: RunRegisteredCommandOptions = {},
): Promise<RunRegisteredCommandResult> {
  const ctx = options.ctx ?? createTestCommandContext();
  const spec = getRegisteredCommand(name, ctx.registry);
  const result = await spec.handler(ctx, [...args], options.stdin ?? NO_STDIN);

  return { ctx, result, spec };
}

export function stdoutText(result: CommandResult | Uint8Array): string {
  return textDecoder.decode(result instanceof Uint8Array ? result : result.stdout);
}

export function stdinText(text: string): Uint8Array {
  return textEncoder.encode(text);
}
