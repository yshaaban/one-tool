import type { MaybePromise, CommandResult, ToolAdapters } from '../types.js';
import type { VFS } from '../vfs/interface.js';
import type { ResolvedAgentCLIExecutionPolicy } from '../execution-policy.js';
import { compareCLocaleText } from '../c-locale.js';
import { SimpleMemory } from '../memory.js';

export interface CommandSpec {
  name: string;
  summary: string;
  usage: string;
  details: string;
  handler: CommandHandler;
  /**
   * Optional metadata used by the command guide and conformance tests.
   * Built-in commands in this repo are expected to provide the applicable fields.
   */
  acceptsStdin?: boolean;
  minArgs?: number;
  maxArgs?: number;
  requiresAdapter?: keyof ToolAdapters;
  conformanceArgs?: string[];
}

export type CommandHandler = (
  ctx: CommandContext,
  args: string[],
  stdin: Uint8Array,
) => MaybePromise<CommandResult>;

export class CommandRegistry {
  private readonly commands = new Map<string, CommandSpec>();

  register(spec: CommandSpec): void {
    if (this.commands.has(spec.name)) {
      throw new Error(`command already registered: ${spec.name}`);
    }
    this.commands.set(spec.name, spec);
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  get(name: string): CommandSpec | undefined {
    return this.commands.get(name);
  }

  replace(spec: CommandSpec): void {
    if (!this.commands.has(spec.name)) {
      throw new Error(`command not registered: ${spec.name}`);
    }
    this.commands.set(spec.name, spec);
  }

  unregister(name: string): boolean {
    return this.commands.delete(name);
  }

  all(): CommandSpec[] {
    return [...this.commands.values()].sort(function (left, right): number {
      return compareCLocaleText(left.name, right.name);
    });
  }

  names(): string[] {
    return [...this.commands.keys()].sort(compareCLocaleText);
  }
}

export interface CommandContext {
  vfs: VFS;
  adapters: ToolAdapters;
  memory: SimpleMemory;
  registry: CommandRegistry;
  executionPolicy: ResolvedAgentCLIExecutionPolicy;
  outputDir: string;
  outputCounter: number;
}
