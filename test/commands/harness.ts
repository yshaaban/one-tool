import assert from 'node:assert/strict';

import {
  CommandRegistry,
  registerBuiltinCommands,
  type CommandContext,
  type CommandSpec,
} from '../../src/commands/index.js';
import { SimpleMemory } from '../../src/memory.js';
import { textDecoder, textEncoder, type CommandResult, type ToolAdapters } from '../../src/types.js';
import { MemoryVFS } from '../../src/vfs/memory-vfs.js';

export const NO_STDIN = new Uint8Array();

export function makeRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);
  return registry;
}

export function makeCtx(
  overrides: Partial<CommandContext> & { adapters?: ToolAdapters } = {},
): CommandContext {
  const registry = overrides.registry ?? makeRegistry();
  return {
    vfs: overrides.vfs ?? new MemoryVFS(),
    adapters: overrides.adapters ?? {},
    memory: overrides.memory ?? new SimpleMemory(),
    registry,
    outputDir: overrides.outputDir ?? '/output',
    outputCounter: overrides.outputCounter ?? 0,
  };
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
): Promise<{ ctx: CommandContext; result: CommandResult; spec: CommandSpec }> {
  const ctx = options.ctx ?? makeCtx();
  const spec = getSpec(name, ctx.registry);
  const result = await spec.handler(ctx, args, options.stdin ?? NO_STDIN);
  return { ctx, result, spec };
}

export function stdoutText(result: CommandResult | Uint8Array): string {
  return textDecoder.decode(result instanceof Uint8Array ? result : result.stdout);
}

export function stdinText(text: string): Uint8Array {
  return textEncoder.encode(text);
}
